"""Integration test: experiment runner dry-run on golden scenario."""

import os
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class ExperimentRunnerTest(unittest.TestCase):
    def test_golden_scenario_dry_run(self):
        env = os.environ.copy()
        env["PREVAIL_BACKEND_URL"] = "http://127.0.0.1:9"
        result = subprocess.run(
            [
                sys.executable,
                str(ROOT / "experiments" / "runner.py"),
                "--scenario",
                str(ROOT / "experiments" / "scenarios" / "golden.json"),
                "--dry-run",
            ],
            capture_output=True,
            text=True,
            cwd=str(ROOT),
            env=env,
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertIn("handoff_count", result.stdout)
        self.assertIn("migration_latency_ms", result.stdout)

    def test_empty_stream_file_rejected(self):
        empty = ROOT / "tests" / "integration" / "fixtures" / "empty.yaml"
        empty.parent.mkdir(parents=True, exist_ok=True)
        empty.write_text(
            "id: empty\nstream_file: tests/integration/fixtures/missing.jsonl\n"
            "session_id: x\nmode: baseline\nrepeats: 1\n",
            encoding="utf-8",
        )
        result = subprocess.run(
            [sys.executable, str(ROOT / "experiments" / "runner.py"), "--scenario", str(empty), "--dry-run"],
            capture_output=True,
            text=True,
            cwd=str(ROOT),
        )
        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
