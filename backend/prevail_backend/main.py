import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Body, FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .aggregator import EdgeAggregator
from .config import settings
from .sim_client import sim_status
from .sim_drive import (
    pause_drive,
    reset_drive,
    resume_drive,
    start_drive,
    status as drive_status,
    stop_drive,
)
from .timeline_store import TimelineStore

runtime = EdgeAggregator()
timeline_store = TimelineStore(
    settings.database_url, require_postgres=settings.require_postgres
)


async def _timeline_sync_loop():
    while True:
        try:
            if timeline_store.enabled:
                snap = await runtime.snapshot()
                run_id = snap.get("run_id", "run-demo-1")
                inserted = timeline_store.sync_events(run_id, snap.get("timeline", []))
                for event in snap.get("timeline", []):
                    etype = event.get("event_type")
                    payload = event.get("payload") or {}
                    ts = int(event.get("timestamp_ms") or 0)
                    if etype == "AuthorityTransferred":
                        try:
                            latency = float(payload.get("latency_ms") or 0)
                        except (TypeError, ValueError):
                            continue
                        timeline_store.insert_metric(
                            run_id, "transition_latency_ms", latency, event.get("edge_id"), ts, payload
                        )
                        mode = str(payload.get("transfer_mode") or "unknown")
                        timeline_store.insert_metric(
                            run_id, f"handoff_{mode}", latency, event.get("edge_id"), ts, payload
                        )
                    elif etype == "WrongPrediction":
                        timeline_store.insert_metric(
                            run_id, "prediction_wrong", 1.0, event.get("edge_id"), ts, payload
                        )
                    elif etype == "PredictionScored":
                        top1_hit = 1.0 if str(payload.get("top1_hit")).lower() == "true" else 0.0
                        top2_hit = 1.0 if str(payload.get("top2_hit")).lower() == "true" else 0.0
                        timeline_store.insert_metric(
                            run_id, "prediction_top1", top1_hit, event.get("edge_id"), ts, payload
                        )
                        timeline_store.insert_metric(
                            run_id, "prediction_top2", top2_hit, event.get("edge_id"), ts, payload
                        )
                    elif etype == "ShadowSyncUpdate":
                        try:
                            ratio = float(payload.get("sync_ratio") or 0)
                        except (TypeError, ValueError):
                            continue
                        timeline_store.insert_metric(
                            run_id, "shadow_sync_ratio", ratio, event.get("edge_id"), ts, payload
                        )
                    elif etype in (
                        "PredictionUpdated",
                        "TeeBytes",
                        "ResourceSnapshot",
                        "AuthorityFailover",
                        "ImageCapabilityDenied",
                        "ShadowFlinkStarted",
                        "FlinkStateAligned",
                        "MulticastFanout",
                    ):
                        value = 1.0
                        for key in ("tee_bytes", "sync_ratio", "cpu_available_ratio", "rss_bytes"):
                            if key in payload:
                                try:
                                    value = float(payload[key])
                                except (TypeError, ValueError):
                                    pass
                                break
                        timeline_store.insert_metric(
                            run_id, etype.lower(), value, event.get("edge_id"), ts, payload
                        )
                if inserted:
                    print(f"[backend] persisted {inserted} timeline events")
        except Exception as exc:
            print(f"[backend] timeline sync error: {exc}")
        await asyncio.sleep(5.0)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    sync_task = None
    if timeline_store.enabled:
        sync_task = asyncio.create_task(_timeline_sync_loop())
    yield
    if sync_task:
        sync_task.cancel()
        try:
            await sync_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="PREVAIL Observability API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    runtime_ok = await runtime.health()
    return {
        "status": "ok" if runtime_ok else "degraded",
        "service": "prevail-backend",
        "runtime_reachable": runtime_ok,
        "postgres_enabled": timeline_store.is_postgres,
        "database": timeline_store.engine_name,
        "drive": drive_status(),
    }


@app.get("/v1/snapshot")
async def snapshot():
    return await runtime.snapshot()


