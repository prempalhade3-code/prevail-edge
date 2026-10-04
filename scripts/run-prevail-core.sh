#!/usr/bin/env bash
# PREVAIL authority stack (4-edge mesh + backend + SUMO) — no visualization engine
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/rust/prevail-runtime/target/release/prevail-runtime"
JAR="$ROOT/flink/prevail-job/target/prevail-job-0.1.0-SNAPSHOT.jar"
MESH="edge-a=127.0.0.1:9101,edge-b=127.0.0.1:9102,edge-c=127.0.0.1:9103,edge-d=127.0.0.1:9104"

if [[ ! -x "$BIN" ]]; then
  echo "[core] Building prevail-runtime…"
  (cd "$ROOT/rust/prevail-runtime" && CARGO_TARGET_DIR=./target cargo build --release)
fi

export PREVAIL_MESH_PEERS="$MESH"
export PREVAIL_LIVE_SIM=1
export PREVAIL_SKIP_DEMO_BOOTSTRAP=1
export PREVAIL_PREDICTOR_URL="${PREVAIL_PREDICTOR_URL:-http://127.0.0.1:8091}"
export PREVAIL_SESSION_CONFIG_PATH="$ROOT/deploy/config/session.json"
export PREVAIL_EDGE_REGIONS_PATH="$ROOT/deploy/config/edge-regions.json"
export PREVAIL_EDGE_CAPABILITIES_PATH="$ROOT/deploy/config/edge-capabilities.json"
export PREVAIL_FLINK_JAR="$JAR"
export PREVAIL_FLINK_SINK="$ROOT/experiments/flink-sink"
export PREVAIL_EDGE_URLS="edge-a=http://127.0.0.1:8090,edge-b=http://127.0.0.1:8092,edge-c=http://127.0.0.1:8094,edge-d=http://127.0.0.1:8096"

PIDS=()
start_edge() {
  local edge="$1" port="$2" grpc="$3"
  echo "[core] Starting $edge HTTP :$port gRPC :$grpc"
  PREVAIL_EDGE_ID="$edge" PREVAIL_RUNTIME_PORT="$port" \
    PREVAIL_SIDECAR_GRPC_PORT="$grpc" \
    PREVAIL_FLINK_SIDECAR="127.0.0.1:${grpc}" \
    PREVAIL_CHECKPOINT_DIR="$ROOT/experiments/checkpoints/${edge}" \
    "$BIN" &
  PIDS+=("$!")
}

start_edge edge-a 8090 50051
start_edge edge-b 8092 50052
start_edge edge-c 8094 50053
start_edge edge-d 8096 50054
sleep 2

echo "[core] Starting backend…"
cd "$ROOT/backend"
PREVAIL_RUNTIME_URL=http://127.0.0.1:8090 \
  PREVAIL_EDGE_URLS="$PREVAIL_EDGE_URLS" \
  "$ROOT/backend/.venv/bin/python" -m prevail_backend.main &
PIDS+=("$!")
sleep 2

echo "[core] Starting SUMO live mobility source…"
cd "$ROOT"
PREVAIL_TRAJECTORY_URL=http://127.0.0.1:8090/v1/trajectory \
  PREVAIL_TRAFFIC_URL=http://127.0.0.1:8090/v1/traffic \
  PREVAIL_SESSION_ID=sim-vehicle-01 \
  PYTHONPATH="$ROOT" python3 -m sim.vehicle.sumo_live &
PIDS+=("$!")

echo "[core] PREVAIL core running. Open http://127.0.0.1:8000"
echo "[core] Edges 8090/8092/8094/8096  gRPC 50051-50054"
trap 'for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done' EXIT
wait
