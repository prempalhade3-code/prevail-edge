"""City road network plus derived edge-zone distances."""

from __future__ import annotations

import json
import math
from heapq import heappop, heappush
from pathlib import Path
from typing import Dict, List, Optional, Tuple

Coord = Tuple[float, float]


def _haversine_m(a: Coord, b: Coord) -> float:
    r = 6371000.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dphi = math.radians(b[0] - a[0])
    dlmb = math.radians(b[1] - a[1])
    h = math.sin(dphi / 2.0) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2.0) ** 2
    return 2.0 * r * math.atan2(math.sqrt(h), math.sqrt(1.0 - h))


def _polyline_length(pts: List[Coord]) -> float:
    return sum(_haversine_m(pts[i - 1], pts[i]) for i in range(1, len(pts)))


class RoadGraph:
    def __init__(self, path: Optional[str] = None):
        if path is None:
            root = Path(__file__).resolve().parents[2]
            path = str(root / "deploy" / "config" / "road-graph.json")
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        self.nodes: Dict[str, dict] = {}
        self.adj: Dict[str, List[Tuple[str, float]]] = {}
        self.geometries: Dict[Tuple[str, str], List[Coord]] = {}
        self.zone_adj: Dict[str, List[Tuple[str, float]]] = {}
        self._load(raw)

    def _load(self, raw: dict) -> None:
        nodes = raw.get("nodes", {})
        if isinstance(nodes, list):
            for node_id in nodes:
                self.nodes[str(node_id)] = {"id": node_id, "type": "zone", "edge_id": node_id}
                self.adj[str(node_id)] = []
            for edge in raw.get("edges", []):
                src, dst = str(edge["from"]), str(edge["to"])
                dist = float(edge["distance_m"])
                self.adj.setdefault(src, []).append((dst, dist))
                self.zone_adj.setdefault(src, []).append((dst, dist))
            return

        for node_id, meta in nodes.items():
            record = dict(meta)
            record["id"] = node_id
            self.nodes[node_id] = record
            self.adj[node_id] = []

        for edge in raw.get("edges", []):
            src, dst = str(edge["from"]), str(edge["to"])
            pts = [(float(p[0]), float(p[1])) for p in (edge.get("waypoints") or [])]
            if len(pts) < 2:
                sa = self.nodes.get(src, {})
                da = self.nodes.get(dst, {})
                pts = [(float(sa["latitude"]), float(sa["longitude"])), (float(da["latitude"]), float(da["longitude"]))]
            dist = float(edge.get("distance_m") or _polyline_length(pts))
            self.adj.setdefault(src, []).append((dst, dist))
            self.adj.setdefault(dst, []).append((src, dist))
            self.geometries[(src, dst)] = pts
            self.geometries[(dst, src)] = list(reversed(pts))
            ea = self.nodes.get(src, {}).get("edge_id")
            eb = self.nodes.get(dst, {}).get("edge_id")
            if ea and eb and ea != eb:
                self.zone_adj.setdefault(ea, []).append((eb, dist))
                self.zone_adj.setdefault(eb, []).append((ea, dist))

    def city_ids(self) -> List[str]:
        return [nid for nid, meta in self.nodes.items() if meta.get("type") == "city" or "latitude" in meta]

    def resolve(self, node_id: str) -> Optional[str]:
        if node_id in self.adj:
            return node_id
        return None

    def geometry(self, src: str, dst: str) -> List[Coord]:
        return list(self.geometries.get((src, dst), []))

    def path_geometry(self, path: List[str]) -> List[Coord]:
        if not path:
            return []
        if len(path) == 1:
            node = self.nodes.get(path[0], {})
            if "latitude" in node:
                return [(float(node["latitude"]), float(node["longitude"]))]
            return []
        out: List[Coord] = []
        for a, b in zip(path, path[1:]):
            segment = self.geometry(a, b)
            if not segment:
                continue
            if out and segment[0] == out[-1]:
                out.extend(segment[1:])
            else:
                out.extend(segment)
        return out

    def _dijkstra(self, adj: Dict[str, List[Tuple[str, float]]], src: str, dst: str) -> Optional[float]:
        if src == dst:
            return 0.0
        if src not in adj or dst not in adj:
            return None
        dist = {src: 0.0}
        heap: List[Tuple[float, str]] = [(0.0, src)]
        seen = set()
        while heap:
            cost, node = heappop(heap)
            if node in seen:
                continue
            seen.add(node)
            if node == dst:
                return cost
            for nxt, weight in adj.get(node, []):
                nxt_cost = cost + weight
                if nxt_cost < dist.get(nxt, float("inf")):
                    dist[nxt] = nxt_cost
                    heappush(heap, (nxt_cost, nxt))
        return None

    def shortest_path_m(self, src: str, dst: str) -> Optional[float]:
        if src in self.adj and dst in self.adj:
            return self._dijkstra(self.adj, src, dst)
        if src in self.zone_adj or dst in self.zone_adj:
            return self._dijkstra(self.zone_adj, src, dst)
        return None
