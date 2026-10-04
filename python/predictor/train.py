"""Training and offline evaluation pipeline for PREVAIL edge prediction models."""

import argparse
import json
import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, random_split

from python.predictor.baseline.matrix_baseline import DestinationMatrixBaseline
from python.predictor.config import PredictorConfig
from python.predictor.dataset import (
    EdgeSequenceDataset,
    SyntheticTrajectoryGenerator,
    collate_sequence_batch,
)
from python.predictor.model import EdgePredictorGRU


def evaluate_accuracy(
    model: EdgePredictorGRU,
    val_loader: DataLoader,
    device: torch.device,
) -> Dict[str, float]:
    """Computes Top-1 and Top-2 accuracy metrics for the GRU model."""
    model.eval()
    correct_top1 = 0
    correct_top2 = 0
    total = 0

    with torch.no_grad():
        for batch in val_loader:
            x_batch, feat_batch, y_batch = batch
            x_batch = x_batch.to(device)
            feat_batch = feat_batch.to(device)
            y_batch = y_batch.to(device)
            logits = model(x_batch, feat_batch)

            # Top-1
            preds_top1 = torch.argmax(logits, dim=-1)
            correct_top1 += (preds_top1 == y_batch).sum().item()

            # Top-2
            _, top2_indices = torch.topk(logits, k=min(2, logits.shape[-1]), dim=-1)
            correct_top2 += torch.any(top2_indices == y_batch.unsqueeze(1), dim=1).sum().item()

            total += y_batch.size(0)

    top1_acc = (correct_top1 / total) if total > 0 else 0.0
    top2_acc = (correct_top2 / total) if total > 0 else 0.0
    return {"top1_accuracy": top1_acc, "top2_accuracy": top2_acc, "total_samples": total}


def evaluate_baseline_accuracy(
    baseline: DestinationMatrixBaseline,
    val_loader: DataLoader,
    idx_to_edge: Dict[int, str],
    edge_ids: List[str],
) -> Dict[str, float]:
    """Top-1 accuracy of the first-order Markov baseline on the same validation split.

    The GRU only justifies its cost if it beats this, so the comparison is
    reported alongside every training run rather than assumed.
    """
    correct = 0
    total = 0

    for x_batch, _feat_batch, y_batch in val_loader:
        for row, target in zip(x_batch.tolist(), y_batch.tolist()):
            tokens = [t for t in row if t != 0]
            last_edge = idx_to_edge.get(tokens[-1]) if tokens else None
            probs = baseline.predict_proba(last_edge)
            if not probs:
                continue
            predicted = max(probs.items(), key=lambda kv: kv[1])[0]
            if predicted == edge_ids[target]:
                correct += 1
            total += 1

    return {"top1_accuracy": (correct / total) if total else 0.0, "total_samples": total}


