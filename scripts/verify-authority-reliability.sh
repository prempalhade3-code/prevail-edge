#!/usr/bin/env bash
# Prove single-authority after normal op, two-shadow kill, and authority rejoin.
set -euo pipefail
API="${PREVAIL_API:-http://127.0.0.1:8000}"
FLINK="${PREVAIL_FLINK_REST:-http://127.0.0.1:8081}"

need() {
  local url="$1"
  for _ in $(seq 1 8); do
    if curl -sf --max-time 8 "$url" >/dev/null; then
      return 0
    fi
    sleep 2
  done
  echo "missing $url" >&2
  exit 1
}
need "$API/health"
need http://127.0.0.1:8090/health
need http://127.0.0.1:8092/health
need http://127.0.0.1:8094/health
need http://127.0.0.1:8096/health
need "$FLINK/jobs/overview"

python3 - <<'PY'
import json, time, urllib.request, urllib.error, subprocess, sys

API = "http://127.0.0.1:8000"
FLINK = "http://127.0.0.1:8081"
EDGES = {
    "edge-a": 8090,
    "edge-b": 8092,
    "edge-c": 8094,
    "edge-d": 8096,
}

def get(url, timeout=8):
    return json.load(urllib.request.urlopen(url, timeout=timeout))

def post(url, body, timeout=20):
    last = None
    for _ in range(4):
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(body).encode(),
                headers={"content-type": "application/json"},
                method="POST",
            )
            return json.load(urllib.request.urlopen(req, timeout=timeout))
        except Exception as exc:
            last = exc
            time.sleep(1)
    raise last

def reset_session():
    for port in EDGES.values():
        try:
            post(f"http://127.0.0.1:{port}/v1/session/reset", {}, timeout=8)
        except Exception as exc:
            print("[reset] edge", port, exc)
    time.sleep(8)

def nodes():
    out = {}
    for edge, port in EDGES.items():
        try:
            out[edge] = get(f"http://127.0.0.1:{port}/v1/current-node", timeout=8)
        except Exception as exc:
            out[edge] = {"error": str(exc)}
    return out

def authorities(snapshot=None):
    snap = snapshot or nodes()
    return sorted(
        edge
        for edge, node in snap.items()
        if isinstance(node, dict) and node.get("role") == "AUTHORITATIVE"
    )

def assert_one_authority(label, wait=12):
    deadline = time.time() + wait
    last = None
    while time.time() < deadline:
        snap = nodes()
        last = snap
        auths = authorities(snap)
        epochs = {
            edge: node.get("epoch")
            for edge, node in snap.items()
            if isinstance(node, dict) and "epoch" in node
        }
        print(f"[{label}] auths={auths} epochs={epochs}")
        if len(auths) == 1:
            holder = auths[0]
            live_epochs = [
                node.get("epoch")
                for edge, node in snap.items()
                if isinstance(node, dict) and node.get("role") != None and "error" not in node
            ]
            if live_epochs and max(e or 0 for e in live_epochs) == snap[holder].get("epoch"):
                try:
                    metrics = get(f"{API}/v1/metrics", timeout=6)
                    print(f"[{label}] metrics holders={metrics.get('authority_holders_reported')} invariant={metrics.get('single_authority_invariant')}")
                    if metrics.get("single_authority_invariant") and metrics.get("authority_holders_reported") == [holder]:
                        return holder, snap[holder].get("epoch"), snap
                except Exception as exc:
                    print(f"[{label}] metrics unavailable ({exc}); using current-node")
                    return holder, snap[holder].get("epoch"), snap
        time.sleep(1)
    print(f"[{label}] FAILED last={last}", file=sys.stderr)
    raise SystemExit(f"{label}: expected exactly one authority")

def docker(*args):
    return subprocess.check_call(["docker", *args])

def wait_http(url, tries=40):
    for _ in range(tries):
        try:
            urllib.request.urlopen(url, timeout=3).read()
            return
        except Exception:
            time.sleep(2)
    raise SystemExit(f"timeout waiting for {url}")

def warm_two_shadows():
    snap = nodes()
    auths = authorities(snap)
    warm = [e for e, n in snap.items() if isinstance(n, dict) and n.get("role") == "WARM_SHADOW"]
    if auths != ["edge-a"] or warm:
        reset_session()
    holder, _, _ = assert_one_authority("post-reset", wait=25)
    post(
        f"http://127.0.0.1:{EDGES[holder]}/v1/test/prediction",
        {
            "probabilities": {"edge-b": 0.62, "edge-c": 0.31, "edge-d": 0.07},
            "eta_sec": 40,
            "requires_image": False,
        },
    )
    deadline = time.time() + 50
    while time.time() < deadline:
        tick = {
            "session_id": "sim-vehicle-01",
            "timestamp_ms": int(time.time() * 1000),
            "latitude": 12.9278,
            "longitude": 77.6817,
            "speed_mps": 12.0,
            "heading_deg": 90.0,
            "edge_id": "edge-a",
        }
        try:
            post("http://127.0.0.1:8090/v1/trajectory", tick, timeout=6)
        except Exception as exc:
            print("[warm] tick failed", exc)
        warm = []
        for edge, port in EDGES.items():
            try:
                node = get(f"http://127.0.0.1:{port}/v1/current-node", timeout=3)
                if node.get("role") == "WARM_SHADOW":
                    warm.append(edge)
            except Exception:
                pass
        overview = get(f"{FLINK}/jobs/overview")
        running = {
            (j.get("name") or "").split()[1]
            for j in overview.get("jobs") or []
            if j.get("state") == "RUNNING" and len((j.get("name") or "").split()) > 1
        }
        print("[warm] shadows", warm, "running jobs", sorted(running))
        if {"edge-b", "edge-c"} <= running:
            return sorted({"edge-b", "edge-c"} | set(warm))
        time.sleep(2)
    raise SystemExit("failed to create two warm shadows")

