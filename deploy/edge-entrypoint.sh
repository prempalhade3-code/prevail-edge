#!/usr/bin/env bash
# One Docker container = one logical PREVAIL edge: Rust runtime + labeled Flink TM.
set -euo pipefail

EDGE="${PREVAIL_EDGE_ID:?PREVAIL_EDGE_ID is required}"
export PREVAIL_RUNTIME_HOST="${PREVAIL_RUNTIME_HOST:-0.0.0.0}"
export PREVAIL_SIDECAR_GRPC_HOST="${PREVAIL_SIDECAR_GRPC_HOST:-0.0.0.0}"
export PREVAIL_SIDECAR_GRPC_PORT="${PREVAIL_SIDECAR_GRPC_PORT:-50051}"
export PREVAIL_CHECKPOINT_DIR="${PREVAIL_CHECKPOINT_DIR:-/var/prevail/checkpoints/${EDGE}}"
export JOB_MANAGER_RPC_ADDRESS="${JOB_MANAGER_RPC_ADDRESS:-jobmanager}"
export PREVAIL_FLINK_REST="${PREVAIL_FLINK_REST:-http://jobmanager:8081}"
export PREVAIL_FLINK_JAR="${PREVAIL_FLINK_JAR:-/opt/prevail/prevail-job.jar}"
export PREVAIL_FLINK_SIDECAR="${PREVAIL_FLINK_SIDECAR:-127.0.0.1:50051}"
export PREVAIL_PIN_RESOURCE="${PREVAIL_PIN_RESOURCE:-pin-${EDGE}}"

mkdir -p "$PREVAIL_CHECKPOINT_DIR" /var/prevail/sink

FLINK_CONF="${FLINK_HOME}/conf/config.yaml"
if [[ ! -f "$FLINK_CONF" && -f "${FLINK_HOME}/conf/flink-conf.yaml" ]]; then
  FLINK_CONF="${FLINK_HOME}/conf/flink-conf.yaml"
fi

# Pin driver must be on the TM classpath so FGRM can advertise pin-${EDGE}.
cp -f /opt/prevail/prevail-job.jar "${FLINK_HOME}/lib/prevail-pin.jar"

{
  echo "jobmanager.rpc.address: ${JOB_MANAGER_RPC_ADDRESS}"
  echo "taskmanager.host: ${EDGE}"
  echo "taskmanager.registration.resource-id: ${EDGE}"
  echo "taskmanager.numberOfTaskSlots: 1"
  echo "taskmanager.memory.process.size: 512m"
  echo "taskmanager.memory.jvm-metaspace.size: 64m"
  echo "taskmanager.memory.jvm-overhead.min: 64m"
  echo "taskmanager.memory.jvm-overhead.max: 256m"
  echo "taskmanager.memory.framework.heap.size: 64m"
  echo "taskmanager.memory.framework.off-heap.size: 32m"
  echo "taskmanager.memory.task.heap.size: 96m"
  echo "taskmanager.memory.task.off-heap.size: 16m"
  echo "taskmanager.memory.managed.size: 32m"
  echo "taskmanager.memory.network.min: 16m"
  echo "taskmanager.memory.network.max: 32m"
  echo "taskmanager.registration.timeout: 300 s"
  echo "cluster.evenly-spread-out-slots: true"
  echo "cluster.fine-grained-resource-management.enabled: true"
  echo "state.checkpoints.num-retained: 5"
  echo "external-resources: pin-${EDGE}"
  echo "external-resource.pin-${EDGE}.amount: 1"
  echo "external-resource.pin-${EDGE}.driver-factory.class: dev.prevail.job.EdgePinDriverFactory"
} >> "$FLINK_CONF"

echo "PREVAIL_EDGE_ID=${EDGE}" >> "${FLINK_HOME}/conf/prevail-edge.env"

echo "[edge ${EDGE}] starting prevail-runtime"
prevail-runtime &
RUST_PID=$!

echo "[edge ${EDGE}] starting Flink TaskManager labeled ${EDGE} pin-resource=pin-${EDGE}"
(
  while true; do
    "${FLINK_HOME}/bin/taskmanager.sh" start-foreground || true
    echo "[edge ${EDGE}] Flink TaskManager exited; retrying in 4s" >&2
    sleep 4
  done
) &
TM_PID=$!

term() {
  kill "$RUST_PID" "$TM_PID" 2>/dev/null || true
}
trap term TERM INT

while true; do
  if ! kill -0 "$RUST_PID" 2>/dev/null; then
    echo "[edge ${EDGE}] rust runtime exited" >&2
    kill "$TM_PID" 2>/dev/null || true
    exit 1
  fi
  sleep 2
done
