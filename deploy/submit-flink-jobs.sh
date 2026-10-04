#!/usr/bin/env bash
# Submit the authoritative Flink job pinned to the labeled TM. Shadow jobs are
# created/cancelled by the Rust runtime on ShadowCreate / ShadowRelease.
set -euo pipefail

JM="${JOB_MANAGER_RPC_ADDRESS:-jobmanager}"
JAR="${PREVAIL_JOB_JAR:-/opt/prevail/prevail-job.jar}"
AUTHORITY="${PREVAIL_BOOTSTRAP_EDGE_ID:-edge-a}"
REST="http://${JM}:8081"

wait_for() {
  local host="$1" port="$2" label="$3"
  for _ in $(seq 1 90); do
    if (echo >"/dev/tcp/${host}/${port}") >/dev/null 2>&1; then
      echo "[submit] ${label} ready"
      return 0
    fi
    sleep 2
  done
  echo "[submit] ${label} not ready" >&2
  return 1
}

wait_for "$JM" 8081 "jobmanager"
for edge in edge-a edge-b edge-c edge-d; do
  wait_for "$edge" 8090 "$edge rust"
  wait_for "$edge" 50051 "$edge grpc"
done

echo "[submit] waiting for four labeled TaskManagers"
tms=""
for _ in $(seq 1 60); do
  tms="$(curl -sf "${REST}/taskmanagers" || true)"
  count="$(printf '%s' "$tms" | grep -o '"id"' | wc -l | tr -d ' ')"
  echo "[submit] TaskManagers seen=${count}"
  if [[ "${count}" -ge 4 ]]; then
    break
  fi
  sleep 2
done

echo "[submit] TM payload: ${tms}"
for edge in edge-a edge-b edge-c edge-d; do
  printf '%s' "$tms" | grep -q "${edge}" || {
    echo "[submit] labeled TM ${edge} is missing" >&2
    exit 1
  }
done

echo "[submit] submitting authority Flink job pinned to ${AUTHORITY}"
set +e
flink run -d -m "${JM}:8081" \
  -c dev.prevail.job.PrevailStreamJob \
  "$JAR" \
  --edge-id "$AUTHORITY" \
  --ingress sidecar \
  --sidecar "127.0.0.1:50051" \
  --sink "/var/prevail/sink/${AUTHORITY}.jsonl" \
  --checkpoint-dir "/var/prevail/checkpoints/${AUTHORITY}" \
  --pin-resource "pin-${AUTHORITY}" \
  --mode prevail | tee /tmp/prevail-flink-submit.log
submit_rc=${PIPESTATUS[0]}
set -e
if [[ "$submit_rc" -ne 0 ]] && ! grep -q "Job has been submitted" /tmp/prevail-flink-submit.log; then
  echo "[submit] flink run failed" >&2
  exit 1
fi

echo "[submit] verifying job landed on TM ${AUTHORITY}"
pinned=0
for _ in $(seq 1 40); do
  overview="$(curl -sf "${REST}/jobs/overview" || true)"
  printf '%s' "$overview" | grep -q '"state":"RUNNING"' || { sleep 2; continue; }
  jid="$(printf '%s' "$overview" | grep -oE '"jid":"[a-f0-9]+"' | head -1 | cut -d'"' -f4)"
  [[ -n "$jid" ]] || { sleep 2; continue; }
  job="$(curl -sf "${REST}/jobs/${jid}" || true)"
  hosts=""
  for vid in $(printf '%s' "$job" | grep -oE '"id":"[0-9a-f]{32}"' | cut -d'"' -f4); do
    detail="$(curl -sf "${REST}/jobs/${jid}/vertices/${vid}" || true)"
    hosts="${hosts} ${detail}"
  done
  echo "[submit] job ${jid} hosts=${hosts}" | head -c 400
  echo
  if printf '%s' "$hosts" | grep -q "${AUTHORITY}"; then
    pinned=1
    echo "[submit] authority job pinned to ${AUTHORITY}"
    break
  fi
  sleep 2
done

if [[ "$pinned" -ne 1 ]]; then
  echo "[submit] authority job did not land on labeled TM ${AUTHORITY}" >&2
  curl -sf "${REST}/jobs/overview" || true
  exit 1
fi

echo "[submit] authority job running; shadows will be submitted on ShadowCreate"
exit 0
