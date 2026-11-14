import uuid
import json
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

from backend.db import get_db_connection, q
from backend.schemas import SessionData

SESSION_LIFETIME_HOURS = 24
ACTION_LIFETIME_MINUTES = 5

def current_iso_time() -> str:
    return datetime.now(timezone.utc).isoformat()

def create_session() -> SessionData:
    session_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=SESSION_LIFETIME_HOURS)
    
    conn = get_db_connection()
    with conn:
        conn.execute(q("""
            INSERT INTO sessions (id, role, display_name, created_at, expires_at, last_seen_at)
            VALUES (?, 'public', 'Guest', ?, ?, ?)
        """), (session_id, now.isoformat(), expires.isoformat(), now.isoformat()))
        conn.execute(q("""
            INSERT INTO conversation_state (session_id, state_json, updated_at)
            VALUES (?, ?, ?)
        """), (session_id, json.dumps({}), now.isoformat()))
    conn.close()
    
    return SessionData(
        session_id=session_id,
        role="public",
        display_name="Guest",
        created_at=now.isoformat(),
        expires_at=expires.isoformat()
    )

def get_session(session_id: str) -> Optional[SessionData]:
    conn = get_db_connection()
    row = conn.execute(q("""
        SELECT id, account_id, role, display_name, kit_token, created_at, expires_at, revoked_at
        FROM sessions WHERE id = ?
    """), (session_id,)).fetchone()
    conn.close()
    
    if not row or row["revoked_at"]:
        return None
        
    # Check session expiration
    now = current_iso_time()
    if row["expires_at"] and row["expires_at"] < now:
        return None
        
    return SessionData(
        session_id=row["id"],
        account_id=row["account_id"],
        role=row["role"],
        display_name=row["display_name"],
        kit_token=row["kit_token"],
        created_at=row["created_at"],
        expires_at=row["expires_at"]
    )

def update_session_auth(session_id: str, account_id: str, role: str, display_name: str, kit_token: str) -> None:
    now = current_iso_time()
    conn = get_db_connection()
    with conn:
        conn.execute(q("""
            UPDATE sessions
            SET account_id = ?, role = ?, display_name = ?, kit_token = ?, last_seen_at = ?
            WHERE id = ?
        """), (account_id, role, display_name, kit_token, now, session_id))
    conn.close()

def revoke_session(session_id: str) -> None:
    now = current_iso_time()
    conn = get_db_connection()
    with conn:
        conn.execute(q("""
            UPDATE sessions SET revoked_at = ? WHERE id = ?
        """), (now, session_id))
        conn.execute(q("""
            UPDATE pending_actions SET status = 'CANCELLED', updated_at = ?
            WHERE session_id = ? AND status IN ('PENDING', 'READY_FOR_CONFIRMATION')
        """), (now, session_id))
    conn.close()

def log_turn(session_id: str, account_id: Optional[str], user_text: str, assistant_text: str, intent: Optional[str], module: Optional[str]) -> None:
    now = current_iso_time()
    conn = get_db_connection()
    with conn:
        conn.execute(q("""
            INSERT INTO conversation_turns (session_id, account_id, user_text, assistant_text, intent, module, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """), (session_id, account_id, user_text, assistant_text, intent, module, now))
    conn.close()

def get_history(session_id: str, account_id: Optional[str]) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    if account_id:
        rows = conn.execute(q("""
            SELECT user_text, assistant_text, intent, module, created_at
            FROM conversation_turns
            WHERE account_id = ?
            ORDER BY id ASC
        """), (account_id,)).fetchall()
    else:
        rows = conn.execute(q("""
            SELECT user_text, assistant_text, intent, module, created_at
            FROM conversation_turns
            WHERE session_id = ?
            ORDER BY id ASC
        """), (session_id,)).fetchall()
    conn.close()
    
    return [dict(r) for r in rows]

def get_conversation_state(session_id: str) -> Dict[str, Any]:
    conn = get_db_connection()
    row = conn.execute(q("SELECT state_json FROM conversation_state WHERE session_id = ?"), (session_id,)).fetchone()
    conn.close()
    if row and row["state_json"]:
        return json.loads(row["state_json"])
    return {}

def save_conversation_state(session_id: str, state: Dict[str, Any]) -> None:
    now = current_iso_time()
    conn = get_db_connection()
    with conn:
        conn.execute(q("""
            INSERT INTO conversation_state (session_id, state_json, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
        """), (session_id, json.dumps(state), now))
    conn.close()

