#!/usr/bin/env python3
"""Turn raw OpenStreetMap data into PREVAIL's drivable road graph and city scene.

Pipeline
--------
1. Read the Overpass dump for the Bangalore ORR tech corridor.
2. Classify highways, split ways at shared nodes to get a real intersection graph.
3. Keep the largest connected component of drivable roads and solve a long route
   across it, so the vehicle has an origin, a destination and genuine turns.
4. Place buildings, trees and street furniture using a clearance test against
   *every* road centreline. This is the part that stops the vehicle driving
   through geometry: a prop can only exist where no road is, by construction.
5. Lay the four edge servers along the route and size their coverage to tile it.

Outputs
-------
  sim/network/city-network.json      drivable graph + route (simulator)
  frontend/public/city/scene.json    road meshes + prop instances (renderer)
  deploy/config/edge-regions.json    regenerated edge positions
"""
from __future__ import annotations

import heapq
import json
import math
import random
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "sim" / "network" / "osm" / "orr-corridor.raw.json"
CATALOG = ROOT / "frontend" / "public" / "models" / "catalog.json"

OUT_NETWORK = ROOT / "sim" / "network" / "city-network.json"
OUT_SCENE = ROOT / "frontend" / "public" / "city" / "scene.json"
OUT_REGIONS = ROOT / "deploy" / "config" / "edge-regions.json"
OUT_GEOJSON = ROOT / "sim" / "network" / "city-roads.geojson"

# Corridor centre (Bellandur / Outer Ring Road tech belt).
ORIGIN_LAT = 12.9400
ORIGIN_LON = 77.6860

M_PER_DEG_LAT = 111_320.0
M_PER_DEG_LON = M_PER_DEG_LAT * math.cos(math.radians(ORIGIN_LAT))

# half_width metres, speed m/s, drivable, rank (higher = more major)
ROAD_CLASS = {
    "trunk": (11.0, 22.2, True, 6),
    "trunk_link": (7.0, 13.9, True, 5),
    "primary": (8.0, 16.7, True, 5),
    "primary_link": (5.5, 11.1, True, 4),
    "secondary": (6.5, 13.9, True, 4),
    "secondary_link": (5.0, 11.1, True, 3),
    "tertiary": (5.0, 11.1, True, 3),
    "unclassified": (4.0, 8.3, False, 2),
    "residential": (3.6, 8.3, False, 1),
}

SIDEWALK = 2.6          # metres of pavement before anything may be built
SCENE_RADIUS = 420.0    # only dress the city within this distance of the route

BUILDING_SCALE = 8.0
HOUSE_SCALE = 6.0
TREE_SCALE = 5.0
PALM_SCALE = 7.0
PROP_SCALE = 6.0

rng = random.Random(20260301)


# ---------------------------------------------------------------- projection


def to_xz(lat: float, lon: float) -> tuple[float, float]:
    return ((lon - ORIGIN_LON) * M_PER_DEG_LON, -(lat - ORIGIN_LAT) * M_PER_DEG_LAT)


def to_latlon(x: float, z: float) -> tuple[float, float]:
    return (ORIGIN_LAT - z / M_PER_DEG_LAT, ORIGIN_LON + x / M_PER_DEG_LON)


def dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])


# ---------------------------------------------------------------- road graph


class Road:
    __slots__ = ("name", "cls", "half_width", "speed", "rank", "drivable", "pts", "node_ids")

    def __init__(self, name, cls, pts, node_ids):
        hw, speed, drivable, rank = ROAD_CLASS[cls]
        self.name = name
        self.cls = cls
        self.half_width = hw
        self.speed = speed
        self.rank = rank
        self.drivable = drivable
        self.pts = pts
        self.node_ids = node_ids


def load_roads() -> list[Road]:
    data = json.loads(RAW.read_text(encoding="utf-8"))
    roads: list[Road] = []
    for el in data.get("elements", []):
        if el.get("type") != "way":
            continue
        tags = el.get("tags") or {}
        cls = tags.get("highway")
        if cls not in ROAD_CLASS:
            continue
        geom = el.get("geometry") or []
        nodes = el.get("nodes") or []
        if len(geom) < 2 or len(nodes) != len(geom):
            continue
        pts = [to_xz(g["lat"], g["lon"]) for g in geom]
        roads.append(Road(tags.get("name") or cls, cls, pts, nodes))
    return roads


