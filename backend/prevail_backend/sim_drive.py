"""Backend-owned source→destination drive with start/pause/resume/reset/stop."""

from __future__ import annotations

import asyncio
import time
from typing import Any

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
}

_TASK: asyncio.Task | None = None


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
    global _TASK
    if _STATE["running"]:
        return {"accepted": False, "error": "drive already running", **status()}

    from python.mobility.route_planner import plan_ticks

    ticks = plan_ticks(
        source,
        destination,
        linger_first=48 if scenario == "warm" else 12,
        steps_per_leg=28,
        include_images=include_images,
        divert_wrong=scenario == "wrong",
    )
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
        path=list(dict.fromkeys(t["edge_id"] for t in ticks)),
        wait_for_warm=scenario == "warm",
    )
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
    global _TASK
    _STATE["stopped"] = True
    _STATE["paused"] = False
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
    )


async def _wait_if_paused() -> None:
    while _STATE.get("paused") and not _STATE.get("stopped"):
        await asyncio.sleep(0.15)


async def _shadow_ready(runtime: EdgeAggregator, target: str, threshold: float = 0.95) -> bool:
    import httpx

    for url in runtime.urls().values():
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(f"{url}/v1/shadows")
                resp.raise_for_status()
                for row in resp.json() or []:
                    if row.get("edge_id") == target and float(row.get("sync_ratio") or 0) >= threshold:
                        return True
        except Exception:
            continue
    return False


async def _pump(
    runtime: EdgeAggregator,
    ticks: list[dict[str, Any]],
    tick_ms: int,
    scenario: str,
) -> None:
    try:
        first_edge = ticks[0]["edge_id"] if ticks else "edge-a"
        next_edges = [t["edge_id"] for t in ticks if t["edge_id"] != first_edge]
        next_edge = next_edges[0] if next_edges else None
        warmed = scenario != "warm"
        for idx, sample in enumerate(ticks):
            if _STATE.get("stopped"):
                break
            await _wait_if_paused()
            if _STATE.get("stopped"):
                break
            if (
                scenario == "warm"
                and not warmed
                and next_edge
                and sample["edge_id"] != first_edge
            ):
                deadline = time.time() + 55.0
                while time.time() < deadline and not _STATE.get("stopped"):
                    await _wait_if_paused()
                    if await _shadow_ready(runtime, next_edge):
                        warmed = True
                        _STATE["warm_ready"] = True
                        break
                    linger = dict(ticks[max(0, idx - 1)])
                    linger["timestamp_ms"] = int(time.time() * 1000)
                    linger["edge_id"] = first_edge
                    await runtime.ingest_trajectory(linger)
                    _STATE["posted"] = int(_STATE["posted"]) + 1
                    await asyncio.sleep(max(tick_ms, 250) / 1000.0)
                warmed = True
            sample = dict(sample)
            sample["timestamp_ms"] = int(time.time() * 1000)
            await runtime.ingest_trajectory(sample)
            _STATE["posted"] = int(_STATE["posted"]) + 1
            await asyncio.sleep(tick_ms / 1000.0)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001 — surface to /v1/sim/drive/status
        _STATE["error"] = str(exc)
    finally:
        _STATE["running"] = False
        if _STATE.get("control") not in {"stopped", "reset"}:
            _STATE["control"] = "idle"


# Back-compat name used by /v1/sim/drive
run_drive = start_drive
