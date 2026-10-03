"""Canonical PREVAIL session identity shared by simulators, predictor and experiments.

Every component must resolve the session id from here rather than hardcoding it.
A mismatch silently breaks the predict loop: the predictor accumulates history
under one key while the runtime queries another, so it can only ever answer with
the uniform/baseline distribution.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict

DEFAULT_CONFIG_PATH = (
    Path(__file__).resolve().parents[2] / "deploy" / "config" / "session.json"
)

_FALLBACK: Dict[str, Any] = {
    "session_id": "sim-vehicle-01",
    "run_id": "run-demo-1",
    "bootstrap_edge_id": "edge-a",
    "authority_secret": "lab-secret",
}


def load_session_config(config_path: str | os.PathLike[str] | None = None) -> Dict[str, Any]:
    """Loads session config, preferring PREVAIL_SESSION_CONFIG_PATH then the default."""
    path = Path(
        config_path
        or os.environ.get("PREVAIL_SESSION_CONFIG_PATH")
        or DEFAULT_CONFIG_PATH
    )
    merged = dict(_FALLBACK)
    try:
        merged.update(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError):
        pass
    return merged


def get_session_id(config_path: str | os.PathLike[str] | None = None) -> str:
    """Canonical session id. PREVAIL_SESSION_ID overrides for experiment sweeps."""
    override = os.environ.get("PREVAIL_SESSION_ID")
    if override:
        return override
    return str(load_session_config(config_path)["session_id"])


def get_run_id(config_path: str | os.PathLike[str] | None = None) -> str:
    """Canonical run id. PREVAIL_RUN_ID overrides so each experiment run is distinct."""
    override = os.environ.get("PREVAIL_RUN_ID")
    if override:
        return override
    return str(load_session_config(config_path)["run_id"])
