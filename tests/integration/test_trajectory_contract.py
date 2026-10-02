"""Integration test: trajectory fixture validates against contract schema."""

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / "docs" / "contracts" / "trajectory-sample.schema.json").read_text())
FIXTURE = ROOT / "sim" / "fixtures" / "sample-trajectory.jsonl"
REGIONS = ROOT / "deploy" / "config" / "edge-regions.json"
REQUIRED_FIELDS = set(SCHEMA.get("required", []))


def validate_trajectory_sample(sample: dict) -> None:
    missing = REQUIRED_FIELDS - set(sample.keys())
    if missing:
        raise AssertionError(f"Missing required fields: {missing}")
    if sample.get("edge_id") is None:
        raise AssertionError("edge_id must be present")


class TrajectoryContractTest(unittest.TestCase):
    def test_fixture_lines_match_schema(self):
        self.assertTrue(FIXTURE.exists(), "sample-trajectory.jsonl missing")
        for line in FIXTURE.read_text(encoding="utf-8").splitlines():
            if line.strip():
                sample = json.loads(line)
                validate_trajectory_sample(sample)

    def test_fixture_edge_ids_exist_in_region_config(self):
        region_ids = {r["edge_id"] for r in json.loads(REGIONS.read_text())["regions"]}
        for line in FIXTURE.read_text(encoding="utf-8").splitlines():
            if line.strip():
                sample = json.loads(line)
                self.assertIn(sample["edge_id"], region_ids)

    def test_wrong_region_file_has_no_overlap(self):
        """Wrong region config should not contain fixture edge IDs (negative test helper)."""
        wrong_ids = {"edge-x", "edge-y", "edge-z"}
        fixture_edges = set()
        for line in FIXTURE.read_text(encoding="utf-8").splitlines():
            if line.strip():
                fixture_edges.add(json.loads(line)["edge_id"])
        self.assertFalse(fixture_edges & wrong_ids)


if __name__ == "__main__":
    unittest.main()
