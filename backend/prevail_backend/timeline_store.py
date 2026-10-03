"""Optional Postgres persistence for timeline events from the runtime."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Set

logger = logging.getLogger(__name__)


class TimelineStore:
    def __init__(self, database_url: str | None):
        self.database_url = database_url
        self._seen: Set[str] = set()

    @property
    def enabled(self) -> bool:
        return bool(self.database_url)

    def sync_events(self, run_id: str, events: List[Dict[str, Any]]) -> int:
        if not self.enabled:
            return 0
        try:
            import psycopg2
        except ImportError:
            logger.warning("psycopg2 not installed; timeline sync disabled")
            return 0

        inserted = 0
        conn = psycopg2.connect(self.database_url)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO runs (run_id, scenario_id, mode, status)
                    VALUES (%s, 'live', 'prevail', 'running')
                    ON CONFLICT (run_id) DO UPDATE SET status = 'running'
                    """,
                    (run_id,),
                )
                for event in events:
                    key = f"{event.get('timestamp_ms')}:{event.get('event_type')}:{event.get('message')}"
                    if key in self._seen:
                        continue
                    payload = event.get("payload") or {}
                    cur.execute(
                        """
                        INSERT INTO timeline_events
                            (run_id, timestamp_ms, event_type, edge_id, message, payload)
                        VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                        ON CONFLICT (run_id, timestamp_ms, event_type, message) DO NOTHING
                        """,
                        (
                            run_id,
                            event["timestamp_ms"],
                            event["event_type"],
                            event.get("edge_id"),
                            event["message"],
                            json.dumps(payload),
                        ),
                    )
                    if cur.rowcount:
                        self._seen.add(key)
                        inserted += 1
            conn.commit()
        finally:
            conn.close()
        return inserted
