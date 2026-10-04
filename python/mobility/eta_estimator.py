from typing import Tuple, Optional
from .region_mapper import RegionMapper, haversine_distance_m
from .road_graph import RoadGraph


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

    current_edge = region_mapper.get_edge_id(current_gps[0], current_gps[1])
    graph = RoadGraph()
    network_m = graph.shortest_path_m(current_edge, target_edge_id)
    if network_m is None:
        cur_lat, cur_lon = current_gps
        target_lat, target_lon = target_center
        network_m = haversine_distance_m(cur_lat, cur_lon, target_lat, target_lon)
    else:
        # remaining distance inside the current cell toward the next hop
        cur_lat, cur_lon = current_gps
        center_lat, center_lon = region_mapper.get_region_center(current_edge) or current_gps
        network_m += haversine_distance_m(cur_lat, cur_lon, center_lat, center_lon)

    effective_speed = speed_mps if speed_mps > 0.1 else default_speed_mps
    eta_seconds = network_m / effective_speed

    return round(eta_seconds, 2)