@app.get("/v1/live")
async def live():
    """Compact pose feed for the Unreal viewer. Timeline/trails stay off this path."""
    snap = await runtime.snapshot()
    prediction = snap.get("prediction") or {}
    return {
        "current_edge_id": snap.get("current_edge_id"),
        "authority": snap.get("authority"),
        "prediction": {
            "probabilities": prediction.get("probabilities") or {},
            "eta_sec": prediction.get("eta_sec"),
        },
        "shadows": [
            {
                "edge_id": row.get("edge_id"),
                "role": row.get("role"),
                "sync_ratio": row.get("sync_ratio"),
            }
            for row in (snap.get("shadows") or [])
        ],
        "topology": [
            {
                "edge_id": row.get("edge_id"),
                "latitude": row.get("latitude"),
                "longitude": row.get("longitude"),
                "role": row.get("role"),
                "sync_ratio": row.get("sync_ratio"),
            }
            for row in (snap.get("topology") or [])
        ],
        "vehicle_latitude": snap.get("vehicle_latitude"),
        "vehicle_longitude": snap.get("vehicle_longitude"),
        "vehicle_heading": snap.get("vehicle_heading"),
        "vehicle_speed_mps": snap.get("vehicle_speed_mps"),
        "traffic_vehicles": snap.get("traffic_vehicles") or [],
    }


@app.get("/v1/topology")
async def topology():
    return await runtime.get("/v1/topology")


@app.get("/v1/current-node")
async def current_node():
    return await runtime.get("/v1/current-node")


@app.get("/v1/prediction")
async def prediction():
    return await runtime.get("/v1/prediction")


@app.get("/v1/shadows")
async def shadows():
    return await runtime.get("/v1/shadows")


@app.get("/v1/events")
async def events():
    return await runtime.get("/v1/events")


@app.get("/v1/metrics")
async def metrics():
    return await runtime.metrics()


@app.post("/v1/ingest/timeline")
async def ingest_timeline(event: dict):
    """Runtime push path: TimelineEvent → Postgres/SQLite immediately."""
    run_id = event.get("run_id", "run-demo-1")
    inserted = timeline_store.sync_events(run_id, [event])
    return {"inserted": inserted}


@app.post("/v1/ingest/metrics")
async def ingest_metrics(sample: dict):
    inserted = timeline_store.insert_metric(
        sample.get("run_id", "run-demo-1"),
        sample.get("metric_name", "unknown"),
        float(sample.get("value") or 0),
        sample.get("edge_id"),
        int(sample.get("timestamp_ms") or 0),
        sample.get("metadata") or {},
    )
    return {"inserted": inserted}


@app.get("/v1/history/events")
async def history_events(run_id: str = "run-demo-1", limit: int = 200):
    return timeline_store.list_events(run_id, limit)


@app.get("/v1/history/metrics")
async def history_metrics(run_id: str = "run-demo-1", limit: int = 200):
    return timeline_store.list_metrics(run_id, limit)


@app.get("/v1/history/accuracy")
async def history_accuracy(run_id: str = "run-demo-1"):
    rows = timeline_store.list_prediction_scored(run_id, 500)
    if not rows:
        rows = timeline_store.list_prediction_scored(None, 500)

    def _payload(row):
        payload = row.get("payload")
        if isinstance(payload, str):
            try:
                return json.loads(payload)
            except json.JSONDecodeError:
                return {}
        return payload or {}

    hits1 = []
    hits2 = []
    for row in rows:
        payload = _payload(row)
        actual = str(payload.get("actual_edge") or "").strip()
        top1 = str(payload.get("prediction_top1") or "").strip()
        top2 = str(payload.get("prediction_top2") or "").strip()
        if not actual:
            continue
        hits1.append(1.0 if top1 == actual else 0.0)
        hits2.append(1.0 if top1 == actual or top2 == actual else 0.0)

    def _avg(items):
        if not items:
            return None
        return round(sum(items) / len(items), 4)

    return {
        "run_id": run_id,
        "handoffs_scored": len(hits1),
        "live_top1_accuracy": _avg(hits1),
        "live_top2_accuracy": _avg(hits2),
        "source": "live_handoffs",
    }


@app.post("/v1/trajectory")
async def ingest_trajectory(sample: dict):
    return await runtime.ingest_trajectory(sample)


