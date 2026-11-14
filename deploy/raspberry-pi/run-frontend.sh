#!/usr/bin/env bash
set -euo pipefail
FRONTEND_DIR="${FRONTEND_DIR:-/home/mustafa/astrovital/frontend}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
cd "$FRONTEND_DIR"
test -f dist/index.html || { echo "Compiled frontend is missing" >&2; exit 1; }
exec /usr/bin/python3 -m http.server "$FRONTEND_PORT" --bind 0.0.0.0 --directory "$FRONTEND_DIR/dist"
