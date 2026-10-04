#!/usr/bin/env bash
# One-command thesis demo: 4 edges + predictor + backend + Flink tap + road sim
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MESH="edge-a=127.0.0.1:9101,edge-b=127.0.0.1:9102,edge-c=127.0.0.1:9103,edge-d=127.0.0.1:9104"
EDGE_HTTP="edge-a=http://127.0.0.1:8090,edge-b=http://127.0.0.1:8092,edge-c=http://127.0.0.1:8094,edge-d=http://127.0.0.1:8096"
FLINK_TAP_PORT="${PREVAIL_FLINK_TAP_PORT:-9999}"

BIN="$ROOT/rust/prevail-runtime/target/release/prevail-runtime"
JAR="$ROOT/flink/prevail-job/target/prevail-job-0.1.0-SNAPSHOT.jar"

log() { echo "[demo] $*"; }

wait_http() {
  local url="$1" label="$2" tries="${3:-30}"
  for ((i=1; i<=tries; i++)); do
    if curl -sf "$url" >/dev/null 2>&1; then
      log "$label ready"
      return 0
    fi
    sleep 1
  done
  log "WARN: $label not ready after ${tries}s"
  return 1
}

if [[ ! -x "$BIN" ]]; then
  log "Building prevail-runtime…"
  (cd "$ROOT/rust/prevail-runtime" && CARGO_TARGET_DIR=./target cargo build --release)
fi

if [[ ! -f "$JAR" ]]; then
  log "Building Flink job (standalone fat jar)…"
  (cd "$ROOT/flink/prevail-coordinator" && mvn -q package -DskipTests)
  (cd "$ROOT/flink/prevail-job" && mvn -q package -Pstandalone -DskipTests)
fi

if [[ ! -d "$ROOT/frontend/dist" ]] \
  || [[ "$ROOT/frontend/src/App.tsx" -nt "$ROOT/frontend/dist/index.html" ]] \
  || [[ "$ROOT/frontend/src/components/ComparisonCharts.tsx" -nt "$ROOT/frontend/dist/index.html" ]]; then
  log "Building dashboard…"
  "$ROOT/scripts/build-ui.sh"
fi

export PREVAIL_MESH_PEERS="$MESH"
export PREVAIL_LIVE_SIM=1
export PREVAIL_SKIP_DEMO_BOOTSTRAP=1
export PREVAIL_PREDICTOR_URL="${PREVAIL_PREDICTOR_URL:-http://127.0.0.1:8091}"
export PREVAIL_SESSION_CONFIG_PATH="$ROOT/deploy/config/session.json"
export PREVAIL_EDGE_REGIONS_PATH="$ROOT/deploy/config/edge-regions.json"
export PREVAIL_EDGE_CAPABILITIES_PATH="$ROOT/deploy/config/edge-capabilities.json"
export PREVAIL_OBSERVABILITY_URL="http://127.0.0.1:8000"
export PREVAIL_MODE="${PREVAIL_MODE:-prevail}"
export PREVAIL_CAPABILITY_CHECK_ENABLED="${PREVAIL_CAPABILITY_CHECK_ENABLED:-1}"
export PREVAIL_SPECULATION_ENABLED="${PREVAIL_SPECULATION_ENABLED:-1}"
export PREVAIL_CHECKPOINT_DIR="${PREVAIL_CHECKPOINT_DIR:-$ROOT/experiments/checkpoints}"

PIDS=()
cleanup() {
  log "Shutting down…"
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

start_edge() {
  local edge="$1" port="$2" grpc="$3"
  PREVAIL_EDGE_ID="$edge" PREVAIL_RUNTIME_PORT="$port" \
    PREVAIL_SIDECAR_GRPC_PORT="$grpc" \
    PREVAIL_FLINK_JAR="$JAR" \
    PREVAIL_FLINK_SIDECAR="127.0.0.1:${grpc}" \
    PREVAIL_FLINK_SINK="$ROOT/experiments/flink-sink" \
    PREVAIL_CHECKPOINT_DIR="$ROOT/experiments/checkpoints/${edge}" \
    "$BIN" &
  PIDS+=("$!")
  sleep 0.4
}

log "Starting predictor…"
cd "$ROOT"
PYTHONPATH="$ROOT" "$ROOT/backend/.venv/bin/python" -m uvicorn python.predictor.service:app --host 127.0.0.1 --port 8091 &
PIDS+=("$!")
wait_http "http://127.0.0.1:8091/health" "predictor" 20 || true

log "Starting edge mesh…"
start_edge edge-a 8090 50051
start_edge edge-b 8092 50052
start_edge edge-c 8094 50053
start_edge edge-d 8096 50054
wait_http "http://127.0.0.1:8090/health" "edge-a" 20 || true

# Postgres for timeline persistence + integration tests
if docker info >/dev/null 2>&1; then
  log "Starting Postgres (docker)…"
  (cd "$ROOT/deploy" && docker compose up -d postgres) || true
  for ((i=1; i<=25; i++)); do
    if docker exec prevail-postgres pg_isready -U prevail -d prevail >/dev/null 2>&1; then
      log "Postgres ready"
      break
    fi
    sleep 1
  done
fi
POSTGRES_DSN="postgresql://prevail:prevail_password@127.0.0.1:5432/prevail"
SQLITE_DSN="sqlite:///$ROOT/experiments/prevail-timeline.db"
if docker exec prevail-postgres pg_isready -U prevail -d prevail >/dev/null 2>&1; then
  DEFAULT_DB="$POSTGRES_DSN"
  log "Using Postgres for timeline persistence"
else
  DEFAULT_DB="$SQLITE_DSN"
  log "Postgres unavailable — using SQLite $ROOT/experiments/prevail-timeline.db"
fi
export PREVAIL_EDGE_URLS="$EDGE_HTTP"
export PREVAIL_SIDECAR_URL="${PREVAIL_SIDECAR_URL:-http://127.0.0.1:8090}"

log "Starting backend…"
cd "$ROOT/backend"
PREVAIL_BOOTSTRAP_EDGE_ID=edge-a \
  PREVAIL_DATABASE_URL="${PREVAIL_DATABASE_URL:-$DEFAULT_DB}" \
  "$ROOT/backend/.venv/bin/python" -m prevail_backend.main &
PIDS+=("$!")
wait_http "http://127.0.0.1:8000/health" "backend" 20 || true

# Authority Flink only. Shadows are submitted on ShadowCreate and torn down on ShadowRelease.
if [[ -f "$JAR" ]]; then
  mkdir -p "$ROOT/experiments/flink-sink" "$ROOT/experiments/checkpoints"
  export PREVAIL_FLINK_JAR="$JAR"
  export PREVAIL_FLINK_SINK="$ROOT/experiments/flink-sink"
  log "Authority Flink job will be started by edge-a (shadows on demand)"
fi

log "Starting live SUMO mobility source…"
cd "$ROOT"
PREVAIL_TRAJECTORY_URL=http://127.0.0.1:8090/v1/trajectory \
  PREVAIL_TRAFFIC_URL=http://127.0.0.1:8090/v1/traffic \
  PREVAIL_SESSION_ID=session-lab-1 \
  PYTHONPATH="$ROOT" "$ROOT/backend/.venv/bin/python" -m sim.vehicle.sumo_live &
PIDS+=("$!")

echo ""
echo "=== PREVAIL thesis demo ==="
echo "Dashboard:  http://127.0.0.1:8000"
echo "Edges:      8090/8092/8094/8096  QUIC: 9101-9104  gRPC sidecar: 50051-50054"
echo "Press Ctrl+C to stop the mesh."
wait