@app.post("/v1/sim/drive")
async def sim_drive(body: dict = Body(...)):
    """Start a source→destination GPS drive through the live mesh."""
    source = str(body.get("source") or body.get("from") or "edge-a")
    destination = str(body.get("destination") or body.get("to") or "edge-d")
    scenario = str(body.get("scenario") or "warm")
    tick_ms = int(body.get("tick_ms") or 350)
    include_images = bool(body.get("include_images", True))
    return await start_drive(
        runtime,
        source=source,
        destination=destination,
        scenario=scenario,
        tick_ms=tick_ms,
        include_images=include_images,
    )


@app.get("/v1/sim/drive/status")
async def sim_drive_status():
    return drive_status()


@app.post("/v1/sim/start")
async def sim_start(body: dict = Body(default={})):
    return await start_drive(
        runtime,
        source=str(body.get("source") or "edge-a"),
        destination=str(body.get("destination") or "edge-d"),
        scenario=str(body.get("scenario") or "warm"),
        tick_ms=int(body.get("tick_ms") or 350),
        include_images=bool(body.get("include_images", True)),
    )


@app.post("/v1/sim/pause")
async def sim_pause():
    return await pause_drive()


@app.post("/v1/sim/resume")
async def sim_resume():
    return await resume_drive()


@app.post("/v1/sim/stop")
async def sim_stop():
    return await stop_drive()


@app.post("/v1/sim/reset")
async def sim_reset():
    return await reset_drive(runtime)


@app.post("/v1/test/prediction")
async def test_prediction(body: dict = Body(...)):
    """Deterministic live-scenario injector for capability and multi-shadow checks."""
    return await runtime.post("/v1/test/prediction", body)


@app.post("/v1/traffic")
async def ingest_traffic(vehicles: list = Body(...)):
    return await runtime.post("/v1/traffic", vehicles)


@app.get("/v1/sim/status")
async def sim_engine_status():
    """CARLA / simulation engine connection status."""
    return await sim_status()


@app.websocket("/ws/sim")
async def ws_sim_engine(websocket: WebSocket):
    """Proxy CARLA chase-camera stream from simulation bridge."""
    await websocket.accept()
    bridge_ws = settings.sim_bridge_ws_url
    try:
        import websockets

        async with websockets.connect(bridge_ws, max_size=10_000_000) as upstream:
            async for message in upstream:
                if isinstance(message, bytes):
                    await websocket.send_bytes(message)
                else:
                    await websocket.send_text(message)
    except WebSocketDisconnect:
        return
    except Exception as exc:
        while True:
            try:
                status = await sim_status()
                status["proxy_error"] = str(exc)
                await websocket.send_text(json.dumps({"type": "status", "status": status}))
                await asyncio.sleep(2.0)
            except WebSocketDisconnect:
                break


@app.websocket("/ws/live")
async def ws_live(websocket: WebSocket):
    """Full observability snapshot on the live socket (timeline + shadows)."""
    await websocket.accept()
    while True:
        try:
            await websocket.send_text(json.dumps(await runtime.snapshot()))
            await asyncio.sleep(0.25)
        except WebSocketDisconnect:
            break
        except Exception:
            await asyncio.sleep(1.0)


_FRONTEND_ROOT = Path(__file__).resolve().parents[2] / "frontend"
_DEMO_HTML = _FRONTEND_ROOT / "demo.html"
_UI_DIST = _FRONTEND_ROOT / "dist"


@app.get("/")
async def dashboard_home():
    """2D live dashboard. Always prefer demo.html so the 3D dist build is not served."""
    return FileResponse(_DEMO_HTML)


@app.get("/demo")
async def dashboard_demo():
    return FileResponse(_DEMO_HTML)


# Optional built-asset mount for leftover Vite files; `/` stays the 2D demo.
if _UI_DIST.is_dir() and (_UI_DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=str(_UI_DIST / "assets")), name="dashboard-assets")


def run():
    import uvicorn

    uvicorn.run(
        "prevail_backend.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=False,
    )


if __name__ == "__main__":
    run()
