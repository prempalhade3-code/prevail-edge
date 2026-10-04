"""FastAPI inference service for PREVAIL next-edge probability prediction."""

import json
import os
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import torch

from python.predictor.baseline.matrix_baseline import DestinationMatrixBaseline
from python.predictor.config import config
from python.predictor.model import EdgePredictorGRU, normalize_heading, normalize_speed


class PredictRequest(BaseModel):
    session_id: str = Field(..., description="Unique vehicle/session identifier")
    current_edge: Optional[str] = Field(None, description="Optional current edge override")
    history: Optional[List[str]] = Field(None, description="Optional explicit edge history")


class TrajectoryUpdate(BaseModel):
    session_id: str
    edge_id: str
    timestamp_ms: Optional[int] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    speed_mps: Optional[float] = None
    heading_deg: Optional[float] = None


class PredictionResponse(BaseModel):
    session_id: str
    model_version: str
    probabilities: Dict[str, float]
    eta_sec: Optional[float] = None
    computed_at_ms: int


class SessionHistoryStore:
    """In-memory sliding window of the *edge transition* sequence per session.

    Consecutive duplicates are collapsed. The simulator reports at 5 Hz, so
    recording every sample would fill the window with one repeated edge and the
    model would never see a transition. The GRU is trained on transition
    sequences, so the serving-time history must be shaped the same way.
    """

    def __init__(self, max_history: int = 20):
        self.max_history = max_history
        self._history: Dict[str, deque] = defaultdict(lambda: deque(maxlen=self.max_history))
        self._last_speed: Dict[str, float] = {}
        self._last_heading: Dict[str, float] = {}
        self._last_gps: Dict[str, Tuple[float, float]] = {}
        self._dwell_samples: Dict[str, int] = defaultdict(int)
        self._features: Dict[str, deque] = defaultdict(lambda: deque(maxlen=self.max_history))

    def record_step(
        self,
        session_id: str,
        edge_id: str,
        speed_mps: Optional[float] = None,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        heading_deg: Optional[float] = None,
    ):
        history = self._history[session_id]
        if speed_mps is not None:
            self._last_speed[session_id] = speed_mps
        if heading_deg is not None:
            self._last_heading[session_id] = heading_deg
        feat = (
            normalize_speed(self._last_speed.get(session_id, 12.0)),
            normalize_heading(self._last_heading.get(session_id, 90.0)),
        )
        if not history or history[-1] != edge_id:
            history.append(edge_id)
            self._features[session_id].append(feat)
            self._dwell_samples[session_id] = 1
        else:
            self._dwell_samples[session_id] += 1
            if self._features[session_id]:
                self._features[session_id][-1] = feat
        if latitude is not None and longitude is not None:
            self._last_gps[session_id] = (latitude, longitude)

    def get_history(self, session_id: str) -> List[str]:
        return list(self._history.get(session_id, []))

    def get_speed(self, session_id: str) -> Optional[float]:
        return self._last_speed.get(session_id)

    def get_features(self, session_id: str) -> List[Tuple[float, float]]:
        return list(self._features.get(session_id, []))

    def get_gps(self, session_id: str) -> Optional[Tuple[float, float]]:
        return self._last_gps.get(session_id)

    def get_dwell_samples(self, session_id: str) -> int:
        """Samples observed in the current edge, used to temper the ETA estimate."""
        return self._dwell_samples.get(session_id, 0)


def _collapse_repeats(seq: List[str]) -> List[str]:
    """Collapses consecutive duplicate edges into a single transition step."""
    collapsed: List[str] = []
    for edge in seq:
        if not collapsed or collapsed[-1] != edge:
            collapsed.append(edge)
    return collapsed


