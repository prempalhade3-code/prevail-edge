"""PyTorch GRU Neural Network for Edge Trajectory Prediction."""

import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import torch
import torch.nn as nn
import torch.nn.functional as F


class EdgePredictorGRU(nn.Module):
    """Compact Recurrent Neural Network (GRU) for next-edge probability prediction.

    Designed for ultra-low latency edge inference with model footprint well under 1 MB.
    """

    def __init__(
        self,
        num_edges: int = 4,
        embedding_dim: int = 16,
        hidden_dim: int = 32,
        num_layers: int = 1,
        dropout: float = 0.0,
    ):
        super().__init__()
        self.num_edges = num_edges
        self.embedding_dim = embedding_dim
        self.hidden_dim = hidden_dim
        self.num_layers = num_layers

        # Token 0 is reserved for padding/unknown, tokens 1..num_edges are edge IDs
        self.embedding = nn.Embedding(
            num_embeddings=num_edges + 1,
            embedding_dim=embedding_dim,
            padding_idx=0,
        )
        self.gru = nn.GRU(
            input_size=embedding_dim,
            hidden_size=hidden_dim,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0.0,
        )
        self.fc = nn.Linear(hidden_dim, num_edges)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Forward pass.

        Args:
            x: Tensor of shape (batch_size, seq_len) with integer token IDs.

        Returns:
            Tensor of shape (batch_size, num_edges) with raw logits.
        """
        # (batch_size, seq_len, embedding_dim)
        embedded = self.embedding(x)
        # output: (batch_size, seq_len, hidden_dim), h_n: (num_layers, batch_size, hidden_dim)
        _, h_n = self.gru(embedded)
        # Use top layer's last hidden state: (batch_size, hidden_dim)
        last_hidden = h_n[-1]
        logits = self.fc(last_hidden)
        return logits

    def predict_distribution(
        self,
        sequence_tokens: List[int],
        edge_ids: List[str],
        temperature: float = 1.0,
    ) -> Dict[str, float]:
        """Runs inference on a token sequence and returns normalized edge probabilities.

        Args:
            sequence_tokens: List of 1-based edge index tokens.
            edge_ids: List of edge string IDs corresponding to indices 1..N.
            temperature: Softmax temperature parameter.

        Returns:
            Dictionary mapping edge_id to probability in [0, 1] summing to 1.0.
        """
        self.eval()
        if not sequence_tokens:
            # Fallback uniform distribution
            n = len(edge_ids)
            return {e: round(1.0 / n, 6) for e in edge_ids}

        with torch.no_grad():
            x = torch.tensor([sequence_tokens], dtype=torch.long)
            logits = self.forward(x)[0]
            probs_list = F.softmax(logits, dim=-1).cpu().tolist()

        raw_probs = {}
        for idx, edge_id in enumerate(edge_ids):
            raw_probs[edge_id] = float(probs_list[idx]) if idx < len(probs_list) else 0.0

        # Exact normalization to sum to 1.0
        total = sum(raw_probs.values())
        if total > 0:
            probs = {k: round(v / total, 6) for k, v in raw_probs.items()}
            # Adjust minor floating point rounding on first element
            diff = round(1.0 - sum(probs.values()), 6)
            first_key = next(iter(probs.keys()))
            probs[first_key] = round(probs[first_key] + diff, 6)
            return probs

        n = len(edge_ids)
        return {e: round(1.0 / n, 6) for e in edge_ids}

    def export_torchscript(self, save_path: str) -> str:
        """Exports the model to a TorchScript tracing file (.pt) under 1 MB.

        Args:
            save_path: Target filesystem path.

        Returns:
            Absolute path of exported model.
        """
        self.eval()
        dummy_input = torch.tensor([[1, 2, 3]], dtype=torch.long)
        traced_model = torch.jit.trace(self, dummy_input)
        Path(save_path).parent.mkdir(parents=True, exist_ok=True)
        traced_model.save(save_path)

        file_size_bytes = os.path.getsize(save_path)
        file_size_kb = file_size_bytes / 1024.0
        if file_size_kb > 1024.0:
            raise ValueError(f"Exported model exceeds 1 MB: {file_size_kb:.2f} KB")

        return save_path

    def export_onnx(self, save_path: str) -> str:
        """Exports the model to ONNX format.

        Args:
            save_path: Target ONNX path.

        Returns:
            Absolute path of exported ONNX file.
        """
        self.eval()
        dummy_input = torch.tensor([[1, 2, 3]], dtype=torch.long)
        Path(save_path).parent.mkdir(parents=True, exist_ok=True)
        torch.onnx.export(
            self,
            dummy_input,
            save_path,
            input_names=["input_sequence"],
            output_names=["logits"],
            dynamic_axes={"input_sequence": {0: "batch_size", 1: "seq_len"}},
            opset_version=14,
        )
        return save_path
