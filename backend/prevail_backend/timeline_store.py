"""Database persistence for timeline events from the runtime (Postgres & SQLite support)."""

from __future__ import annotations

import json
import logging
import sqlite3
from typing import Any, Dict, List, Set

logger = logging.getLogger(__name__)


SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT UNIQUE NOT NULL,
    scenario_id TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'prevail',
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    status TEXT NOT NULL DEFAULT 'running'
);

CREATE TABLE IF NOT EXISTS timeline_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    timestamp_ms BIGINT NOT NULL,
    event_type TEXT NOT NULL,
    edge_id TEXT,
    message TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(run_id, timestamp_ms, event_type, message)
);

CREATE TABLE IF NOT EXISTS metric_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    value REAL NOT NULL,
    edge_id TEXT,
    timestamp_ms BIGINT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}'
);
"""


class TimelineStore:
    def __init__(self, database_url: str | None):
        self.database_url = database_url
        self._seen: Set[str] = set()
        self._init_db()

    @property
    def enabled(self) -> bool:
        return bool(self.database_url)

    def _is_sqlite(self) -> bool:
        return bool(self.database_url and ("sqlite" in self.database_url or self.database_url.endswith(".db")))

    def _init_db(self) -> None:
        if not self.enabled:
            return
        if self._is_sqlite():
            try:
                db_path = self.database_url.replace("sqlite:///", "").replace("sqlite://", "")
                conn = sqlite3.connect(db_path)
                with conn:
                    conn.executescript(SQLITE_SCHEMA)
                conn.close()
            except Exception as e:
                logger.warning(f"Failed to initialize SQLite timeline store: {e}")

    def sync_events(self, run_id: str, events: List[Dict[str, Any]]) -> int:
        if not self.enabled:
            return 0

        if self._is_sqlite():
            return self._sync_sqlite(run_id, events)
        else:
            return self._sync_postgres(run_id, events)

    def _sync_sqlite(self, run_id: str, events: List[Dict[str, Any]]) -> int:
        inserted = 0
        db_path = self.database_url.replace("sqlite:///", "").replace("sqlite://", "")
        try:
            conn = sqlite3.connect(db_path)
            with conn:
                conn.execute(
                    """
                    INSERT INTO runs (run_id, scenario_id, mode, status)
                    VALUES (?, 'live', 'prevail', 'running')
                    ON CONFLICT(run_id) DO UPDATE SET status = 'running'
                    """,
                    (run_id,),
                )
                for event in events:
                    key = f"{event.get('timestamp_ms')}:{event.get('event_type')}:{event.get('message')}"
                    if key in self._seen:
                        continue
                    payload = event.get("payload") or {}
                    try:
                        conn.execute(
                            """
                            INSERT INTO timeline_events
                                (run_id, timestamp_ms, event_type, edge_id, message, payload)
                            VALUES (?, ?, ?, ?, ?, ?)
                            ON CONFLICT(run_id, timestamp_ms, event_type, message) DO NOTHING
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
                        self._seen.add(key)
                        inserted += 1
                    except sqlite3.IntegrityError:
                        pass
            conn.close()
        except Exception as e:
            logger.warning(f"SQLite timeline sync failed: {e}")
        return inserted

    def _sync_postgres(self, run_id: str, events: List[Dict[str, Any]]) -> int:
        try:
            import psycopg2
        except ImportError:
            logger.warning("psycopg2 not installed; timeline sync disabled")
            return 0

        inserted = 0
        try:
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
        except Exception as e:
            logger.warning(f"Postgres timeline sync failed: {e}")
        return inserted

