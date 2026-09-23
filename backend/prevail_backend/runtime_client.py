"""HTTP client for Prem's Rust prevail-runtime (core source of truth)."""

from typing import Any

import httpx

from .config import settings


class RuntimeClient:
    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (base_url or settings.runtime_url).rstrip("/")

    async def get(self, path: str) -> Any:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{self.base_url}{path}")
            r.raise_for_status()
            return r.json()

    async def post(self, path: str) -> Any:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(f"{self.base_url}{path}")
            r.raise_for_status()
            return r.json()

    async def snapshot(self) -> dict[str, Any]:
        return await self.get("/v1/snapshot")

    async def advance_demo(self) -> dict[str, Any]:
        return await self.post("/v1/demo/advance")
