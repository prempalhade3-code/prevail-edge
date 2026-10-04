import json
import math
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple


def point_in_polygon(lat: float, lon: float, polygon: List[List[float]]) -> bool:
    """Ray-casting containment test. Polygon vertices are [lat, lon]."""
    inside = False
    n = len(polygon)
    if n < 3:
        return False
    j = n - 1
    for i in range(n):
        yi, xi = polygon[i][0], polygon[i][1]
        yj, xj = polygon[j][0], polygon[j][1]
        intersects = ((xi > lon) != (xj > lon)) and (
            lat < (yj - yi) * (lon - xi) / ((xj - xi) or 1e-12) + yi
        )
        if intersects:
            inside = not inside
        j = i
    return inside


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
        """Map GPS to an edge using region polygons first, then nearest centroid."""
        if not self.regions:
            return "edge-a"

        contained: List[Tuple[str, float]] = []
        nearest_id = None
        min_distance = float("inf")

        for region in self.regions:
            r_lat = region["latitude"]
            r_lon = region["longitude"]
            edge_id = region["edge_id"]
            dist = haversine_distance_m(latitude, longitude, r_lat, r_lon)
            if dist < min_distance:
                min_distance = dist
                nearest_id = edge_id
            if region.get("polygon") and point_in_polygon(latitude, longitude, region["polygon"]):
                contained.append((edge_id, dist))

        if contained:
            contained.sort(key=lambda item: item[1])
            return contained[0][0]

        if max_radius_m is not None and min_distance > max_radius_m:
            return "edge-a"
        return nearest_id or "edge-a"

    def get_region_center(self, edge_id: str) -> Optional[Tuple[float, float]]:
        """Returns (latitude, longitude) center of the specified edge_id."""
        for region in self.regions:
            if region["edge_id"] == edge_id:
                return (region["latitude"], region["longitude"])
        return None
