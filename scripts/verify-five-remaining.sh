#!/usr/bin/env bash
# Live checks for the five remaining backend issues. Requires a healthy mesh.
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

reset_drive() {
  curl -sf -X POST "$API/v1/sim/reset" >/dev/null || true
  python3 - <<'PY'
import json, time, urllib.request
deadline = time.time() + 45
ok = False
while time.time() < deadline:
    try:
        snap = json.load(urllib.request.urlopen("http://127.0.0.1:8000/v1/snapshot", timeout=8))
        holder = (snap.get("authority") or {}).get("holder_edge_id")
        jobs = json.load(urllib.request.urlopen("http://127.0.0.1:8081/jobs/overview", timeout=8)).get("jobs") or []
        running_a = any(j.get("state")=="RUNNING" and "edge-a" in (j.get("name") or "") for j in jobs)
        print("[five] reset wait holder", holder, "a_job", running_a)
        if holder == "edge-a" and running_a:
            ok = True
            break
    except Exception as exc:
        print("[five] reset wait", exc)
    time.sleep(2)
if not ok:
    raise SystemExit("bootstrap authority/job not ready after reset")
PY
}

echo "[five] 1. Shadow Flink cleanup"
reset_drive
python3 - <<'PY'
import json, time, urllib.request, sys

def get(url, t=12):
    return json.load(urllib.request.urlopen(url, timeout=t))

def post(url, body, t=15):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"content-type": "application/json"}, method="POST",
    )
    return json.load(urllib.request.urlopen(req, timeout=t))

def jobs():
    return json.load(urllib.request.urlopen("http://127.0.0.1:8081/jobs/overview", timeout=8)).get("jobs") or []

def edge_jobs(state="RUNNING"):
    found = {}
    for job in jobs():
        if job.get("state") != state:
            continue
        name = job.get("name") or ""
        for edge in ("edge-a", "edge-b", "edge-c", "edge-d"):
            if edge in name.split():
                found.setdefault(edge, []).append(job)
    return found

post("http://127.0.0.1:8000/v1/test/prediction", {
    "probabilities": {"edge-b": 0.52, "edge-c": 0.40, "edge-d": 0.08},
    "eta_sec": 40,
    "requires_image": False,
})
shadows = []
deadline = time.time() + 45
while time.time() < deadline:
    snap = get("http://127.0.0.1:8000/v1/snapshot")
    shadows = sorted({s.get("edge_id") for s in (snap.get("shadows") or []) if s.get("role") == "WARM_SHADOW"})
    running = edge_jobs()
    print("[five] shadows", shadows, "running", {k: [j["jid"][:8] for j in v] for k, v in running.items()})
    if set(shadows) >= {"edge-b", "edge-c"} and "edge-b" in running and "edge-c" in running:
        break
    time.sleep(2)
if set(shadows) < {"edge-b", "edge-c"}:
    raise SystemExit("dual shadows B+C not created")
c_jobs = [j["jid"] for j in edge_jobs().get("edge-c", [])]
if not c_jobs:
    raise SystemExit("C Flink job never reached RUNNING")
print("[five] C jobs before promote", c_jobs)

post("http://127.0.0.1:8000/v1/sim/drive", {
    "source": "edge-a", "destination": "edge-b",
    "scenario": "warm", "tick_ms": 280, "include_images": False,
})
promoted = False
deadline = time.time() + 90
while time.time() < deadline:
    snap = get("http://127.0.0.1:8000/v1/snapshot")
    holder = ((snap.get("authority") or {}).get("holder_edge_id")
              or (snap.get("current_node") or {}).get("authority_holder"))
    print("[five] holder", holder)
    if holder == "edge-b":
        promoted = True
        break
    time.sleep(3)
if not promoted:
    raise SystemExit("B was not promoted")

deadline = time.time() + 30
canceled = False
while time.time() < deadline:
    after = jobs()
    still = [j for j in after if j.get("jid") in c_jobs and j.get("state") == "RUNNING"]
    canceled_states = [j.get("state") for j in after if j.get("jid") in c_jobs]
    print("[five] C job states", canceled_states, "still_running", bool(still))
    if not still and canceled_states and all(s == "CANCELED" for s in canceled_states):
        canceled = True
        break
    if not still:
        # job disappeared from overview; treat as cleaned
        canceled = True
        break
    time.sleep(2)
if not canceled:
    raise SystemExit("C Flink job remained RUNNING after B promotion / ShadowRelease")
print("[five] 1 PASS C canceled after B promote")
PY

echo "[five] 2. Live multicast / tee_bytes"
reset_drive
python3 - <<'PY'
import json, time, urllib.request, sys

def get(url, t=12):
    return json.load(urllib.request.urlopen(url, timeout=t))

