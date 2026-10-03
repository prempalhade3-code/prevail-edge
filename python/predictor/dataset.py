"""Dataset generators and trajectory ingest utilities for edge sequence prediction."""

import random
from typing import Dict, List, Optional, Tuple
import torch
from torch.utils.data import Dataset


class SyntheticTrajectoryGenerator:
    """Generates route-coherent synthetic edge sequences for next-edge training.

    Real vehicles do not random-walk the edge graph: they traverse corridors
    toward a destination, so the next edge depends on *where the trip started*,
    not only on the current edge. Sampling from named route archetypes
    reproduces that higher-order structure, which is what makes the GRU
    meaningfully better than the first-order destination-matrix baseline.

    A memoryless walk over the adjacency graph would cap top-1 accuracy near
    chance and make the GRU-versus-Markov comparison vacuous.
    """

    # Commuter archetypes over the Bangalore corridor topology:
    # edge-a Central, edge-b East, edge-c South-East, edge-d North-West.
    DEFAULT_ROUTES: List[Tuple[List[str], float]] = [
        (["edge-d", "edge-a", "edge-b"], 0.22),            # NW residential -> centre -> east offices
        (["edge-d", "edge-a", "edge-b", "edge-c"], 0.16),  # same, continuing onto the south highway
        (["edge-b", "edge-a", "edge-d"], 0.20),            # evening return
        (["edge-c", "edge-b", "edge-a"], 0.14),            # south-east inbound
        (["edge-a", "edge-b", "edge-c"], 0.12),            # cross-town along MG Road then highway
        (["edge-c", "edge-a", "edge-d"], 0.08),            # diagonal transit
        (["edge-a", "edge-b", "edge-a"], 0.08),            # local out-and-back
    ]

    def __init__(
        self,
        edge_ids: Optional[List[str]] = None,
        seed: int = 42,
        deviation_prob: float = 0.08,
        dwell_prob: float = 0.18,
    ):
        self.edge_ids = edge_ids or ["edge-a", "edge-b", "edge-c", "edge-d"]
        self.random = random.Random(seed)
        self.deviation_prob = deviation_prob
        self.dwell_prob = dwell_prob

        # Adjacency still constrains deviations to geographically plausible moves.
        self.transition_graph: Dict[str, List[str]] = {
            "edge-a": ["edge-b", "edge-c", "edge-d"],
            "edge-b": ["edge-a", "edge-c"],
            "edge-c": ["edge-a", "edge-b"],
            "edge-d": ["edge-a"],
        }
        for e in self.edge_ids:
            if e not in self.transition_graph:
                self.transition_graph[e] = [x for x in self.edge_ids if x != e] or [e]

        known = set(self.edge_ids)
        self.routes = [
            (route, weight)
            for route, weight in self.DEFAULT_ROUTES
            if all(step in known for step in route)
        ]
        if not self.routes:
            self.routes = [([e for e in self.edge_ids], 1.0)]

    def _pick_route(self) -> List[str]:
        routes = [r for r, _ in self.routes]
        weights = [w for _, w in self.routes]
        return self.random.choices(routes, weights=weights, k=1)[0]

    def generate_trajectory(self, min_len: int = 4, max_len: int = 12) -> List[str]:
        """Generates one route-coherent trajectory, with dwells and occasional detours."""
        route = self._pick_route()
        # Start partway along the route sometimes, so prefixes are not all trip starts.
        start = self.random.randrange(len(route))
        target_len = self.random.randint(min_len, max_len)

        trajectory: List[str] = []
        cursor = start

        while len(trajectory) < target_len:
            current = route[cursor % len(route)]
            trajectory.append(current)

            # Dwell: the vehicle lingers in an edge before moving on.
            if self.random.random() < self.dwell_prob and len(trajectory) < target_len:
                trajectory.append(current)

            if self.random.random() < self.deviation_prob:
                # Detour to an adjacent edge, then rejoin the route.
                candidates = [
                    e for e in self.transition_graph.get(current, self.edge_ids) if e != current
                ]
                if candidates and len(trajectory) < target_len:
                    trajectory.append(self.random.choice(candidates))

            cursor += 1

        return trajectory[:target_len]

    def generate_dataset(
        self, num_sequences: int = 1000, min_len: int = 4, max_len: int = 12
    ) -> List[List[str]]:
        """Generates a collection of synthetic trajectory sequences."""
        return [
            self.generate_trajectory(min_len=min_len, max_len=max_len)
            for _ in range(num_sequences)
        ]


class EdgeSequenceDataset(Dataset):
    """PyTorch Dataset for training GRU on prefix sequences to predict the next edge."""

    def __init__(
        self,
        sequences: List[List[str]],
        edge_to_idx: Dict[str, int],
        min_prefix_len: int = 1,
        max_seq_len: int = 10,
    ):
        self.samples: List[Tuple[List[int], int]] = []
        self.edge_to_idx = edge_to_idx
        self.max_seq_len = max_seq_len

        for seq in sequences:
            if len(seq) < 2:
                continue
            token_ids = [self.edge_to_idx[e] for e in seq if e in self.edge_to_idx]
            for i in range(min_prefix_len, len(token_ids)):
                prefix = token_ids[max(0, i - max_seq_len) : i]
                target = token_ids[i] - 1  # 0-indexed for CrossEntropyLoss
                self.samples.append((prefix, target))

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor]:
        prefix, target = self.samples[idx]
        return torch.tensor(prefix, dtype=torch.long), torch.tensor(target, dtype=torch.long)


def collate_sequence_batch(batch: List[Tuple[torch.Tensor, torch.Tensor]]) -> Tuple[torch.Tensor, torch.Tensor]:
    """Collates variable-length prefix sequences into a zero-padded batch tensor."""
    prefixes, targets = zip(*batch)
    max_len = max(len(p) for p in prefixes)
    padded_prefixes = torch.zeros((len(prefixes), max_len), dtype=torch.long)
    for i, p in enumerate(prefixes):
        padded_prefixes[i, -len(p) :] = p  # Left pad with 0 (padding idx)
    target_tensor = torch.tensor(targets, dtype=torch.long)
    return padded_prefixes, target_tensor


def parse_gps_trajectory_to_edge_sequence(
    gps_points: List[Tuple[float, float]],
    region_mapper=None,
) -> List[str]:
    """Maps raw GPS trajectory points (lat, lon) to a collapsed edge sequence.

    Args:
        gps_points: List of (latitude, longitude) coordinate tuples.
        region_mapper: Optional RegionMapper instance (from python.mobility.region_mapper).

    Returns:
        List of consecutive edge IDs with immediate self-loops deduplicated.
    """
    if not gps_points:
        return []

    edge_sequence = []
    prev_edge = None

    for lat, lon in gps_points:
        if region_mapper is not None:
            edge_id = region_mapper.get_edge_id(lat, lon)
        else:
            # Fallback distance heuristic if region_mapper is not passed
            edge_id = "edge-a"

        if edge_id != prev_edge:
            edge_sequence.append(edge_id)
            prev_edge = edge_id

    return edge_sequence
