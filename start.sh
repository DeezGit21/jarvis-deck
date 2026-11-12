#!/usr/bin/env bash
# JARVIS Deck one-command launcher (macOS / Linux / git-bash)
# Starts the FastAPI backend on 127.0.0.1:8785 and the web deck on http://localhost:4527
set -e
cd "$(dirname "$0")"

[ -d node_modules ] || npm install

if [ ! -d .venv ]; then
  echo "Creating python virtualenv..."
  python3 -m venv .venv
fi
./.venv/bin/python -m pip install -q -r requirements.txt

echo "Starting backend on http://127.0.0.1:8785 ..."
./.venv/bin/python -m uvicorn standalone:app --app-dir dashboard --host 127.0.0.1 --port 8785 &
BACKEND_PID=$!
trap 'kill $BACKEND_PID 2>/dev/null' EXIT

echo "Building + serving the deck on http://localhost:4527 ..."
npm run build
npx vite preview --port 4527 --strictPort
