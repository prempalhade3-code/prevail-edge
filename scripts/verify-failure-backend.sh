#!/usr/bin/env bash
# Real kill + iptables failure checks against the Docker mesh.
set -euo pipefail
API="${PREVAIL_API:-http://127.0.0.1:8000}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

holders() {
  curl -sf "$API/v1/metrics" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d.get("authority_holders_reported") or []), ",".join(d.get("authority_holders_reported") or []), d.get("single_authority_invariant"))'
}

echo "[fail] baseline holders: $(holders)"
python3 - <<'PY'
import json, urllib.request, sys
m = json.load(urllib.request.urlopen("http://127.0.0.1:8000/v1/metrics", timeout=8))
if not m.get("single_authority_invariant"):
    raise SystemExit("split brain before fault")
PY

echo "[fail] iptables drop QUIC from edge-a"
python3 - <<'PY'
import sys
sys.path.insert(0, "experiments")
from fault_inject import iptables_drop_quic, wait
iptables_drop_quic("edge-a", 9101)
wait(4)
PY

python3 - <<'PY'
import json, urllib.request
m = json.load(urllib.request.urlopen("http://127.0.0.1:8000/v1/metrics", timeout=8))
print("[fail] after iptables", m.get("authority_holders_reported"), "invariant", m.get("single_authority_invariant"))
if not m.get("single_authority_invariant"):
    raise SystemExit("split brain after iptables")
PY

python3 - <<'PY'
import sys
sys.path.insert(0, "experiments")
from fault_inject import iptables_clear
iptables_clear("edge-a")
PY

echo "[fail] warm-sync a shadow before kill"
python3 - <<'PY'
import json, time, urllib.request, sys
req = urllib.request.Request(
    "http://127.0.0.1:8000/v1/test/prediction",
    data=json.dumps({
        "probabilities": {"edge-b": 0.88, "edge-c": 0.07, "edge-d": 0.05},
        "eta_sec": 40,
        "requires_image": False,
    }).encode(),
    headers={"content-type": "application/json"},
    method="POST",
)
urllib.request.urlopen(req, timeout=15).read()
deadline = time.time() + 40
ready = False
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
        urllib.request.urlopen(urllib.request.Request(
            "http://127.0.0.1:8090/v1/trajectory",
            data=json.dumps(tick).encode(),
            headers={"content-type": "application/json"},
            method="POST",
        ), timeout=6).read()
    except Exception as exc:
        print("[fail] trajectory tick failed", exc)
    shadows = []
    for port in (8090, 8092, 8094, 8096):
        try:
            shadows.extend(json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/v1/shadows", timeout=2)) or [])
        except Exception:
            continue
    warm = [s for s in shadows if s.get("role") == "WARM_SHADOW" and float(s.get("sync_ratio") or 0) >= 0.95]
    print("[fail] warm shadows", [(s.get("edge_id"), s.get("sync_ratio")) for s in warm])
    if warm:
        ready = True
        break
    time.sleep(1)
if not ready:
    raise SystemExit("no warm shadow at sync>=0.95 before kill")
PY

echo "[fail] kill authoritative container"
python3 - <<'PY'
import json, time, urllib.request, sys
sys.path.insert(0, "experiments")
from fault_inject import kill_edge, start_edge, wait
holder = "edge-a"
try:
    node = json.load(urllib.request.urlopen("http://127.0.0.1:8090/v1/current-node", timeout=4))
    holder = node.get("authority_holder") or holder
except Exception:
    pass
print("[fail] killing", holder)
before = int(time.time() * 1000)
kill_edge(holder)
deadline = time.time() + 35
ok = False
while time.time() < deadline:
    try:
        m = json.load(urllib.request.urlopen("http://127.0.0.1:8000/v1/metrics", timeout=5))
    except Exception:
        time.sleep(1)
        continue
    holders = m.get("authority_holders_reported") or []
    print("[fail] holders", holders, "invariant", m.get("single_authority_invariant"))
    if m.get("single_authority_invariant") and holders and holder not in holders:
        ok = True
        break
    try:
        hist = json.load(urllib.request.urlopen("http://127.0.0.1:8000/v1/history/events?limit=80", timeout=5))
        ev = [e for e in hist if e.get("event_type") == "AuthorityFailover" and int(e.get("timestamp_ms") or 0) >= before]
        if ev and m.get("single_authority_invariant"):
            ok = True
            break
    except Exception:
        pass
    time.sleep(1)
start_edge(holder)
wait(4)
if not ok:
    raise SystemExit("kill failover not observed")
print("[fail] kill failover observed")
PY

echo "[fail] PASS"