class PredictorEngine:
    """Inference engine managing neural model, baseline fallback, and session state."""

    def __init__(self):
        self.config = config
        self.edge_ids = self.config.edge_ids
        self.edge_to_idx = {e: idx + 1 for idx, e in enumerate(self.edge_ids)}
        self.idx_to_edge = {idx + 1: e for idx, e in enumerate(self.edge_ids)}
        self.session_store = SessionHistoryStore()
        self.model: Optional[EdgePredictorGRU] = None
        self.traced_model = None
        self.onnx_session = None
        self.inference_backend = "none"
        self.baseline: Optional[DestinationMatrixBaseline] = None
        self.training_metadata: Dict[str, object] = {}

        self._load_or_init_models()

    def _load_or_init_models(self):
        """Attempts to load exported TorchScript model or initializes in-memory GRU/baseline."""
        # 1. Initialize destination matrix baseline as solid fallback
        self.baseline = DestinationMatrixBaseline(edge_ids=self.edge_ids)
        baseline_path = Path(self.config.model_path).with_name("baseline_matrix.json")
        if baseline_path.exists():
            try:
                self.baseline = DestinationMatrixBaseline.load(str(baseline_path))
                print(f"Loaded destination-matrix baseline from: {baseline_path}")
            except Exception as exc:
                print(f"Warning: failed to load baseline matrix ({exc})")

        # 2. Prefer ONNX Runtime for live inference; TorchScript is fallback only.
        model_file = Path(self.config.model_path)
        onnx_file = model_file.with_suffix(".onnx")
        require_onnx = os.getenv("PREVAIL_USE_ONNX", "1") != "0"
        if onnx_file.exists():
            try:
                import onnxruntime as ort

                self.onnx_session = ort.InferenceSession(
                    str(onnx_file), providers=["CPUExecutionProvider"]
                )
                self.inference_backend = "onnx"
                print(f"Loaded ONNX predictor from: {onnx_file}")
            except Exception as exc:
                print(f"Warning: failed to load ONNX model ({exc})")
                if require_onnx:
                    raise RuntimeError(f"PREVAIL_USE_ONNX=1 but ONNX load failed: {exc}") from exc
        elif require_onnx:
            raise RuntimeError(f"PREVAIL_USE_ONNX=1 but missing {onnx_file}")

        if self.onnx_session is None and model_file.exists():
            try:
                self.traced_model = torch.jit.load(str(model_file))
                self.traced_model.eval()
                self.inference_backend = "torchscript"
                print(f"Loaded TorchScript predictor model from: {model_file}")
            except Exception as e:
                print(f"Warning: Failed to load TorchScript model ({e}). Using PyTorch GRU instance.")

        meta_path = Path(self.config.model_path).with_name("training_metadata.json")
        if meta_path.exists():
            try:
                self.training_metadata = json.loads(meta_path.read_text(encoding="utf-8"))
                print(f"Loaded training metadata: {self.training_metadata}")
            except Exception as exc:
                print(f"Warning: failed to read training metadata ({exc})")

        require_official = os.getenv("PREVAIL_REQUIRE_OFFICIAL_MODEL") == "1"
        if require_official and self.training_metadata.get("source") != "official":
            raise RuntimeError(
                "PREVAIL_REQUIRE_OFFICIAL_MODEL=1 but training_metadata.json is not official"
            )
        if require_official and self.onnx_session is None and self.traced_model is None:
            raise RuntimeError("official GRU artifact missing; refusing untrained weights")

        if self.onnx_session is None and self.traced_model is None:
            self.model = EdgePredictorGRU(
                num_edges=len(self.edge_ids),
                embedding_dim=16,
                hidden_dim=32,
                num_layers=1,
            )
            self.model.eval()
            self.inference_backend = "untrained-gru"

    def predict(self, session_id: str, current_edge: Optional[str] = None, history: Optional[List[str]] = None) -> PredictionResponse:
        """Computes next-edge probability distribution for given session_id."""
        now_ms = int(time.time() * 1000)

        # Determine sequence history, collapsing dwell so the shape matches training.
        seq = _collapse_repeats(history or self.session_store.get_history(session_id))
        if current_edge and (not seq or seq[-1] != current_edge):
            seq = seq + [current_edge]

        # Convert to token IDs
        tokens = [self.edge_to_idx[e] for e in seq if e in self.edge_to_idx]

        probabilities: Dict[str, float] = {}

        feats = self.session_store.get_features(session_id)
        if len(feats) < len(tokens):
            feats = ([(0.4, 0.25)] * (len(tokens) - len(feats))) + feats
        feats = feats[-len(tokens) :] if tokens else []

        if self.onnx_session is not None and tokens:
            try:
                import numpy as np

                inp = np.array([tokens], dtype=np.int64)
                feat = np.array([feats], dtype=np.float32)
                logits = self.onnx_session.run(
                    ["logits"],
                    {"input_sequence": inp, "input_features": feat},
                )[0][0]
                exp = np.exp(logits - np.max(logits))
                probs_list = (exp / exp.sum()).tolist()
                raw = {self.edge_ids[i]: float(probs_list[i]) for i in range(len(self.edge_ids))}
                tot = sum(raw.values())
                probabilities = {k: round(v / tot, 6) for k, v in raw.items()}
            except Exception:
                probabilities = {}

        elif self.traced_model is not None and tokens:
            try:
                with torch.no_grad():
                    inp = torch.tensor([tokens], dtype=torch.long)
                    feat = torch.tensor([feats], dtype=torch.float32)
                    logits = self.traced_model(inp, feat)[0]
                    probs_list = torch.softmax(logits, dim=-1).cpu().tolist()
                    raw = {self.edge_ids[i]: float(probs_list[i]) for i in range(len(self.edge_ids))}
                    tot = sum(raw.values())
                    probabilities = {k: round(v / tot, 6) for k, v in raw.items()}
            except Exception:
                probabilities = {}

        elif self.model is not None and tokens:
            probabilities = self.model.predict_distribution(tokens, self.edge_ids, features=feats)

        # If still empty or no history, use baseline or prior distribution
        if not probabilities or sum(probabilities.values()) == 0:
            last_edge = seq[-1] if seq else None
            if self.baseline is not None:
                probabilities = self.baseline.predict_proba(last_edge)
            else:
                probabilities = self.config.get_fallback_probabilities()

        # Next-edge distribution: exclude current edge and re-normalize.
        current = current_edge or (seq[-1] if seq else None)
        if current and current in probabilities:
            remaining = {k: v for k, v in probabilities.items() if k != current}
            if remaining:
                total_p = sum(remaining.values())
                probabilities = {k: round(v / total_p, 6) for k, v in remaining.items()}
            else:
                probabilities = self.config.get_fallback_probabilities()

        # Ensure exact sum to 1.0
        total_p = sum(probabilities.values())
        if total_p > 0:
            diff = round(1.0 - total_p, 6)
            first_key = next(iter(probabilities.keys()))
            probabilities[first_key] = round(probabilities[first_key] + diff, 6)
        else:
            probabilities = self.config.get_fallback_probabilities()

        # Calculate road-network ETA to the top predicted next edge using mobility RegionMapper
        speed = self.session_store.get_speed(session_id) or 12.0
        eta_sec = 15.0
        if probabilities:
            top_candidate = max(probabilities.items(), key=lambda x: x[1])[0]
            current_gps = self.session_store.get_gps(session_id)
            if current_gps:
                try:
                    from python.mobility.eta_estimator import estimate_eta
                    from python.mobility.region_mapper import RegionMapper
                    mapper = RegionMapper()
                    eta_sec = estimate_eta(current_gps, top_candidate, speed_mps=speed, region_mapper=mapper)
                except Exception:
                    eta_sec = round(max(5.0, 500.0 / max(speed, 1.0)), 2)
            else:
                eta_sec = round(max(5.0, 500.0 / max(speed, 1.0)), 2)

        return PredictionResponse(
            session_id=session_id,
            model_version=self.config.model_version,
            probabilities=probabilities,
            eta_sec=round(float(eta_sec), 2),
            computed_at_ms=now_ms,
        )


