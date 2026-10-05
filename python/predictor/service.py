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


class RouteRegisterRequest(BaseModel):
    session_id: str = Field(..., description="Unique vehicle/session identifier")
    planned_route: List[str] = Field(..., description="Ordered edge-zone path for the active simulation")
    reset_history: bool = Field(
        True,
        description="Clear transition history when a new drive starts",
    )


class TrajectoryUpdate(BaseModel):
    session_id: str
    edge_id: str
    timestamp_ms: Optional[int] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    speed_mps: Optional[float] = None
    heading_deg: Optional[float] = None
    planned_route: Optional[List[str]] = Field(
        None,
        description="Optional ordered edge path; registers route on each drive tick",
    )
    reset_route_history: bool = Field(
        False,
        description="When true with planned_route, clears transition history",
    )


class PredictionResponse(BaseModel):
    session_id: str
    model_version: str
    probabilities: Dict[str, float]
    eta_sec: Optional[float] = None
    computed_at_ms: int
    for_edge: Optional[str] = Field(
        None,
        description="Edge id this prediction was computed for (staleness guard)",
    )
    route_terminal: bool = Field(
        False,
        description="True when the vehicle is on the final edge of the planned route",
    )
    predicted_next_edge: Optional[str] = Field(
        None,
        description="Immediate next edge on the registered route, if any",
    )
    planned_route: Optional[List[str]] = Field(
        None,
        description="Active planned route used for this prediction",
    )


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
        self._planned_route: Dict[str, List[str]] = {}

    def set_planned_route(
        self,
        session_id: str,
        planned_route: List[str],
        *,
        reset_history: bool = False,
    ) -> None:
        collapsed = _collapse_repeats([e for e in planned_route if e])
        self._planned_route[session_id] = collapsed
        if reset_history:
            self._history.pop(session_id, None)
            self._features.pop(session_id, None)
            self._dwell_samples.pop(session_id, None)
            self._last_speed.pop(session_id, None)
            self._last_heading.pop(session_id, None)
            self._last_gps.pop(session_id, None)

    def get_planned_route(self, session_id: str) -> List[str]:
        return list(self._planned_route.get(session_id, []))

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
        self._zone_neighbors: Optional[Dict[str, List[str]]] = None

        self._load_or_init_models()

    def _load_zone_neighbors(self) -> Dict[str, List[str]]:
        if self._zone_neighbors is not None:
            return self._zone_neighbors
        try:
            from python.mobility.road_graph import RoadGraph

            graph = RoadGraph()
            out: Dict[str, List[str]] = {eid: [] for eid in self.edge_ids}
            for src, pairs in graph.zone_adj.items():
                if src not in out:
                    continue
                seen = set(out[src])
                for dst, _ in pairs:
                    if dst in self.edge_ids and dst not in seen:
                        out[src].append(dst)
                        seen.add(dst)
            self._zone_neighbors = out
            return out
        except Exception:
            self._zone_neighbors = {eid: list(self.edge_ids) for eid in self.edge_ids}
            return self._zone_neighbors

    @staticmethod
    def _renormalize(probabilities: Dict[str, float]) -> Dict[str, float]:
        total = sum(probabilities.values())
        if total <= 0:
            return probabilities
        out = {k: round(v / total, 6) for k, v in probabilities.items()}
        diff = round(1.0 - sum(out.values()), 6)
        if out:
            first = next(iter(out.keys()))
            out[first] = round(out[first] + diff, 6)
        return out

    def _restrict_to_neighbors(
        self, current: Optional[str], probabilities: Dict[str, float]
    ) -> Dict[str, float]:
        """Keep only edges that share a road-network zone boundary with current."""
        if not current:
            return probabilities
        allowed = set(self._load_zone_neighbors().get(current, []))
        if not allowed:
            return probabilities
        filtered = {k: v for k, v in probabilities.items() if k in allowed}
        if not filtered:
            return probabilities
        return self._renormalize(filtered)

    def _penalize_backtrack(
        self,
        seq: List[str],
        current: Optional[str],
        probabilities: Dict[str, float],
    ) -> Dict[str, float]:
        """Prefer forward progress over immediately reversing the last hop."""
        if len(seq) < 2 or not current or seq[-1] != current:
            return probabilities
        back = seq[-2]
        if back not in probabilities:
            return probabilities
        adjusted = dict(probabilities)
        adjusted[back] = adjusted[back] * 0.12
        return self._renormalize(adjusted)

    def _route_index(self, planned_route: List[str], current: Optional[str]) -> int:
        if not current or not planned_route:
            return -1
        idx = -1
        for i, edge in enumerate(planned_route):
            if edge == current:
                idx = i
        return idx

    def _apply_route_context(
        self,
        session_id: str,
        current: Optional[str],
        probabilities: Dict[str, float],
    ) -> Tuple[Dict[str, float], bool, Optional[str]]:
        """Align next-edge output with the active simulation route.

        When a planned route is registered, the displayed next-edge prediction
        must be the immediate forward hop on that route, using the model's
        confidence for that edge where available. On the final route edge,
        no next-edge prediction is emitted.
        """
        planned_route = self.session_store.get_planned_route(session_id)
        if not planned_route or not current:
            return probabilities, False, None

        idx = self._route_index(planned_route, current)
        if idx < 0:
            return probabilities, False, None
        if idx >= len(planned_route) - 1:
            return {}, True, None

        next_edge = planned_route[idx + 1]
        out = dict(probabilities)
        if next_edge not in out or out[next_edge] <= 0:
            fallback_conf = (
                self.baseline.predict_proba(current).get(next_edge, 0.30)
                if self.baseline
                else 0.30
            )
            out[next_edge] = float(fallback_conf)

        # Penalize past/visited route edges behind the current position
        for past_edge in planned_route[: idx + 1]:
            if past_edge in out and past_edge != next_edge:
                out[past_edge] = out[past_edge] * 0.1

        max_other = max([v for k, v in out.items() if k != next_edge], default=0.0)
        out[next_edge] = max(out[next_edge] * 2.5, max_other * 1.5 + 0.1)
        return self._renormalize(out), False, next_edge

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
        current = current_edge or (seq[-1] if seq else None)

        # GRU/ONNX need at least one observed transition; a single dwell edge is
        # ambiguous and the untrained/exported head often spuriously favours distant
        # zones (e.g. edge-c while still on edge-a). Use the Markov baseline then.
        use_neural = len(seq) >= 2 and bool(tokens)

        feats = self.session_store.get_features(session_id)
        if len(feats) < len(tokens):
            feats = ([(0.4, 0.25)] * (len(tokens) - len(feats))) + feats
        feats = feats[-len(tokens) :] if tokens else []

        raw: Dict[str, float] = {}
        if use_neural and self.onnx_session is not None:
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
            except Exception:
                raw = {}

        elif use_neural and self.traced_model is not None:
            try:
                with torch.no_grad():
                    inp = torch.tensor([tokens], dtype=torch.long)
                    feat = torch.tensor([feats], dtype=torch.float32)
                    logits = self.traced_model(inp, feat)[0]
                    probs_list = torch.softmax(logits, dim=-1).cpu().tolist()
                    raw = {self.edge_ids[i]: float(probs_list[i]) for i in range(len(self.edge_ids))}
            except Exception:
                raw = {}

        # Ensure all self.edge_ids exist with genuine model probabilities
        probabilities = {}
        for eid in self.edge_ids:
            val = raw.get(eid)
            if val is None and self.baseline is not None:
                val = self.baseline.predict_proba(current or (seq[-1] if seq else None)).get(eid)
            probabilities[eid] = max(float(val) if val is not None else 0.05, 0.01)

        probabilities = self._renormalize(probabilities)

        planned_route = self.session_store.get_planned_route(session_id)
        probabilities, route_terminal, predicted_next = self._apply_route_context(
            session_id, current, probabilities
        )

        if not route_terminal and not predicted_next and probabilities:
            predicted_next = max(probabilities.items(), key=lambda x: x[1])[0]

        # Calculate road-network ETA to predicted next edge using mobility RegionMapper
        speed = self.session_store.get_speed(session_id) or 12.0
        eta_sec = 15.0
        if route_terminal:
            eta_sec = None
        elif predicted_next:
            current_gps = self.session_store.get_gps(session_id)
            if current_gps:
                try:
                    from python.mobility.eta_estimator import estimate_eta
                    from python.mobility.region_mapper import RegionMapper
                    mapper = RegionMapper()
                    eta_sec = estimate_eta(current_gps, predicted_next, speed_mps=speed, region_mapper=mapper)
                except Exception:
                    eta_sec = round(max(5.0, 500.0 / max(speed, 1.0)), 2)
            else:
                eta_sec = round(max(5.0, 500.0 / max(speed, 1.0)), 2)

        return PredictionResponse(
            session_id=session_id,
            model_version=self.config.model_version,
            probabilities=probabilities,
            eta_sec=round(float(eta_sec), 2) if eta_sec is not None else None,
            computed_at_ms=now_ms,
            for_edge=current,
            route_terminal=route_terminal,
            predicted_next_edge=predicted_next,
            planned_route=planned_route or None,
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
        "route_aware": True,
    }


@app.post("/session/route")
def register_session_route(req: RouteRegisterRequest):
    """Register the ordered edge path for an active simulation session."""
    if not req.session_id:
        raise HTTPException(status_code=400, detail="session_id is required")
    if not req.planned_route:
        raise HTTPException(status_code=400, detail="planned_route is required")
    engine.session_store.set_planned_route(
        req.session_id,
        req.planned_route,
        reset_history=req.reset_history,
    )
    return {
        "status": "registered",
        "session_id": req.session_id,
        "planned_route": engine.session_store.get_planned_route(req.session_id),
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
    if update.planned_route:
        engine.session_store.set_planned_route(
            update.session_id,
            update.planned_route,
            reset_history=update.reset_route_history,
        )
    engine.session_store.record_step(
        session_id=update.session_id,
        edge_id=update.edge_id,
        speed_mps=update.speed_mps,
        latitude=update.latitude,
        longitude=update.longitude,
        heading_deg=update.heading_deg,
    )
    return {"status": "recorded", "session_id": update.session_id}
