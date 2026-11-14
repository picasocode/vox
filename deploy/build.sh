#!/usr/bin/env bash
# Vercel build entry for this repository. Supports two deployment modes:
#
#   Single project (default):   builds the React frontend AND exposes the
#                               FastAPI backend as the /api serverless function.
#
#   Two projects (API project): set the environment variable
#                               KIT_FRONTEND_BUILD=never on the API project.
#                               The frontend is then deployed separately from
#                               the frontend/ directory (see README.md), and
#                               this script skips npm entirely and writes a
#                               small placeholder page instead.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${KIT_FRONTEND_BUILD:-auto}" = "never" ]; then
  mkdir -p frontend/dist
  cat > frontend/dist/index.html <<'HTML'
<!doctype html>
<html><head><meta charset="utf-8"><title>KIT VOX API</title></head>
<body style="font-family:system-ui;padding:2rem">
<h1>KIT VOX API</h1>
<p>This project serves the backend only. The web app is deployed separately.</p>
<p><a href="/api/health">/api/health</a></p>
</body></html>
HTML
  echo "[build] KIT_FRONTEND_BUILD=never -> skipped frontend build (API-only project)"
else
  cd frontend
  npm install
  npm run build
fi
