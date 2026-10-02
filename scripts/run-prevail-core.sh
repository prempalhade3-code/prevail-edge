#!/usr/bin/env bash
# PREVAIL authority stack (runtime + backend + road sim) — no visualization engine
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "[core] Starting PREVAIL runtime (live sim)…"
cd "$ROOT/rust/prevail-runtime"
PREVAIL_LIVE_SIM=1 CARGO_TARGET_DIR=./target ./target/release/prevail-runtime &
PID_RT=$!
sleep 2

echo "[core] Starting backend…"
cd "$ROOT/backend"
PREVAIL_RUNTIME_URL=http://127.0.0.1:8090 "$ROOT/backend/.venv/bin/python" -m prevail_backend.main &
PID_BE=$!
sleep 2

echo "[core] Starting road simulator…"
cd "$ROOT"
PREVAIL_RUNTIME_URL=http://127.0.0.1:8090 python3 sim/vehicle/road_simulator.py &
PID_SIM=$!

echo "[core] PREVAIL core running. Open http://127.0.0.1:8000"
echo "[core] For game-engine view: python sim/carla/prevail_bridge.py (+ CARLA server)"
trap 'kill $PID_RT $PID_BE $PID_SIM 2>/dev/null' EXIT
wait
