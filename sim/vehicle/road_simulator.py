#!/usr/bin/env python3
"""
Realistic road-following vehicle simulator for PREVAIL.

Follows GeoJSON road network with variable speed, traffic slowdowns, and
continuous trajectory ingest to the Rust runtime (no button-click demo).

Usage:
  PREVAIL_RUNTIME_URL=http://127.0.0.1:8090 python sim/vehicle/road_simulator.py
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from python.mobility.region_mapper import RegionMapper
from python.mobility.session_config import get_session_id


@dataclass
class RoadPoint:
    lon: float
    lat: float
    speed_limit_mps: float


def load_primary_route(geojson_path: Path) -> List[RoadPoint]:
    data = json.loads(geojson_path.read_text(encoding="utf-8"))
    features = data.get("features", [])
    # Use longest spine (MG-Road-East-Spine)
    spine = max(features, key=lambda f: len(f["geometry"]["coordinates"]))
    limit = float(spine["properties"].get("speed_limit_mps", 15.0))
    return [RoadPoint(lon=c[0], lat=c[1], speed_limit_mps=limit) for c in spine["geometry"]["coordinates"]]


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dlon = math.radians(lon2 - lon1)
    x = math.sin(dlon) * math.cos(phi2)
    y = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def densify_route(points: List[RoadPoint], step_m: float = 8.0) -> List[RoadPoint]:
    """Insert intermediate points every ~step_m for smooth road following."""
    if len(points) < 2:
        return points
    dense: List[RoadPoint] = [points[0]]
    for i in range(len(points) - 1):
        a, b = points[i], points[i + 1]
        dist = haversine_m(a.lat, a.lon, b.lat, b.lon)
        if dist <= step_m:
            dense.append(b)
            continue
        steps = max(1, int(dist / step_m))
        for s in range(1, steps + 1):
            t = s / steps
            dense.append(
                RoadPoint(
                    lon=a.lon + (b.lon - a.lon) * t,
                    lat=a.lat + (b.lat - a.lat) * t,
                    speed_limit_mps=min(a.speed_limit_mps, b.speed_limit_mps),
                )
            )
    return dense


def post_json(url: str, payload: Dict[str, Any]) -> None:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        if resp.status >= 400:
            raise urllib.error.HTTPError(url, resp.status, "request failed", resp.headers, None)


class TrafficModel:
    """Simple traffic: random congestion bursts and junction slowdowns."""

    def __init__(self):
        self._congestion_until = 0.0

    def speed_factor(self, idx: int, total: int) -> float:
        now = time.time()
        if now < self._congestion_until:
            return 0.25
        # Junction zones (~every 15% of route)
        if idx % max(1, total // 7) == 0:
            return 0.45
        # Random traffic burst
        if idx % 113 == 0:
            self._congestion_until = now + 4.0
            return 0.3
        return 1.0


def spawn_traffic_fleet(route: List[RoadPoint], count: int = 8) -> List[int]:
    """Starting indices spread along route for background traffic."""
    if not route:
        return []
    step = max(1, len(route) // count)
    return [(i * step) % len(route) for i in range(count)]


def run_simulation(
    runtime_url: Optional[str] = None,
    predictor_url: Optional[str] = None,
    hz: float = 5.0,
    loop: bool = True,
):
    runtime_url = (runtime_url or os.environ.get("PREVAIL_RUNTIME_URL", "http://127.0.0.1:8090")).rstrip("/")
    predictor_url = predictor_url or os.environ.get("PREVAIL_PREDICTOR_URL")
    network = ROOT / "sim" / "network" / "bangalore-corridor.geojson"
    route = densify_route(load_primary_route(network), step_m=6.0)
    mapper = RegionMapper()
    traffic = TrafficModel()
    session_id = get_session_id()
    interval = 1.0 / hz
    fleet_offsets = spawn_traffic_fleet(route, count=10)
    fleet_pos = list(fleet_offsets)

    print(f"[road-sim] Route points={len(route)} hz={hz} traffic={len(fleet_pos)} runtime={runtime_url}", file=sys.stderr)

    while True:
        for idx, pt in enumerate(route):
            t0 = time.time()
            nxt = route[(idx + 1) % len(route)] if idx + 1 < len(route) else pt
            heading = bearing_deg(pt.lat, pt.lon, nxt.lat, nxt.lon)
            factor = traffic.speed_factor(idx, len(route))
            speed = max(2.0, pt.speed_limit_mps * factor * (0.85 + 0.15 * math.sin(idx * 0.07)))

            edge_id = mapper.get_edge_id(pt.lat, pt.lon)
            sample = {
                "session_id": session_id,
                "timestamp_ms": int(time.time() * 1000),
                "latitude": round(pt.lat, 6),
                "longitude": round(pt.lon, 6),
                "speed_mps": round(speed, 2),
                "edge_id": edge_id,
                "heading_deg": round(heading, 1),
            }

            try:
                post_json(f"{runtime_url}/v1/trajectory", sample)
            except (urllib.error.URLError, urllib.error.HTTPError) as exc:
                print(f"[road-sim] WARN runtime ingest: {exc}", file=sys.stderr)

            if predictor_url:
                try:
                    post_json(
                        f"{predictor_url.rstrip('/')}/trajectory",
                        {
                            "session_id": session_id,
                            "edge_id": edge_id,
                            "timestamp_ms": sample["timestamp_ms"],
                            "latitude": sample["latitude"],
                            "longitude": sample["longitude"],
                            "speed_mps": sample["speed_mps"],
                        },
                    )
                except (urllib.error.URLError, urllib.error.HTTPError):
                    pass

            # Background traffic (GTA-like density on same corridor)
            traffic_payload = []
            for v_i, start in enumerate(fleet_pos):
                t_idx = (idx + start) % len(route)
                tpt = route[t_idx]
                tnxt = route[(t_idx + 1) % len(route)]
                traffic_payload.append(
                    {
                        "vehicle_id": f"traffic-{v_i + 1}",
                        "latitude": round(tpt.lat, 6),
                        "longitude": round(tpt.lon, 6),
                        "heading_deg": round(bearing_deg(tpt.lat, tpt.lon, tnxt.lat, tnxt.lon), 1),
                        "speed_mps": round(max(3.0, tpt.speed_limit_mps * 0.7), 2),
                    }
                )
            try:
                post_json(f"{runtime_url}/v1/traffic", traffic_payload)
            except (urllib.error.URLError, urllib.error.HTTPError):
                pass

            if idx % int(hz) == 0:
                print(
                    f"[road-sim] edge={edge_id} speed={speed:.1f}m/s "
                    f"lat={pt.lat:.4f} lon={pt.lon:.4f} traffic={len(traffic_payload)}",
                    file=sys.stderr,
                )

            elapsed = time.time() - t0
            time.sleep(max(0.0, interval - elapsed))

        if not loop:
            break
        print("[road-sim] Loop restart — continuous corridor drive", file=sys.stderr)


if __name__ == "__main__":
    run_simulation()
