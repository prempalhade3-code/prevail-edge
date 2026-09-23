"""Destination-matrix Markov transition baseline for next-edge prediction."""

import json
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional


class DestinationMatrixBaseline:
    """First-order Markov destination-matrix baseline.

    Computes empirical transition probabilities:
        P(edge_{t+1} | edge_t)
    with Laplace smoothing.
    """

    def __init__(self, edge_ids: Optional[List[str]] = None, alpha: float = 0.05):
        self.edge_ids = edge_ids or ["edge-a", "edge-b", "edge-c", "edge-d"]
        self.alpha = alpha
        self.transition_counts: Dict[str, Dict[str, float]] = defaultdict(
            lambda: defaultdict(float)
        )
        self.transitions: Dict[str, Dict[str, float]] = {}
        self._init_default_transitions()

    def _init_default_transitions(self):
        """Initializes default transition probabilities with mild smoothing."""
        n = len(self.edge_ids)
        uniform_prob = 1.0 / n if n > 0 else 1.0
        for src in self.edge_ids:
            self.transitions[src] = {dst: uniform_prob for dst in self.edge_ids}

    def fit(self, sequences: List[List[str]]) -> "DestinationMatrixBaseline":
        """Fits transition counts from a collection of edge ID sequences.

        Args:
            sequences: List of trajectories where each trajectory is a list of edge IDs.
        """
        counts: Dict[str, Dict[str, float]] = {
            src: {dst: self.alpha for dst in self.edge_ids} for src in self.edge_ids
        }

        for seq in sequences:
            if not seq or len(seq) < 2:
                continue
            for i in range(len(seq) - 1):
                src, dst = seq[i], seq[i + 1]
                if src in counts and dst in counts[src]:
                    counts[src][dst] += 1.0

        # Normalize to conditional probabilities
        self.transitions = {}
        for src in self.edge_ids:
            total = sum(counts[src].values())
            if total > 0:
                raw_probs = {dst: counts[src][dst] / total for dst in self.edge_ids}
                # Ensure clean float rounding summing to 1.0
                total_p = sum(raw_probs.values())
                self.transitions[src] = {
                    dst: round(prob / total_p, 6) for dst, prob in raw_probs.items()
                }
            else:
                self.transitions[src] = {
                    dst: round(1.0 / len(self.edge_ids), 6) for dst in self.edge_ids
                }

        return self

    def predict_proba(self, current_edge: Optional[str] = None) -> Dict[str, float]:
        """Returns next-edge probability distribution given current edge.

        Args:
            current_edge: The latest visited edge ID. If None or unknown, returns uniform prior.
        """
        if current_edge and current_edge in self.transitions:
            probs = dict(self.transitions[current_edge])
        else:
            n = len(self.edge_ids)
            probs = {edge: round(1.0 / n, 6) for edge in self.edge_ids}

        # Normalize so sum == 1.0
        total = sum(probs.values())
        if total > 0:
            diff = 1.0 - total
            first_key = next(iter(probs.keys()))
            probs[first_key] = round(probs[first_key] + diff, 6)
        return probs

    def save(self, filepath: str) -> None:
        """Saves transition matrix to JSON file."""
        data = {
            "edge_ids": self.edge_ids,
            "alpha": self.alpha,
            "transitions": self.transitions,
        }
        Path(filepath).parent.mkdir(parents=True, exist_ok=True)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    @classmethod
    def load(cls, filepath: str) -> "DestinationMatrixBaseline":
        """Loads transition matrix from JSON file."""
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
        baseline = cls(edge_ids=data["edge_ids"], alpha=data.get("alpha", 0.05))
        baseline.transitions = data["transitions"]
        return baseline
