"""Parse live PREVAIL timeline events into measured experiment metrics."""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional


def _payload(ev: Dict[str, Any]) -> Dict[str, Any]:
    raw = ev.get("payload") or {}
    return raw if isinstance(raw, dict) else {}


def parse_timeline(events: List[Dict[str, Any]]) -> Dict[str, float]:
    warm: List[float] = []
    reactive: List[float] = []
    sync_ratios: List[float] = []
    sync_times: List[float] = []
    cpu_used: List[float] = []
    ram_used: List[float] = []
    rss: List[float] = []
    wrong = 0
    shadows_created = 0
    tee_bytes = 0.0
    starts: Dict[str, float] = {}
    shadow_started: Dict[str, float] = {}

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
                ratio = float(payload.get("sync_ratio") or 0)
            except (TypeError, ValueError):
                ratio = 0.0
            sync_ratios.append(ratio)
            edge = str(ev.get("edge_id") or payload.get("shadow_edge_id") or "")
            if ratio >= 0.95 and edge in shadow_started:
                sync_times.append(max(0.0, ts - shadow_started[edge]))
                shadow_started.pop(edge, None)
        elif etype in {"ShadowCreated", "ShadowPrepared"}:
            wrong_edge = str(ev.get("edge_id") or payload.get("target") or "")
            if etype == "ShadowCreated":
                shadows_created += 1
            if wrong_edge:
                shadow_started[wrong_edge] = ts
        elif etype == "WrongPrediction":
            wrong += 1
        elif etype == "TeeBytes":
            try:
                tee_bytes = max(tee_bytes, float(payload.get("tee_bytes") or 0))
            except (TypeError, ValueError):
                pass
        elif etype == "ResourceSnapshot":
            try:
                cpu_used.append(1.0 - float(payload.get("cpu_available_ratio") or 0))
                ram_used.append(1.0 - float(payload.get("memory_available_ratio") or 0))
                rss.append(float(payload.get("rss_bytes") or 0))
            except (TypeError, ValueError):
                pass

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
    topk = load_topk_from_metadata()
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
        "tee_bytes": tee_bytes,
        "cpu_overhead": avg(cpu_used),
        "ram_overhead": avg(ram_used),
        "rss_bytes": avg(rss),
        "sync_time_ms": avg(sync_times),
        "topk_top1": topk["top1"],
        "topk_top2": topk["top2"],
    }


def load_topk_from_metadata() -> Dict[str, float]:
    meta = Path(__file__).resolve().parents[1] / "python" / "predictor" / "models" / "training_metadata.json"
    if not meta.exists():
        return {"top1": 0.0, "top2": 0.0}
    try:
        data = json.loads(meta.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"top1": 0.0, "top2": 0.0}
    return {
        "top1": float(data.get("top1_accuracy") or 0.0),
        "top2": float(data.get("top2_accuracy") or 0.0),
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
    parsed["tee_bytes"] = max(parsed["tee_bytes"], float(snap.get("tee_bytes") or 0))
    if parsed["cpu_overhead"] <= 0 and snap.get("cpu_available_ratio") is not None:
        parsed["cpu_overhead"] = 1.0 - float(snap.get("cpu_available_ratio") or 1.0)
    if parsed["ram_overhead"] <= 0 and snap.get("memory_available_ratio") is not None:
        parsed["ram_overhead"] = 1.0 - float(snap.get("memory_available_ratio") or 1.0)
    if parsed["rss_bytes"] <= 0 and snap.get("rss_bytes") is not None:
        parsed["rss_bytes"] = float(snap.get("rss_bytes") or 0)
    if parsed["handoff_count"] <= 0:
        return None
    return parsed
