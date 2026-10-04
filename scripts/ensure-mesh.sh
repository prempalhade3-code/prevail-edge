#!/usr/bin/env bash
# Start the host mesh (or reuse compose) so E1–E6 / golden have a live runtime.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/rust/prevail-runtime/target/release/prevail-runtime"
MESH="edge-a=127.0.0.1:9101,edge-b=127.0.0.1:9102,edge-c=127.0.0.1:9103,edge-d=127.0.0.1:9104"
EDGE_HTTP="edge-a=http://127.0.0.1:8090,edge-b=http://127.0.0.1:8092,edge-c=http://127.0.0.1:8094,edge-d=http://127.0.0.1:8096"

already_up() {
  curl -sf http://127.0.0.1:8090/health >/dev/null 2>&1 \
    && curl -sf http://127.0.0.1:8000/health >/dev/null 2>&1
}

if already_up; then
  if curl -sf http://127.0.0.1:8081/overview >/dev/null 2>&1 \
    || curl -sf http://127.0.0.1:8081/jobs/overview >/dev/null 2>&1; then
    echo "[mesh] docker/Flink mesh already running"
  else
    echo "[mesh] already running (host)"
  fi
  exit 0
fi

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "[mesh] starting Docker 4-edge + Flink + Postgres"
  (cd "$ROOT/deploy" && docker compose up -d --build postgres predictor flink-jobmanager edge-a edge-b edge-c edge-d flink-submit backend)
  for _ in $(seq 1 90); do
    if already_up && curl -sf http://127.0.0.1:8081/jobs/overview >/dev/null 2>&1; then
      echo "[mesh] docker mesh ready"
      exit 0
    fi
    sleep 2
  done
  echo "[mesh] docker mesh did not become healthy" >&2
  exit 1
fi

if [[ ! -x "$BIN" ]]; then
  echo "[mesh] building prevail-runtime"
  (cd "$ROOT/rust/prevail-runtime" && CARGO_TARGET_DIR=./target cargo build --release)
fi

export PREVAIL_MESH_PEERS="$MESH"
export PREVAIL_LIVE_SIM=1
export PREVAIL_SKIP_DEMO_BOOTSTRAP=1
export PREVAIL_PREDICTOR_URL="${PREVAIL_PREDICTOR_URL:-http://127.0.0.1:8091}"
export PREVAIL_SESSION_CONFIG_PATH="$ROOT/deploy/config/session.json"
export PREVAIL_EDGE_REGIONS_PATH="$ROOT/deploy/config/edge-regions.json"
export PREVAIL_EDGE_CAPABILITIES_PATH="$ROOT/deploy/config/edge-capabilities.json"
export PREVAIL_FLINK_JAR="${PREVAIL_FLINK_JAR:-$ROOT/flink/prevail-job/target/prevail-job-0.1.0-SNAPSHOT.jar}"
export PREVAIL_FLINK_SINK="$ROOT/experiments/flink-sink"
export PREVAIL_EDGE_URLS="$EDGE_HTTP"

mkdir -p "$ROOT/experiments/flink-sink" "$ROOT/experiments/checkpoints" /tmp/prevail-mesh

if ! curl -sf http://127.0.0.1:8091/health >/dev/null 2>&1; then
  echo "[mesh] starting predictor"
  nohup env PYTHONPATH="$ROOT" "${PYTHON:-$ROOT/backend/.venv/bin/python}" -m uvicorn python.predictor.service:app --host 127.0.0.1 --port 8091 \
    > /tmp/prevail-mesh/predictor.log 2>&1 &
  echo $! > /tmp/prevail-mesh/predictor.pid
  disown || true
  sleep 1
fi

start_edge() {
  local edge="$1" port="$2" grpc="$3"
  echo "[mesh] $edge :$port gRPC :$grpc"
  PREVAIL_EDGE_ID="$edge" PREVAIL_RUNTIME_PORT="$port" \
    PREVAIL_SIDECAR_GRPC_PORT="$grpc" \
    PREVAIL_RUNTIME_HOST=127.0.0.1 \
    PREVAIL_FLINK_SIDECAR="127.0.0.1:${grpc}" \
    PREVAIL_CHECKPOINT_DIR="$ROOT/experiments/checkpoints/${edge}" \
    nohup "$BIN" > "/tmp/prevail-mesh/${edge}.log" 2>&1 &
  echo $! > "/tmp/prevail-mesh/${edge}.pid"
  disown || true
}

start_edge edge-a 8090 50051
start_edge edge-b 8092 50052
start_edge edge-c 8094 50053
start_edge edge-d 8096 50054

for _ in $(seq 1 20); do
  curl -sf http://127.0.0.1:8090/health >/dev/null 2>&1 && break
  sleep 1
done

if ! curl -sf http://127.0.0.1:8000/health >/dev/null 2>&1; then
  echo "[mesh] starting backend"
  cd "$ROOT/backend"
  PREVAIL_RUNTIME_URL=http://127.0.0.1:8090 \
    PREVAIL_EDGE_URLS="$EDGE_HTTP" \
    PREVAIL_DATABASE_URL="${PREVAIL_DATABASE_URL:-sqlite:///$ROOT/experiments/prevail-timeline.db}" \
    nohup "$ROOT/backend/.venv/bin/python" -m prevail_backend.main \
    > /tmp/prevail-mesh/backend.log 2>&1 &
  echo $! > /tmp/prevail-mesh/backend.pid
  disown || true
  cd "$ROOT"
fi

for _ in $(seq 1 20); do
  if already_up; then
    echo "[mesh] ready"
    exit 0
  fi
  sleep 1
done
echo "[mesh] failed to become healthy" >&2
exit 1
