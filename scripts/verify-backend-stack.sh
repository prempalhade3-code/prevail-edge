#!/usr/bin/env bash
set -euo pipefail

check() {
  local url="$1" label="$2"
  echo "[verify] $label $url"
  curl -sf "$url" >/dev/null
}

check http://127.0.0.1:8090/health edge-a
check http://127.0.0.1:8092/health edge-b
check http://127.0.0.1:8094/health edge-c
check http://127.0.0.1:8096/health edge-d
check http://127.0.0.1:8091/health predictor
check http://127.0.0.1:8000/health backend
check http://127.0.0.1:8081/overview flink-jm

echo "[verify] posting trajectory to edge-a"
curl -sf -X POST http://127.0.0.1:8090/v1/trajectory \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"sim-vehicle-01","timestamp_ms":1,"latitude":12.920709,"longitude":77.663605,"speed_mps":12.5,"heading_deg":90,"edge_id":"edge-a"}' \
  >/dev/null

echo "[verify] flink ingress on authority"
curl -sf http://127.0.0.1:8090/v1/flink/ingress >/dev/null

echo "[verify] predictor reports official training"
python3 - <<'PY'
import json, urllib.request
body = json.loads(urllib.request.urlopen("http://127.0.0.1:8091/health").read())
assert body.get("training_source") == "official", body
print(body)
PY

echo "[verify] backend snapshot"
curl -sf http://127.0.0.1:8000/v1/snapshot >/dev/null
echo "[verify] OK"
