#!/usr/bin/env bash
# Launch four prevail-runtime processes (one per edge) on loopback.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/rust/prevail-runtime/target/release/prevail-runtime"
MESH="edge-a=127.0.0.1:9101,edge-b=127.0.0.1:9102,edge-c=127.0.0.1:9103,edge-d=127.0.0.1:9104"

if [[ ! -x "$BIN" ]]; then
  echo "[mesh] Building prevail-runtime (release)…"
  (cd "$ROOT/rust/prevail-runtime" && CARGO_TARGET_DIR=./target cargo build --release)
fi

export PREVAIL_MESH_PEERS="$MESH"
export PREVAIL_LIVE_SIM=1
export PREVAIL_SKIP_DEMO_BOOTSTRAP=1
export PREVAIL_PREDICTOR_URL="${PREVAIL_PREDICTOR_URL:-http://127.0.0.1:8091}"
export PREVAIL_SESSION_CONFIG_PATH="$ROOT/deploy/config/session.json"
export PREVAIL_EDGE_REGIONS_PATH="$ROOT/deploy/config/edge-regions.json"
export PREVAIL_EDGE_CAPABILITIES_PATH="$ROOT/deploy/config/edge-capabilities.json"

PIDS=()
start_edge() {
  local edge="$1"
  local http_port="$2"
  echo "[mesh] Starting $edge on HTTP :$http_port"
  PREVAIL_EDGE_ID="$edge" PREVAIL_RUNTIME_PORT="$http_port" "$BIN" &
  PIDS+=("$!")
  sleep 0.4
}

start_edge edge-a 8090
start_edge edge-b 8092
start_edge edge-c 8094
start_edge edge-d 8096

echo "[mesh] Four edge runtimes up. Trajectory → http://127.0.0.1:8090"
trap 'for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done' EXIT
wait
