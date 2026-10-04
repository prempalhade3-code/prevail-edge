#!/usr/bin/env bash
# Verify Docker mesh + warm/wrong drives + Postgres history. Backend only.
set -euo pipefail
API="${PREVAIL_API:-http://127.0.0.1:8000}"
FLINK="${PREVAIL_FLINK_REST:-http://127.0.0.1:8081}"

need() { curl -sf "$1" >/dev/null || { echo "missing $1" >&2; exit 1; }; }
need "$API/health"
need http://127.0.0.1:8090/health
need http://127.0.0.1:8092/health
need http://127.0.0.1:8094/health
need http://127.0.0.1:8096/health
need "$FLINK/jobs/overview"

echo "[verify] four edges + backend + Flink REST up"

python3 - <<'PY'
import json, urllib.request, sys
health = json.load(urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=8))
print("[verify] backend health", health)
if health.get("database") != "postgresql":
    print("[verify] live DB is not PostgreSQL", health, file=sys.stderr)
    sys.exit(1)
pred = json.load(urllib.request.urlopen("http://127.0.0.1:8091/health", timeout=8))
print("[verify] predictor", pred)
if pred.get("inference_backend") != "onnx" or not pred.get("onnx_loaded"):
    print("[verify] live predictor is not ONNX", pred, file=sys.stderr)
    sys.exit(1)
PY

python3 - <<'PY'
import json, urllib.request, sys, time
flink = "http://127.0.0.1:8081"
tms = json.load(urllib.request.urlopen(flink + "/taskmanagers", timeout=8))
ids = [tm.get("id","") for tm in tms.get("taskmanagers") or []]
print("[verify] TMs", ids)
for edge in ("edge-a","edge-b","edge-c","edge-d"):
    if not any(edge in i for i in ids):
        print("[verify] missing labeled TM", edge, file=sys.stderr)
        sys.exit(1)
overview = json.load(urllib.request.urlopen(flink + "/jobs/overview", timeout=8))
running = [j for j in overview.get("jobs") or [] if j.get("state")=="RUNNING"]
print("[verify] running Flink jobs", [(j.get("name"), j.get("jid")) for j in running])
if not running:
    print("[verify] no running Flink job", file=sys.stderr)
    sys.exit(1)
PY

echo "[verify] starting warm drive A→D"
curl -sf -X POST "$API/v1/sim/drive" -H 'content-type: application/json' \
  -d '{"source":"edge-a","destination":"edge-d","scenario":"warm","tick_ms":300,"include_images":true}' >/dev/null

warm_ok=0
for _ in $(seq 1 80); do
  if python3 - <<'PY'
import json, urllib.request, sys
hist = json.load(urllib.request.urlopen("http://127.0.0.1:8000/v1/history/events?limit=400", timeout=8))
warm = []
for e in hist:
    if e.get("event_type") != "AuthorityTransferred":
        continue
    payload = e.get("payload") or {}
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except Exception:
            payload = {}
    if payload.get("transfer_mode") == "warm":
        warm.append(e)
print("warm", len(warm), "hist", len(hist))
sys.exit(0 if warm else 1)
PY
  then
    warm_ok=1
    break
  fi
  sleep 3
done
if [[ "$warm_ok" -ne 1 ]]; then
  echo "[verify] warm promotion did not occur" >&2
  curl -sf "$API/v1/history/events?limit=30" || true
  exit 1
fi
echo "[verify] warm promotion observed"

echo "[verify] reset before wrong-prediction drive"
curl -sf -X POST "$API/v1/sim/reset" >/dev/null || true
sleep 2

echo "[verify] starting wrong-prediction drive B→A"
curl -sf -X POST "$API/v1/sim/drive" -H 'content-type: application/json' \
  -d '{"source":"edge-b","destination":"edge-a","scenario":"wrong","tick_ms":280,"include_images":true}' >/dev/null || true
