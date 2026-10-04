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
    def __init__(self, database_url: str | None, require_postgres: bool = False):
        self.database_url = database_url
        self._seen: Set[str] = set()
        if require_postgres:
            if not database_url or self._looks_sqlite(database_url):
                raise RuntimeError(
                    "PREVAIL_REQUIRE_POSTGRES=1 but PREVAIL_DATABASE_URL is not PostgreSQL"
                )
        self._init_db()

    @property
    def enabled(self) -> bool:
        return bool(self.database_url)

    @property
    def is_postgres(self) -> bool:
        return bool(self.database_url) and not self._is_sqlite()

    @property
    def engine_name(self) -> str:
        if not self.database_url:
            return "none"
        return "sqlite" if self._is_sqlite() else "postgresql"

    def _looks_sqlite(self, url: str) -> bool:
        return "sqlite" in url or url.endswith(".db")

    def _is_sqlite(self) -> bool:
        return bool(self.database_url and self._looks_sqlite(self.database_url))

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

    def insert_metric(
        self,
        run_id: str,
        metric_name: str,
        value: float,
        edge_id: str | None,
        timestamp_ms: int,
        metadata: Dict[str, Any],
    ) -> int:
        if not self.enabled:
            return 0
        if self._is_sqlite():
            db_path = self.database_url.replace("sqlite:///", "").replace("sqlite://", "")
            try:
                conn = sqlite3.connect(db_path)
                with conn:
                    conn.execute(
                        """
                        INSERT INTO metric_samples
                            (run_id, metric_name, value, edge_id, timestamp_ms, metadata)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (run_id, metric_name, value, edge_id, timestamp_ms, json.dumps(metadata)),
                    )
                conn.close()
                return 1
            except Exception as e:
                logger.warning(f"SQLite metric insert failed: {e}")
                return 0
        try:
            import psycopg2

            conn = psycopg2.connect(self.database_url)
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO metric_samples
                            (run_id, metric_name, value, edge_id, timestamp_ms, metadata)
                        VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                        """,
                        (run_id, metric_name, value, edge_id, timestamp_ms, json.dumps(metadata)),
                    )
                conn.commit()
            finally:
                conn.close()
            return 1
        except Exception as e:
            logger.warning(f"Postgres metric insert failed: {e}")
            return 0

    def list_events(self, run_id: str, limit: int = 200) -> List[Dict[str, Any]]:
        return self._list("timeline_events", run_id, limit)

    def list_metrics(self, run_id: str, limit: int = 200) -> List[Dict[str, Any]]:
        return self._list("metric_samples", run_id, limit, order="timestamp_ms")

    def list_prediction_scored(self, run_id: str | None = None, limit: int = 500) -> List[Dict[str, Any]]:
        """Read PredictionScored timeline rows, optionally scoped to one run."""
        if not self.enabled:
            return []
        if self._is_sqlite():
            db_path = self.database_url.replace("sqlite:///", "").replace("sqlite://", "")
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            if run_id:
                rows = conn.execute(
                    """
                    SELECT run_id, timestamp_ms, edge_id, message, payload
                    FROM timeline_events
                    WHERE event_type = 'PredictionScored' AND run_id = ?
                    ORDER BY timestamp_ms DESC LIMIT ?
                    """,
                    (run_id, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT run_id, timestamp_ms, edge_id, message, payload
                    FROM timeline_events
                    WHERE event_type = 'PredictionScored'
                    ORDER BY timestamp_ms DESC LIMIT ?
                    """,
                    (limit,),
                ).fetchall()
            conn.close()
            return [dict(r) for r in rows]
        try:
            import psycopg2
            import psycopg2.extras

            conn = psycopg2.connect(self.database_url)
            try:
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    if run_id:
                        cur.execute(
                            """
                            SELECT run_id, timestamp_ms, edge_id, message, payload
                            FROM timeline_events
                            WHERE event_type = 'PredictionScored' AND run_id = %s
                            ORDER BY timestamp_ms DESC LIMIT %s
                            """,
                            (run_id, limit),
                        )
                    else:
                        cur.execute(
                            """
                            SELECT run_id, timestamp_ms, edge_id, message, payload
                            FROM timeline_events
                            WHERE event_type = 'PredictionScored'
                            ORDER BY timestamp_ms DESC LIMIT %s
                            """,
                            (limit,),
                        )
                    return [dict(r) for r in cur.fetchall()]
            finally:
                conn.close()
        except Exception as e:
            logger.warning(f"list PredictionScored failed: {e}")
            return []

    def _list(self, table: str, run_id: str, limit: int, order: str = "timestamp_ms") -> List[Dict[str, Any]]:
        if not self.enabled:
            return []
        if self._is_sqlite():
            db_path = self.database_url.replace("sqlite:///", "").replace("sqlite://", "")
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                f"SELECT * FROM {table} WHERE run_id = ? ORDER BY {order} DESC LIMIT ?",
                (run_id, limit),
            ).fetchall()
            conn.close()
            return [dict(r) for r in rows]
        try:
            import psycopg2
            import psycopg2.extras

            conn = psycopg2.connect(self.database_url)
            try:
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute(
                        f"SELECT * FROM {table} WHERE run_id = %s ORDER BY {order} DESC LIMIT %s",
                        (run_id, limit),
                    )
                    return [dict(r) for r in cur.fetchall()]
            finally:
                conn.close()
        except Exception as e:
            logger.warning(f"list {table} failed: {e}")
            return []

