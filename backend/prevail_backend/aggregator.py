"""Fan-out to every edge runtime and merge into one observability snapshot."""

from __future__ import annotations

import asyncio
from typing import Any

import httpx

from .config import settings

ROLE_RANK = {"AUTHORITATIVE": 3, "WARM_SHADOW": 2, "IDLE": 1}


def _parse_edge_urls(spec: str) -> dict[str, str]:
    """Parse `edge-a=http://127.0.0.1:8090,edge-b=...` into a stable map."""
    out: dict[str, str] = {}
    for entry in spec.split(","):
        entry = entry.strip()
        if not entry or "=" not in entry:
            continue
        edge_id, url = entry.split("=", 1)
        out[edge_id.strip()] = url.strip().rstrip("/")
    return out


def edge_urls() -> dict[str, str]:
    if settings.edge_urls.strip():
        return _parse_edge_urls(settings.edge_urls)
    return {
        "edge-a": "http://127.0.0.1:8090",
        "edge-b": "http://127.0.0.1:8092",
        "edge-c": "http://127.0.0.1:8094",
        "edge-d": "http://127.0.0.1:8096",
    }


def authoritative_url() -> str:
    """Trajectory and sidecar traffic go to the bootstrap authoritative edge."""
    urls = edge_urls()
    return urls.get(settings.bootstrap_edge_id, settings.runtime_url.rstrip("/"))


