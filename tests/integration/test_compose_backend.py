"""Compose-system validation for the four Docker edges + Flink JM."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _curl(url: str, timeout: float = 4.0):
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


class ComposeBackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.skip = os.environ.get("PREVAIL_REQUIRE_COMPOSE") != "1"
        result = subprocess.run(
            ["docker", "compose", "-f", str(ROOT / "deploy" / "docker-compose.yml"), "ps", "--format", "json"],
            capture_output=True,
            text=True,
            cwd=str(ROOT),
        )
        cls.compose_up = result.returncode == 0 and bool(result.stdout.strip())

    def test_four_edges_and_jobmanager_when_compose_is_up(self):
        if not self.compose_up:
            if self.skip is False and os.environ.get("PREVAIL_REQUIRE_COMPOSE") == "1":
                self.fail("compose stack is required but not running")
            self.skipTest("compose stack is not running")
        edges = {
            "edge-a": "http://127.0.0.1:8090/health",
            "edge-b": "http://127.0.0.1:8092/health",
            "edge-c": "http://127.0.0.1:8094/health",
            "edge-d": "http://127.0.0.1:8096/health",
        }
        for edge, url in edges.items():
            status, body = _curl(url)
            self.assertEqual(status, 200, edge)
            self.assertEqual(body.get("service"), "prevail-runtime")
        jm = urllib.request.urlopen("http://127.0.0.1:8081/overview", timeout=4)
        self.assertEqual(jm.status, 200)
        overview = json.loads(jm.read().decode("utf-8"))
        self.assertGreaterEqual(int(overview.get("taskmanagers", 0)), 4)
        tms = json.loads(urllib.request.urlopen("http://127.0.0.1:8081/taskmanagers", timeout=4).read())
        ids = " ".join(tm.get("id", "") for tm in tms.get("taskmanagers") or [])
        for edge in ("edge-a", "edge-b", "edge-c", "edge-d"):
            self.assertIn(edge, ids)
        jobs = json.loads(urllib.request.urlopen("http://127.0.0.1:8081/jobs/overview", timeout=4).read())
        running = [j for j in jobs.get("jobs") or [] if j.get("state") == "RUNNING"]
        self.assertGreaterEqual(len(running), 1, "authority Flink job must be running")

    def test_sweep_fails_closed_without_mesh(self):
        env = os.environ.copy()
        env["PREVAIL_BACKEND_URL"] = "http://127.0.0.1:9"
        result = subprocess.run(
            [
                sys.executable,
                str(ROOT / "experiments" / "sweep.py"),
                "--experiment",
                "E1",
                "--scenario",
                str(ROOT / "experiments" / "scenarios" / "golden.json"),
            ],
            capture_output=True,
            text=True,
            cwd=str(ROOT),
            env=env,
        )
        combined = (result.stdout + result.stderr).lower()
        self.assertNotEqual(result.returncode, 0, combined)
        self.assertTrue(
            "unavailable" in combined or "refusing" in combined or "live" in combined,
            combined,
        )


if __name__ == "__main__":
    unittest.main()
