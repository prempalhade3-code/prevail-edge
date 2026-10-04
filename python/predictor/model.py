"""PyTorch GRU Neural Network for Edge Trajectory Prediction."""

import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import torch
import torch.nn as nn
import torch.nn.functional as F


FEATURE_DIM = 2  # speed_norm, heading_norm
SPEED_SCALE = 30.0  # m/s


def normalize_speed(speed_mps: float) -> float:
    return max(0.0, min(float(speed_mps) / SPEED_SCALE, 2.0))


def normalize_heading(heading_deg: float) -> float:
    return ((float(heading_deg) % 360.0) + 360.0) % 360.0 / 360.0


class EdgePredictorGRU(nn.Module):
    """Compact Recurrent Neural Network (GRU) for next-edge probability prediction.

    Each step is an edge-id embedding concatenated with speed and heading.
    Designed for ultra-low latency edge inference with model footprint well under 1 MB.
    """

    def __init__(
        self,
        num_edges: int = 4,
        embedding_dim: int = 16,
        hidden_dim: int = 32,
        num_layers: int = 1,
        dropout: float = 0.0,
        feature_dim: int = FEATURE_DIM,
    ):
        super().__init__()
        self.num_edges = num_edges
        self.embedding_dim = embedding_dim
        self.hidden_dim = hidden_dim
        self.num_layers = num_layers
        self.feature_dim = feature_dim

        # Token 0 is reserved for padding/unknown, tokens 1..num_edges are edge IDs
        self.embedding = nn.Embedding(
            num_embeddings=num_edges + 1,
            embedding_dim=embedding_dim,
            padding_idx=0,
        )
        self.gru = nn.GRU(
            input_size=embedding_dim + feature_dim,
            hidden_size=hidden_dim,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0.0,
        )
        self.fc = nn.Linear(hidden_dim, num_edges)

    def forward(self, tokens: torch.Tensor, features: Optional[torch.Tensor] = None) -> torch.Tensor:
        """Forward pass.

        Args:
            tokens: (batch, seq_len) integer token IDs.
            features: (batch, seq_len, feature_dim) speed/heading. Zeros if omitted.

        Returns:
            (batch, num_edges) raw logits.
        """
        embedded = self.embedding(tokens)
        if features is None:
            features = torch.zeros(
                tokens.size(0), tokens.size(1), self.feature_dim, device=tokens.device
            )
        x = torch.cat([embedded, features], dim=-1)
        _, h_n = self.gru(x)
        last_hidden = h_n[-1]
        return self.fc(last_hidden)

    def predict_distribution(
        self,
        sequence_tokens: List[int],
        edge_ids: List[str],
        temperature: float = 1.0,
        features: Optional[List[Tuple[float, float]]] = None,
    ) -> Dict[str, float]:
        """Runs inference on a token sequence and returns normalized edge probabilities."""
        self.eval()
        if not sequence_tokens:
            n = len(edge_ids)
            return {e: round(1.0 / n, 6) for e in edge_ids}

        with torch.no_grad():
            x = torch.tensor([sequence_tokens], dtype=torch.long)
            feat = None
            if features:
                aligned = features[-len(sequence_tokens) :]
                while len(aligned) < len(sequence_tokens):
                    aligned = [(0.0, 0.0)] + list(aligned)
                feat = torch.tensor([aligned], dtype=torch.float32)
            logits = self.forward(x, feat)[0]
            if temperature and temperature != 1.0:
                logits = logits / temperature
            probs_list = F.softmax(logits, dim=-1).cpu().tolist()

        raw_probs = {}
        for idx, edge_id in enumerate(edge_ids):
            raw_probs[edge_id] = float(probs_list[idx]) if idx < len(probs_list) else 0.0

        total = sum(raw_probs.values())
        if total > 0:
            probs = {k: round(v / total, 6) for k, v in raw_probs.items()}
            diff = round(1.0 - sum(probs.values()), 6)
            first_key = next(iter(probs.keys()))
            probs[first_key] = round(probs[first_key] + diff, 6)
            return probs

        n = len(edge_ids)
        return {e: round(1.0 / n, 6) for e in edge_ids}

    def _dummy_inputs(self) -> Tuple[torch.Tensor, torch.Tensor]:
        tokens = torch.tensor([[1, 2, 3]], dtype=torch.long)
        features = torch.tensor([[[0.4, 0.25], [0.45, 0.5], [0.5, 0.75]]], dtype=torch.float32)
        return tokens, features

    def export_torchscript(self, save_path: str) -> str:
        """Exports the model to a TorchScript tracing file (.pt) under 1 MB."""
        self.eval()
        tokens, features = self._dummy_inputs()
        traced_model = torch.jit.trace(self, (tokens, features))
        Path(save_path).parent.mkdir(parents=True, exist_ok=True)
        traced_model.save(save_path)

        file_size_bytes = os.path.getsize(save_path)
        file_size_kb = file_size_bytes / 1024.0
        if file_size_kb > 1024.0:
            raise ValueError(f"Exported model exceeds 1 MB: {file_size_kb:.2f} KB")

        return save_path

    def export_onnx(self, save_path: str) -> str:
        """Exports the model to ONNX format. Fails closed if export cannot complete."""
        self.eval()
        tokens, features = self._dummy_inputs()
        Path(save_path).parent.mkdir(parents=True, exist_ok=True)
        kwargs = dict(
            input_names=["input_sequence", "input_features"],
            output_names=["logits"],
            dynamic_axes={
                "input_sequence": {0: "batch_size", 1: "seq_len"},
                "input_features": {0: "batch_size", 1: "seq_len"},
            },
            opset_version=14,
        )
        try:
            torch.onnx.export(self, (tokens, features), save_path, dynamo=False, **kwargs)
        except TypeError:
            torch.onnx.export(self, (tokens, features), save_path, **kwargs)
        if not os.path.exists(save_path) or os.path.getsize(save_path) < 64:
            raise RuntimeError(f"ONNX export produced no usable file at {save_path}")
        return save_path
