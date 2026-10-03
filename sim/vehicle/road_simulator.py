#!/usr/bin/env python3
"""Graph-based road simulator for PREVAIL.

The vehicle drives a route solved over the real OpenStreetMap graph of the
Bangalore ORR tech corridor, so every position it reports lies on actual road
geometry. Longitudinal motion comes from a proper speed profile: curvature sets
a cornering limit, a backward pass turns that into anticipated braking, and IDM
handles car-following. Background traffic random-walks the same graph and takes
real turns at junctions.

Coordinates are metres in a local XZ frame about the corridor origin; latitude
and longitude are derived at the boundary so the runtime contract is unchanged.

Usage:
  PREVAIL_BACKEND_URL=http://127.0.0.1:8000 python sim/vehicle/road_simulator.py
  PREVAIL_FLINK_TAP=127.0.0.1:9999   # optional JSONL tap for the Flink socket source
"""

from __future__ import annotations

import json
import math
import os
import random
import socket
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from python.mobility.region_mapper import RegionMapper
from python.mobility.session_config import get_session_id

NETWORK = ROOT / "sim" / "network" / "city-network.json"

M_PER_DEG_LAT = 111_320.0

# Vehicle dynamics (metres, seconds).
A_ACCEL = 1.7          # comfortable acceleration
A_BRAKE = 3.2          # comfortable deceleration
A_LATERAL = 2.6        # cornering grip budget -> sets curve speed
STEP_M = 5.0           # route resampling interval
LANE_OFFSET = 2.4      # distance from centreline to the travelled lane
TRAFFIC_COUNT = 28
TRAFFIC_VISIBLE_M = 650.0

rng = random.Random(7)


# --------------------------------------------------------------------- geometry


class Projection:
    def __init__(self, lat0: float, lon0: float):
        self.lat0 = lat0
        self.lon0 = lon0
        self.m_per_deg_lon = M_PER_DEG_LAT * math.cos(math.radians(lat0))

    def to_latlon(self, x: float, z: float) -> Tuple[float, float]:
        return (self.lat0 - z / M_PER_DEG_LAT, self.lon0 + x / self.m_per_deg_lon)


def bearing_from_tangent(ux: float, uz: float) -> float:
    """Compass bearing in degrees; +x is east and -z is north in our frame."""
    return (math.degrees(math.atan2(ux, -uz)) + 360.0) % 360.0


@dataclass
class Path:
    """A drivable lane polyline with smoothed tangents and a speed profile.

    `pts` is already offset into the travelled lane and smoothed, so following it
    cannot produce the sideways jolt you get from offsetting a raw polyline whose
    perpendicular flips at every sharp vertex.
    """

    pts: List[Tuple[float, float]]
    center: List[Tuple[float, float]]
    tangent: List[Tuple[float, float]]
    cum: List[float]
    limit: List[float]
    names: List[str]
    # Main legs end at a destination and come to rest; connector manoeuvres are
    # driven straight through into the following leg.
    stop_at_end: bool = True

    @property
    def length(self) -> float:
        return self.cum[-1] if self.cum else 0.0

    def _bracket(self, s: float) -> Tuple[int, float]:
        lo, hi = 0, len(self.cum) - 1
        while lo < hi - 1:
            mid = (lo + hi) // 2
            if self.cum[mid] <= s:
                lo = mid
            else:
                hi = mid
        nxt = min(lo + 1, len(self.cum) - 1)
        seg = max(self.cum[nxt] - self.cum[lo], 1e-6)
        return lo, min(max((s - self.cum[lo]) / seg, 0.0), 1.0)

    def locate(self, s: float) -> Tuple[float, float, float, float, float]:
        """Return (x, z, ux, uz, speed_limit) at arc length s."""
        s = min(max(s, 0.0), self.length)
        i, t = self._bracket(s)
        j = min(i + 1, len(self.pts) - 1)
        a, b = self.pts[i], self.pts[j]
        ta, tb = self.tangent[i], self.tangent[j]
        ux, uz = ta[0] + (tb[0] - ta[0]) * t, ta[1] + (tb[1] - ta[1]) * t
        norm = math.hypot(ux, uz) or 1.0
        return (
            a[0] + (b[0] - a[0]) * t,
            a[1] + (b[1] - a[1]) * t,
            ux / norm,
            uz / norm,
            self.limit[i],
        )

    def road_name(self, s: float) -> str:
        if not self.names:
            return ""
        idx = min(range(len(self.cum)), key=lambda i: abs(self.cum[i] - s))
        return self.names[min(idx, len(self.names) - 1)]


