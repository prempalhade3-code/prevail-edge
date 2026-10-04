"""Plan a corridor route between two PREVAIL edges and emit GPS ticks.

Ticks follow the ORR polyline in deploy/config/corridor-waypoints.json, not
straight lines between edge centroids.
"""

from __future__ import annotations

import json
import math
from heapq import heappop, heappush
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from python.mobility.region_mapper import RegionMapper
from python.mobility.road_graph import RoadGraph

# Minimal valid JPEG (1x1) used when the drive requests image-class work.
MIN_JPEG = (
    b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    b"\xff\xdb\x00C\x00"
    + bytes([8] * 64)
    + b"\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00"
    b"\xff\xc4\x00\x14\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
    b"\xff\xda\x00\x08\x01\x01\x00\x00?\x00\x7f\xff\xd9"
)


def _waypoints_path() -> Path:
    root = Path(__file__).resolve().parents[2]
    return root / "deploy" / "config" / "corridor-waypoints.json"


def load_corridor_waypoints(path: Optional[str] = None) -> List[Tuple[float, float]]:
    raw = json.loads(Path(path or _waypoints_path()).read_text(encoding="utf-8"))
    pts = [(float(w["latitude"]), float(w["longitude"])) for w in raw.get("waypoints") or []]
    if len(pts) < 2:
        raise ValueError("corridor-waypoints.json needs at least two points")
    return pts


def shortest_path(graph: RoadGraph, src: str, dst: str) -> Optional[List[str]]:
    if src == dst:
        return [src]
    if src not in graph.adj or dst not in graph.adj:
        return None
    dist = {src: 0.0}
    prev: Dict[str, str] = {}
    heap: List[Tuple[float, str]] = [(0.0, src)]
    seen = set()
    while heap:
        cost, node = heappop(heap)
        if node in seen:
            continue
        seen.add(node)
        if node == dst:
            path = [dst]
            while path[-1] in prev:
                path.append(prev[path[-1]])
            path.reverse()
            return path
        for nxt, weight in graph.adj.get(node, []):
            nxt_cost = cost + weight
            if nxt_cost < dist.get(nxt, float("inf")):
                dist[nxt] = nxt_cost
                prev[nxt] = node
                heappush(heap, (nxt_cost, nxt))
    return None


def _heading(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    dy = b[0] - a[0]
    dx = b[1] - a[1]
    return (math.degrees(math.atan2(dx, dy)) + 360.0) % 360.0


def _nearest_index(pts: List[Tuple[float, float]], target: Tuple[float, float]) -> int:
    best_i, best_d = 0, float("inf")
    for i, pt in enumerate(pts):
        d = (pt[0] - target[0]) ** 2 + (pt[1] - target[1]) ** 2
        if d < best_d:
            best_i, best_d = i, d
    return best_i


def _resample(pts: List[Tuple[float, float]], count: int) -> List[Tuple[float, float]]:
    if count <= 1 or len(pts) == 1:
        return [pts[0]]
    if len(pts) == 2 and count == 2:
        return list(pts)
    dist = [0.0]
    for i in range(1, len(pts)):
        dist.append(
            dist[-1]
            + math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
        )
    total = dist[-1] or 1e-9
    out: List[Tuple[float, float]] = []
    for step in range(count):
        t = (step / (count - 1)) * total
        j = 1
        while j < len(dist) and dist[j] < t:
            j += 1
        a, b = pts[j - 1], pts[min(j, len(pts) - 1)]
        span = max(dist[min(j, len(dist) - 1)] - dist[j - 1], 1e-9)
        frac = (t - dist[j - 1]) / span
        out.append((a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac))
    return out


def corridor_slice(
    source: str,
    destination: str,
    *,
    mapper: Optional[RegionMapper] = None,
    waypoints: Optional[List[Tuple[float, float]]] = None,
) -> List[Tuple[float, float]]:
    mapper = mapper or RegionMapper()
    pts = waypoints or load_corridor_waypoints()
    centers = {r["edge_id"]: (r["latitude"], r["longitude"]) for r in mapper.regions}
    if source not in centers or destination not in centers:
        raise ValueError(f"unknown edge {source}->{destination}")
    i0 = _nearest_index(pts, centers[source])
    i1 = _nearest_index(pts, centers[destination])
    if i0 == i1:
        return [pts[i0]]
    if i0 < i1:
        return pts[i0 : i1 + 1]
    return list(reversed(pts[i1 : i0 + 1]))


def plan_ticks(
    source: str,
    destination: str,
    *,
    mapper: Optional[RegionMapper] = None,
    graph: Optional[RoadGraph] = None,
    steps_per_leg: int = 24,
    linger_first: int = 36,
    include_images: bool = True,
    divert_wrong: bool = False,
) -> List[dict]:
    """Return trajectory samples along the ORR polyline.

    linger_first keeps the vehicle on the first edge long enough for
    checkpoint + ShadowCreate + Flink restore before the first boundary.
    """
    mapper = mapper or RegionMapper()
    graph = graph or RoadGraph()
    path = shortest_path(graph, source, destination)
    if not path:
        raise ValueError(f"no route from {source} to {destination}")

    if divert_wrong and len(path) >= 2:
        predicted = path[1]
        neighbors = [n for n, _ in graph.adj.get(source, []) if n != predicted]
        if neighbors:
            path = [source, neighbors[0]]

    pts = corridor_slice(path[0], path[-1], mapper=mapper)
    if len(pts) < 2:
        raise ValueError(f"corridor has no geometry from {source} to {destination}")

    first_center = next(r for r in mapper.regions if r["edge_id"] == path[0])
    first_pt = (first_center["latitude"], first_center["longitude"])
    total = linger_first + max(steps_per_leg * max(1, len(path) - 1), 8)
    sampled = _resample(pts, total)

    ticks: List[dict] = []
    import base64

    image_b64 = base64.b64encode(MIN_JPEG).decode("ascii")
    for step, (lat, lon) in enumerate(sampled):
        # Hold on the first-edge centroid for the linger window so speculation
        # and Flink restore finish before the vehicle leaves the box.
        if step < linger_first:
            lat, lon = first_pt
            nxt = sampled[min(step + 1, len(sampled) - 1)]
            heading = _heading(first_pt, nxt)
        else:
            nxt = sampled[min(step + 1, len(sampled) - 1)]
            heading = _heading((lat, lon), nxt)
        mapped = mapper.get_edge_id(lat, lon)
        sample = {
            "session_id": "sim-vehicle-01",
            "timestamp_ms": 0,
            "latitude": round(lat, 6),
            "longitude": round(lon, 6),
            "speed_mps": 8.0 if step < linger_first else 11.0,
            "heading_deg": heading,
            "edge_id": mapped,
            "workload_class": "stream",
        }
        if include_images and step % 8 == 0:
            sample["workload_class"] = "image"
            sample["image_event_id"] = f"img-{mapped}-{step}"
            sample["image_jpeg_b64"] = image_b64
        ticks.append(sample)
    return ticks
