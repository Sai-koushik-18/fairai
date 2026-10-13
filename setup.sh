#!/bin/bash

echo ""
echo "======================================"
echo "  FairAI - Setup Script"
echo "  Google Solution Challenge 2026"
echo "======================================"
echo ""

# ── BACKEND SETUP ──────────────────────────────────────────
echo "[1/4] Setting up Python backend..."
cd backend

# FairAI pins numpy 1.26.4, which has no wheels for Python 3.13+.
# Pick a 3.12 interpreter explicitly.
PY_CMD=""
for candidate in python3.12 python3 python; do
  if command -v "$candidate" >/dev/null 2>&1; then
    ver=$("$candidate" -c 'import sys;print("%d.%d"%sys.version_info[:2])' 2>/dev/null)
    if [ "$ver" = "3.12" ]; then PY_CMD="$candidate"; break; fi
  fi
done

if [ -z "$PY_CMD" ]; then
  echo "ERROR: Python 3.12 not found."
  echo "FairAI requires Python 3.12.x (numpy 1.26.4 has no 3.13+ wheels)."
  echo "Install from https://www.python.org/downloads/release/python-3129/"
  exit 1
fi

"$PY_CMD" -m venv venv
if [ $? -ne 0 ]; then
  echo "ERROR: could not create virtualenv with $PY_CMD"
  exit 1
fi

source venv/bin/activate
pip install -r requirements.txt -q

if [ -z "$GEMINI_API_KEY" ]; then
  echo ""
  echo ">>> Enter your Gemini API Key (free at https://aistudio.google.com):"
  read -r key
  export GEMINI_API_KEY="$key"
  echo "GEMINI_API_KEY=$key" >> .env
fi

echo "[1/4] Backend ready!"

# ── FRONTEND SETUP ─────────────────────────────────────────
cd ../frontend
echo "[2/4] Installing React dependencies (may take 2-3 minutes)..."
npm install -q
echo "[2/4] Frontend ready!"

echo ""
echo "======================================"
echo "  Setup complete! Now run:"
echo ""
echo "  Terminal 1 (backend):"
echo "  cd backend && source venv/bin/activate && python app.py"
echo ""
echo "  Terminal 2 (frontend):"
echo "  cd frontend && npm start"
echo ""
echo "  Open: http://localhost:3000"
echo "======================================"
