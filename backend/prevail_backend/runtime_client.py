import httpx

from .config import settings


class RuntimeClient:
    def __init__(self) -> None:
        self.base_url = settings.runtime_url.rstrip("/")

    async def get(self, path: str):
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{self.base_url}{path}")
            resp.raise_for_status()
            return resp.json()

    async def post(self, path: str, body: dict | None = None):
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(f"{self.base_url}{path}", json=body or {})
            resp.raise_for_status()
            return resp.json()

    async def snapshot(self):
        return await self.get("/v1/snapshot")

    async def ingest_trajectory(self, sample: dict):
        return await self.post("/v1/trajectory", sample)

    async def health(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{self.base_url}/health")
                return resp.status_code == 200
        except httpx.HTTPError:
            return False
