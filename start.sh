#!/usr/bin/env sh
# Start a local static server:  ./start.sh [port]
cd "$(dirname "$0")" || exit 1
PORT="${1:-5173}"
if command -v node >/dev/null 2>&1; then exec node scripts/serve.mjs "$PORT"; fi
if command -v python3 >/dev/null 2>&1; then echo "http://localhost:$PORT/"; exec python3 -m http.server "$PORT"; fi
echo "Need Node.js or Python 3." >&2; exit 1
