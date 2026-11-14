#!/usr/bin/env bash
# Vercel build entry point.
#
# Vercel caps vercel.json#buildCommand at 256 chars, so the real logic lives here.
# Repo root is derived from this script's location (../), so it works both on
# Vercel and locally without depending on /vercel/path0.
set -euo pipefail

# Resolve repo root as the parent dir of this script (scripts/ -> repo root).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

if [ "${KIT_FRONTEND_BUILD:-}" = "never" ]; then
  # API-only deploy: emit a minimal stub so outputDirectory has something.
  mkdir -p frontend/dist
  printf '%s\n' '<title>KIT VOX API</title>API only. Web app deployed separately.' > frontend/dist/index.html
else
  # Build the Vite frontend. Vite's default outDir is frontend/dist.
  cd frontend
  npm i
  npm run build
  cd "$ROOT"
fi

# Vercel's outputDirectory is "dist", but it may resolve that against either the
# repo root or frontend/ (depending on dashboard "Root Directory"). Mirror the
# build output to the repo-root dist/ as well, so it is found either way.
rm -rf dist
cp -r frontend/dist dist
