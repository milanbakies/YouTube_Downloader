#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

APP_URL="http://127.0.0.1:4317"
PORT=4317

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js/npm not found. Install Node 20+ or run: nvm use default"
  read -r -p "Press Enter to close…"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing npm dependencies…"
  npm install
fi

if [ ! -f .env.local ] && [ -f .env.example ]; then
  cp .env.example .env.local
  echo "Created .env.local (YouTube cookies via Chrome)."
fi

# Logged-in Chrome cookies — needed after a few downloads when YouTube bot-checks.
export YT_DLP_COOKIES_FROM_BROWSER="${YT_DLP_COOKIES_FROM_BROWSER:-chrome}"
echo "Using browser cookies: ${YT_DLP_COOKIES_FROM_BROWSER} (allow Keychain if macOS asks)"

echo "Stopping anything on port ${PORT}…"
for _ in 1 2; do
  PIDS=$(lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN -t 2>/dev/null || true)
  if [ -z "${PIDS}" ]; then
    break
  fi
  kill ${PIDS} 2>/dev/null || true
  sleep 1
done
PIDS=$(lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN -t 2>/dev/null || true)
if [ -n "${PIDS}" ]; then
  kill -9 ${PIDS} 2>/dev/null || true
  sleep 1
fi

(
  for _ in $(seq 1 90); do
    if curl -sf --max-time 2 "${APP_URL}/api/health" >/dev/null 2>&1; then
      open "${APP_URL}"
      exit 0
    fi
    sleep 1
  done
  echo "Server did not become ready in time; open ${APP_URL} manually."
) &

echo "Starting YouTube Downloader on ${APP_URL}"
echo "Leave this window open while converting. Close it or press Ctrl+C to stop the server."
exec npm run dev:force
