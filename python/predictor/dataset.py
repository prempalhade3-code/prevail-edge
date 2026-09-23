"""Dataset generators and trajectory ingest utilities for edge sequence prediction."""

import random
from typing import Dict, List, Optional, Tuple
import torch
from torch.utils.data import Dataset


class SyntheticTrajectoryGenerator:
    """Generates synthetic edge sequence trajectories based on edge spatial adjacency."""

    def __init__(self, edge_ids: Optional[List[str]] = None, seed: int = 42):
        self.edge_ids = edge_ids or ["edge-a", "edge-b", "edge-c", "edge-d"]
        self.random = random.Random(seed)

        # Adjacency transition graph modeling typical urban routes
        # edge-a (Central) connects to all: B (East), C (South-East), D (North-West)
        # edge-b connects to A, C
        # edge-c connects to A, B
        # edge-d connects to A
        self.transition_graph: Dict[str, List[str]] = {
            "edge-a": ["edge-b", "edge-c", "edge-d", "edge-b", "edge-a"],
            "edge-b": ["edge-a", "edge-c", "edge-b"],
            "edge-c": ["edge-a", "edge-b", "edge-c"],
            "edge-d": ["edge-a", "edge-d"],
        }
        # Fallback for any unknown nodes
        for e in self.edge_ids:
            if e not in self.transition_graph:
                self.transition_graph[e] = [x for x in self.edge_ids if x != e] or [e]

    def generate_trajectory(self, min_len: int = 4, max_len: int = 12) -> List[str]:
        """Generates a single synthetic trajectory sequence of edge IDs."""
        length = self.random.randint(min_len, max_len)
        current = self.random.choice(self.edge_ids)
        trajectory = [current]

        for _ in range(length - 1):
            next_candidates = self.transition_graph.get(current, self.edge_ids)
            current = self.random.choice(next_candidates)
            trajectory.append(current)

        return trajectory

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
