"""Parse live PREVAIL timeline events into measured experiment metrics."""

from __future__ import annotations

import json
import urllib.request
from typing import Any, Dict, List, Optional


def _payload(ev: Dict[str, Any]) -> Dict[str, Any]:
    raw = ev.get("payload") or {}
    return raw if isinstance(raw, dict) else {}


def parse_timeline(events: List[Dict[str, Any]]) -> Dict[str, float]:
    warm: List[float] = []
    reactive: List[float] = []
    sync_ratios: List[float] = []
    wrong = 0
    shadows_created = 0
    starts: Dict[str, float] = {}

    for ev in events:
        etype = ev.get("event_type")
        payload = _payload(ev)
        ts = float(ev.get("timestamp_ms") or 0)
        if etype == "HandoffDetected":
            target = payload.get("to_edge") or ev.get("edge_id")
            if target:
                starts[str(target)] = ts
        elif etype == "AuthorityTransferred":
            target = str(payload.get("to") or ev.get("edge_id") or "")
            explicit = payload.get("latency_ms")
            latency = None
            if explicit not in (None, ""):
                latency = float(explicit)
            elif target in starts:
                latency = ts - starts[target]
            if latency is not None and latency >= 0:
                mode = str(payload.get("transfer_mode") or "")
                if not mode:
                    mode = "reactive" if "reactive" in str(ev.get("message", "")) else "warm"
                (reactive if mode == "reactive" else warm).append(latency)
        elif etype == "ShadowSyncUpdate":
            try:
                sync_ratios.append(float(payload.get("sync_ratio") or 0))
            except (TypeError, ValueError):
                pass
        elif etype == "WrongPrediction":
            wrong += 1
        elif etype == "ShadowCreated":
            shadows_created += 1

    def avg(xs: List[float]) -> float:
        return sum(xs) / len(xs) if xs else 0.0

    def pct(xs: List[float], q: float) -> float:
        if not xs:
            return 0.0
        ordered = sorted(xs)
        idx = min(len(ordered) - 1, max(0, int(len(ordered) * q)))
        return ordered[idx]

    all_lat = warm + reactive
    correct = len(warm)
    decided = correct + wrong
    return {
        "source": 1.0,
        "live_runtime": 1.0,
        "warm_latency_ms": avg(warm),
        "reactive_latency_ms": avg(reactive),
        "migration_latency_ms": avg(warm) if warm else avg(all_lat),
        "baseline_latency_ms": avg(reactive) if reactive else avg(all_lat),
        "p50_latency_ms": pct(all_lat, 0.50),
        "p95_latency_ms": pct(all_lat, 0.95),
        "handoff_count": float(len(all_lat)),
        "warm_count": float(len(warm)),
        "reactive_count": float(len(reactive)),
        "wrong_prediction_count": float(wrong),
        "prediction_accuracy": (correct / decided) if decided else 0.0,
        "average_sync_ratio": avg([s for s in sync_ratios if s > 0]) or 0.0,
        "shadows_created": float(shadows_created),
    }


def fetch_live_snapshot(backend_url: str = "http://127.0.0.1:8000") -> Optional[Dict[str, Any]]:
    try:
        req = urllib.request.Request(f"{backend_url.rstrip('/')}/v1/snapshot")
        with urllib.request.urlopen(req, timeout=3) as resp:
            if resp.status == 200:
                return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None
    return None


def fetch_live_metrics(backend_url: str = "http://127.0.0.1:8000") -> Optional[Dict[str, float]]:
    snap = fetch_live_snapshot(backend_url)
    if not snap:
        return None
    events = snap.get("timeline") or []
    parsed = parse_timeline(events)
    if parsed["handoff_count"] <= 0:
        return None
    return parsed
