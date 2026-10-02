#!/usr/bin/env python3
"""
PREVAIL ↔ CARLA simulation bridge.

Connects the Unreal/CARLA game-engine simulation to PREVAIL authority state.
Streams chase-camera JPEG frames to the web frontend via WebSocket.

Usage:
  PREVAIL_RUNTIME_URL=http://127.0.0.1:8090 python sim/carla/prevail_bridge.py

Environment:
  CARLA_HOST          default 127.0.0.1
  CARLA_PORT          default 2000
  PREVAIL_BRIDGE_PORT default 8765
  CARLA_TM_PORT       default 8000 (Traffic Manager)
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sim.carla.coordinates import geo_to_carla
from sim.carla.edge_props import sync_edge_topology

try:
    import carla
except ImportError:
    carla = None  # type: ignore

try:
    import websockets
except ImportError:
    websockets = None  # type: ignore

try:
    import numpy as np
except ImportError:
    np = None  # type: ignore


RUNTIME_URL = os.environ.get("PREVAIL_RUNTIME_URL", "http://127.0.0.1:8090").rstrip("/")
BRIDGE_PORT = int(os.environ.get("PREVAIL_BRIDGE_PORT", "8765"))
CARLA_HOST = os.environ.get("CARLA_HOST", "127.0.0.1")
CARLA_PORT = int(os.environ.get("CARLA_PORT", "2000"))


class BridgeState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.carla_connected = False
        self.engine = "CARLA/Unreal Engine 4.26"
        self.map_name = ""
        self.fps = 0.0
        self.frame_seq = 0
        self.latest_jpeg: bytes = b""
        self.status: Dict[str, Any] = {
            "engine": "CARLA",
            "connected": False,
            "message": "Waiting for CARLA server…",
            "setup": {
                "step1": "./CarlaUE4.sh -prefernvidia -quality-level=Epic",
                "step2": "pip install carla (egg from CARLA release matching version)",
                "step3": "python sim/carla/prevail_bridge.py",
                "docker": "docker compose -f docker-compose.carla.yml up",
                "mac_note": "CARLA requires Linux/Windows + NVIDIA GPU. Run bridge with CARLA_HOST=<linux-ip> from Mac.",
            },
        }
        self.ws_clients: Set[Any] = set()


STATE = BridgeState()


def fetch_snapshot() -> Optional[Dict[str, Any]]:
    try:
        with urllib.request.urlopen(f"{RUNTIME_URL}/v1/snapshot", timeout=2) as resp:
            return json.loads(resp.read())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None


def jpeg_from_carla_image(image: Any) -> bytes:
    """Convert CARLA sensor image to JPEG bytes."""
    if np is None:
        return b""
    array = np.frombuffer(image.raw_data, dtype=np.uint8)
    array = array.reshape((image.height, image.width, 4))
    rgb = array[:, :, :3]
    try:
        from PIL import Image
        import io

        im = Image.fromarray(rgb)
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=85)
        return buf.getvalue()
    except ImportError:
        return rgb.tobytes()


class CarlaSimulationThread(threading.Thread):
    """Runs CARLA sync loop in background thread."""

    def __init__(self) -> None:
        super().__init__(daemon=True)
        self._running = True
        self._client: Any = None
        self._world: Any = None
        self._hero: Any = None
        self._driver: Any = None
        self._camera: Any = None
        self._traffic_vehicles: Dict[str, Any] = {}
        self._edge_actors: Dict[str, List[Any]] = {}

    def stop(self) -> None:
        self._running = False

    def run(self) -> None:
        if carla is None:
            with STATE.lock:
                STATE.status["message"] = (
                    "Python `carla` module not installed. "
                    "Install from CARLA release: pip install <path>/carla-0.9.15-py3.10-linux-x86_64.egg"
                )
            return

        try:
            self._client = carla.Client(CARLA_HOST, CARLA_PORT)
            self._client.set_timeout(10.0)
            self._world = self._client.load_world("Town10HD_Opt")
            settings = self._world.get_settings()
            settings.synchronous_mode = True
            settings.fixed_delta_seconds = 0.05  # 20 Hz
            self._world.apply_settings(settings)

            bp_lib = self._world.get_blueprint_library()
            tm = self._client.get_trafficmanager(CARLA_PORT + 6000)
            tm.set_synchronous_mode(True)

            # Weather: dusk urban atmosphere
            weather = carla.WeatherParameters(
                cloudiness=40.0,
                sun_altitude_angle=25.0,
                fog_density=10.0,
                wetness=20.0,
            )
            self._world.set_weather(weather)

            # Hero vehicle — realistic sedan blueprint
            vehicle_bp = bp_lib.filter("vehicle.tesla.model3")[0]
            vehicle_bp.set_attribute("color", "8,32,46")
            spawn = self._world.get_map().get_spawn_points()[10]
            self._hero = self._world.spawn_actor(vehicle_bp, spawn)
            self._hero.set_autopilot(False)

            # Driver walker (visible through windows)
            walker_bp = bp_lib.filter("walker.pedestrian.*")[0]
            driver_transform = carla.Transform(carla.Location(x=0.4, y=-0.4, z=0.9))
            self._driver = self._world.spawn_actor(
                walker_bp,
                self._hero.get_transform(),
            )
            self._driver.set_simulate_physics(False)
            self._driver.attach_to(
                self._hero,
                socket_name="seat_front_right",
                attachment_type=carla.AttachmentType.Rigid,
            )

            # Chase camera — third-person GTA-style
            cam_bp = bp_lib.find("sensor.camera.rgb")
            cam_bp.set_attribute("image_size_x", "1280")
            cam_bp.set_attribute("image_size_y", "720")
            cam_bp.set_attribute("fov", "85")
            cam_transform = carla.Transform(
                carla.Location(x=-6.5, z=2.8),
                carla.Rotation(pitch=-12.0),
            )
            self._camera = self._world.spawn_actor(
                cam_bp,
                cam_transform,
                attach_to=self._hero,
            )
            self._camera.listen(self._on_frame)

            # Ambient traffic via Traffic Manager
            spawn_points = self._world.get_map().get_spawn_points()
            traffic_bps = bp_lib.filter("vehicle.*")
            for i, sp in enumerate(spawn_points[:25]):
                if i == 10:
                    continue
                bp = traffic_bps[i % len(traffic_bps)]
                if bp.has_attribute("color"):
                    bp.set_attribute("color", "50,50,50")
                actor = self._world.try_spawn_actor(bp, sp)
                if actor:
                    actor.set_autopilot(True, tm.get_port())

            with STATE.lock:
                STATE.carla_connected = True
                STATE.map_name = self._world.get_map().name
                STATE.status.update(
                    {
                        "connected": True,
                        "message": f"CARLA connected — {STATE.map_name}",
                        "hero_vehicle": "vehicle.tesla.model3",
                        "traffic_manager": True,
                    }
                )

            last_fps = time.time()
            frames = 0

            while self._running:
                snap = fetch_snapshot()
                if snap and self._hero and self._hero.is_alive:
                    self._sync_from_snapshot(snap, tm)
                    sync_edge_topology(
                        self._world,
                        bp_lib,
                        carla,
                        snap.get("topology", []),
                        geo_to_carla,
                        self._edge_actors,
                    )

                self._world.tick()
                frames += 1
                now = time.time()
                if now - last_fps >= 1.0:
                    with STATE.lock:
                        STATE.fps = frames / (now - last_fps)
                    frames = 0
                    last_fps = now

        except Exception as exc:
            with STATE.lock:
                STATE.carla_connected = False
                STATE.status.update(
                    {
                        "connected": False,
                        "message": f"CARLA connection failed: {exc}",
                    }
                )

        finally:
            self._cleanup()

    def _on_frame(self, image: Any) -> None:
        jpeg = jpeg_from_carla_image(image)
        if not jpeg:
            return
        with STATE.lock:
            STATE.latest_jpeg = jpeg
            STATE.frame_seq += 1

    def _sync_from_snapshot(self, snap: Dict[str, Any], tm: Any) -> None:
        lat = snap.get("vehicle_latitude")
        lon = snap.get("vehicle_longitude")
        if lat is None or lon is None:
            return
        heading = snap.get("vehicle_heading", 0.0)
        t = geo_to_carla(lat, lon, heading)
        transform = carla.Transform(
            carla.Location(x=t.x, y=t.y, z=t.z + 20),
            carla.Rotation(yaw=t.yaw),
        )
        self._hero.set_transform(transform)

        # Mirror PREVAIL traffic vehicles as NPCs
        traffic = snap.get("traffic_vehicles") or []
        bp_lib = self._world.get_blueprint_library()
        for i, tv in enumerate(traffic[:12]):
            vid = tv["vehicle_id"]
            tt = geo_to_carla(tv["latitude"], tv["longitude"], tv.get("heading_deg", 0))
            tf = carla.Transform(
                carla.Location(x=tt.x, y=tt.y, z=tt.z + 15),
                carla.Rotation(yaw=tt.yaw),
            )
            if vid not in self._traffic_vehicles:
                bps = bp_lib.filter("vehicle.audi.*")
                bp = bps[i % len(bps)] if bps else bp_lib.filter("vehicle.*")[0]
                actor = self._world.try_spawn_actor(bp, tf)
                if actor:
                    actor.set_autopilot(True, tm.get_port())
                    self._traffic_vehicles[vid] = actor
            else:
                actor = self._traffic_vehicles[vid]
                if actor.is_alive:
                    actor.set_transform(tf)

    def _cleanup(self) -> None:
        for actors in self._edge_actors.values():
            for a in actors:
                if a.is_alive:
                    a.destroy()
        if self._camera and self._camera.is_alive:
            self._camera.destroy()
        if self._driver and self._driver.is_alive:
            self._driver.destroy()
        if self._hero and self._hero.is_alive:
            self._hero.destroy()
        for v in self._traffic_vehicles.values():
            if v.is_alive:
                v.destroy()


class StatusHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        pass

    def do_GET(self) -> None:
        if self.path == "/status":
            with STATE.lock:
                body = json.dumps(STATE.status).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/frame":
            with STATE.lock:
                jpeg = STATE.latest_jpeg
            if not jpeg:
                self.send_response(204)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(jpeg)
        else:
            self.send_response(404)
            self.end_headers()


async def ws_handler(websocket: Any) -> None:
    STATE.ws_clients.add(websocket)
    last_seq = -1
    try:
        while True:
            with STATE.lock:
                seq = STATE.frame_seq
                jpeg = STATE.latest_jpeg
                status = dict(STATE.status)
            if jpeg and seq != last_seq:
                await websocket.send(json.dumps({"type": "frame", "seq": seq, "status": status}))
                await websocket.send(jpeg)
                last_seq = seq
            else:
                await websocket.send(json.dumps({"type": "status", "status": status}))
            await asyncio.sleep(0.05)
    except Exception:
        pass
    finally:
        STATE.ws_clients.discard(websocket)


async def run_websocket_server() -> None:
    if websockets is None:
        print("[bridge] websockets not installed — pip install websockets", file=sys.stderr)
        return
    async with websockets.serve(ws_handler, "127.0.0.1", BRIDGE_PORT, max_size=10_000_000):
        print(f"[bridge] WebSocket stream ws://127.0.0.1:{BRIDGE_PORT}")
        await asyncio.Future()


def main() -> None:
    print(f"[bridge] PREVAIL runtime: {RUNTIME_URL}")
    print(f"[bridge] CARLA target: {CARLA_HOST}:{CARLA_PORT}")

    carla_thread = CarlaSimulationThread()
    carla_thread.start()

    http = ThreadingHTTPServer(("127.0.0.1", BRIDGE_PORT + 1), StatusHandler)
    threading.Thread(target=http.serve_forever, daemon=True).start()
    print(f"[bridge] HTTP status http://127.0.0.1:{BRIDGE_PORT + 1}/status")

    if websockets:
        asyncio.run(run_websocket_server())
    else:
        while True:
            time.sleep(1)


if __name__ == "__main__":
    main()

# Allow: python -m sim.carla.prevail_bridge

