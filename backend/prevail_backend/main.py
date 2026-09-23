import asyncio
import json
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .runtime_client import RuntimeClient

runtime = RuntimeClient()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield


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
    return {"status": "ok", "service": "prevail-backend"}


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
    return await runtime.get("/v1/metrics")


@app.post("/v1/demo/advance")
async def advance_demo():
    return await runtime.advance_demo()


@app.websocket("/ws/live")
async def ws_live(websocket: WebSocket):
    """Proxy live snapshots from Rust runtime WebSocket (fallback: poll snapshot)."""
    await websocket.accept()
    runtime_ws = settings.runtime_url.replace("http", "ws", 1) + "/ws/live"
    try:
        import websockets

        async with websockets.connect(runtime_ws) as upstream:
            async for message in upstream:
                await websocket.send_text(message)
    except WebSocketDisconnect:
        return
    except Exception:
        while True:
            try:
                snap = await runtime.snapshot()
                await websocket.send_text(json.dumps(snap))
                await asyncio.sleep(0.8)
            except WebSocketDisconnect:
                break


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
