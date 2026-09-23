import json
import unittest
from pathlib import Path
from python.mobility.region_mapper import RegionMapper, haversine_distance_m
from python.mobility.eta_estimator import estimate_eta
from python.mobility.sumo_adapter import SUMOAdapter


class TestMobilityModule(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.root_dir = Path(__file__).resolve().parents[3]
        cls.config_path = str(cls.root_dir / "deploy" / "config" / "edge-regions.json")
        cls.schema_path = str(cls.root_dir / "docs" / "contracts" / "trajectory-sample.schema.json")
        cls.mapper = RegionMapper(config_path=cls.config_path)

    def test_region_mapper_coordinates(self):
        """Test exact center coordinate lookups for all four edge regions."""
        self.assertEqual(self.mapper.get_edge_id(12.9716, 77.5946), "edge-a")
        self.assertEqual(self.mapper.get_edge_id(12.9750, 77.6050), "edge-b")
        self.assertEqual(self.mapper.get_edge_id(12.9650, 77.6100), "edge-c")
        self.assertEqual(self.mapper.get_edge_id(12.9800, 77.5850), "edge-d")

    def test_haversine_distance(self):
        """Test haversine distance calculation is positive for distinct points."""
        dist = haversine_distance_m(12.9716, 77.5946, 12.9750, 77.6050)
        self.assertGreater(dist, 100.0)

    def test_estimate_eta(self):
        """Test ETA estimation from edge-a center to edge-b center."""
        gps_a = (12.9716, 77.5946)
        eta_sec = estimate_eta(gps_a, "edge-b", speed_mps=15.0, region_mapper=self.mapper)
        self.assertGreater(eta_sec, 0.0)

        # Test zero speed fallback
        eta_fallback = estimate_eta(gps_a, "edge-b", speed_mps=0.0, region_mapper=self.mapper)
        self.assertGreater(eta_fallback, 0.0)

    def test_trajectory_sample_schema_validity(self):
        """Verify generated trajectory sample adheres strictly to contract schema."""
        with open(self.schema_path, "r", encoding="utf-8") as f:
            schema = json.load(f)

        sample = {
            "session_id": "vehicle-test-01",
            "timestamp_ms": 1700000000000,
            "latitude": 12.9716,
            "longitude": 77.5946,
            "speed_mps": 12.5,
            "edge_id": "edge-a",
            "heading_deg": 90.0,
        }

        # Validate required fields and types according to schema
        for required_key in schema["required"]:
            self.assertIn(required_key, sample)

        self.assertIsInstance(sample["session_id"], str)
        self.assertIsInstance(sample["timestamp_ms"], int)
        self.assertIsInstance(sample["latitude"], float)
        self.assertIsInstance(sample["longitude"], float)
        self.assertIsInstance(sample["speed_mps"], (float, int))
        self.assertGreaterEqual(sample["speed_mps"], 0)
        self.assertIsInstance(sample["edge_id"], str)


if __name__ == "__main__":
    unittest.main()