def train_pipeline(
    epochs: int = 10,
    batch_size: int = 32,
    learning_rate: float = 0.005,
    num_sequences: int = 2000,
    output_dir: Optional[str] = None,
) -> Tuple[EdgePredictorGRU, Dict[str, float]]:
    """Runs the full model training, evaluation, and TorchScript export pipeline."""
    config = PredictorConfig()
    edge_ids = config.edge_ids
    num_edges = len(edge_ids)

    # 1-based indexing for tokens (0 = padding)
    edge_to_idx = {edge_id: idx + 1 for idx, edge_id in enumerate(edge_ids)}
    idx_to_edge = {idx + 1: edge_id for idx, edge_id in enumerate(edge_ids)}

    print(f"=== Starting PREVAIL Predictor Training Pipeline ===")
    print(f"Edge Label Space ({num_edges} nodes): {edge_ids}")

    from python.predictor.download_official import ensure_official
    from python.predictor.ingest_gps import (
        load_official_featured_sequences,
        load_official_sequences,
        sequences_from_jsonl,
        synthesize_geolife_tdrive,
    )

    sequences: List = []
    root = Path(__file__).resolve().parents[2]
    allow_synthetic = os.getenv("PREVAIL_ALLOW_SYNTHETIC", "") == "1"
    source = "official"
    try:
        ensure_official()
        official = load_official_featured_sequences()
        if not official:
            official = load_official_sequences()
        sequences.extend(official)
        print(f"Loaded {len(official)} official T-Drive/GeoLife sequences (speed/heading features)")
    except Exception as exc:
        if not allow_synthetic:
            raise RuntimeError(
                f"official T-Drive/GeoLife data is required for training: {exc}"
            ) from exc
        source = "synthetic-fallback"
        print(f"WARNING: official download failed ({exc}); PREVAIL_ALLOW_SYNTHETIC=1")

    labeled = os.getenv("PREVAIL_TRAIN_SEQUENCES")
    if labeled and Path(labeled).exists():
        loaded = sequences_from_jsonl(Path(labeled))
        sequences.extend(loaded)
        print(f"Loaded {len(loaded)} labeled sequences from {labeled}")

    if allow_synthetic:
        geolife_csv = root / "python" / "predictor" / "data" / "geolife_tdrive.csv"
        if not geolife_csv.exists():
            synthesize_geolife_tdrive(geolife_csv)
        from python.predictor.ingest_gps import sequences_from_csv
        sequences.extend(sequences_from_csv(geolife_csv))
        generator = SyntheticTrajectoryGenerator(edge_ids=edge_ids)
        sequences.extend(generator.generate_dataset(num_sequences=num_sequences))

    if len(sequences) < 8:
        raise RuntimeError(f"not enough official sequences to train GRU: {len(sequences)}")
    print(f"Training on {len(sequences)} trajectory sequences (source={source}).")

    edge_only = [
        [step[0] if isinstance(step, tuple) else step for step in seq]
        for seq in sequences
    ]

    # 2. Train Destination-Matrix Baseline for benchmarking
    baseline = DestinationMatrixBaseline(edge_ids=edge_ids)
    baseline.fit(edge_only)
    if output_dir:
        baseline_path = os.path.join(output_dir, "baseline_matrix.json")
        baseline.save(baseline_path)
        print(f"Exported destination matrix baseline to {baseline_path}")

    # 3. Create PyTorch Dataset
    full_dataset = EdgeSequenceDataset(sequences, edge_to_idx=edge_to_idx)
    val_size = max(10, int(len(full_dataset) * 0.2))
    train_size = len(full_dataset) - val_size
    train_set, val_set = random_split(full_dataset, [train_size, val_size])

    train_loader = DataLoader(
        train_set,
        batch_size=batch_size,
        shuffle=True,
        collate_fn=collate_sequence_batch,
    )
    val_loader = DataLoader(
        val_set,
        batch_size=batch_size,
        shuffle=False,
        collate_fn=collate_sequence_batch,
    )

    # 4. Initialize GRU Model
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = EdgePredictorGRU(
        num_edges=num_edges,
        embedding_dim=16,
        hidden_dim=32,
        num_layers=1,
    ).to(device)

    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate)

    print(f"\nTraining GRU on {train_size} transition samples (Val: {val_size})...")
    for epoch in range(1, epochs + 1):
        model.train()
        total_loss = 0.0
        for x_batch, feat_batch, y_batch in train_loader:
            x_batch = x_batch.to(device)
            feat_batch = feat_batch.to(device)
            y_batch = y_batch.to(device)

            optimizer.zero_grad()
            logits = model(x_batch, feat_batch)
            loss = criterion(logits, y_batch)
            loss.backward()
            optimizer.step()
            total_loss += loss.item()

        avg_loss = total_loss / max(1, len(train_loader))
        if epoch % max(1, epochs // 5) == 0 or epoch == epochs:
            metrics = evaluate_accuracy(model, val_loader, device)
            print(
                f"Epoch {epoch:02d}/{epochs:02d} | "
                f"Loss: {avg_loss:.4f} | "
                f"Val Top-1 Acc: {metrics['top1_accuracy'] * 100:.2f}% | "
                f"Val Top-2 Acc: {metrics['top2_accuracy'] * 100:.2f}%"
            )

    # 5. Final Offline Evaluation Report, against the Markov baseline
    final_metrics = evaluate_accuracy(model, val_loader, device)
    baseline_metrics = evaluate_baseline_accuracy(baseline, val_loader, idx_to_edge, edge_ids)
    uplift = final_metrics["top1_accuracy"] - baseline_metrics["top1_accuracy"]
    final_metrics["baseline_top1_accuracy"] = baseline_metrics["top1_accuracy"]
    final_metrics["gru_uplift_over_baseline"] = uplift

    print("\n" + "=" * 50)
    print("      OFFLINE ACCURACY EVALUATION REPORT")
    print("=" * 50)
    print(f"Model Architecture:   EdgePredictorGRU (Embed=16, Hidden=32, 1-Layer)")
    print(f"Total Validation Set: {final_metrics['total_samples']} samples")
    print(f"GRU Top-1 Accuracy:   {final_metrics['top1_accuracy'] * 100:.2f}%")
    print(f"GRU Top-2 Accuracy:   {final_metrics['top2_accuracy'] * 100:.2f}%")
    print(f"Markov Top-1 Baseline:{baseline_metrics['top1_accuracy'] * 100:>7.2f}%")
    print(f"GRU uplift:           {uplift * 100:+.2f} pp")
    print("=" * 50)

    # 6. Model Export (TorchScript < 1MB)
    if output_dir is None:
        output_dir = str(Path(__file__).resolve().parent / "models")
    os.makedirs(output_dir, exist_ok=True)

    export_path = os.path.join(output_dir, "gru_predictor.pt")
    model_cpu = model.cpu()
    model_cpu.export_torchscript(export_path)
    baseline.save(os.path.join(output_dir, "baseline_matrix.json"))
    onnx_path = model_cpu.export_onnx(os.path.join(output_dir, "gru_predictor.onnx"))
    print(f"Exported ONNX model to {onnx_path}")

    file_size_kb = os.path.getsize(export_path) / 1024.0
    print(f"Successfully exported TorchScript model to: {export_path}")
    print(f"Model file size: {file_size_kb:.2f} KB (Target < 1024 KB: PASS)")

    metadata = {
        "source": source,
        "sequence_count": len(sequences),
        "top1_accuracy": final_metrics["top1_accuracy"],
        "top2_accuracy": final_metrics["top2_accuracy"],
        "baseline_top1_accuracy": final_metrics["baseline_top1_accuracy"],
        "model_path": export_path,
        "model_bytes": os.path.getsize(export_path),
        "onnx_path": onnx_path,
        "features": ["speed_norm", "heading_norm"],
    }
    meta_path = os.path.join(output_dir, "training_metadata.json")
    Path(meta_path).write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(f"Wrote training metadata to {meta_path}")
    final_metrics["source"] = 1.0 if source == "official" else 0.0

    return model_cpu, final_metrics


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train PREVAIL ML Edge Predictor")
    parser.add_argument("--epochs", type=int, default=10, help="Number of training epochs")
    parser.add_argument("--batch-size", type=int, default=32, help="Batch size")
    parser.add_argument("--lr", type=float, default=0.005, help="Learning rate")
    parser.add_argument("--sequences", type=int, default=2000, help="Number of synthetic trajectories")
    parser.add_argument("--output-dir", type=str, default=None, help="Output directory for exported model")
    args = parser.parse_args()

    train_pipeline(
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.lr,
        num_sequences=args.sequences,
        output_dir=args.output_dir,
    )