# wait if previous drive still running
for _ in $(seq 1 40); do
  running=$(curl -sf "$API/v1/sim/drive/status" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("running"))')
  [[ "$running" == "False" ]] && break
  sleep 2
done
curl -sf -X POST "$API/v1/sim/drive" -H 'content-type: application/json' \
  -d '{"source":"edge-b","destination":"edge-a","scenario":"wrong","tick_ms":280,"include_images":true}' >/dev/null

wrong_ok=0
for _ in $(seq 1 70); do
  if python3 - <<'PY'
import json, urllib.request, sys
hist = json.load(urllib.request.urlopen("http://127.0.0.1:8000/v1/history/events?limit=400", timeout=8))
wrong = [e for e in hist if e.get("event_type")=="WrongPrediction"]
reactive = []
for e in hist:
    if e.get("event_type") != "AuthorityTransferred":
        continue
    payload = e.get("payload") or {}
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except Exception:
            payload = {}
    if payload.get("transfer_mode") == "reactive":
        reactive.append(e)
print("wrong", len(wrong), "reactive", len(reactive))
sys.exit(0 if wrong and reactive else 1)
PY
  then
    wrong_ok=1
    break
  fi
  sleep 3
done
if [[ "$wrong_ok" -ne 1 ]]; then
  echo "[verify] wrong-prediction reactive fallback not observed" >&2
  exit 1
fi
echo "[verify] wrong prediction + reactive fallback observed"

python3 - <<'PY'
import json, urllib.request
hist = json.load(urllib.request.urlopen("http://127.0.0.1:8000/v1/history/events?limit=20", timeout=8))
metrics = json.load(urllib.request.urlopen("http://127.0.0.1:8000/v1/history/metrics?limit=20", timeout=8))
print("[verify] history events", len(hist), "metrics", len(metrics))
if not hist:
    raise SystemExit("postgres/history events empty")
denied = [e for e in hist if e.get("event_type")=="ImageCapabilityDenied"]
print("[verify] image capability denials", len(denied))
PY

echo "[verify] reset before image-D and dual-shadow scenarios"
curl -sf -X POST "$API/v1/sim/reset" >/dev/null || true
sleep 2

echo "[verify] deterministic image capability denial on Edge D"
python3 - <<'PY'
import json, urllib.request, sys
req = urllib.request.Request(
    "http://127.0.0.1:8000/v1/test/prediction",
    data=json.dumps({
        "probabilities": {"edge-d": 0.70, "edge-c": 0.28, "edge-b": 0.02},
        "eta_sec": 40,
        "requires_image": True,
    }).encode(),
    headers={"content-type": "application/json"},
    method="POST",
)
snap = json.load(urllib.request.urlopen(req, timeout=15))
events = snap.get("timeline") or []
denied = [e for e in events if e.get("event_type") == "ImageCapabilityDenied" and e.get("edge_id") == "edge-d"]
shadows = [s.get("edge_id") for s in (snap.get("shadows") or [])]
print("[verify] image-D denied", len(denied), "shadows", shadows)
if not denied:
    raise SystemExit("ImageCapabilityDenied for edge-d not observed")
if "edge-d" in shadows:
    raise SystemExit("edge-d became an image-processing shadow")
if "edge-c" not in shadows:
    raise SystemExit("next valid edge after D denial was not selected")
PY

echo "[verify] reset before dual-shadow scenario"
curl -sf -X POST "$API/v1/sim/reset" >/dev/null || true
sleep 2

echo "[verify] two simultaneous shadows + multicast"
python3 - <<'PY'
import json, urllib.request, sys, time
req = urllib.request.Request(
    "http://127.0.0.1:8000/v1/test/prediction",
    data=json.dumps({
        "probabilities": {"edge-b": 0.52, "edge-c": 0.40, "edge-d": 0.08},
        "eta_sec": 40,
        "requires_image": False,
    }).encode(),
    headers={"content-type": "application/json"},
    method="POST",
)
snap = json.load(urllib.request.urlopen(req, timeout=15))
deadline = time.time() + 40
shadows = []
while time.time() < deadline:
    snap = json.load(urllib.request.urlopen("http://127.0.0.1:8000/v1/snapshot", timeout=8))
    shadows = sorted({s.get("edge_id") for s in (snap.get("shadows") or []) if s.get("role") == "WARM_SHADOW"})
    print("[verify] shadows", shadows)
    if set(shadows) >= {"edge-b", "edge-c"}:
        break
    time.sleep(2)