def build_path(
    pts: Sequence[Sequence[float]],
    speeds: Sequence[float],
    names: Sequence[str],
    lane_offset: float = LANE_OFFSET,
    stop_at_end: bool = True,
    terminal_speed: Optional[float] = None,
) -> Path:
    """Resample to a fixed step, then derive a physically achievable speed profile."""
    pts = [(float(p[0]), float(p[1])) for p in pts]
    if len(pts) < 2:
        raise ValueError("path needs at least two points")

    dense: List[Tuple[float, float]] = [pts[0]]
    dense_limit: List[float] = [float(speeds[0])]
    dense_name: List[str] = [names[0] if names else ""]

    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        seg = math.hypot(b[0] - a[0], b[1] - a[1])
        if seg < 1e-6:
            continue
        lim = float(speeds[min(i, len(speeds) - 1)])
        nm = names[min(i, len(names) - 1)] if names else ""
        steps = max(1, int(round(seg / STEP_M)))
        for s in range(1, steps + 1):
            t = s / steps
            dense.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
            dense_limit.append(lim)
            dense_name.append(nm)

    # Tangents averaged over a short window, so direction changes gradually through
    # junction corners instead of snapping at each vertex.
    window = max(1, int(round(14.0 / STEP_M)))
    tangent: List[Tuple[float, float]] = []
    for i in range(len(dense)):
        a = dense[max(0, i - window)]
        b = dense[min(len(dense) - 1, i + window)]
        dx, dz = b[0] - a[0], b[1] - a[1]
        n = math.hypot(dx, dz)
        if n < 1e-9:
            tangent.append(tangent[-1] if tangent else (0.0, 1.0))
        else:
            tangent.append((dx / n, dz / n))

    # Offset into the travelled lane, then relax the result to remove residual kinks.
    # India drives on the left, so the lane sits on the left of the direction of
    # travel. Opposing traffic has a reversed tangent and lands on the other side.
    lane = [
        (p[0] + t[1] * lane_offset, p[1] - t[0] * lane_offset)
        for p, t in zip(dense, tangent)
    ]
    for _ in range(2):
        smoothed = list(lane)
        for i in range(1, len(lane) - 1):
            smoothed[i] = (
                (lane[i - 1][0] + 2.0 * lane[i][0] + lane[i + 1][0]) * 0.25,
                (lane[i - 1][1] + 2.0 * lane[i][1] + lane[i + 1][1]) * 0.25,
            )
        lane = smoothed

    cum = [0.0]
    for i in range(1, len(lane)):
        cum.append(cum[-1] + math.hypot(lane[i][0] - lane[i - 1][0], lane[i][1] - lane[i - 1][1]))

    # Cornering limit from the local radius of curvature.
    limit = list(dense_limit)
    for i in range(1, len(dense) - 1):
        p0, p1, p2 = dense[i - 1], dense[i], dense[i + 1]
        a = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        b = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
        c = math.hypot(p2[0] - p0[0], p2[1] - p0[1])
        area = abs((p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1])) * 0.5
        if area < 1e-6:
            continue
        radius = (a * b * c) / (4.0 * area)
        limit[i] = min(limit[i], max(4.0, math.sqrt(A_LATERAL * radius)))

    # Arriving at a destination is part of the profile, so the backward pass below
    # spreads the braking over the approach instead of stopping short of the end.
    if terminal_speed is not None:
        limit[-1] = min(limit[-1], terminal_speed)

    # Backward pass: braking has to start before the corner, not inside it.
    for i in range(len(limit) - 2, -1, -1):
        ds = max(cum[i + 1] - cum[i], 1e-6)
        limit[i] = min(limit[i], math.sqrt(limit[i + 1] ** 2 + 2.0 * A_BRAKE * ds))

    return Path(lane, dense, tangent, cum, limit, dense_name, stop_at_end)


def make_uturn(a: Path, b: Path, reach: float = 11.0, speed: float = 3.5) -> Path:
    """A short cubic arc joining the end of one leg to the start of the next.

    Without this the car would snap across the central reserve, because the return
    leg legitimately runs down the opposite carriageway. Driving the arc keeps the
    position continuous through the turn.
    """
    p0, t0 = a.pts[-1], a.tangent[-1]
    p3, t3 = b.pts[0], b.tangent[0]
    p1 = (p0[0] + t0[0] * reach, p0[1] + t0[1] * reach)
    p2 = (p3[0] - t3[0] * reach, p3[1] - t3[1] * reach)

    pts: List[Tuple[float, float]] = []
    samples = 28
    for k in range(samples + 1):
        t = k / samples
        m = 1.0 - t
        pts.append(
            (
                m**3 * p0[0] + 3 * m**2 * t * p1[0] + 3 * m * t**2 * p2[0] + t**3 * p3[0],
                m**3 * p0[1] + 3 * m**2 * t * p1[1] + 3 * m * t**2 * p2[1] + t**3 * p3[1],
            )
        )

    # Endpoints are already lane positions, so no further offset is applied.
    return build_path(
        pts, [speed] * len(pts), ["U-turn"] * len(pts), lane_offset=0.0, stop_at_end=False
    )