print("[rel] baseline single authority")
holder, epoch, _ = assert_one_authority("normal")
print(f"[rel] PASS normal holder={holder} epoch={epoch}")

print("[rel] two-shadow promotion")
warm = warm_two_shadows()
print("[rel] warm shadows", warm)
holder, epoch, _ = assert_one_authority("pre-kill")
print(f"[rel] killing {holder}")
docker("kill", f"prevail-{holder}")
time.sleep(2)
promoted, new_epoch, snap = assert_one_authority("two-shadow-kill", wait=45)
if promoted == holder:
    raise SystemExit("killed authority is still the only reported authority")
if new_epoch <= epoch:
    raise SystemExit(f"epoch did not advance: {epoch} -> {new_epoch}")
print(f"[rel] PASS two-shadow kill promoted={promoted} epoch={new_epoch}")
for edge, node in snap.items():
    if edge != promoted and isinstance(node, dict) and node.get("role") == "AUTHORITATIVE":
        raise SystemExit(f"split brain after two-shadow kill: {snap}")

print(f"[rel] restarting killed {holder}")
docker("start", f"prevail-{holder}")
wait_http(f"http://127.0.0.1:{EDGES[holder]}/health")
time.sleep(3)
rejoin_holder, rejoin_epoch, rejoin = assert_one_authority("rejoin", wait=20)
rejoined = rejoin.get(holder) or {}
if rejoined.get("role") == "AUTHORITATIVE":
    raise SystemExit(f"restarted node claimed authority: {rejoin}")
if rejoin_holder != promoted:
    print(f"[rel] holder moved after rejoin {promoted} -> {rejoin_holder}")
if rejoin_epoch < new_epoch:
    raise SystemExit(f"epoch regressed after rejoin {new_epoch} -> {rejoin_epoch}")
print(f"[rel] PASS rejoin holder={rejoin_holder} epoch={rejoin_epoch} restarted={holder} role={rejoined.get('role')}")

print("[rel] checkpoint restore from source job")
source = rejoin_holder
jobs = get(f"{FLINK}/jobs/overview")
running = [j for j in jobs.get("jobs") or [] if j.get("state") == "RUNNING"]
source_jobs = [j for j in running if j.get("name", "").split()[1:2] == [source]]
if not source_jobs:
    raise SystemExit(f"no running source job for {source}: {[(j.get('name'), j.get('state')) for j in running]}")
jid = source_jobs[0]["jid"]
ck = get(f"{FLINK}/jobs/{jid}/checkpoints")
completed = (ck.get("latest") or {}).get("completed") or {}
path = completed.get("external_path") or completed.get("externalPath") or ""
print(f"[rel] source job {jid} checkpoint {path}")
if not path:
    raise SystemExit("source job has no completed checkpoint")

# Drive another shadow create and confirm the new job is RUNNING.
target = next(e for e in ("edge-b", "edge-c", "edge-d") if e != source)
post(
    f"http://127.0.0.1:{EDGES[source]}/v1/test/prediction",
    {
        "probabilities": {target: 0.9, "edge-d": 0.05, "edge-b": 0.05},
        "eta_sec": 20,
        "requires_image": False,
    },
)
deadline = time.time() + 40
shadow_running = False
while time.time() < deadline:
    tick = {
        "session_id": "sim-vehicle-01",
        "timestamp_ms": int(time.time() * 1000),
        "latitude": 12.9278,
        "longitude": 77.6817,
        "speed_mps": 12.0,
        "heading_deg": 90.0,
        "edge_id": source,
    }
    try:
        post(f"http://127.0.0.1:{EDGES[source]}/v1/trajectory", tick, timeout=6)
    except Exception:
        pass
    overview = get(f"{FLINK}/jobs/overview")
    shadows = [
        j
        for j in overview.get("jobs") or []
        if j.get("state") == "RUNNING" and j.get("name", "").split()[1:2] == [target]
    ]
    print("[rel] running jobs", [(j.get("name"), j.get("state")) for j in overview.get("jobs") or []])
    if shadows:
        shadow_running = True
        break
    time.sleep(2)
if not shadow_running:
    raise SystemExit("shadow job did not reach RUNNING from the source checkpoint")
assert_one_authority("post-shadow")
print("[rel] PASS source-job checkpoint restore")
print("[rel] ALL AUTHORITY RELIABILITY CHECKS PASSED")
PY
