import base64
from pathlib import Path
from typing import Optional, Dict, Any
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Depends, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.config import settings
from backend.schemas import SessionData, TurnRequest, TurnResponse, LoginRequest
from backend.session_manager import (
    create_session, get_session, update_session_auth, revoke_session,
    get_history, get_pending_action, try_claim_action_for_execution,
    update_action_status
)
from backend.asr.phrase_recognizer import PhraseRecognizer
from backend.agents.orchestrator import orchestrator
from backend.tools.kit_client import kit_client
from backend.tts.synthesizer import tts_synthesizer

app = FastAPI(
    title="KIT VOX Backend",
    description="Voice and text college assistant for Knotopian Institute of Technology",
    version="1.0.0"
)

# CORS configuration for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount local recorded TTS audio assets
settings.tts_dir.mkdir(parents=True, exist_ok=True)
app.mount("/tts", StaticFiles(directory=str(settings.tts_dir)), name="tts")

phrase_recognizer = PhraseRecognizer()

@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "templates_loaded": len(phrase_recognizer.template_manager.get_templates()),
        "tts_assets_loaded": len(list(settings.tts_dir.glob("*.wav"))),
        "environment": settings.environment,
        "sample_rate": settings.sample_rate,
        "kit_backend": "MOCK (in-memory, not the real KIT API)" if settings.kit_use_mock else "REAL",
        "kit_key_configured": bool(settings.kit_participant_key)
    }

@app.post("/api/session")
def start_session():
    session = create_session()
    return session

@app.get("/api/me")
def get_current_user(session_id: str):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return session

@app.post("/api/login")
def login(req: LoginRequest):
    session = get_session(req.session_id)
    if not session:
        session = create_session()

    # Authenticate via KIT API (or mock fallback)
    auth_res = kit_client.login(req.username, req.password)
    if not auth_res.get("success"):
        raise HTTPException(status_code=401, detail=auth_res.get("error", "Invalid credentials"))

    user = auth_res.get("user", {})
    actual_role = user.get("role", req.role)
    account_id = str(user.get("id", user.get("login_id", req.username)))
    display_name = f"{user.get('full_name', req.username)} ({actual_role.capitalize()})"
    token = auth_res.get("access_token", "")

    update_session_auth(
        session_id=session.session_id,
        account_id=account_id,
        role=actual_role,
        display_name=display_name,
        kit_token=token
    )

    return {
        "success": True,
        "session_id": session.session_id,
        "role": actual_role,
        "display_name": display_name,
        "account_id": account_id
    }

@app.post("/api/logout")
def logout(session_id: str):
    revoke_session(session_id)
    return {"success": True, "message": "Logged out successfully."}

@app.post("/api/asr")
def process_audio(file: UploadFile = File(...)):
    audio_bytes = file.file.read()
    result = phrase_recognizer.recognize_wav_bytes(audio_bytes)
    return result

@app.post("/api/turn", response_model=TurnResponse)
def process_turn(req: TurnRequest):
    recognized_text = None
    asr_confidence = 1.0

    if req.audio_base64:
        try:
            audio_bytes = base64.b64decode(req.audio_base64)
            asr_res = phrase_recognizer.recognize_wav_bytes(audio_bytes)
            if asr_res.get("success"):
                recognized_text = asr_res.get("recognized_text")
                asr_confidence = asr_res.get("confidence", 1.0)
            elif asr_res.get("rejected"):
                # Insufficient recognition confidence -> ask user to repeat
                repeat_text = "I didn't quite catch that. Could you please repeat your request?"
                return TurnResponse(
                    session_id=req.session_id,
                    assistant_text=repeat_text,
                    audio_url="/tts/repeat_prompt.wav",
                    needs_confirmation=False,
                    error="confidence_insufficient"
                )
        except Exception as e:
            return TurnResponse(
                session_id=req.session_id,
                assistant_text="Error decoding audio input. Please type your message instead.",
                audio_url="/tts/error.wav",
                error=str(e)
            )

    # Route through orchestrator
    res = orchestrator.handle_turn(
        session_id=req.session_id,
        user_text=req.text or "",
        recognized_audio_text=recognized_text
    )

    # Generate matching local TTS audio
    audio_url = tts_synthesizer.get_audio_url_for_turn(
        intent=res.get("intent"),
        assistant_text=res["assistant_text"],
        module=res.get("module"),
        needs_confirmation=res.get("needs_confirmation", False)
    )

    return TurnResponse(
        session_id=res["session_id"],
        recognized_text=res.get("recognized_text") or recognized_text,
        intent=res.get("intent"),
        module=res.get("module"),
        assistant_text=res["assistant_text"],
        audio_url=audio_url,
        pending_action=res.get("pending_action"),
        needs_confirmation=res.get("needs_confirmation", False),
        context=res.get("context")
    )

@app.post("/api/actions/{action_id}/confirm")
def confirm_action(action_id: str, session_id: str):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=401, detail="Session expired or invalid")

    # Atomic claim to prevent double-execution races
    claimed = try_claim_action_for_execution(action_id, session_id)
    if not claimed:
        raise HTTPException(
            status_code=400,
            detail="Action is expired, already confirmed, or in an invalid state"
        )

    result = orchestrator.execute_pending_tool(claimed, token=session.kit_token)

    if result.get("success"):
        update_action_status(action_id, "SUCCEEDED", result)
        msg = f"Action confirmed successfully. {result.get('message', '')}"
    else:
        update_action_status(action_id, "FAILED", result)
        msg = f"Action execution failed: {result.get('error', 'Unknown error')}"

    return {
        "success": result.get("success", False),
        "message": msg,
        "result": result,
        "audio_url": "/tts/action_confirmed.wav" if result.get("success") else "/tts/error.wav"
    }

@app.post("/api/actions/{action_id}/cancel")
def cancel_action(action_id: str, session_id: str):
    pending = get_pending_action(action_id)
    if not pending or pending["session_id"] != session_id:
        raise HTTPException(status_code=404, detail="Pending action not found")

    update_action_status(action_id, "CANCELLED")
    return {
        "success": True,
        "message": "Action cancelled successfully.",
        "audio_url": "/tts/action_cancelled.wav"
    }

@app.get("/api/history")
def get_account_history(session_id: str):
    session = get_session(session_id)
    if not session:
        return []
    return get_history(session_id, session.account_id)

@app.get("/api/public/info")
def public_info():
    info = kit_client.get_college_info()
    courses = kit_client.get_courses()
    placements = kit_client.get_placement_drives()
    today = kit_client.get_today()
    return {"college": info, "courses": courses, "placements": placements, "today": today}

# Serve the built frontend (frontend/dist) from this same server.
# Mounted LAST so every /api and /tts route above keeps priority.
_frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=str(_frontend_dist), html=True), name="frontend")