# ------------------------------------------------------------------ road graph


class Graph:
    def __init__(self, raw: dict):
        self.nodes: Dict[str, Tuple[float, float]] = {
            k: (v[0], v[1]) for k, v in raw["nodes"].items()
        }
        self.adj: Dict[str, List[dict]] = {}
        for e in raw["edges"]:
            for a, b, pts in ((e["a"], e["b"], e["pts"]), (e["b"], e["a"], list(reversed(e["pts"])))):
                self.adj.setdefault(a, []).append(
                    {"to": b, "pts": pts, "speed": e["speed"], "name": e["name"]}
                )

    def random_walk(self, start: str, min_length: float = 2200.0) -> Optional[Path]:
        """Walk real edges, preferring to continue straight at junctions."""
        pts: List[Tuple[float, float]] = []
        speeds: List[float] = []
        names: List[str] = []
        node = start
        prev: Optional[str] = None
        total = 0.0
        guard = 0

        while total < min_length and guard < 400:
            guard += 1
            options = [o for o in self.adj.get(node, []) if o["to"] != prev] or self.adj.get(node, [])
            if not options:
                break

            if pts and len(options) > 1:
                hx = pts[-1][0] - pts[-2][0] if len(pts) >= 2 else 0.0
                hz = pts[-1][1] - pts[-2][1] if len(pts) >= 2 else 0.0
                hn = math.hypot(hx, hz) or 1.0

                def straightness(o: dict) -> float:
                    seg = o["pts"]
                    dx, dz = seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]
                    dn = math.hypot(dx, dz) or 1.0
                    return (hx / hn) * (dx / dn) + (hz / hn) * (dz / dn)

                options = sorted(options, key=straightness, reverse=True)
                choice = options[0] if rng.random() < 0.65 else options[rng.randrange(len(options))]
            else:
                choice = options[rng.randrange(len(options))]

            seg = choice["pts"]
            for i, p in enumerate(seg):
                if pts and i == 0:
                    continue
                pts.append((float(p[0]), float(p[1])))
                speeds.append(choice["speed"])
                names.append(choice["name"])
            for i in range(len(seg) - 1):
                total += math.hypot(seg[i + 1][0] - seg[i][0], seg[i + 1][1] - seg[i][1])

            prev, node = node, choice["to"]

        if len(pts) < 3:
            return None
        return build_path(pts, speeds, names)


# --------------------------------------------------------------------- agents


@dataclass
class Agent:
    vehicle_id: str
    path: Path
    s: float = 0.0
    v: float = 0.0
    is_hero: bool = False
    # Fixed per vehicle so drivers keep a consistent character instead of
    # re-rolling their desired speed on every tick.
    speed_factor: float = 0.95
    node: Optional[str] = None
    x: float = 0.0
    z: float = 0.0
    ux: float = 0.0
    uz: float = 1.0
    limit: float = 10.0

    def refresh_pose(self) -> None:
        # The path is already offset into the correct lane; opposing traffic lands on
        # the other side of the centreline because its tangent is reversed.
        self.x, self.z, self.ux, self.uz, self.limit = self.path.locate(self.s)

    @property
    def heading_deg(self) -> float:
        return bearing_from_tangent(self.ux, self.uz)


def gap_ahead(agent: Agent, others: Iterable[Agent]) -> Tuple[float, float]:
    """Nearest vehicle in front in the same lane: returns (gap, its speed)."""
    best = 160.0
    lead_v = best
    for o in others:
        if o is agent:
            continue
        dx, dz = o.x - agent.x, o.z - agent.z
        along = dx * agent.ux + dz * agent.uz
        if along <= 0.5 or along > best:
            continue
        # Only same-direction vehicles matter; oncoming traffic is in the other lane.
        if o.ux * agent.ux + o.uz * agent.uz < 0.70:
            continue
        lateral = abs(dx * (-agent.uz) + dz * agent.ux)
        if lateral > 3.2:
            continue
        best, lead_v = along, o.v
    return best, lead_v


