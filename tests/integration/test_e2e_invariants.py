"""E2E invariant tests for PREVAIL authority and shadow semantics."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def _get(url: str, timeout: float = 3.0):
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def _reachable(url: str) -> bool:
    try:
        _get(url)
        return True
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return False


@unittest.skipUnless(os.environ.get("PREVAIL_E2E") == "1", "Set PREVAIL_E2E=1 with stack running")
class E2EInvariantTests(unittest.TestCase):
    BACKEND = os.environ.get("PREVAIL_E2E_BACKEND", "http://127.0.0.1:8000")

    @classmethod
    def setUpClass(cls):
        deadline = time.time() + 30
        while time.time() < deadline:
            if _reachable(f"{cls.BACKEND}/health"):
                return
            time.sleep(1)
        raise unittest.SkipTest("Backend not reachable for E2E")

    def test_single_authority_holder(self):
        snap = _get(f"{self.BACKEND}/v1/snapshot")
        holder = snap["authority"]["holder_edge_id"]
        self.assertIn(holder, {"edge-a", "edge-b", "edge-c", "edge-d"})
        metrics = _get(f"{self.BACKEND}/v1/metrics")
        self.assertTrue(metrics.get("single_authority_invariant", True))

    def test_shadow_output_suppressed(self):
        snap = _get(f"{self.BACKEND}/v1/snapshot")
        for shadow in snap.get("shadows", []):
            if shadow.get("role") == "WARM_SHADOW":
                self.assertTrue(shadow.get("output_suppressed", True))

    def test_prediction_or_degraded_visible(self):
        snap = _get(f"{self.BACKEND}/v1/snapshot")
        if snap.get("prediction"):
            model = snap["prediction"].get("model_version", "")
            if snap.get("predictor_degraded"):
                self.assertIn("degraded", model)
            else:
                self.assertNotEqual(model, "mock-v0")

    def test_vehicle_position_present_after_warmup(self):
        time.sleep(2)
        snap = _get(f"{self.BACKEND}/v1/snapshot")
        self.assertIsNotNone(snap.get("vehicle_latitude"))
        self.assertIsNotNone(snap.get("vehicle_longitude"))

    def test_transfers_include_measured_latency(self):
        snap = _get(f"{self.BACKEND}/v1/snapshot")
        transfers = [
            e for e in snap.get("timeline", []) if e.get("event_type") == "AuthorityTransferred"
        ]
        if not transfers:
            self.skipTest("no AuthorityTransferred yet")
        payload = transfers[-1].get("payload") or {}
        self.assertIn("latency_ms", payload)
        self.assertGreaterEqual(float(payload["latency_ms"]), 0)
        self.assertIn(payload.get("transfer_mode"), {"warm", "reactive"})

    def test_warm_shadows_form_after_warmup(self):
        deadline = time.time() + 30
        shadows = []
        while time.time() < deadline:
            snap = _get(f"{self.BACKEND}/v1/snapshot")
            shadows = snap.get("shadows", [])
            if shadows:
                break
            time.sleep(2)
        self.assertTrue(shadows, "expected at least one warm shadow after warmup")


class UnitInvariantTests(unittest.TestCase):
    def test_golden_handoffs_in_fixture(self):
        fixture = ROOT / "sim" / "fixtures" / "sample-trajectory.jsonl"
        edges = []
        last = None
        for line in fixture.read_text().splitlines():
            edge = json.loads(line)["edge_id"]
            if last and edge != last:
                edges.append((last, edge))
            last = edge
        self.assertIn(("edge-a", "edge-b"), edges)
        self.assertIn(("edge-b", "edge-c"), edges)

    def test_experiment_sweep_runs(self):
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
            timeout=60,
            env=env,
        )
        combined = (result.stdout + result.stderr).lower()
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertTrue("live" in combined or "unavailable" in combined, combined)


if __name__ == "__main__":
    unittest.main()
