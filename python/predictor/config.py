"""Configuration for PREVAIL ML Predictor service."""

import json
import os
from pathlib import Path
from typing import Dict, List, Optional


class PredictorConfig:
    """Predictor service configuration and edge region metadata resolver."""

    def __init__(
        self,
        port: Optional[int] = None,
        host: Optional[str] = None,
        model_version: Optional[str] = None,
        edge_regions_path: Optional[str] = None,
        model_path: Optional[str] = None,
    ):
        self.port = int(
            port
            or os.getenv("PREVAIL_PREDICTOR_PORT")
            or os.getenv("PORT")
            or "8091"
        )
        self.host = host or os.getenv("PREVAIL_PREDICTOR_HOST", "0.0.0.0")
        self.model_version = (
            model_version
            or os.getenv("PREVAIL_MODEL_VERSION")
            or "gru-edge-v0.1.0"
        )

        # Base repository root discovery
        base_dir = Path(__file__).resolve().parents[2]
        default_regions = str(base_dir / "deploy" / "config" / "edge-regions.json")
        self.edge_regions_path = (
            edge_regions_path
            or os.getenv("PREVAIL_EDGE_REGIONS_PATH")
            or default_regions
        )

        default_model = str(Path(__file__).resolve().parent / "models" / "gru_predictor.pt")
        self.model_path = model_path or os.getenv("PREVAIL_MODEL_PATH", default_model)

        self.default_edge_ids: List[str] = ["edge-a", "edge-b", "edge-c", "edge-d"]
        self.edge_ids = self.load_edge_ids()

    def load_edge_ids(self) -> List[str]:
        """Loads available edge IDs from edge-regions.json or uses fallback defaults."""
        path = Path(self.edge_regions_path)
        if path.exists():
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    regions = data.get("regions", [])
                    ids = [r["edge_id"] for r in regions if "edge_id" in r]
                    if ids:
                        return ids
            except Exception:
                pass
        return list(self.default_edge_ids)

    def get_fallback_probabilities(self) -> Dict[str, float]:
        """Generates a normalized fallback probability distribution across all known edges."""
        edge_ids = self.edge_ids or self.default_edge_ids
        n = len(edge_ids)
        if n == 0:
            return {"edge-a": 1.0}
        prob = round(1.0 / n, 6)
        remainder = round(1.0 - (prob * (n - 1)), 6)
        probs = {edge: prob for edge in edge_ids[:-1]}
        probs[edge_ids[-1]] = remainder
        return probs


config = PredictorConfig()
