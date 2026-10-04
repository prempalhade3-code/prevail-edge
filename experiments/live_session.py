"""Drive a live PREVAIL session and collect measured E1–E6 metrics."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[1]


def _get(url: str, timeout: float = 4.0) -> Any:
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _post(url: str, payload: Any, timeout: float = 8.0) -> Any:
    data = json.dumps(payload).encode("utf-8")
    last_exc: Exception | None = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            time.sleep(0.25 * (attempt + 1))
    raise last_exc if last_exc else RuntimeError(f"POST {url} failed")


def require_live_mesh(backend_url: Optional[str] = None) -> Dict[str, Any]:
    backend_url = (backend_url or os.environ.get("PREVAIL_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
    try:
        health = _get(f"{backend_url}/health")
    except Exception as exc:
        raise RuntimeError(
            f"live PREVAIL mesh unavailable at {backend_url}/health: {exc}"
        ) from exc
    try:
        snap = _get(f"{backend_url}/v1/snapshot")
    except Exception as exc:
        raise RuntimeError(f"live snapshot unavailable: {exc}") from exc
    if not snap:
        raise RuntimeError("live snapshot is empty")
    health["snapshot"] = snap
    return health


def drive_trajectory(
    samples: List[Dict[str, Any]],
    runtime_url: Optional[str] = None,
    delay_s: float = 0.05,
) -> int:
    runtime_url = (
        runtime_url
        or os.environ.get("PREVAIL_RUNTIME_URL")
        or "http://127.0.0.1:8090"
    ).rstrip("/")
    posted = 0
    for sample in samples:
        _post(f"{runtime_url}/v1/trajectory", sample)
        posted += 1
        time.sleep(delay_s)
    return posted


def wait_for_handoffs(backend_url: str, minimum: int = 1, timeout_s: float = 30.0) -> Dict[str, Any]:
    from experiments.metrics import parse_timeline

    deadline = time.time() + timeout_s
    last: Dict[str, Any] = {}
    while time.time() < deadline:
        snap = _get(f"{backend_url.rstrip('/')}/v1/snapshot")
        last = parse_timeline(snap.get("timeline") or [])
        last["snapshot"] = snap
        if last.get("handoff_count", 0) >= minimum:
            return last
        time.sleep(0.5)
    raise RuntimeError(
        f"live session produced no measured handoffs (last={ {k: last.get(k) for k in ('handoff_count','warm_count','reactive_count')} })"
    )


def read_jsonl(path: Path) -> List[Dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