# Pending action management
def create_pending_action(
    session_id: str,
    account_id: str,
    tool_name: str,
    intent: str,
    slots: Dict[str, Any],
    summary: str
) -> Dict[str, Any]:
    action_id = str(uuid.uuid4())
    idempotency_key = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=ACTION_LIFETIME_MINUTES)
    
    conn = get_db_connection()
    with conn:
        # Cancel any previous active action for this session to prevent race conditions
        conn.execute(q("""
            UPDATE pending_actions SET status = 'SUPERSEDED', updated_at = ?
            WHERE session_id = ? AND status IN ('PENDING', 'READY_FOR_CONFIRMATION')
        """), (now.isoformat(), session_id))
        
        conn.execute(q("""
            INSERT INTO pending_actions (
                id, session_id, account_id, tool_name, intent, slots_json,
                summary, idempotency_key, status, expires_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'READY_FOR_CONFIRMATION', ?, ?, ?)
        """), (
            action_id, session_id, account_id, tool_name, intent, json.dumps(slots),
            summary, idempotency_key, expires.isoformat(), now.isoformat(), now.isoformat()
        ))
    conn.close()
    
    return {
        "action_id": action_id,
        "tool_name": tool_name,
        "intent": intent,
        "slots": slots,
        "summary": summary,
        "status": "READY_FOR_CONFIRMATION",
        "expires_at": expires.isoformat()
    }

def get_pending_action(action_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    row = conn.execute(q("""
        SELECT id, session_id, account_id, tool_name, intent, slots_json, summary,
               idempotency_key, status, expires_at, result_json, created_at, updated_at
        FROM pending_actions WHERE id = ?
    """), (action_id,)).fetchone()
    conn.close()
    
    if not row:
        return None
    d = dict(row)
    d["slots"] = json.loads(d["slots_json"])
    if d["result_json"]:
        d["result"] = json.loads(d["result_json"])
    return d

def get_active_pending_action_for_session(session_id: str) -> Optional[Dict[str, Any]]:
    now = current_iso_time()
    conn = get_db_connection()
    row = conn.execute(q("""
        SELECT id, session_id, account_id, tool_name, intent, slots_json, summary,
               idempotency_key, status, expires_at, result_json, created_at, updated_at
        FROM pending_actions
        WHERE session_id = ? AND status = 'READY_FOR_CONFIRMATION' AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY created_at DESC LIMIT 1
    """), (session_id, now)).fetchone()
    conn.close()
    
    if not row:
        return None
    d = dict(row)
    d["slots"] = json.loads(d["slots_json"])
    return d

def try_claim_action_for_execution(action_id: str, session_id: str) -> Optional[Dict[str, Any]]:
    """
    Atomically claims a pending action from READY_FOR_CONFIRMATION -> EXECUTING.
    Prevents race conditions between voice and UI button confirmations.
    """
    now = current_iso_time()
    conn = get_db_connection()
    try:
        with conn:
            row = conn.execute(q("""
                SELECT id, session_id, account_id, tool_name, intent, slots_json, summary,
                       idempotency_key, status, expires_at, result_json, created_at, updated_at
                FROM pending_actions
                WHERE id = ? AND session_id = ?
            """), (action_id, session_id)).fetchone()
            
            if not row:
                return None
                
            if row["expires_at"] and row["expires_at"] < now:
                conn.execute(q("UPDATE pending_actions SET status = 'EXPIRED', updated_at = ? WHERE id = ?"), (now, action_id))
                return None
                
            if row["status"] != "READY_FOR_CONFIRMATION":
                return None
                
            cursor = conn.execute(q("""
                UPDATE pending_actions
                SET status = 'EXECUTING', updated_at = ?
                WHERE id = ? AND status = 'READY_FOR_CONFIRMATION'
            """), (now, action_id))
            
            if cursor.rowcount == 0:
                return None
                
        d = dict(row)
        d["slots"] = json.loads(d["slots_json"])
        return d
    finally:
        conn.close()

def update_action_status(action_id: str, status: str, result: Optional[Dict[str, Any]] = None) -> None:
    now = current_iso_time()
    conn = get_db_connection()
    with conn:
        conn.execute(q("""
            UPDATE pending_actions
            SET status = ?, result_json = ?, updated_at = ?
            WHERE id = ?
        """), (status, json.dumps(result) if result else None, now, action_id))
    conn.close()