def split_at_intersections(roads: list[Road]):
    """Split every way where it shares a node with another way.

    Returns (nodes, edges). An edge is a polyline between two graph nodes, which
    is what makes turns at junctions possible instead of one endless polyline.
    """
    usage: dict[int, int] = defaultdict(int)
    for r in roads:
        for nid in r.node_ids:
            usage[nid] += 1

    node_xz: dict[int, tuple[float, float]] = {}
    edges = []

    for road in roads:
        run_pts = [road.pts[0]]
        run_start = road.node_ids[0]
        for i in range(1, len(road.pts)):
            run_pts.append(road.pts[i])
            nid = road.node_ids[i]
            is_junction = usage[nid] > 1
            is_end = i == len(road.pts) - 1
            if is_junction or is_end:
                if len(run_pts) >= 2 and run_start != nid:
                    node_xz[run_start] = road.pts[road.node_ids.index(run_start)]
                    node_xz[nid] = road.pts[i]
                    length = sum(dist(run_pts[k], run_pts[k + 1]) for k in range(len(run_pts) - 1))
                    if length > 1.0:
                        edges.append(
                            {
                                "a": run_start,
                                "b": nid,
                                "pts": list(run_pts),
                                "name": road.name,
                                "cls": road.cls,
                                "half_width": road.half_width,
                                "speed": road.speed,
                                "rank": road.rank,
                                "drivable": road.drivable,
                                "length": length,
                            }
                        )
                run_pts = [road.pts[i]]
                run_start = nid

    return node_xz, edges


def largest_drivable_component(node_xz, edges):
    adj: dict[int, list[int]] = defaultdict(list)
    drivable = [e for e in edges if e["drivable"]]
    for e in drivable:
        adj[e["a"]].append(e["b"])
        adj[e["b"]].append(e["a"])

    seen: set[int] = set()
    best: set[int] = set()
    for start in adj:
        if start in seen:
            continue
        comp = {start}
        stack = [start]
        seen.add(start)
        while stack:
            cur = stack.pop()
            for nxt in adj[cur]:
                if nxt not in seen:
                    seen.add(nxt)
                    comp.add(nxt)
                    stack.append(nxt)
        if len(comp) > len(best):
            best = comp

    kept = [e for e in drivable if e["a"] in best and e["b"] in best]
    return best, kept


def solve_route(node_xz, edges, component):
    """Longest-ish sensible route: pick two far-apart junctions, then shortest time."""
    adj: dict[int, list[tuple[int, dict]]] = defaultdict(list)
    for e in edges:
        adj[e["a"]].append((e["b"], e))
        adj[e["b"]].append((e["a"], e))

    # Prefer major-road endpoints that are far apart in space.
    major = [n for n in component if any(e["rank"] >= 5 for _, e in adj[n])] or list(component)
    major.sort(key=lambda n: node_xz[n][0])
    source = major[0]
    target = major[-1]

    def dijkstra(src):
        best = {src: 0.0}
        prev: dict[int, tuple[int, dict]] = {}
        pq = [(0.0, src)]
        while pq:
            cost, cur = heapq.heappop(pq)
            if cost > best.get(cur, float("inf")) + 1e-9:
                continue
            for nxt, e in adj[cur]:
                # Travel time, with a mild bias toward bigger roads.
                w = e["length"] / e["speed"] * (1.0 + 0.12 * (6 - e["rank"]))
                nc = cost + w
                if nc < best.get(nxt, float("inf")):
                    best[nxt] = nc
                    prev[nxt] = (cur, e)
                    heapq.heappush(pq, (nc, nxt))
        return best, prev

    best, prev = dijkstra(source)
    if target not in prev:
        reachable = [n for n in best if n != source]
        if not reachable:
            raise SystemExit("route solve failed: no reachable nodes")
        target = max(reachable, key=lambda n: dist(node_xz[source], node_xz[n]))

    chain = []
    cur = target
    while cur != source:
        p, e = prev[cur]
        chain.append((p, cur, e))
        cur = p
    chain.reverse()

    # Flatten into an oriented polyline with per-point speed limits.
    route_pts: list[tuple[float, float]] = []
    route_speed: list[float] = []
    route_names: list[str] = []
    segments = []

    for a, b, e in chain:
        pts = e["pts"] if e["a"] == a else list(reversed(e["pts"]))
        start_index = len(route_pts)
        for i, p in enumerate(pts):
            if route_pts and i == 0:
                continue
            route_pts.append(p)
            route_speed.append(e["speed"])
            route_names.append(e["name"])
        segments.append(
            {
                "name": e["name"],
                "cls": e["cls"],
                "speed": e["speed"],
                "half_width": e["half_width"],
                "from_index": start_index,
                "to_index": len(route_pts) - 1,
            }
        )

    return route_pts, route_speed, route_names, segments


