"""Spawn believable edge-computing infrastructure in CARLA."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

ROLE_COLORS = {
    "AUTHORITATIVE": (0, 200, 120),
    "WARM_SHADOW": (255, 180, 0),
    "IDLE": (120, 130, 150),
}


def _try_prop(world: Any, blueprint_library: Any, name: str, transform: Any) -> Optional[Any]:
    try:
        bp = blueprint_library.find(name)
        if bp is None:
            return None
        return world.try_spawn_actor(bp, transform)
    except Exception:
        return None


def spawn_edge_installation(
    world: Any,
    blueprint_library: Any,
    carla_module: Any,
    x: float,
    y: float,
    z: float,
    edge_id: str,
    role: str,
) -> List[Any]:
    """Build roadside edge node from stacked CARLA static props + light."""
    actors: List[Any] = []
    loc = carla_module.Location(x=x, y=y, z=z)
    rot = carla_module.Rotation(pitch=0, yaw=0, roll=0)

    # Elevated platform (bus shelter + barriers as cabinet cluster)
    base = _try_prop(
        world,
        blueprint_library,
        "static.prop.busstop",
        carla_module.Transform(loc + carla_module.Location(z=0), rot),
    )
    if base:
        actors.append(base)

    for i, offset in enumerate([-1.2, 0, 1.2]):
        pole = _try_prop(
            world,
            blueprint_library,
            "static.prop.streetbarrier",
            carla_module.Transform(
                loc + carla_module.Location(x=offset * 100, z=150),
                carla_module.Rotation(pitch=0, yaw=90, roll=0),
            ),
        )
        if pole:
            actors.append(pole)

    # Antenna mast
    mast = _try_prop(
        world,
        blueprint_library,
        "static.prop.trafficcone",
        carla_module.Transform(loc + carla_module.Location(z=350), rot),
    )
    if mast:
        actors.append(mast)

    # Status light
    r, g, b = ROLE_COLORS.get(role, ROLE_COLORS["IDLE"])
    try:
        light_bp = blueprint_library.find("static.prop.streetbarrier")
        if light_bp:
            light_bp.set_attribute("color", f"{r},{g},{b}")
    except Exception:
        pass

    return actors


def sync_edge_topology(
    world: Any,
    blueprint_library: Any,
    carla_module: Any,
    topology: List[Dict[str, Any]],
    geo_to_carla_fn: Any,
    existing: Dict[str, List[Any]],
) -> Dict[str, List[Any]]:
    """Create/update edge installations from PREVAIL topology snapshot."""
    seen = set()
    for node in topology:
        eid = node.get("edge_id", "")
        seen.add(eid)
        if eid in existing:
            continue
        t = geo_to_carla_fn(node["latitude"], node["longitude"])
        existing[eid] = spawn_edge_installation(
            world,
            blueprint_library,
            carla_module,
            t.x,
            t.y,
            t.z + 50,
            eid,
            node.get("role", "IDLE"),
        )
    return existing
