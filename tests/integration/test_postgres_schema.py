"""Integration test: Postgres schema applies and tables exist."""

import os
import unittest


DB_URL = os.environ.get(
    "PREVAIL_DATABASE_URL",
    "postgresql://prevail:prevail_password@127.0.0.1:5432/prevail",
)


@unittest.skipUnless(
    os.environ.get("PREVAIL_INTEGRATION_TESTS") == "1",
    "Set PREVAIL_INTEGRATION_TESTS=1 and start postgres to run",
)
class PostgresSchemaTest(unittest.TestCase):
    def test_required_tables_exist(self):
        import psycopg2

        conn = psycopg2.connect(DB_URL)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT table_name FROM information_schema.tables
                    WHERE table_schema = 'public'
                    AND table_name IN ('runs', 'timeline_events', 'metric_samples')
                    ORDER BY table_name
                    """
                )
                tables = [row[0] for row in cur.fetchall()]
            self.assertEqual(tables, ["metric_samples", "runs", "timeline_events"])
        finally:
            conn.close()

    def test_seed_run_exists(self):
        import psycopg2

        conn = psycopg2.connect(DB_URL)
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT run_id FROM runs WHERE run_id = 'run-demo-1'")
                row = cur.fetchone()
            self.assertIsNotNone(row)
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
