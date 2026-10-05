"""Backend-owned source→destination drive with start/pause/resume/reset/stop."""

from __future__ import annotations

import asyncio
import os
import time
from typing import Any

import httpx

from .aggregator import EdgeAggregator

_STATE: dict[str, Any] = {
    "running": False,
    "paused": False,
    "stopped": False,
    "scenario": None,
    "path": [],
    "posted": 0,
    "error": None,
    "control": "idle",
    "warm_state": None,
    "warm_ready": False,
}

_TASK: asyncio.Task | None = None
_SHADOW_POLL: asyncio.Task | None = None


def status() -> dict[str, Any]:
    return dict(_STATE)


def _set(**kwargs: Any) -> dict[str, Any]:
    _STATE.update(kwargs)
    return status()


async def start_drive(
    runtime: EdgeAggregator,
    *,
    source: str,
    destination: str,
    scenario: str = "warm",
    tick_ms: int = 350,
    include_images: bool = True,
) -> dict[str, Any]:
    global _TASK, _SHADOW_POLL
    if _STATE["running"]:
        return {"accepted": False, "error": "drive already running", **status()}

    from python.mobility.route_planner import city_ids, plan_ticks, shortest_path
    from python.mobility.road_graph import RoadGraph

    if source == destination:
        return {"accepted": False, **status(), "error": "Choose a different destination."}
    known = set(city_ids())
    if source not in known or destination not in known:
        return {"accepted": False, **status(), "error": "Choose a supported city."}

    graph = RoadGraph()
    city_path = shortest_path(graph, source, destination)
    if not city_path:
        return {"accepted": False, **status(), "error": "No road route between those cities."}

    ticks = plan_ticks(
        source,
        destination,
        steps_per_leg=28,
        include_images=include_images,
        divert_wrong=scenario == "wrong",
        graph=graph,
    )
    edge_path = list(dict.fromkeys(t["edge_id"] for t in ticks))
    first_edge = edge_path[0] if edge_path else "edge-a"
    next_edge = edge_path[1] if len(edge_path) > 1 else None

    await _register_predictor_route("sim-vehicle-01", edge_path)

    _set(
        running=True,
        paused=False,
        stopped=False,
        scenario=scenario,
        source=source,
        destination=destination,
        posted=0,
        total=len(ticks),
        error=None,
        control="running",
        path=edge_path,
        city_path=city_path,
        wait_for_warm=scenario == "warm",
        warm_state="waiting" if scenario == "warm" else None,
        warm_ready=False,
        warm_shadow_target=next_edge,
    )

    if _SHADOW_POLL and not _SHADOW_POLL.done():
        _SHADOW_POLL.cancel()

    if scenario == "warm" and next_edge:
        _SHADOW_POLL = asyncio.create_task(_poll_shadow_readiness(runtime, next_edge))

    _TASK = asyncio.create_task(_pump(runtime, ticks, max(80, tick_ms), scenario))
    return {"accepted": True, **status()}


async def pause_drive() -> dict[str, Any]:
    if not _STATE["running"]:
        return {"accepted": False, "error": "no drive running", **status()}
    return _set(paused=True, control="paused")


async def resume_drive() -> dict[str, Any]:
    if not _STATE["running"]:
        return {"accepted": False, "error": "no drive running", **status()}
    return _set(paused=False, control="running")


async def stop_drive() -> dict[str, Any]:
    global _TASK, _SHADOW_POLL
    _STATE["stopped"] = True
    _STATE["paused"] = False
    if _SHADOW_POLL and not _SHADOW_POLL.done():
        _SHADOW_POLL.cancel()
        try:
            await _SHADOW_POLL
        except asyncio.CancelledError:
            pass
    if _TASK and not _TASK.done():
        _TASK.cancel()
        try:
            await _TASK
        except asyncio.CancelledError:
            pass
    return _set(running=False, control="stopped")


async def reset_drive(runtime: EdgeAggregator) -> dict[str, Any]:
    await stop_drive()
    errors = []
    for edge_id, url in runtime.urls().items():
        try:
            import httpx

            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.post(f"{url}/v1/session/reset")
                resp.raise_for_status()
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{edge_id}:{exc}")
    return _set(
        running=False,
        paused=False,
        stopped=True,
        posted=0,
        path=[],
        error="; ".join(errors) if errors else None,
        control="reset",
        scenario=None,
        warm_state=None,
        warm_ready=False,
        warm_shadow_target=None,
    )


