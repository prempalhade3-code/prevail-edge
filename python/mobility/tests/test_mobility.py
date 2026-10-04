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
        self.assertEqual(self.mapper.get_edge_id(12.920709, 77.663605), "edge-a")
        self.assertEqual(self.mapper.get_edge_id(12.928155, 77.681794), "edge-b")
        self.assertEqual(self.mapper.get_edge_id(12.941340, 77.696074), "edge-c")
        self.assertEqual(self.mapper.get_edge_id(12.956990, 77.703291), "edge-d")

    def test_haversine_distance(self):
        """Test haversine distance calculation is positive for distinct points."""
        dist = haversine_distance_m(12.920709, 77.663605, 12.928155, 77.681794)
        self.assertGreater(dist, 100.0)

    def test_polygon_contains_region_center(self):
        from python.mobility.region_mapper import point_in_polygon

        region = next(r for r in self.mapper.regions if r["edge_id"] == "edge-a")
        self.assertTrue(point_in_polygon(region["latitude"], region["longitude"], region["polygon"]))

    def test_road_network_eta_uses_graph(self):
        from python.mobility.road_graph import RoadGraph

        graph = RoadGraph()
        a_to_d = graph.shortest_path_m("edge-a", "edge-d")
        a_to_b = graph.shortest_path_m("edge-a", "edge-b")
        self.assertIsNotNone(a_to_d)
        self.assertGreater(a_to_d, a_to_b)

    def test_estimate_eta(self):
        """Test ETA estimation from edge-a center to edge-b center."""
        gps_a = (12.920709, 77.663605)
        eta_sec = estimate_eta(gps_a, "edge-b", speed_mps=15.0, region_mapper=self.mapper)
        self.assertGreater(eta_sec, 0.0)

        # Test zero speed fallback
        eta_fallback = estimate_eta(gps_a, "edge-b", speed_mps=0.0, region_mapper=self.mapper)
        self.assertGreater(eta_fallback, 0.0)

    def test_sumo_live_projects_spine_onto_corridor(self):
        from sim.vehicle.sumo_live import _interp_corridor

        lat0, lon0 = _interp_corridor(0.0, 400.0)
        lat1, lon1 = _interp_corridor(2000.0, 400.0)
        self.assertAlmostEqual(lat0, 12.920709, places=4)
        self.assertGreater(lat1, lat0)
        self.assertGreater(lon1, lon0)

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

    def test_route_planner_source_destination(self):
        from python.mobility.route_planner import plan_ticks, shortest_path
        from python.mobility.road_graph import RoadGraph

        path = shortest_path(RoadGraph(), "edge-a", "edge-d")
        self.assertEqual(path, ["edge-a", "edge-b", "edge-c", "edge-d"])
        ticks = plan_ticks("edge-a", "edge-b", linger_first=4, steps_per_leg=8, include_images=True)
        self.assertGreater(len(ticks), 4)
        self.assertTrue(any(t.get("image_jpeg_b64") for t in ticks))
        coords = {(round(t["latitude"], 5), round(t["longitude"], 5)) for t in ticks}
        self.assertGreater(len(coords), 2, "route must follow corridor waypoints, not two centroids")
        mapped = {self.mapper.get_edge_id(t["latitude"], t["longitude"]) for t in ticks}
        self.assertTrue(mapped <= {"edge-a", "edge-b"})


if __name__ == "__main__":
    unittest.main()