if set(shadows) < {"edge-b", "edge-c"}:
    raise SystemExit("dual shadows not observed")
# one image-less tick so multicast/tee can fire
tick = {
    "session_id": "sim-vehicle-01",
    "timestamp_ms": int(time.time() * 1000),
    "latitude": 12.9278,
    "longitude": 77.6817,
    "speed_mps": 12.0,
    "heading_deg": 90.0,
    "edge_id": "edge-a",
}
urllib.request.urlopen(urllib.request.Request(
    "http://127.0.0.1:8000/v1/trajectory",
    data=json.dumps(tick).encode(),
    headers={"content-type": "application/json"},
    method="POST",
), timeout=8).read()
time.sleep(1)
snap = json.load(urllib.request.urlopen("http://127.0.0.1:8000/v1/snapshot", timeout=8))
tee = snap.get("tee_bytes") or 0
print("[verify] tee_bytes", tee, "shadows", [s.get("edge_id") for s in snap.get("shadows") or []])
if tee <= 0:
    ev = [e.get("event_type") for e in (snap.get("timeline") or [])]
    print("[verify] timeline", ev[-20:])
    raise SystemExit("multicast/tee_bytes did not increase with two shadows")
PY

echo "[verify] Flink shadow restore + cancel"
python3 - <<'PY'
import json, urllib.request, time, sys
flink = "http://127.0.0.1:8081"
overview = json.load(urllib.request.urlopen(flink + "/jobs/overview", timeout=8))
running = [j for j in overview.get("jobs") or [] if j.get("state") == "RUNNING"]
restored = []
for job in running:
    ck = json.load(urllib.request.urlopen(f"{flink}/jobs/{job['jid']}/checkpoints", timeout=8))
    latest = (ck.get("latest") or {}).get("restored") or {}
    if latest.get("id") is not None:
        restored.append((job.get("name"), job["jid"], latest.get("external_path") or latest.get("id")))
print("[verify] restored jobs", restored)
if not restored:
    raise SystemExit("no RUNNING Flink job restored from a checkpoint/savepoint")
# cancel one non-authority restored job if present and confirm it leaves RUNNING
shadow = next((j for j in running if "edge-a" not in (j.get("name") or "")), None)
if shadow:
    req = urllib.request.Request(
        f"{flink}/jobs/{shadow['jid']}?mode=cancel",
        method="PATCH",
    )
    urllib.request.urlopen(req, timeout=8).read()
    time.sleep(2)
    after = json.load(urllib.request.urlopen(flink + "/jobs/overview", timeout=8))
    still = [j for j in after.get("jobs") or [] if j.get("jid") == shadow["jid"] and j.get("state") == "RUNNING"]
    print("[verify] cancelled", shadow["jid"], "still_running", bool(still))
    if still:
        raise SystemExit("ShadowRelease/cancel did not stop the Flink JVM job")
PY

echo "[verify] live top-1 / top-2 accuracy from scored handoffs"
python3 - <<'PY'
import json, urllib.request
acc = json.load(urllib.request.urlopen("http://127.0.0.1:8000/v1/history/accuracy", timeout=8))
print("[verify] accuracy", acc)
if acc.get("source") != "live_handoffs":
    raise SystemExit("accuracy source is not live handoffs")
if acc.get("handoffs_scored", 0) < 1:
    raise SystemExit("no live handoffs scored for top-k accuracy")
if acc.get("live_top1_accuracy") is None or acc.get("live_top2_accuracy") is None:
    raise SystemExit("live top-k accuracy missing")
PY

echo "[verify] PASS"
