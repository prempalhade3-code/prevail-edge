import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Body, FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .aggregator import EdgeAggregator
from .config import settings
from .sim_client import sim_status
from .timeline_store import TimelineStore

runtime = EdgeAggregator()
timeline_store = TimelineStore(settings.database_url)


async def _timeline_sync_loop():
    while True:
        try:
            if timeline_store.enabled:
                snap = await runtime.snapshot()
                inserted = timeline_store.sync_events(
                    snap.get("run_id", "run-demo-1"),
                    snap.get("timeline", []),
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
        "postgres_enabled": timeline_store.enabled,
    }


@app.get("/v1/snapshot")
async def snapshot():
    return await runtime.snapshot()


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


@app.post("/v1/demo/advance")
async def advance_demo():
    return await runtime.post("/v1/demo/advance")


@app.post("/v1/trajectory")
async def ingest_trajectory(sample: dict):
    return await runtime.ingest_trajectory(sample)


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
    """Merged multi-edge snapshot stream for the dashboard."""
    await websocket.accept()
    while True:
        try:
            snap = await runtime.snapshot()
            await websocket.send_text(json.dumps(snap))
            await asyncio.sleep(0.08)
        except WebSocketDisconnect:
            break
        except Exception:
            await asyncio.sleep(1.0)


# Serve built dashboard from backend when frontend/dist exists (skip Vite dev server).
_UI_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _UI_DIST.is_dir() and (_UI_DIST / "index.html").exists():
    app.mount("/", StaticFiles(directory=str(_UI_DIST), html=True), name="dashboard")


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
