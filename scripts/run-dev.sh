#!/usr/bin/env bash
# Start PREVAIL core stack (Prem's modules). Requires: Rust, Python 3.11+, Node 20+
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Starting prevail-runtime on :8090..."
(cd "$ROOT/rust/prevail-runtime" && cargo run --release) &
RUNTIME_PID=$!

sleep 2

echo "Starting prevail-backend on :8000..."
(cd "$ROOT/backend" && python3 -m prevail_backend.main) &
BACKEND_PID=$!

sleep 1

echo "Starting frontend on :5173..."
(cd "$ROOT/frontend" && npm run dev) &
UI_PID=$!

trap 'kill $RUNTIME_PID $BACKEND_PID $UI_PID 2>/dev/null' EXIT
wait
