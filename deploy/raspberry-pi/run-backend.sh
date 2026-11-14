#!/usr/bin/env bash
set -euo pipefail
BACKEND_DIR="${BACKEND_DIR:-/home/mustafa/astrovital/backend}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
cd "$BACKEND_DIR"
exec "$BACKEND_DIR/.venv/bin/python" -m uvicorn app.main:app --host 0.0.0.0 --port "$BACKEND_PORT"