app = FastAPI(
    title="PREVAIL ML Predictor Service",
    description="Next-edge probability distribution inference service for vehicle sessions.",
    version=config.model_version,
)

engine = PredictorEngine()


@app.get("/health")
def health_check():
    """Healthcheck endpoint."""
    return {
        "status": "healthy",
        "model_version": config.model_version,
        "edge_ids": config.edge_ids,
        "model_loaded": engine.onnx_session is not None or engine.traced_model is not None,
        "inference_backend": engine.inference_backend,
        "onnx_loaded": engine.onnx_session is not None,
        "training_source": engine.training_metadata.get("source"),
        "sequence_count": engine.training_metadata.get("sequence_count"),
    }


@app.post("/predict", response_model=PredictionResponse)
def predict_next_edge(req: PredictRequest):
    """Predicts next-edge probability distribution for a given session.

    Endpoint called by Rust runtime speculation manager (rust/prevail-runtime/src/predictor.rs).
    """
    if not req.session_id:
        raise HTTPException(status_code=400, detail="session_id is required")
    return engine.predict(
        session_id=req.session_id,
        current_edge=req.current_edge,
        history=req.history,
    )


@app.post("/trajectory")
def update_trajectory(update: TrajectoryUpdate):
    """Ingests trajectory sample to maintain active session state buffer."""
    engine.session_store.record_step(
        session_id=update.session_id,
        edge_id=update.edge_id,
        speed_mps=update.speed_mps,
        latitude=update.latitude,
        longitude=update.longitude,
        heading_deg=update.heading_deg,
    )
    return {"status": "recorded", "session_id": update.session_id}
