# KIT VOX — Voice Assistant for Knotopian Institute of Technology

KIT VOX is a voice assistant for a college. You ask a question — by speaking or typing — and it answers from the college's own records: attendance, timetables, fees, holidays, placement drives, leave requests. It speaks its answers aloud, and every question and action is logged to the signed-in account.

Replies are spoken aloud as pre-recorded audio, and every request that changes college data always asks for explicit confirmation first.

---

## Quick start

### Windows
Double-click **`run.bat`** (or run it from a terminal). It installs the Python dependencies, starts the server, and opens `http://127.0.0.1:8000` in your browser.

### Linux / macOS
```bash
./run.sh
```

Both scripts do the same four things:
1. Install Python dependencies from `backend/requirements.txt`
2. Check the prebuilt frontend in `frontend/dist` (included, so nothing to build)
3. Start the server with Uvicorn
4. Open your browser

Stop the server with `Ctrl+C`. To use another port: `PORT=9000 ./run.sh` (Linux/macOS) or edit `PORT` at the top of `run.bat` (Windows).

**Sign-in accounts** (also shown on the login screen, password `Kit@2026` for all):

| Role | Login | What it unlocks |
|---|---|---|
| Student | `arjun` | Own attendance, timetable, exams, holidays, leave and on-duty requests |
| Faculty | `lakshmi` | Pending student requests, approve / reject, holidays |
| Guest (no sign-in) | — | College info, programmes, fees, admissions, placements, documents |

---

## Running with or without the code

You do **not** need Node.js or any build step to use the app — the compiled frontend is included in `frontend/dist` and the server serves it directly.

**Option A — run the finished app (no code, no build):**
```bash
python3 -m pip install -r backend/requirements.txt
python3 -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```
Open http://127.0.0.1:8000. That's the whole story; `run.sh` / `run.bat` automate exactly this.

**Option B — work on the code (frontend hot reload):**
```bash
# Terminal 1 — backend
python3 -m pip install -r backend/requirements.txt
python3 -m uvicorn backend.app:app --port 8000

# Terminal 2 — frontend dev server (rebuilds on save)
cd frontend
npm install          # once
npm run dev          # serves on http://127.0.0.1:5173, proxies /api to :8000
```
Use the 5173 address while developing. When you're happy with changes, rebuild the bundled frontend so the standalone server picks them up:
```bash
cd frontend && npm run build
```
The production build is written to `frontend/dist`, which `backend/app.py` serves automatically.

**Backend-only changes** (anything under `backend/`) need no build at all — just restart Uvicorn.

---

## What it can do

| You say… | It does… |
|---|---|
| "Show my attendance" | Reads your live attendance from the college system, subject by subject |
| "Show my timetable" / "What are my exams?" / "Show holidays" | Reads the academic calendar for your account |
| "I need leave" | Asks for the date and reason, checks the exam calendar, and blocks dates that clash with an exam |
| "Apply for on duty" | Same guided flow for on-duty requests |
| "Show my requests" | Lists your submitted requests and their status |
| "Show pending requests" → "Approve REQ-…" | Faculty review: nothing is approved until you confirm |
| "Tell me about KIT" / course and fee questions | Answers public college information |

Two-step safety: for anything that writes data (leave, on-duty, approve, reject) the assistant shows exactly what will be submitted and waits for an explicit yes. Cancelling leaves the college data untouched.

The **Audit trail** tab shows the full conversation history for the signed-in account, including which intent handled each turn — required by college regulation 12.4.

---

## How it's built

```text
Browser (React + Vite + TypeScript)
  ├── Voice mode: microphone → 16 kHz WAV → base64 → /api/turn
  └── Text mode:  typed command  ────────────► /api/turn
                         │
              FastAPI backend (backend/)
               ├── Speech recognition: matches the recording against spoken
               │   templates; rejects unclear speech by margin
               ├── TF-IDF intent classifier + slot filling (dates, request IDs)
               ├── Deterministic orchestrator → per-module agents
               ├── Policy engine: fail-closed checks (exam clashes, role, session)
               ├── Confirmation state machine for every write action
               └── SQLite session store + audit log
                         │
        College system (ht.knowvally.com) — live REST API
        (auth, attendance, timetable, calendar, requests, placements)
```

Key files:

| Path | What lives there |
|---|---|
| `backend/app.py` | FastAPI routes: `/api/turn`, `/api/login`, `/api/actions/…/confirm`, `/api/history`, `/api/public/info` |
| `backend/asr/` | Speech recognition: template matching, voice activity detection, feature extraction |
| `backend/tools/kit_client.py` | Client for the college REST API, with a built-in mock for testing |
| `backend/agents/` | One deterministic agent per module (admissions, academics, requests, …) |
| `backend/data/templates/` | Spoken templates the recognizer matches against |
| `frontend/src/pages/` | Home, Assistant (voice + text), Audit trail |
| `frontend/public/knotopian-logo.webp` | College logo used in the masthead |

