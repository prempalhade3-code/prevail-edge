"""Corridor road-network distances used for ETA (not centroid Haversine)."""

from __future__ import annotations

import json
from heapq import heappop, heappush
from pathlib import Path
from typing import Dict, List, Optional, Tuple


class RoadGraph:
    def __init__(self, path: Optional[str] = None):
        if path is None:
            root = Path(__file__).resolve().parents[2]
            path = str(root / "deploy" / "config" / "road-graph.json")
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        self.adj: Dict[str, List[Tuple[str, float]]] = {n: [] for n in raw.get("nodes", [])}
        for edge in raw.get("edges", []):
            self.adj.setdefault(edge["from"], []).append((edge["to"], float(edge["distance_m"])))

    def shortest_path_m(self, src: str, dst: str) -> Optional[float]:
        if src == dst:
            return 0.0
        if src not in self.adj or dst not in self.adj:
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
            for nxt, weight in self.adj.get(node, []):
                nxt_cost = cost + weight
                if nxt_cost < dist.get(nxt, float("inf")):
                    dist[nxt] = nxt_cost
                    heappush(heap, (nxt_cost, nxt))
        return None
