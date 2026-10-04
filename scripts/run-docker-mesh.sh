#!/usr/bin/env bash
# One-command Docker mesh startup. Ready only after edges, TMs, Postgres,
# predictor, Flink jobs, and FastAPI are actually healthy.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/deploy/docker-compose.yml")

echo "[docker-mesh] checking Docker"
if ! docker info >/dev/null 2>&1; then
  echo "[docker-mesh] Docker is not healthy" >&2
  exit 1
fi

echo "[docker-mesh] stopping host rust/backend if they own mesh ports (keep ONNX :8091)"
for port in 8090 8092 8094 8096 8000 9101; do
  pids=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
  if [[ -n "${pids}" ]]; then
    for pid in $pids; do
      comm=$(ps -p "$pid" -o comm= 2>/dev/null || true)
      if [[ "$comm" == *prevail* || "$comm" == *python* || "$comm" == *uvicorn* ]]; then
        kill "$pid" 2>/dev/null || true
      fi
    done
  fi
done
sleep 1

if ! curl -sf --max-time 3 http://127.0.0.1:8091/health >/dev/null; then
  echo "[docker-mesh] host ONNX predictor is not on :8091" >&2
  exit 1
fi
echo "[docker-mesh] predictor ready on :8091"

cd "$ROOT/deploy"
up_opts=()
if [[ "${PREVAIL_FORCE_BUILD:-0}" == "1" ]]; then
  echo "[docker-mesh] PREVAIL_FORCE_BUILD=1; rebuilding images"
  up_opts+=(--build --force-recreate)
elif ! docker image inspect deploy-edge-a >/dev/null 2>&1; then
  echo "[docker-mesh] edge image missing; building once"
  up_opts+=(--build --force-recreate)
else
  echo "[docker-mesh] reusing existing deploy-edge-a image (set PREVAIL_FORCE_BUILD=1 to rebuild)"
fi

echo "[docker-mesh] starting postgres, JobManager, and 4 edges"
if [[ ${#up_opts[@]} -gt 0 ]]; then
  "${COMPOSE[@]}" up -d "${up_opts[@]}" postgres flink-jobmanager edge-a edge-b edge-c edge-d
else
  "${COMPOSE[@]}" up -d postgres flink-jobmanager edge-a edge-b edge-c edge-d
fi

wait_http() {
  local url="$1" label="$2" tries="${3:-90}"
  for _ in $(seq 1 "$tries"); do
    if curl -sf --max-time 3 "$url" >/dev/null; then
      echo "[docker-mesh] ${label} ready"
      return 0
    fi
    sleep 2
  done
  echo "[docker-mesh] ${label} not ready: ${url}" >&2
  return 1
}

echo "[docker-mesh] waiting for 4 edge containers"
for _ in $(seq 1 60); do
  running=0
  for c in prevail-edge-a prevail-edge-b prevail-edge-c prevail-edge-d; do
    if [[ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null || echo false)" == "true" ]]; then
      running=$((running + 1))
    fi
  done
  if [[ "$running" -eq 4 ]]; then
    echo "[docker-mesh] 4 edge containers running"
    break
  fi
  sleep 2
done

wait_http http://127.0.0.1:8090/health "edge-a HTTP"
wait_http http://127.0.0.1:8092/health "edge-b HTTP"
wait_http http://127.0.0.1:8094/health "edge-c HTTP"
wait_http http://127.0.0.1:8096/health "edge-d HTTP"
wait_http http://127.0.0.1:8081/jobs/overview "JobManager"

echo "[docker-mesh] waiting for PostgreSQL"
for _ in $(seq 1 40); do
  if docker exec prevail-postgres pg_isready -U prevail -d prevail >/dev/null 2>&1; then
    echo "[docker-mesh] PostgreSQL ready"
    break
  fi
  sleep 2
done

echo "[docker-mesh] waiting for 4 labeled TaskManagers"
tms_ok=0
for _ in $(seq 1 90); do
  tms="$(curl -sf --max-time 3 http://127.0.0.1:8081/taskmanagers || true)"
  count="$(printf '%s' "$tms" | { grep -o '"id"' || true; } | wc -l | tr -d ' ')"
  count="${count:-0}"
  missing=0
  for edge in edge-a edge-b edge-c edge-d; do
    printf '%s' "$tms" | grep -q "$edge" || missing=1
  done
  echo "[docker-mesh] TaskManagers seen=${count}"
  if [[ "$count" -ge 4 && "$missing" -eq 0 ]]; then
    tms_ok=1
    break
  fi
  sleep 2
done
if [[ "$tms_ok" -ne 1 ]]; then
  echo "[docker-mesh] labeled TaskManagers never registered" >&2
  "${COMPOSE[@]}" ps
  exit 1
fi

echo "[docker-mesh] submitting Flink jobs after TMs are ready"
"${COMPOSE[@]}" up -d --no-build flink-submit
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' prevail-flink-submit 2>/dev/null || echo missing 1)"
  if [[ "$status" == "exited 0" ]]; then
    echo "[docker-mesh] flink-submit completed"
    break
  fi
  if [[ "$status" == exited* && "$status" != "exited 0" ]]; then
    echo "[docker-mesh] flink-submit failed: $status" >&2
    docker logs prevail-flink-submit --tail 80 >&2 || true
    exit 1
  fi
  sleep 2
done

echo "[docker-mesh] starting FastAPI"
"${COMPOSE[@]}" up -d --no-build backend
wait_http http://127.0.0.1:8000/health "FastAPI"

echo "[docker-mesh] verifying required health endpoints"
for url in \
  http://127.0.0.1:8090/health \
  http://127.0.0.1:8092/health \
  http://127.0.0.1:8094/health \
  http://127.0.0.1:8096/health \
  http://127.0.0.1:8000/health \
  http://127.0.0.1:8081/jobs/overview \
  http://127.0.0.1:8091/health
do
  curl -sf --max-time 3 "$url" >/dev/null || {
    echo "[docker-mesh] health failed: $url" >&2
    exit 1
  }
done

python3 - <<'PY'
import json, sys, time, urllib.request
health = None
for _ in range(8):
    try:
        health = json.load(urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=8))
        break
    except Exception as exc:
        print("[docker-mesh] backend health retry", exc)
        time.sleep(2)
if not health:
    print("[docker-mesh] backend health unreachable", file=sys.stderr)
    sys.exit(1)
if health.get("database") not in (None, "postgresql") and health.get("status") not in ("ok", "healthy"):
    print("[docker-mesh] backend health unexpected", health, file=sys.stderr)
overview = json.load(urllib.request.urlopen("http://127.0.0.1:8081/jobs/overview", timeout=8))
running = [j for j in overview.get("jobs") or [] if j.get("state") == "RUNNING"]
if not running:
    print("[docker-mesh] no RUNNING Flink job", file=sys.stderr)
    sys.exit(1)
print("[docker-mesh] running Flink jobs", [(j.get("name"), j.get("state")) for j in running])
PY

echo "[docker-mesh] ready  backend=http://127.0.0.1:8000  flink=http://127.0.0.1:8081"
