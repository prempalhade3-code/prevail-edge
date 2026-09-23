"""Unit tests for PyTorch GRU model, baseline transition matrix, and datasets."""

import os
import tempfile
import pytest
import torch

from python.predictor.baseline.matrix_baseline import DestinationMatrixBaseline
from python.predictor.dataset import SyntheticTrajectoryGenerator
from python.predictor.model import EdgePredictorGRU


def test_gru_forward_and_prediction():
    """Verifies GRU forward shape and distribution normalization."""
    edge_ids = ["edge-a", "edge-b", "edge-c", "edge-d"]
    model = EdgePredictorGRU(num_edges=len(edge_ids), embedding_dim=16, hidden_dim=32)

    # Forward pass with batch_size=2, seq_len=4
    dummy_input = torch.tensor([[1, 2, 3, 4], [2, 3, 1, 2]], dtype=torch.long)
    logits = model(dummy_input)
    assert logits.shape == (2, len(edge_ids))

    # Predict distribution for single sequence
    probs = model.predict_distribution([1, 2], edge_ids=edge_ids)
    assert len(probs) == len(edge_ids)
    for edge in edge_ids:
        assert 0.0 <= probs[edge] <= 1.0
    assert pytest.approx(sum(probs.values()), abs=1e-4) == 1.0


def test_gru_torchscript_export_size():
    """Verifies exported TorchScript model is well below 1 MB."""
    edge_ids = ["edge-a", "edge-b", "edge-c", "edge-d"]
    model = EdgePredictorGRU(num_edges=len(edge_ids), embedding_dim=16, hidden_dim=32)

    with tempfile.TemporaryDirectory() as tmpdir:
        export_path = os.path.join(tmpdir, "model_test.pt")
        model.export_torchscript(export_path)

        assert os.path.exists(export_path)
        file_size_kb = os.path.getsize(export_path) / 1024.0
        assert file_size_kb < 1024.0  # Must be under 1 MB


def test_destination_matrix_baseline():
    """Verifies Markov destination matrix fitting and prediction."""
    edge_ids = ["edge-a", "edge-b", "edge-c", "edge-d"]
    baseline = DestinationMatrixBaseline(edge_ids=edge_ids)

    sample_seqs = [
        ["edge-a", "edge-b", "edge-c"],
        ["edge-a", "edge-b", "edge-a"],
        ["edge-b", "edge-c", "edge-d"],
    ]
    baseline.fit(sample_seqs)

    probs = baseline.predict_proba("edge-a")
    assert len(probs) == len(edge_ids)
    assert pytest.approx(sum(probs.values()), abs=1e-4) == 1.0
    # edge-b should have higher probability following edge-a based on the samples
    assert probs["edge-b"] > probs["edge-d"]


def test_synthetic_trajectory_generator():
    """Verifies synthetic trajectory generation produces valid edge sequences."""
    edge_ids = ["edge-a", "edge-b", "edge-c", "edge-d"]
    generator = SyntheticTrajectoryGenerator(edge_ids=edge_ids, seed=123)

    dataset = generator.generate_dataset(num_sequences=20, min_len=3, max_len=8)
    assert len(dataset) == 20
    for seq in dataset:
        assert 3 <= len(seq) <= 8
        for edge in seq:
            assert edge in edge_ids
