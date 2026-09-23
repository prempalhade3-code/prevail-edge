from typing import Tuple, Optional
from .region_mapper import RegionMapper, haversine_distance_m


def estimate_eta(
    current_gps: Tuple[float, float],
    target_edge_id: str,
    speed_mps: float,
    region_mapper: Optional[RegionMapper] = None,
    default_speed_mps: float = 10.0,
) -> float:
    """
    Estimates ETA in seconds for a vehicle at current_gps moving towards target_edge_id.
    
    Args:
        current_gps: (latitude, longitude) tuple of vehicle
        target_edge_id: Target edge ID string (e.g. 'edge-b')
        speed_mps: Current speed in meters per second
        region_mapper: Optional RegionMapper instance (loads default if None)
        default_speed_mps: Default speed fallback if speed_mps <= 0

    Returns:
        Estimated travel time in seconds (float)
    """
    if region_mapper is None:
        region_mapper = RegionMapper()

    target_center = region_mapper.get_region_center(target_edge_id)
    if not target_center:
        # Unknown edge region fallback
        return 0.0

    cur_lat, cur_lon = current_gps
    target_lat, target_lon = target_center

    distance_m = haversine_distance_m(cur_lat, cur_lon, target_lat, target_lon)

    effective_speed = speed_mps if speed_mps > 0.1 else default_speed_mps
    eta_seconds = distance_m / effective_speed

    return round(eta_seconds, 2)