# Intelligent Driver Model constants.
IDM_S0 = 2.5       # bumper-to-bumper gap at a standstill
IDM_T = 1.3        # desired time headway
IDM_DELTA = 4.0


def idm_accel(agent: Agent, gap: float, lead_v: float) -> float:
    """Acceleration from IDM, with the curvature profile as the free-flow target.

    Unlike a speed-proportional rule this pulls away from a standstill whenever the
    gap ahead opens up, so a stopped vehicle is never permanently stuck.
    """
    v0 = max(agent.limit * agent.speed_factor, 0.5)
    approach = agent.v - lead_v
    s_star = IDM_S0 + max(
        0.0, agent.v * IDM_T + (agent.v * approach) / (2.0 * math.sqrt(A_ACCEL * A_BRAKE))
    )
    free = 1.0 - (agent.v / v0) ** IDM_DELTA
    interaction = (s_star / max(gap, 0.5)) ** 2
    return A_ACCEL * (free - interaction)


def advance_leg(agent: Agent, legs: Sequence[Path], index: int) -> int:
    """Move to the next leg once this one is driven out, keeping motion continuous.

    Consecutive legs share an endpoint and leftover arc length is carried across, so
    the handover introduces no positional discontinuity at all.
    """
    if agent.s < agent.path.length:
        return index
    overflow = agent.s - agent.path.length
    index = (index + 1) % len(legs)
    agent.path = legs[index]
    agent.s = min(overflow, agent.path.length)
    return index


def advance(agent: Agent, accel: float, dt: float) -> None:
    accel = max(-A_BRAKE, min(A_ACCEL, accel))
    agent.v = max(0.0, agent.v + accel * dt)
    agent.s += agent.v * dt


# ------------------------------------------------------------------- plumbing


class FlinkTap:
    def __init__(self, host: str, port: int):
        self._sock: Optional[socket.socket] = None
        try:
            self._sock = socket.create_connection((host, port), timeout=2.0)
            print(f"[road-sim] Flink tap connected {host}:{port}", file=sys.stderr)
        except OSError as exc:
            print(f"[road-sim] Flink tap unavailable: {exc}", file=sys.stderr)

    def emit(self, sample: Dict[str, Any]) -> None:
        if self._sock:
            try:
                self._sock.sendall((json.dumps(sample) + "\n").encode())
            except OSError:
                pass


def post_json(url: str, payload: Any) -> None:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        if resp.status >= 400:
            raise urllib.error.HTTPError(url, resp.status, "request failed", resp.headers, None)


def nearest_node(graph: Graph, x: float, z: float) -> Optional[str]:
    best, bestd = None, float("inf")
    for nid, (nx, nz) in graph.nodes.items():
        d = (nx - x) ** 2 + (nz - z) ** 2
        if d < bestd:
            bestd, best = d, nid
    return best


def spawn_traffic(graph: Graph, near: Tuple[float, float], count: int) -> List[Agent]:
    """Place traffic on graph nodes close to a point, each on its own legal walk."""
    candidates = sorted(
        graph.nodes.items(),
        key=lambda kv: (kv[1][0] - near[0]) ** 2 + (kv[1][1] - near[1]) ** 2,
    )[: max(count * 6, 40)]

    agents: List[Agent] = []
    attempt = 0
    while len(agents) < count and attempt < count * 12:
        attempt += 1
        nid, _ = candidates[rng.randrange(len(candidates))]
        path = graph.random_walk(nid)
        if not path or path.length < 400.0:
            continue
        a = Agent(
            vehicle_id=f"traffic-{len(agents) + 1}",
            path=path,
            s=rng.uniform(0.0, path.length * 0.5),
            v=rng.uniform(5.0, 11.0),
            speed_factor=rng.uniform(0.78, 0.98),
            node=nid,
        )
        a.refresh_pose()
        agents.append(a)
    return agents


def respawn(agent: Agent, graph: Graph, near: Tuple[float, float], clear_of: float = 55.0) -> None:
    """Re-seed a vehicle that has finished its walk or wandered out of view.

    Keeps a buffer around the hero so a new vehicle never materialises close
    enough to force an emergency stop.
    """
    for _ in range(14):
        ox, oz = rng.uniform(-420.0, 420.0), rng.uniform(-420.0, 420.0)
        if math.hypot(ox, oz) < clear_of:
            continue
        nid = nearest_node(graph, near[0] + ox, near[1] + oz)
        if not nid:
            continue
        path = graph.random_walk(nid)
        if not path or path.length <= 400.0:
            continue
        agent.path = path
        agent.s = 0.0
        agent.v = rng.uniform(5.0, 11.0)
        agent.node = nid
        agent.refresh_pose()
        if math.hypot(agent.x - near[0], agent.z - near[1]) >= clear_of:
            return