class EdgeAggregator:
    def __init__(self) -> None:
        self._urls = edge_urls()
        self._auth_url = authoritative_url()
        self._cached_auth_url: str | None = None
        self._cached_auth_holder: str | None = None
        self._cached_auth_at: float = 0.0

    def urls(self) -> dict[str, str]:
        return dict(self._urls)

    async def _fetch_snapshot(self, edge_id: str, url: str) -> tuple[str, dict[str, Any] | None]:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{url}/v1/snapshot")
                resp.raise_for_status()
                return edge_id, resp.json()
        except httpx.HTTPError:
            return edge_id, None

    async def fetch_all(self) -> dict[str, dict[str, Any]]:
        tasks = [self._fetch_snapshot(eid, url) for eid, url in self._urls.items()]
        results = await asyncio.gather(*tasks)
        return {eid: snap for eid, snap in results if snap is not None}

    def merge_snapshots(self, snapshots: dict[str, dict[str, Any]]) -> dict[str, Any]:
        if not snapshots:
            return {
                "run_id": "run-demo-1",
                "session_id": "sim-vehicle-01",
                "current_edge_id": "edge-a",
                "authority": {
                    "session_id": "sim-vehicle-01",
                    "epoch": 0,
                    "holder_edge_id": "edge-a",
                    "signature": "",
                },
                "prediction": None,
                "shadows": [],
                "topology": [],
                "timeline": [],
                "mode": "prevail",
            }

        # Prefer the authoritative holder's view of session state.
        primary_id = next(
            (
                eid
                for eid, snap in snapshots.items()
                if snap.get("authority", {}).get("holder_edge_id") == eid
            ),
            next(
                (eid for eid, snap in snapshots.items() if snap.get("vehicle_latitude") is not None),
                settings.bootstrap_edge_id if settings.bootstrap_edge_id in snapshots else next(iter(snapshots)),
            ),
        )
        primary = snapshots[primary_id]

        merged_topology: dict[str, dict[str, Any]] = {}
        for snap in snapshots.values():
            for node in snap.get("topology", []):
                eid = node["edge_id"]
                existing = merged_topology.get(eid)
                if existing is None or ROLE_RANK.get(node.get("role", "IDLE"), 0) > ROLE_RANK.get(
                    existing.get("role", "IDLE"), 0
                ):
                    merged_topology[eid] = node

        timeline: list[dict[str, Any]] = []
        seen: set[tuple[Any, ...]] = set()
        for snap in snapshots.values():
            for event in snap.get("timeline", []):
                key = (
                    event.get("timestamp_ms"),
                    event.get("event_type"),
                    event.get("edge_id"),
                    event.get("message"),
                )
                if key in seen:
                    continue
                seen.add(key)
                timeline.append(event)
        timeline.sort(key=lambda e: e.get("timestamp_ms", 0))
        if len(timeline) > 200:
            timeline = timeline[-200:]

        merged = dict(primary)
        merged["topology"] = list(merged_topology.values())
        merged["timeline"] = timeline
        merged["edge_snapshots"] = {eid: {"reachable": True} for eid in snapshots}

        # Vehicle pose must come from the freshest report, not whichever edge
        # happened to be chosen as primary — a stale authority snapshot yanks
        # the car backwards in the 3D view.
        freshest = None
        freshest_ts = -1
        for snap in snapshots.values():
            if snap.get("vehicle_latitude") is None:
                continue
            ts = int(snap.get("vehicle_updated_ms") or 0)
            if ts >= freshest_ts:
                freshest_ts = ts
                freshest = snap
        if freshest is not None:
            fresh_ts = int(freshest.get("vehicle_updated_ms") or 0)
            primary_ts = int(primary.get("vehicle_updated_ms") or 0)
            for key in (
                "vehicle_latitude",
                "vehicle_longitude",
                "vehicle_heading",
                "vehicle_speed_mps",
                "vehicle_updated_ms",
                "vehicle_trail",
                "traffic_vehicles",
            ):
                if key in freshest:
                    merged[key] = freshest[key]
            if fresh_ts >= primary_ts:
                if freshest.get("current_edge_id"):
                    merged["current_edge_id"] = freshest["current_edge_id"]
                fresh_auth = freshest.get("authority")
                if isinstance(fresh_auth, dict) and fresh_auth.get("holder_edge_id"):
                    merged["authority"] = fresh_auth
                    holder = fresh_auth.get("holder_edge_id")
                    if isinstance(holder, str) and holder in self._urls:
                        self._cached_auth_url = self._urls[holder]
                        self._cached_auth_holder = holder
                        import time

                        self._cached_auth_at = time.time()
        current_edge = merged.get("current_edge_id")
        newest_pred = None
        newest_ts = -1
        for snap in snapshots.values():
            pred = snap.get("prediction")
            if not isinstance(pred, dict):
                continue
            for_edge = pred.get("for_edge")
            if for_edge and current_edge and for_edge != current_edge:
                continue
            ts = int(pred.get("computed_at_ms") or snap.get("vehicle_updated_ms") or 0)
            if ts >= newest_ts:
                newest_ts = ts
                newest_pred = pred
        if newest_pred is not None:
            merged["prediction"] = newest_pred
        merged["tee_bytes"] = sum(int(s.get("tee_bytes") or 0) for s in snapshots.values())
        cpu = [float(s.get("cpu_available_ratio") or 0) for s in snapshots.values() if s.get("cpu_available_ratio") is not None]
        ram = [float(s.get("memory_available_ratio") or 0) for s in snapshots.values() if s.get("memory_available_ratio") is not None]
        rss = [int(s.get("rss_bytes") or 0) for s in snapshots.values()]
        if cpu:
            merged["cpu_available_ratio"] = sum(cpu) / len(cpu)
        if ram:
            merged["memory_available_ratio"] = sum(ram) / len(ram)
        merged["rss_bytes"] = sum(rss)
        return merged

    async def snapshot(self) -> dict[str, Any]:
        snaps = await self.fetch_all()
        return self.merge_snapshots(snaps)

    def cached_authority_url(self) -> str:
        """Return last-known authority URL without a network round trip."""
        return self._cached_auth_url or self._auth_url

    async def authority_url(self, *, force: bool = False) -> str:
        """Route control traffic to whichever edge currently holds authority."""
        import time

        now = time.time()
        if (
            not force
            and self._cached_auth_url
            and (now - self._cached_auth_at) < 8.0
        ):
            return self._cached_auth_url
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(f"{self._auth_url}/v1/current-node")
                resp.raise_for_status()
                holder = (resp.json() or {}).get("authority_holder")
                if holder and holder in self._urls:
                    self._cached_auth_url = self._urls[holder]
                    self._cached_auth_holder = holder
                    self._cached_auth_at = now
                    return self._cached_auth_url
        except httpx.HTTPError:
            pass
        return self._cached_auth_url or self._auth_url

    async def get(self, path: str) -> Any:
        url = await self.authority_url()
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{url}{path}")
            resp.raise_for_status()
            return resp.json()

    async def post(self, path: str, body: dict | list | None = None) -> Any:
        url = await self.authority_url()
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(f"{url}{path}", json={} if body is None else body)
            resp.raise_for_status()
            return resp.json()

    async def ingest_trajectory(self, sample: dict) -> dict[str, Any]:
        return await self.post("/v1/trajectory", sample)

    async def health(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{self._auth_url}/health")
                return resp.status_code == 200
        except httpx.HTTPError:
            return False

    async def metrics(self) -> dict[str, Any]:
        snaps = await self.fetch_all()
        merged = self.merge_snapshots(snaps)
        holders = {
            snap.get("authority", {}).get("holder_edge_id")
            for snap in snaps.values()
            if snap.get("authority")
        }
        holders = {h for h in holders if h}
        return {
            "transition_count": sum(
                1 for e in merged.get("timeline", []) if e.get("event_type") == "AuthorityTransferred"
            ),
            "shadow_count": len(merged.get("shadows", [])),
            "mode": merged.get("mode", "prevail"),
            "edges_reachable": len(snaps),
            "edges_total": len(self._urls),
            "authority_holders_reported": sorted(holders),
            "single_authority_invariant": len(holders) <= 1,
        }
