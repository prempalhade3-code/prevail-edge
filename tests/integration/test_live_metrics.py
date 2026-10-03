"""Unit tests for live timeline metric parsing (no invented 45/550)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from experiments.metrics import parse_timeline  # noqa: E402


class LiveMetricsTests(unittest.TestCase):
    def test_splits_warm_and_reactive_from_latency_ms(self):
        events = [
            {
                "event_type": "HandoffDetected",
                "timestamp_ms": 1000,
                "edge_id": "edge-b",
                "payload": {"to_edge": "edge-b"},
            },
            {
                "event_type": "AuthorityTransferred",
                "timestamp_ms": 1080,
                "edge_id": "edge-b",
                "payload": {"to": "edge-b", "latency_ms": "80", "transfer_mode": "warm"},
            },
            {
                "event_type": "HandoffDetected",
                "timestamp_ms": 2000,
                "edge_id": "edge-c",
                "payload": {"to_edge": "edge-c"},
            },
            {
                "event_type": "AuthorityTransferred",
                "timestamp_ms": 2400,
                "edge_id": "edge-c",
                "message": "Authority transferred via reactive migration",
                "payload": {"to": "edge-c", "latency_ms": "400", "transfer_mode": "reactive"},
            },
            {"event_type": "WrongPrediction", "timestamp_ms": 2401, "payload": {}},
        ]
        parsed = parse_timeline(events)
        self.assertEqual(parsed["warm_count"], 1)
        self.assertEqual(parsed["reactive_count"], 1)
        self.assertEqual(parsed["warm_latency_ms"], 80)
        self.assertEqual(parsed["reactive_latency_ms"], 400)
        self.assertEqual(parsed["wrong_prediction_count"], 1)
        self.assertLess(parsed["prediction_accuracy"], 1.0)

    def test_empty_timeline_is_zero_not_fake(self):
        parsed = parse_timeline([])
        self.assertEqual(parsed["handoff_count"], 0)
        self.assertEqual(parsed["migration_latency_ms"], 0)


if __name__ == "__main__":
    unittest.main()