# ---------------------------------------------------------- clearance index


class RoadIndex:
    """Grid-bucketed road segments supporting fast 'how far from any road' queries."""

    CELL = 50.0

    def __init__(self, edges):
        self.grid: dict[tuple[int, int], list] = defaultdict(list)
        for e in edges:
            hw = e["half_width"]
            pts = e["pts"]
            for i in range(len(pts) - 1):
                a, b = pts[i], pts[i + 1]
                seg = (a[0], a[1], b[0], b[1], hw)
                x0, x1 = sorted((a[0], b[0]))
                z0, z1 = sorted((a[1], b[1]))
                for cx in range(int(x0 // self.CELL), int(x1 // self.CELL) + 1):
                    for cz in range(int(z0 // self.CELL), int(z1 // self.CELL) + 1):
                        self.grid[(cx, cz)].append(seg)

    @staticmethod
    def _point_seg(px, pz, x1, z1, x2, z2) -> float:
        dx, dz = x2 - x1, z2 - z1
        den = dx * dx + dz * dz
        if den <= 1e-9:
            return math.hypot(px - x1, pz - z1)
        t = max(0.0, min(1.0, ((px - x1) * dx + (pz - z1) * dz) / den))
        return math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz))

    def clearance(self, px: float, pz: float, search: float = 60.0) -> float:
        """Distance from (px,pz) to the nearest road *edge* (not centreline)."""
        best = float("inf")
        rad = int(search // self.CELL) + 1
        cx0, cz0 = int(px // self.CELL), int(pz // self.CELL)
        for cx in range(cx0 - rad, cx0 + rad + 1):
            for cz in range(cz0 - rad, cz0 + rad + 1):
                for x1, z1, x2, z2, hw in self.grid.get((cx, cz), ()):
                    d = self._point_seg(px, pz, x1, z1, x2, z2) - hw
                    if d < best:
                        best = d
                        if best < -40:
                            return best
        return best


class Occupancy:
    """Keeps placed props from intersecting each other."""

    CELL = 25.0

    def __init__(self):
        self.grid: dict[tuple[int, int], list] = defaultdict(list)

    def fits(self, x: float, z: float, radius: float) -> bool:
        rad = int((radius + 30.0) // self.CELL) + 1
        cx0, cz0 = int(x // self.CELL), int(z // self.CELL)
        for cx in range(cx0 - rad, cx0 + rad + 1):
            for cz in range(cz0 - rad, cz0 + rad + 1):
                for ox, oz, orad in self.grid.get((cx, cz), ()):
                    if math.hypot(x - ox, z - oz) < radius + orad:
                        return False
        return True

    def add(self, x: float, z: float, radius: float) -> None:
        self.grid[(int(x // self.CELL), int(z // self.CELL))].append((x, z, radius))


def route_proximity(route_pts):
    """Index of the route so we only dress the city the camera will actually see."""
    cell = 100.0
    grid: dict[tuple[int, int], list] = defaultdict(list)
    for i in range(len(route_pts) - 1):
        a, b = route_pts[i], route_pts[i + 1]
        x0, x1 = sorted((a[0], b[0]))
        z0, z1 = sorted((a[1], b[1]))
        for cx in range(int(x0 // cell) - 4, int(x1 // cell) + 5):
            for cz in range(int(z0 // cell) - 4, int(z1 // cell) + 5):
                grid[(cx, cz)].append((a, b))

    def near(x, z, limit=SCENE_RADIUS) -> bool:
        for a, b in grid.get((int(x // cell), int(z // cell)), ()):
            if RoadIndex._point_seg(x, z, a[0], a[1], b[0], b[1]) <= limit:
                return True
        return False

    return near


# ------------------------------------------------------------- city dressing


def place_city(edges, index: RoadIndex, near_route, catalog):
    occupancy = Occupancy()
    buildings: list[dict] = []
    trees: list[dict] = []
    props: list[dict] = []

    commercial = [(k, v) for k, v in catalog["buildings"].items() if not k.startswith("low-detail")]
    towers = [(k, v) for k, v in commercial if "skyscraper" in k]
    blocks = [(k, v) for k, v in commercial if "skyscraper" not in k]
    houses = list(catalog["houses"].items())
    palms = [(k, v) for k, v in catalog["nature"].items() if "palm" in k]
    leafy = [(k, v) for k, v in catalog["nature"].items() if k.startswith("tree") and "palm" not in k]
    bushes = [(k, v) for k, v in catalog["nature"].items() if k.startswith("plant")]
    lights = [(k, v) for k, v in catalog["props"].items() if k.startswith("light")]
    signals = [(k, v) for k, v in catalog["props"].items() if "traffic-light" in k]

    def try_place(bucket, x, z, yaw, name, info, scale, kind, min_clear=SIDEWALK):
        footprint = info["footprint"] * scale
        radius = footprint * 0.5
        # Thin street furniture legitimately stands on the pavement, so it gets a
        # smaller setback than a building does.
        if index.clearance(x, z) < min_clear + radius * (0.15 if min_clear < SIDEWALK else 1.0):
            return False
        if not occupancy.fits(x, z, radius):
            return False
        occupancy.add(x, z, radius)
        lat, lon = to_latlon(x, z)
        bucket.append(
            {
                "model": name,
                "kind": kind,
                "x": round(x, 2),
                "z": round(z, 2),
                "yaw": round(yaw, 4),
                "scale": round(scale, 3),
                "lat": round(lat, 6),
                "lon": round(lon, 6),
            }
        )
        return True

    # Walk each road and offer candidate slots on both sides.
    for e in sorted(edges, key=lambda e: -e["rank"]):
        pts = e["pts"]
        hw = e["half_width"]
        rank = e["rank"]
        spacing = 34.0 if rank >= 5 else 26.0 if rank >= 3 else 20.0

        walked = 0.0
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            seg_len = dist(a, b)
            if seg_len < 1e-6:
                continue
            ux, uz = (b[0] - a[0]) / seg_len, (b[1] - a[1]) / seg_len
            nx, nz = -uz, ux
            yaw = math.atan2(ux, uz)

            t = 0.0
            while t < seg_len:
                walked += spacing
                cx, cz = a[0] + ux * t, a[1] + uz * t
                t += spacing
                if not near_route(cx, cz):
                    continue

                for side in (-1, 1):
                    jitter = rng.uniform(-3.0, 3.0)
                    facing = yaw + (0.0 if side > 0 else math.pi) + rng.uniform(-0.05, 0.05)

                    def plant(count: int, spread: float) -> None:
                        for _ in range(count):
                            tpool, tscale = (palms, PALM_SCALE) if rng.random() < 0.45 else (leafy, TREE_SCALE)
                            tname, tinfo = tpool[rng.randrange(len(tpool))]
                            toff = hw + SIDEWALK + rng.uniform(1.0, spread)
                            try_place(
                                trees,
                                cx + nx * toff * side + ux * rng.uniform(-spread, spread),
                                cz + nz * toff * side + uz * rng.uniform(-spread, spread),
                                rng.uniform(0, math.tau),
                                tname,
                                tinfo,
                                tscale * rng.uniform(0.82, 1.18),
                                "tree",
                            )

                    # Leave some frontage as green space rather than wall-to-wall concrete.
                    if rng.random() < 0.28:
                        plant(3, 12.0)
                        continue

                    # Big roads get offices and towers, small roads get houses.
                    if rank >= 5:
                        pool, scale = (towers, BUILDING_SCALE) if rng.random() < 0.34 else (blocks, BUILDING_SCALE)
                    elif rank >= 3:
                        pool, scale = (blocks, BUILDING_SCALE * 0.85) if rng.random() < 0.6 else (houses, HOUSE_SCALE)
                    else:
                        pool, scale = houses, HOUSE_SCALE

                    name, info = pool[rng.randrange(len(pool))]
                    depth = info["size"][2] * scale
                    offset = hw + SIDEWALK + depth * 0.5 + rng.uniform(2.0, 9.0)
                    bx = cx + nx * offset * side + ux * jitter
                    bz = cz + nz * offset * side + uz * jitter
                    if try_place(buildings, bx, bz, facing, name, info, scale, "building"):
                        continue

                    # No room for a building here: try vegetation instead.
                    plant(1, 4.0)

            # Street trees and lamps in the verge, on majors only.
            if rank >= 4:
                t = 10.0
                while t < seg_len:
                    cx, cz = a[0] + ux * t, a[1] + uz * t
                    t += 22.0
                    if not near_route(cx, cz):
                        continue
                    for side in (-1, 1):
                        verge = hw + 1.4
                        px, pz = cx + nx * verge * side, cz + nz * verge * side
                        if rng.random() < 0.55 and lights:
                            lname, linfo = lights[rng.randrange(len(lights))]
                            try_place(props, px, pz, yaw + (0 if side > 0 else math.pi),
                                      lname, linfo, PROP_SCALE, "light", min_clear=0.3)
                        else:
                            bname, binfo = bushes[rng.randrange(len(bushes))] if bushes else (None, None)
                            if bname:
                                try_place(trees, px, pz, rng.uniform(0, math.tau),
                                          bname, binfo, TREE_SCALE * 0.8, "bush", min_clear=0.3)

    # Traffic signals wherever three or more real roads meet.
    if signals:
        degree: dict[int, int] = defaultdict(int)
        approach: dict[int, list[tuple[float, float]]] = defaultdict(list)
        for e in edges:
            degree[e["a"]] += 1
            degree[e["b"]] += 1
            approach[e["a"]].append(e["pts"][0])
            approach[e["b"]].append(e["pts"][-1])

        for nid, deg in degree.items():
            if deg < 3:
                continue
            jx, jz = approach[nid][0]
            if not near_route(jx, jz):
                continue
            sname, sinfo = signals[rng.randrange(len(signals))]
            for ang in (0.0, math.pi * 0.5, math.pi, math.pi * 1.5):
                try_place(
                    props,
                    jx + math.sin(ang) * 11.0,
                    jz + math.cos(ang) * 11.0,
                    ang + math.pi,
                    sname,
                    sinfo,
                    PROP_SCALE,
                    "signal",
                    min_clear=0.3,
                )

    return buildings, trees, props


# ----------------------------------------------------------------- edge nodes


def place_edges(route_pts, index: RoadIndex):
    """Four edge servers spread along the route, set back from the carriageway."""
    cum = [0.0]
    for i in range(len(route_pts) - 1):
        cum.append(cum[-1] + dist(route_pts[i], route_pts[i + 1]))
    total = cum[-1]

    ids = ["edge-a", "edge-b", "edge-c", "edge-d"]
    names = [
        "ORR North Edge Node A",
        "Tech Park Edge Node B",
        "Bellandur Junction Edge Node C",
        "ORR South Edge Node D",
    ]
    regions = []
    coverage = total / len(ids) * 0.62

    for k, (eid, label) in enumerate(zip(ids, names)):
        target = total * (k + 0.5) / len(ids)
        i = max(1, min(len(cum) - 1, next(j for j in range(len(cum)) if cum[j] >= target)))
        a, b = route_pts[i - 1], route_pts[i]
        seg = dist(a, b) or 1.0
        ux, uz = (b[0] - a[0]) / seg, (b[1] - a[1]) / seg
        nx, nz = -uz, ux

        # Step sideways until we are clear of the road, like a real roadside cabinet.
        px, pz = b
        for off in (14.0, 18.0, 24.0, 30.0, 38.0):
            for side in (1, -1):
                cx, cz = b[0] + nx * off * side, b[1] + nz * off * side
                if index.clearance(cx, cz) > 3.0:
                    px, pz = cx, cz
                    break
            else:
                continue
            break

        lat, lon = to_latlon(px, pz)
        regions.append(
            {
                "edge_id": eid,
                "name": label,
                "latitude": round(lat, 6),
                "longitude": round(lon, 6),
                "x": round(px, 2),
                "z": round(pz, 2),
                "yaw": round(math.atan2(ux, uz), 4),
                "coverage_radius_m": round(coverage, 1),
                "route_distance_m": round(target, 1),
            }
        )

    return regions, total


# ----------------------------------------------------------------------- main


def main() -> None:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    roads = load_roads()
    print(f"[city] OSM ways kept: {len(roads)}")

    node_xz, edges = split_at_intersections(roads)
    print(f"[city] graph: {len(node_xz)} nodes, {len(edges)} edges")

    component, drivable = largest_drivable_component(node_xz, edges)
    print(f"[city] drivable component: {len(component)} nodes, {len(drivable)} edges")

    route_pts, route_speed, route_names, segments = solve_route(node_xz, drivable, component)
    route_len = sum(dist(route_pts[i], route_pts[i + 1]) for i in range(len(route_pts) - 1))
    print(f"[city] route: {len(route_pts)} pts, {route_len:.0f} m, {len(segments)} segments")
    print(f"[city] route roads: {' -> '.join(dict.fromkeys(s['name'] for s in segments))[:300]}")

    index = RoadIndex(edges)
    near_route = route_proximity(route_pts)

    # Only keep roads near the route for rendering, so the mesh budget stays sane.
    visible = [e for e in edges if any(near_route(p[0], p[1], SCENE_RADIUS + 60) for p in e["pts"][::2])]
    print(f"[city] roads near route: {len(visible)}")

    buildings, trees, props = place_city(visible, index, near_route, catalog)
    print(f"[city] placed {len(buildings)} buildings, {len(trees)} trees/bushes, {len(props)} props")

    regions, total = place_edges(route_pts, index)
    for r in regions:
        print(f"[city]   {r['edge_id']} @ ({r['x']:.0f},{r['z']:.0f}) r={r['coverage_radius_m']:.0f}m")

    # Verify nothing drivable is obstructed. Buildings and trees must respect the
    # pavement; thin street furniture is allowed to stand on it.
    for label, bucket, floor in (
        ("buildings", buildings, SIDEWALK),
        ("trees", trees, 0.3),
        ("props", props, 0.3),
    ):
        worst = min((index.clearance(o["x"], o["z"]) for o in bucket), default=float("inf"))
        status = "ok" if worst >= floor else "FAIL"
        print(f"[city] min {label:10s} clearance {worst:6.2f} m (floor {floor}) {status}")
        if worst < floor:
            raise SystemExit(f"{label} placed inside a carriageway")

    OUT_NETWORK.parent.mkdir(parents=True, exist_ok=True)
    OUT_SCENE.parent.mkdir(parents=True, exist_ok=True)

    network = {
        "origin": {"latitude": ORIGIN_LAT, "longitude": ORIGIN_LON},
        "route": {
            "length_m": round(route_len, 2),
            "points": [[round(x, 2), round(z, 2)] for x, z in route_pts],
            "latlon": [list(map(lambda v: round(v, 6), to_latlon(x, z))) for x, z in route_pts],
            "speed_limit_mps": [round(s, 2) for s in route_speed],
            "road_names": route_names,
            "segments": segments,
        },
        "edge_regions": regions,
        # The drivable graph lets background traffic pick its own legal paths and
        # take real turns at junctions instead of sliding along one polyline.
        "graph": {
            "nodes": {str(n): [round(node_xz[n][0], 2), round(node_xz[n][1], 2)] for n in component},
            "edges": [
                {
                    "a": str(e["a"]),
                    "b": str(e["b"]),
                    "name": e["name"],
                    "speed": e["speed"],
                    "half_width": e["half_width"],
                    "pts": [[round(x, 2), round(z, 2)] for x, z in e["pts"]],
                }
                for e in drivable
            ],
        },
    }
    OUT_NETWORK.write_text(json.dumps(network), encoding="utf-8")

    scene = {
        "origin": {"latitude": ORIGIN_LAT, "longitude": ORIGIN_LON},
        "roads": [
            {
                "name": e["name"],
                "cls": e["cls"],
                "half_width": e["half_width"],
                "rank": e["rank"],
                "pts": [[round(x, 2), round(z, 2)] for x, z in e["pts"]],
            }
            for e in visible
        ],
        "route": network["route"]["points"],
        "buildings": buildings,
        "trees": trees,
        "props": props,
        "edge_regions": regions,
    }
    OUT_SCENE.write_text(json.dumps(scene), encoding="utf-8")

    OUT_REGIONS.write_text(
        json.dumps(
            {
                "regions": [
                    {
                        "edge_id": r["edge_id"],
                        "name": r["name"],
                        "latitude": r["latitude"],
                        "longitude": r["longitude"],
                        "coverage_radius_m": r["coverage_radius_m"],
                    }
                    for r in regions
                ]
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    OUT_GEOJSON.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "name": "prevail-orr-corridor",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {
                            "name": e["name"],
                            "highway": e["cls"],
                            "lanes": max(2, int(e["half_width"] / 1.8)),
                            "speed_limit_mps": e["speed"],
                        },
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [list(reversed(to_latlon(x, z))) for x, z in e["pts"]],
                        },
                    }
                    for e in visible
                ],
            }
        ),
        encoding="utf-8",
    )

    for path in (OUT_NETWORK, OUT_SCENE, OUT_REGIONS, OUT_GEOJSON):
        print(f"[city] wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KiB)")


if __name__ == "__main__":
    main()