## Connecting to the college system

`backend/.env` holds the connection settings:

```ini
KIT_API_BASE_URL=https://ht.knowvally.com
KIT_PARTICIPANT_KEY=<your key>
KIT_USE_MOCK=false
```

Every request to the college system sends your key in the `X-Participant-Key` header; student and faculty data additionally uses a login token from `/v1/auth/login` (valid 8 hours). Set `KIT_USE_MOCK=true` to run the whole app against the built-in mock data instead — useful for demos and local testing, and the test suite always uses the mock.

## Deploying to Vercel

The repo supports two deployment styles. **Option A is the simplest — start there.** Both use the same repository; no code changes are needed either way.

### Option A — one project (frontend + backend together)

The React frontend is served by Vercel's CDN and the FastAPI backend runs as a Python serverless function behind `/api/*` and `/tts/*` (configured by `vercel.json`).

1. Push this repository to GitHub.
2. In Vercel: **Add New → Project → Import** the repo. All build settings are read from `vercel.json` — leave everything on auto-detect.
3. Add environment variables (**Settings → Environment Variables**):

   | Variable | Value | Required |
   |---|---|---|
   | `KIT_API_BASE_URL` | `https://ht.knowvally.com` | yes |
   | `KIT_PARTICIPANT_KEY` | your college API key | for live data |
   | `KIT_USE_MOCK` | `false` | recommended (omit → mock data) |

4. **Deploy.** One `*.vercel.app` URL serves everything; microphone permission works automatically (HTTPS).

### Option B — two projects (API + web, deployed separately)

Use this if you want the backend and frontend as independent Vercel projects (e.g. to redeploy the UI without touching the API).

**Project 1 — API**

1. Import the same repo as a new project (name it e.g. `vox-api`).
2. Root Directory: leave as the repository root.
3. Environment variables:

   | Variable | Value | Why |
   |---|---|---|
   | `KIT_API_BASE_URL` | `https://ht.knowvally.com` | college API |
   | `KIT_PARTICIPANT_KEY` | your college API key | live data |
   | `KIT_USE_MOCK` | `false` | recommended |
   | `KIT_FRONTEND_BUILD` | `never` | skips the frontend build inside the API project (handled by `vercel.json`) — it serves only `/api/*` and `/tts/*` |

4. **Deploy.** Open `https://vox-api-….vercel.app/api/health` — it should return `{"status":"healthy",…}`. Keep this URL.

**Project 2 — Web**

1. Import the same repo again as a second project (name it e.g. `vox-web`).
2. **Root Directory: `frontend`** (Settings → General → Root Directory). Vercel auto-detects Vite; no other build settings needed.
3. Environment variables:

   | Variable | Value | Why |
   |---|---|---|
   | `VITE_API_BASE_URL` | `https://vox-api-….vercel.app` (Project 1's URL, no trailing slash) | tells the app where the API and voice audio live |

4. **Deploy.** Set the variable *before* deploying (it is baked into the build). Changing it later requires a redeploy.

### Notes for both options

- Local development never needs these variables: `./run.sh` works unchanged, and `npm run dev` proxies to `127.0.0.1:8000`.
- On Vercel the SQLite database lives in the function's `/tmp` (ephemeral per instance — fine for a demo). Locally it lives next to the code.
- All environment variables are listed with comments in `.env.example` (repo root) and `backend/.env.example`.
- CLI alternative: `npm i -g vercel && vercel --prod` from the repo root (Option A).

## Tests

```bash
python3 -m pytest -q
```

Covers the recognizer (feature shapes, template matching, rejection), NLU, agents, confirmation flow, and API routes — 18 tests, all currently passing.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "address already in use" on startup | Another server is on port 8000. `PORT=9000 ./run.sh`, or stop the old process. |
| Microphone shows "access denied" | Allow microphone permission for the site, or use Text mode — every command works typed. |
| Browser opens before the server is ready | Refresh after a second; the scripts wait ~3 s but slow machines can vary. |
| College system unreachable | Set `KIT_USE_MOCK=true` in `backend/.env` to demo on mock data. |
| `pip install` fails on Linux | Run `python3 -m pip install --upgrade pip` first, then re-run `./run.sh`. |
| Want to change the UI | Edit files in `frontend/src/`, then `cd frontend && npm run build` (Node 18+). |

## Compliance notes

- Spoken replies are pre-recorded, locally served audio files, played at normal speed.
- Role checks are enforced server-side on every request; write actions require explicit confirmation; history is scoped to the authenticated account.
