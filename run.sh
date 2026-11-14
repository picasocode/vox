#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# KIT VOX — install dependencies and start the app (Linux / macOS)
#
# Usage:
#   ./run.sh                 # install + start on http://127.0.0.1:8000
#   PORT=9000 ./run.sh       # start on a different port
#
# The frontend ships prebuilt in frontend/dist, so npm/Node is only needed
# if you want to rebuild it after changing frontend source code.
# ---------------------------------------------------------------------------
set -e
cd "$(dirname "$0")"

PORT="${PORT:-8000}"
HOST="${HOST:-127.0.0.1}"

# Pick a Python interpreter
PY=python3
command -v python3 >/dev/null 2>&1 || PY=python
echo "Using Python: $($PY --version 2>&1)"

echo
echo "[1/4] Installing Python dependencies (requirements.txt)..."
"$PY" -m pip install --quiet --disable-pip-version-check -r requirements.txt \
  || { echo "  pip install failed. Try: $PY -m pip install --upgrade pip"; exit 1; }
echo "  done."

if [ ! -f frontend/dist/index.html ]; then
  echo "[2/4] frontend/dist missing - building the frontend..."
  command -v npm >/dev/null 2>&1 || { echo "  npm not found. Install Node.js 18+ and re-run."; exit 1; }
  (cd frontend && ([ -d node_modules ] || npm install --no-audit --no-fund) && npm run build)
  echo "  done."
else
  echo "[2/4] Prebuilt frontend found in frontend/dist - skipping build."
fi

echo "[3/4] Starting KIT VOX at http://$HOST:$PORT"
echo "      (Student: arjun / Kit@2026   Faculty: lakshmi / Kit@2026)"
echo

echo "[4/4] Opening your browser..."
( sleep 3
  xdg-open "http://$HOST:$PORT" >/dev/null 2>&1 \
  || open "http://$HOST:$PORT" >/dev/null 2>&1 \
  || true ) &

exec "$PY" -m uvicorn backend.app:app --host "$HOST" --port "$PORT"
