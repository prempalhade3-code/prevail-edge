"""FastAPI inference service for PREVAIL next-edge probability prediction."""

import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Dict, List, Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import torch

from python.predictor.baseline.matrix_baseline import DestinationMatrixBaseline
from python.predictor.config import config
from python.predictor.model import EdgePredictorGRU


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


class PredictionResponse(BaseModel):
    session_id: str
    model_version: str
    probabilities: Dict[str, float]
    eta_sec: Optional[float] = None
    computed_at_ms: int


class SessionHistoryStore:
    """In-memory sliding window store for active vehicle session trajectories."""

    def __init__(self, max_history: int = 20):
        self.max_history = max_history
        self._history: Dict[str, deque] = defaultdict(lambda: deque(maxlen=self.max_history))
        self._last_speed: Dict[str, float] = {}

    def record_step(self, session_id: str, edge_id: str, speed_mps: Optional[float] = None):
        self._history[session_id].append(edge_id)
        if speed_mps is not None:
            self._last_speed[session_id] = speed_mps

    def get_history(self, session_id: str) -> List[str]:
        return list(self._history.get(session_id, []))

    def get_speed(self, session_id: str) -> Optional[float]:
        return self._last_speed.get(session_id)


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
        self.baseline: Optional[DestinationMatrixBaseline] = None

        self._load_or_init_models()

    def _load_or_init_models(self):
        """Attempts to load exported TorchScript model or initializes in-memory GRU/baseline."""
        # 1. Initialize destination matrix baseline as solid fallback
        self.baseline = DestinationMatrixBaseline(edge_ids=self.edge_ids)

        # 2. Check for exported TorchScript model
        model_file = Path(self.config.model_path)
        if model_file.exists():
            try:
                self.traced_model = torch.jit.load(str(model_file))
                self.traced_model.eval()
                print(f"Loaded TorchScript predictor model from: {model_file}")
                return
            except Exception as e:
                print(f"Warning: Failed to load TorchScript model ({e}). Using PyTorch GRU instance.")

        # 3. Fallback: Initialize lightweight PyTorch GRU
        self.model = EdgePredictorGRU(
            num_edges=len(self.edge_ids),
            embedding_dim=16,
            hidden_dim=32,
            num_layers=1,
        )
        self.model.eval()

    def predict(self, session_id: str, current_edge: Optional[str] = None, history: Optional[List[str]] = None) -> PredictionResponse:
        """Computes next-edge probability distribution for given session_id."""
        now_ms = int(time.time() * 1000)

        # Determine sequence history
        seq = history or self.session_store.get_history(session_id)
        if current_edge and (not seq or seq[-1] != current_edge):
            seq = seq + [current_edge]

        # Convert to token IDs
        tokens = [self.edge_to_idx[e] for e in seq if e in self.edge_to_idx]

        probabilities: Dict[str, float] = {}

        if self.traced_model is not None and tokens:
            try:
                with torch.no_grad():
                    inp = torch.tensor([tokens], dtype=torch.long)
                    logits = self.traced_model(inp)[0]
                    probs_list = torch.softmax(logits, dim=-1).cpu().tolist()
                    raw = {self.edge_ids[i]: float(probs_list[i]) for i in range(len(self.edge_ids))}
                    tot = sum(raw.values())
                    probabilities = {k: round(v / tot, 6) for k, v in raw.items()}
            except Exception:
                probabilities = {}

        elif self.model is not None and tokens:
            probabilities = self.model.predict_distribution(tokens, self.edge_ids)

        # If still empty or no history, use baseline or prior distribution
        if not probabilities or sum(probabilities.values()) == 0:
            last_edge = seq[-1] if seq else None
            if self.baseline is not None:
                probabilities = self.baseline.predict_proba(last_edge)
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

        # Simple ETA heuristic based on average urban edge transition (10-15 sec)
        speed = self.session_store.get_speed(session_id) or 12.0
        # 500m average edge diameter / speed
        eta_sec = round(max(5.0, 500.0 / max(speed, 1.0)), 2)

        return PredictionResponse(
            session_id=session_id,
            model_version=self.config.model_version,
            probabilities=probabilities,
            eta_sec=eta_sec,
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
    )
    return {"status": "recorded", "session_id": update.session_id}
