#!/usr/bin/env bash
# Start Pairwise locally. Uses Node if available, otherwise Python.
cd "$(dirname "$0")"
PORT="${PORT:-3000}"
if command -v node >/dev/null 2>&1; then
  PORT="$PORT" exec node server.js
elif command -v python3 >/dev/null 2>&1; then
  echo "Pairwise running at http://localhost:$PORT"
  exec python3 -m http.server "$PORT" --directory public
else
  echo "Install Node.js (18+) or Python 3 to run this app." >&2
  exit 1
fi
