import json
import math
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple


def haversine_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great circle distance between two points on the Earth in meters."""
    R = 6371000.0  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


class RegionMapper:
    """Maps GPS coordinates (latitude, longitude) to the nearest edge region ID."""

    def __init__(self, config_path: Optional[str] = None):
        if config_path is None:
            # Default location relative to workspace root
            root_dir = Path(__file__).resolve().parents[2]
            config_path = str(root_dir / "deploy" / "config" / "edge-regions.json")

        self.config_path = config_path
        self.regions: List[Dict[str, Any]] = []
        self.load_regions()

    def load_regions(self):
        """Loads region metadata from JSON configuration."""
        path = Path(self.config_path)
        if not path.exists():
            raise FileNotFoundError(f"Edge regions config file not found: {self.config_path}")

        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            self.regions = data.get("regions", [])

    def get_edge_id(self, latitude: float, longitude: float, max_radius_m: Optional[float] = None) -> str:
        """
        Finds the closest edge ID for given GPS coordinates.
        If max_radius_m is specified, only matches if within that distance;
        otherwise returns closest region or falls back to 'edge-a'.
        """
        if not self.regions:
            return "edge-a"

        best_edge_id = None
        min_distance = float("inf")

        for region in self.regions:
            r_lat = region["latitude"]
            r_lon = region["longitude"]
            edge_id = region["edge_id"]
            dist = haversine_distance_m(latitude, longitude, r_lat, r_lon)

            if dist < min_distance:
                min_distance = dist
                best_edge_id = edge_id

        if max_radius_m is not None and min_distance > max_radius_m:
            return "edge-a"

        return best_edge_id or "edge-a"

    def get_region_center(self, edge_id: str) -> Optional[Tuple[float, float]]:
        """Returns (latitude, longitude) center of the specified edge_id."""
        for region in self.regions:
            if region["edge_id"] == edge_id:
                return (region["latitude"], region["longitude"])
        return None
