"""Geographic ↔ CARLA world coordinate mapping for Bangalore corridor."""

from __future__ import annotations

import math
from dataclasses import dataclass

# Geo anchor (MG Road / edge-a)
ORIGIN_LAT = 12.9716
ORIGIN_LON = 77.5946

# CARLA Town10HD anchor (meters, UE coordinate system)
CARLA_ANCHOR_X = -104.5
CARLA_ANCHOR_Y = 44.3
CARLA_GROUND_Z = 0.35

M_PER_DEG_LAT = 111_320.0
M_PER_DEG_LON = M_PER_DEG_LAT * math.cos(math.radians(ORIGIN_LAT))


@dataclass
class CarlaTransform:
    x: float  # UE cm
    y: float
    z: float
    yaw: float  # degrees


def geo_to_carla(lat: float, lon: float, heading_deg: float = 0.0) -> CarlaTransform:
    """Map WGS84 to CARLA location (centimeters)."""
    east_m = (lon - ORIGIN_LON) * M_PER_DEG_LON
    north_m = (lat - ORIGIN_LAT) * M_PER_DEG_LAT
    # CARLA: X forward (east), Y right (south), Z up
    x_cm = (CARLA_ANCHOR_X + east_m) * 100.0
    y_cm = (CARLA_ANCHOR_Y - north_m) * 100.0
    # PREVAIL heading: 0=north, clockwise → CARLA yaw (0= east in UE, counter from X)
    yaw = heading_deg - 90.0
    return CarlaTransform(x=x_cm, y=y_cm, z=CARLA_GROUND_Z * 100.0, yaw=yaw)


def carla_to_geo(x_cm: float, y_cm: float) -> tuple[float, float]:
    east_m = (x_cm / 100.0) - CARLA_ANCHOR_X
    north_m = CARLA_ANCHOR_Y - (y_cm / 100.0)
    lat = ORIGIN_LAT + north_m / M_PER_DEG_LAT
    lon = ORIGIN_LON + east_m / M_PER_DEG_LON
    return lat, lon