def post(url, body, t=15):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"content-type": "application/json"}, method="POST",
    )
    return json.load(urllib.request.urlopen(req, timeout=t))

post("http://127.0.0.1:8000/v1/test/prediction", {
    "probabilities": {"edge-b": 0.55, "edge-c": 0.35, "edge-d": 0.10},
    "eta_sec": 50,
    "requires_image": False,
})
deadline = time.time() + 40
shadows = []
while time.time() < deadline:
    snap = get("http://127.0.0.1:8000/v1/snapshot")
    shadows = sorted({s.get("edge_id") for s in (snap.get("shadows") or []) if s.get("role") == "WARM_SHADOW"})
    if shadows:
        break
    time.sleep(2)
if not shadows:
    raise SystemExit("no warm shadows for multicast drive")

post("http://127.0.0.1:8000/v1/sim/start", {
    "source": "edge-a", "destination": "edge-d",
    "tick_ms": 250, "include_images": False,
})
tee = 0
fanout = 0
sync = 0.0
deadline = time.time() + 50
while time.time() < deadline:
    snap = get("http://127.0.0.1:8000/v1/snapshot")
    tee = int(snap.get("tee_bytes") or 0)
    events = snap.get("timeline") or []
    fanout = sum(1 for e in events if e.get("event_type") == "MulticastFanout")
    for s in snap.get("shadows") or []:
        try:
            sync = max(sync, float(s.get("sync_ratio") or 0))
        except (TypeError, ValueError):
            pass
    print("[five] tee_bytes", tee, "fanout", fanout, "sync", sync, "shadows",
          [s.get("edge_id") for s in snap.get("shadows") or []])
    if tee > 0 and (fanout > 0 or sync > 0):
        break
    time.sleep(2)
urllib.request.urlopen(urllib.request.Request(
    "http://127.0.0.1:8000/v1/sim/stop", method="POST",
), timeout=8).read()
if tee <= 0:
    raise SystemExit("tee_bytes stayed 0 during live drive")
print("[five] 2 PASS tee_bytes", tee, "fanout", fanout, "sync", sync)
PY

echo "[five] 3. No-authority recovery"
reset_drive
python3 - <<'PY'
import json, time, urllib.request, subprocess, sys

def get(url, t=12):
    return json.load(urllib.request.urlopen(url, timeout=t))

snap = get("http://127.0.0.1:8000/v1/snapshot")
metrics = get("http://127.0.0.1:8000/v1/metrics")
authority = snap.get("authority") or {}
holder = authority.get("holder_edge_id")
print("[five] holder before kill", holder, "metrics", metrics)
if not holder:
    raise SystemExit("no authority before kill")
warm = [s.get("edge_id") for s in (snap.get("shadows") or []) if s.get("role") == "WARM_SHADOW"]
print("[five] warm before kill", warm)
container = {
    "edge-a": "prevail-edge-a",
    "edge-b": "prevail-edge-b",
    "edge-c": "prevail-edge-c",
    "edge-d": "prevail-edge-d",
}[holder]
subprocess.check_call(["docker", "kill", container])
print("[five] killed", container)

deadline = time.time() + 40
ok = False
last = None
while time.time() < deadline:
    metrics = get("http://127.0.0.1:8000/v1/metrics")
    snap = get("http://127.0.0.1:8000/v1/snapshot")
    holders = [h for h in (metrics.get("authority_holders_reported") or []) if h and h != holder]
    inv = metrics.get("single_authority_invariant")
    topo = [(n.get("edge_id"), n.get("role")) for n in (snap.get("topology") or [])]
    last = (holders, inv, topo, metrics.get("edges_reachable"))
    print("[five] after kill", last)
    if len(holders) == 1 and inv is True:
        ok = True
        break
    time.sleep(2)

subprocess.call(["docker", "start", container])
time.sleep(4)
if not ok:
    raise SystemExit(f"zero/two authorities after kill: {last}")
print("[five] 3 PASS single remaining authority", last[0], "invariant", last[1])
PY

echo "[five] 4. Live prediction accuracy API"
python3 - <<'PY'
import json, urllib.request
acc = json.load(urllib.request.urlopen("http://127.0.0.1:8000/v1/history/accuracy", timeout=8))
print("[five] accuracy", acc)
if acc.get("source") != "live_handoffs":
    raise SystemExit("accuracy source is not live handoffs")
if int(acc.get("handoffs_scored") or 0) < 1:
    raise SystemExit("handoffs_scored is 0")
if acc.get("live_top1_accuracy") is None or acc.get("live_top2_accuracy") is None:
    raise SystemExit("live top-k missing")
print("[five] 4 PASS")
PY

echo "[five] PASS 1-4"
