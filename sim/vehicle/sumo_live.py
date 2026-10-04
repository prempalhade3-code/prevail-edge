"""Live SUMO → PREVAIL mobility source (plan §3.1).

Drives corridor.sumocfg through TraCI and posts trajectory samples
(speed, heading, lat/lon, edge_id) into the runtime session pipeline.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Tuple

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from python.mobility.region_mapper import RegionMapper  # noqa: E402

SUMO_CFG = Path(os.environ.get(
    "PREVAIL_SUMO_CFG",
    str(ROOT / "sim" / "sumo" / "corridor-live.sumocfg"),
))
# Corridor spine in SUMO metres → Bangalore edge-region polyline.
SPINE = [
    (12.920709, 77.663605),
    (12.928155, 77.681794),
    (12.941340, 77.696074),
    (12.956990, 77.703291),
]
NET_LENGTH_M = 2000.0


def _interp_corridor(x_m: float, y_m: float) -> Tuple[float, float]:
    t = max(0.0, min(1.0, x_m / NET_LENGTH_M))
    scaled = t * (len(SPINE) - 1)
    i = min(len(SPINE) - 2, int(scaled))
    frac = scaled - i
    lat = SPINE[i][0] + frac * (SPINE[i + 1][0] - SPINE[i][0])
    lon = SPINE[i][1] + frac * (SPINE[i + 1][1] - SPINE[i][1])
    lat += (y_m - 400.0) * 1e-5
    return lat, lon


def _heading(angle_sumo: float) -> float:
    # SUMO angle is degrees from north, clockwise. Pass through as heading_deg.
    return round(float(angle_sumo) % 360.0, 1)


def _post(url: str, payload: Any) -> None:
    data = json.dumps(payload).encode("utf-8")
    last_exc: Exception | None = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                resp.read()
            return
        except Exception as exc:  # noqa: BLE001 — retry transient mesh handoffs
            last_exc = exc
            time.sleep(0.2 * (attempt + 1))
    if last_exc is not None:
        raise last_exc


def _wait_runtime(url: str, tries: int = 60) -> None:
    health = url.rsplit("/", 2)[0] + "/health" if "/v1/" in url else url
    if health.endswith("/trajectory"):
        health = health.replace("/v1/trajectory", "/health")
    for _ in range(tries):
        try:
            with urllib.request.urlopen(health, timeout=2) as resp:
                if resp.status == 200:
                    return
        except Exception:
            time.sleep(1)
    raise RuntimeError(f"PREVAIL runtime not reachable for SUMO feed: {health}")


def _start_traci():
    if "SUMO_HOME" in os.environ:
        tools = os.path.join(os.environ["SUMO_HOME"], "tools")
        if tools not in sys.path:
            sys.path.append(tools)
    try:
        import traci  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "SUMO TraCI is required for the live mobility source. "
            "Install sumo/sumo-tools and set SUMO_HOME."
        ) from exc

    binary = os.environ.get("SUMO_BINARY", "sumo")
    extra = os.environ.get("SUMO_EXTRA_ARGS", "").split()
    cmd = [binary, "-c", str(SUMO_CFG), "--start", "--quit-on-end", "false"] + [a for a in extra if a]
    traci.start(cmd)
    return traci


def run_live(loop: bool = True) -> int:
    if not SUMO_CFG.exists():
        raise FileNotFoundError(f"missing SUMO config: {SUMO_CFG}")
    traj_url = os.environ.get("PREVAIL_TRAJECTORY_URL", "http://127.0.0.1:8090/v1/trajectory")
    traffic_url = os.environ.get("PREVAIL_TRAFFIC_URL", "http://127.0.0.1:8090/v1/traffic")
    session_id = os.environ.get("PREVAIL_SESSION_ID", "sim-vehicle-01")
    hero_id = os.environ.get("PREVAIL_SUMO_HERO", "hero")
    step_sec = float(os.environ.get("PREVAIL_SUMO_STEP_SEC", "0.2"))
    mapper = RegionMapper()
    _wait_runtime(traj_url)
    posted = 0
    while True:
        traci = _start_traci()
        try:
            while traci.simulation.getMinExpectedNumber() > 0:
                traci.simulationStep()
                now_ms = int(time.time() * 1000)
                traffic: List[Dict[str, Any]] = []
                if hero_id in traci.vehicle.getIDList():
                    x, y = traci.vehicle.getPosition(hero_id)
                    lat, lon = _interp_corridor(x, y)
                    speed = float(traci.vehicle.getSpeed(hero_id))
                    heading = _heading(traci.vehicle.getAngle(hero_id))
                    sample = {
                        "session_id": session_id,
                        "timestamp_ms": now_ms,
                        "latitude": round(lat, 6),
                        "longitude": round(lon, 6),
                        "speed_mps": round(speed, 2),
                        "heading_deg": heading,
                        "edge_id": mapper.get_edge_id(lat, lon),
                        "workload_class": "stream",
                    }
                    _post(traj_url, sample)
                    posted += 1
                for vid in traci.vehicle.getIDList():
                    if vid == hero_id:
                        continue
                    x, y = traci.vehicle.getPosition(vid)
                    lat, lon = _interp_corridor(x, y)
                    traffic.append({
                        "vehicle_id": vid,
                        "latitude": round(lat, 6),
                        "longitude": round(lon, 6),
                        "speed_mps": round(float(traci.vehicle.getSpeed(vid)), 2),
                        "heading_deg": _heading(traci.vehicle.getAngle(vid)),
                    })
                if traffic:
                    try:
                        _post(traffic_url, traffic)
                    except urllib.error.URLError:
                        pass
                time.sleep(step_sec)
        finally:
            try:
                traci.close(False)
            except Exception:
                pass
        if not loop:
            break
        time.sleep(1.0)
    return posted


def main() -> int:
    loop = os.environ.get("PREVAIL_SUMO_ONCE", "") != "1"
    posted = run_live(loop=loop)
    print(f"[sumo-live] posted={posted}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
