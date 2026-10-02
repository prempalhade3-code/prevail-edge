"""HTTP/WS client for CARLA simulation bridge."""

from __future__ import annotations

import json
import urllib.error
import urllib.request

import httpx

from .config import settings


async def sim_status() -> dict:
    url = f"{settings.sim_bridge_http_url}/status"
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        return {
            "engine": "CARLA",
            "connected": False,
            "message": f"Simulation bridge unreachable: {exc}",
            "setup": {
                "step1": "Start CARLA: ./CarlaUE4.sh -prefernvidia -quality-level=Epic",
                "step2": "python sim/carla/prevail_bridge.py",
                "docs": "sim/carla/ARCHITECTURE.md",
            },
        }


def sim_status_sync() -> dict:
    url = f"{settings.sim_bridge_http_url}/status"
    try:
        with urllib.request.urlopen(url, timeout=2) as resp:
            return json.loads(resp.read())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        return {
            "engine": "CARLA",
            "connected": False,
            "message": f"Simulation bridge unreachable: {exc}",
        }
