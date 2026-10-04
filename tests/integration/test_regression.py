"""Same-scenario metric regression: two dry runs stay within tolerance."""

from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class RegressionTests(unittest.TestCase):
    def setUp(self):
        import os
        os.environ["PREVAIL_BACKEND_URL"] = "http://127.0.0.1:9"

    def test_golden_baseline_is_deterministic(self):
        from experiments.runner import load_scenario, read_trajectory_samples, simulate_baseline_migration

        scenario = load_scenario(ROOT / "experiments" / "scenarios" / "golden.yaml")
        samples = read_trajectory_samples(scenario.stream_file)
        first = simulate_baseline_migration(scenario, samples)
        second = simulate_baseline_migration(scenario, samples)
        self.assertEqual(first["handoff_count"], second["handoff_count"])
        self.assertAlmostEqual(
            first["migration_latency_ms"],
            second["migration_latency_ms"],
            places=4,
        )

    def test_e2_requires_live_mesh(self):
        import os
        from experiments.runner import load_scenario, read_trajectory_samples
        from experiments.sweep import sweep_e2

        os.environ["PREVAIL_BACKEND_URL"] = "http://127.0.0.1:9"
        scenario = load_scenario(ROOT / "experiments" / "scenarios" / "golden.yaml")
        samples = read_trajectory_samples(scenario.stream_file)
        with self.assertRaises(RuntimeError):
            sweep_e2(scenario, samples)

    def test_live_regression_two_drives_stay_consistent(self):
        import os
        import urllib.request

        os.environ.pop("PREVAIL_BACKEND_URL", None)
        try:
            urllib.request.urlopen("http://127.0.0.1:8090/health", timeout=2)
        except Exception:
            self.fail("live mesh is required for regression; start scripts/ensure-mesh.sh")

        from experiments.live_session import drive_trajectory
        from experiments.metrics import fetch_live_metrics
        from experiments.runner import load_scenario, read_trajectory_samples

        scenario = load_scenario(ROOT / "experiments" / "scenarios" / "golden.yaml")
        samples = read_trajectory_samples(scenario.stream_file)
        drive_trajectory(samples[:8], delay_s=0.03)
        first = fetch_live_metrics()
        self.assertIsNotNone(first)
        drive_trajectory(samples[:8], delay_s=0.03)
        second = fetch_live_metrics()
        self.assertIsNotNone(second)
        self.assertGreaterEqual(second["handoff_count"], first["handoff_count"])
        self.assertIn("tee_bytes", second)
        self.assertIn("topk_top1", second)

    def test_same_scenario_offline_baseline_is_stable(self):
        from experiments.runner import load_scenario, read_trajectory_samples, simulate_baseline_migration

        scenario = load_scenario(ROOT / "experiments" / "scenarios" / "golden.yaml")
        samples = read_trajectory_samples(scenario.stream_file)
        a = simulate_baseline_migration(scenario, samples)
        b = simulate_baseline_migration(scenario, samples)
        self.assertEqual(a["samples_processed"], b["samples_processed"])