# ------------------------------------------------------------------- main loop


def run_simulation(
    runtime_url: Optional[str] = None,
    predictor_url: Optional[str] = None,
    hz: float = 10.0,
    loop: bool = True,
):
    runtime_url = (
        runtime_url
        or os.environ.get("PREVAIL_RUNTIME_URL")
        or os.environ.get("PREVAIL_BACKEND_URL", "http://127.0.0.1:8000")
    ).rstrip("/")
    predictor_url = predictor_url or os.environ.get("PREVAIL_PREDICTOR_URL")

    net = json.loads(NETWORK.read_text(encoding="utf-8"))
    proj = Projection(net["origin"]["latitude"], net["origin"]["longitude"])
    route = net["route"]

    forward = build_path(
        route["points"], route["speed_limit_mps"], route["road_names"], terminal_speed=1.5
    )
    backward = build_path(
        list(reversed(route["points"])),
        list(reversed(route["speed_limit_mps"])),
        list(reversed(route["road_names"])),
        terminal_speed=1.5,
    )
    # Out, turn, back, turn: a continuous commute with no discontinuity anywhere.
    legs = [forward, make_uturn(forward, backward), backward, make_uturn(backward, forward)]
    leg_index = 0

    graph = Graph(net["graph"])
    mapper = RegionMapper()
    session_id = get_session_id()
    interval = 1.0 / hz

    flink_tap: Optional[FlinkTap] = None
    tap_spec = os.environ.get("PREVAIL_FLINK_TAP")
    if tap_spec and ":" in tap_spec:
        host, port = tap_spec.rsplit(":", 1)
        flink_tap = FlinkTap(host, int(port))

    hero = Agent("hero", forward, s=0.0, v=0.0, is_hero=True)
    hero.refresh_pose()
    traffic = spawn_traffic(graph, (hero.x, hero.z), TRAFFIC_COUNT)

    print(
        f"[road-sim] route={forward.length:.0f}m pts={len(forward.pts)} "
        f"traffic={len(traffic)} hz={hz} runtime={runtime_url}",
        file=sys.stderr,
    )

    dt = interval
    last_log = 0.0

    while True:
        t0 = time.time()
        everyone = [hero] + traffic

        for agent in everyone:
            gap, lead_v = gap_ahead(agent, everyone)

            advance(agent, idm_accel(agent, gap, lead_v), dt)

            if agent.is_hero:
                leg_index = advance_leg(agent, legs, leg_index)
                agent.refresh_pose()
                continue

            if agent.s >= agent.path.length - 2.0 or math.hypot(
                agent.x - hero.x, agent.z - hero.z
            ) > TRAFFIC_VISIBLE_M:
                respawn(agent, graph, (hero.x, hero.z))
            else:
                agent.refresh_pose()

        lat, lon = proj.to_latlon(hero.x, hero.z)
        edge_id = mapper.get_edge_id(lat, lon)
        sample = {
            "session_id": session_id,
            "timestamp_ms": int(time.time() * 1000),
            "latitude": round(lat, 6),
            "longitude": round(lon, 6),
            "speed_mps": round(hero.v, 2),
            "edge_id": edge_id,
            "heading_deg": round(hero.heading_deg, 1),
        }

        try:
            post_json(f"{runtime_url}/v1/trajectory", sample)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
            print(f"[road-sim] WARN runtime: {exc}", file=sys.stderr)

        if flink_tap:
            flink_tap.emit(sample)

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
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
                pass

        payload = []
        for agent in traffic:
            tlat, tlon = proj.to_latlon(agent.x, agent.z)
            payload.append(
                {
                    "vehicle_id": agent.vehicle_id,
                    "latitude": round(tlat, 6),
                    "longitude": round(tlon, 6),
                    "heading_deg": round(agent.heading_deg, 1),
                    "speed_mps": round(agent.v, 2),
                }
            )
        try:
            post_json(f"{runtime_url}/v1/traffic", payload)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
            pass

        if t0 - last_log > 5.0:
            last_log = t0
            print(
                f"[road-sim] edge={edge_id} v={hero.v:4.1f}m/s "
                f"s={hero.s:7.0f}/{hero.path.length:.0f}m road={hero.path.road_name(hero.s)[:28]} "
                f"traffic={len(payload)}",
                file=sys.stderr,
            )

        if not loop:
            break
        time.sleep(max(0.0, interval - (time.time() - t0)))


if __name__ == "__main__":
    run_simulation()
