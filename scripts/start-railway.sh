#!/bin/sh
set -e

echo "================================================================"
echo "  Aspreen TV — Railway Production Entrypoint"
echo "================================================================"

# Create storage directory for HLS output
mkdir -p "${STREAM_STORAGE_PATH:-/app/data/hls}"

# Default public port set by Railway
PUBLIC_PORT="${PORT:-3000}"
INTERNAL_API_PORT="3001"

echo "[Aspreen TV] Starting Fastify API on internal port ${INTERNAL_API_PORT}..."
PORT=${INTERNAL_API_PORT} HOST=0.0.0.0 node apps/api/dist/index.js &
API_PID=$!

echo "[Aspreen TV] Waiting for API to become ready..."
sleep 2

echo "[Aspreen TV] Starting Next.js Web on public port ${PUBLIC_PORT}..."
INTERNAL_API_URL="http://127.0.0.1:${INTERNAL_API_PORT}" npm run start --prefix apps/web -- -p ${PUBLIC_PORT} &
WEB_PID=$!

cleanup() {
  echo "[Aspreen TV] Stopping services..."
  kill -TERM "$API_PID" 2>/dev/null || true
  kill -TERM "$WEB_PID" 2>/dev/null || true
  wait "$API_PID" 2>/dev/null || true
  wait "$WEB_PID" 2>/dev/null || true
  exit 0
}

trap cleanup INT TERM

# Wait for both processes
wait -n "$API_PID" "$WEB_PID"
