# KIT VOX — Voice Assistant for Knotopian Institute of Technology

KIT VOX is a voice assistant for a college. You ask a question — by speaking or typing — and it answers from the college's own records: attendance, timetables, fees, holidays, placement drives, leave requests. It speaks its answers aloud, and every question and action is logged to the signed-in account.

**Pure React edition.** The whole assistant now runs in the browser: intent recognition, slot filling, confirmation gates and the audit trail live in `frontend/src/lib/localEngine.ts` and persist in `localStorage`. There is no Python backend and nothing to install besides Node.

---

## Quick start

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

Production build:

```bash
npm run build      # outputs frontend/dist (what Vercel deploys)
npm run preview
```

Deploy on Vercel: import the repo with **Root Directory = `frontend`** (Framework: Vite is auto-detected). `vercel.json` at the repo root pins the standard `npm run build` / `dist` settings.

**Sign-in accounts** (password `Kit@2026`):

| Role | Login | What it unlocks |
|---|---|---|
| Student | `arjun` | attendance, timetable, leave / on-duty submission, own requests |
| Teacher | `lakshmi` | pending queue, approve / reject student requests |

Guests can ask about courses, fees, admissions, holidays and exam dates without signing in.

## How it works

- **Voice input** — the browser's built-in Web Speech API (`SpeechRecognition`) transcribes your question (Chrome, Edge, Safari). Firefox and unsupported browsers fall back to typed input with a clear notice.
- **Voice output** — fixed prompts (welcome, confirmations, slot prompts) play as pre-recorded WAVs from `frontend/public/tts/`. Dynamic answers (attendance numbers, timetables…) are spoken with the browser's `speechSynthesis`.
- **Understanding** — `localEngine.ts` matches keywords from `src/data/vocabulary.json` to intents, fills slots (date → reason / event, request ID), and gates every data-changing action behind an explicit yes/no confirmation, mirroring the original backend's agent flows.
- **Audit trail** — every turn is logged per session (visible on the "Audit trail" tab) and kept in `localStorage`.

## Connecting a server engine later (optional)

The UI keeps the exact same REST contract the original backend exposed. To swap the in-browser engine for a server, build with `VITE_API_BASE_URL=https://your-api.example.com` — every call in `src/lib/api.ts` then hits that API (`/api/session`, `/api/turn`, `/api/actions/:id/confirm`, …) instead of the local engine.
