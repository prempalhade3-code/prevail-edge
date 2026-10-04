#!/usr/bin/env bash
# PREVAIL live road simulation — runtime + backend + road sim (3 processes)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== PREVAIL Live Simulation ==="
echo "1) Start runtime with PREVAIL_LIVE_SIM=1 (skip button demo)"
echo "2) Start backend on :8000 (serves UI from dist if built)"
echo "3) Start SUMO live mobility (TraCI → /v1/trajectory)"
echo ""
echo "Open: http://127.0.0.1:8000"
echo ""

cd "$ROOT/rust/prevail-runtime"
PREVAIL_LIVE_SIM=1 CARGO_TARGET_DIR=./target cargo run --release &
RUNTIME_PID=$!
sleep 2

cd "$ROOT/backend"
PREVAIL_RUNTIME_URL=http://127.0.0.1:8090 "$ROOT/backend/.venv/bin/python" -m prevail_backend.main &
BACKEND_PID=$!
sleep 1

cd "$ROOT"
PREVAIL_TRAJECTORY_URL=http://127.0.0.1:8090/v1/trajectory \
  PREVAIL_TRAFFIC_URL=http://127.0.0.1:8090/v1/traffic \
  PREVAIL_SESSION_ID=sim-vehicle-01 \
  PYTHONPATH="$ROOT" python3 -m sim.vehicle.sumo_live &
SIM_PID=$!

trap 'kill $RUNTIME_PID $BACKEND_PID $SIM_PID 2>/dev/null' EXIT
wait
