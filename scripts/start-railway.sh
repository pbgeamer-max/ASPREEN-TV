#!/bin/bash
 
echo "================================================================"
echo "  Aspreen TV — Railway Production Entrypoint"
echo "================================================================"

# Create storage directory for HLS output
mkdir -p "${STREAM_STORAGE_PATH:-/app/data/hls}"

# Default public port set by Railway
PUBLIC_PORT="${PORT:-3000}"
INTERNAL_API_PORT="3001"
INTERNAL_STREAM_PORT="8088"

# 1. Run 24/7 Stream Proxy Daemon in a supervised loop
run_stream_proxy() {
  while true; do
    echo "[Aspreen TV] Starting 24/7 Stream Proxy Daemon on internal port ${INTERNAL_STREAM_PORT}..."
    STREAM_PROXY_PORT=${INTERNAL_STREAM_PORT} python3 -u scripts/aspreen_stream_proxy_daemon.py
    CODE=$?
    echo "[Aspreen TV] Stream Proxy Daemon exited with code ${CODE}. Auto-restarting in 2s..."
    sleep 2
  done
}

# 2. Run Fastify API in a supervised loop - auto-restarts if it ever exits
run_api() {
  while true; do
    echo "[Aspreen TV] Starting Fastify API on internal port ${INTERNAL_API_PORT}..."
    PORT=${INTERNAL_API_PORT} HOST=0.0.0.0 node --max-old-space-size=800 apps/api/dist/index.js
    CODE=$?
    echo "[Aspreen TV] Fastify API exited with code ${CODE}. Auto-restarting in 2s..."
    sleep 2
  done
}

# 3. Run Next.js Web in a supervised loop
run_web() {
  while true; do
    echo "[Aspreen TV] Starting Next.js Web on public port ${PUBLIC_PORT}..."
    INTERNAL_API_URL="http://127.0.0.1:${INTERNAL_API_PORT}" \
    STREAM_PROXY_URL="http://127.0.0.1:${INTERNAL_STREAM_PORT}" \
    npm run start --prefix apps/web -- -p ${PUBLIC_PORT}
    CODE=$?
    echo "[Aspreen TV] Next.js Web exited with code ${CODE}. Auto-restarting in 2s..."
    sleep 2
  done
}

# 4. Run Master Content Auto-Sync Daemon
run_auto_sync() {
  sleep 15
  while true; do
    echo "[Aspreen TV] Starting Master Content Auto-Sync Daemon..."
    node scripts/aspreen_auto_sync_daemon.js
    CODE=$?
    echo "[Aspreen TV] Auto-Sync Daemon exited with code ${CODE}. Auto-restarting in 10s..."
    sleep 10
  done
}

run_stream_proxy &
PROXY_PID=$!

run_api &
API_PID=$!

echo "[Aspreen TV] Waiting for API and Proxy to initialize..."
sleep 3

run_web &
WEB_PID=$!

run_auto_sync &
SYNC_PID=$!

cleanup() {
  echo "[Aspreen TV] Shutting down services cleanly..."
  kill -TERM "$PROXY_PID" "$API_PID" "$WEB_PID" "$SYNC_PID" 2>/dev/null || true
  pkill -P "$PROXY_PID" 2>/dev/null || true
  pkill -P "$API_PID" 2>/dev/null || true
  pkill -P "$WEB_PID" 2>/dev/null || true
  pkill -P "$SYNC_PID" 2>/dev/null || true
  exit 0
}

trap cleanup INT TERM

# Wait for supervisor background jobs
wait