async def _register_predictor_route(session_id: str, edge_path: list[str]) -> bool:
    """Tell the ML predictor the active edge sequence for this drive."""
    if not edge_path:
        _STATE["predictor_route_registered"] = False
        return False
    url = os.environ.get("PREVAIL_PREDICTOR_URL", "http://127.0.0.1:8091").rstrip("/")
    last_error: str | None = None
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.post(
                    f"{url}/session/route",
                    json={
                        "session_id": session_id,
                        "planned_route": edge_path,
                        "reset_history": True,
                    },
                )
                resp.raise_for_status()
                _STATE["predictor_route_registered"] = True
                _STATE.pop("predictor_route_error", None)
                return True
        except httpx.HTTPError as exc:
            last_error = str(exc)
            await asyncio.sleep(0.25 * (attempt + 1))
    _STATE["predictor_route_registered"] = False
    _STATE["predictor_route_error"] = last_error
    return False


async def _mirror_route_to_predictor(
    session_id: str,
    edge_path: list[str],
    sample: dict[str, Any],
) -> None:
    """Ensure the predictor receives route context even if /session/route is unavailable."""
    if not edge_path:
        return
    url = os.environ.get("PREVAIL_PREDICTOR_URL", "http://127.0.0.1:8091").rstrip("/")
    body = {
        "session_id": session_id,
        "edge_id": sample.get("edge_id"),
        "timestamp_ms": sample.get("timestamp_ms"),
        "latitude": sample.get("latitude"),
        "longitude": sample.get("longitude"),
        "speed_mps": sample.get("speed_mps"),
        "heading_deg": sample.get("heading_deg"),
        "planned_route": edge_path,
        "reset_route_history": bool(sample.get("reset_route_history")),
    }
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            await client.post(f"{url}/trajectory", json=body)
    except httpx.HTTPError:
        pass


async def _wait_if_paused() -> None:
    while _STATE.get("paused") and not _STATE.get("stopped"):
        await asyncio.sleep(0.15)


async def _shadow_ready(runtime: EdgeAggregator, target: str, threshold: float = 0.95) -> bool:
    """True only when the authoritative edge reports the target shadow at threshold."""
    import httpx

    url = runtime.cached_authority_url()
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{url}/v1/shadows")
            resp.raise_for_status()
            for row in resp.json() or []:
                if row.get("edge_id") != target:
                    continue
                if row.get("role") not in (None, "WARM_SHADOW", "WarmShadow", "warm_shadow"):
                    continue
                if float(row.get("sync_ratio") or 0) >= threshold:
                    return True
    except Exception:
        return False
    return False


async def _poll_shadow_readiness(runtime: EdgeAggregator, target: str) -> None:
    """Background poll — never blocks vehicle movement."""
    deadline = time.time() + 25.0
    try:
        while time.time() < deadline and not _STATE.get("stopped"):
            if await _shadow_ready(runtime, target):
                _STATE["warm_state"] = "ready"
                _STATE["warm_ready"] = True
                return
            await asyncio.sleep(0.45)
        if not _STATE.get("stopped"):
            _STATE["warm_state"] = "timeout"
            _STATE["warm_ready"] = False
    except asyncio.CancelledError:
        raise


async def _pump(
    runtime: EdgeAggregator,
    ticks: list[dict[str, Any]],
    tick_ms: int,
    scenario: str,
) -> None:
    try:
        edge_path = list(_STATE.get("path") or [])
        session_id = "sim-vehicle-01"
        route_announced = bool(_STATE.get("predictor_route_registered"))
        for tick_idx, tick in enumerate(ticks):
            if _STATE.get("stopped"):
                break
            await _wait_if_paused()
            if _STATE.get("stopped"):
                break
            if edge_path and not route_announced:
                route_announced = await _register_predictor_route(session_id, edge_path)
            sample = dict(tick)
            sample["timestamp_ms"] = int(time.time() * 1000)
            if edge_path:
                sample["planned_route"] = edge_path
                sample["reset_route_history"] = tick_idx == 0
            await runtime.ingest_trajectory(sample)
            await _mirror_route_to_predictor(session_id, edge_path, sample)
            _STATE["posted"] = int(_STATE["posted"]) + 1
            await asyncio.sleep(tick_ms / 1000.0)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001 — surface to /v1/sim/drive/status
        _STATE["error"] = str(exc)
        _STATE["warm_state"] = "failed"
    finally:
        _STATE["running"] = False
        if _STATE.get("control") not in {"stopped", "reset"}:
            _STATE["control"] = "idle"


# Back-compat name used by /v1/sim/drive
run_drive = start_drive
