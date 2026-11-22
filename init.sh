#!/usr/bin/env bash
# Start the API from the repository root.
# The FastAPI package is backend/app, so uvicorn must run with backend/ as its
# working directory. The map UI is a separate process: see README.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT/backend"

if [[ -x "$ROOT/.venv/bin/python" ]]; then
  PYTHON="$ROOT/.venv/bin/python"
elif [[ -x "$ROOT/backend/.venv/bin/python" ]]; then
  PYTHON="$ROOT/backend/.venv/bin/python"
else
  echo "No virtualenv found. From the repository root, run:" >&2
  echo "  python3 -m venv .venv && source .venv/bin/activate && python -m pip install -r backend/requirements.txt" >&2
  exit 1
fi

exec "$PYTHON" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
