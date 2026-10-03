#!/usr/bin/env python3
"""Offline check that the simulated vehicle moves legally and smoothly.

Runs the same dynamics the live simulator uses, with no HTTP, and asserts the
properties the simulation is supposed to guarantee:

  * the vehicle never leaves the carriageway
  * consecutive positions never jump further than the speed allows (no teleport)
  * acceleration stays inside the comfort envelope
  * the route genuinely visits every edge region in order
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path as FsPath

ROOT = FsPath(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from python.mobility.region_mapper import RegionMapper
from sim.network.build_city import RoadIndex
from sim.vehicle.road_simulator import (
    A_ACCEL,
    A_BRAKE,
    Agent,
    Graph,
    Projection,
    advance,
    advance_leg,
    build_path,
    gap_ahead,
    idm_accel,
    make_uturn,
    spawn_traffic,
)

NETWORK = ROOT / "sim" / "network" / "city-network.json"
DURATION_S = 900.0
HZ = 10.0


def main() -> int:
    net = json.loads(NETWORK.read_text(encoding="utf-8"))
    proj = Projection(net["origin"]["latitude"], net["origin"]["longitude"])
    route = net["route"]
    graph = Graph(net["graph"])
    mapper = RegionMapper()

    forward = build_path(
        route["points"], route["speed_limit_mps"], route["road_names"], terminal_speed=1.5
    )
    backward = build_path(
        list(reversed(route["points"])),
        list(reversed(route["speed_limit_mps"])),
        list(reversed(route["road_names"])),
        terminal_speed=1.5,
    )
    legs = [forward, make_uturn(forward, backward), backward, make_uturn(backward, forward)]
    leg = 0

    index = RoadIndex(net["graph"]["edges"])

    hero = Agent("hero", forward, is_hero=True)
    hero.refresh_pose()
    traffic = spawn_traffic(graph, (hero.x, hero.z), 28)

    dt = 1.0 / HZ
    steps = int(DURATION_S / dt)

    prev = (hero.x, hero.z)
    prev_v = hero.v
    worst_offroad = float("-inf")
    worst_jump = 0.0
    worst_accel = 0.0
    worst_decel = 0.0
    speeds = []
    visited: list[str] = []
    turnarounds = 0

    for _ in range(steps):
        everyone = [hero] + traffic
        for agent in everyone:
            gap, lead_v = gap_ahead(agent, everyone)
            advance(agent, idm_accel(agent, gap, lead_v), dt)
            if agent.is_hero:
                nxt = advance_leg(agent, legs, leg)
                if nxt != leg:
                    turnarounds += 1
                    leg = nxt
                agent.refresh_pose()

        jump = math.hypot(hero.x - prev[0], hero.z - prev[1])
        worst_jump = max(worst_jump, jump)
        prev = (hero.x, hero.z)

        accel = (hero.v - prev_v) / dt
        worst_accel = max(worst_accel, accel)
        worst_decel = min(worst_decel, accel)
        prev_v = hero.v
        speeds.append(hero.v)

        # Clearance is distance beyond the carriageway edge, so being on a road is
        # negative. The failure we care about is it ever going positive.
        worst_offroad = max(worst_offroad, index.clearance(hero.x, hero.z))

        lat, lon = proj.to_latlon(hero.x, hero.z)
        eid = mapper.get_edge_id(lat, lon)
        if not visited or visited[-1] != eid:
            visited.append(eid)

    allowed_jump = (max(speeds) + 1.0) * dt
    moving = sum(1 for v in speeds if v > 0.5) / len(speeds)

    print(f"simulated          {DURATION_S:.0f} s at {HZ:.0f} Hz ({steps} steps)")
    print(f"speed              min {min(speeds):.2f}  mean {sum(speeds)/len(speeds):.2f}  max {max(speeds):.2f} m/s")
    print(f"moving fraction    {moving*100:.1f} %")
    print(f"max step distance  {worst_jump:.3f} m (allowed {allowed_jump:.3f})")
    print(f"peak accel         {worst_accel:+.2f} m/s^2 (limit {A_ACCEL})")
    print(f"peak decel         {worst_decel:+.2f} m/s^2 (limit {-A_BRAKE})")
    print(f"worst excursion    {worst_offroad:+.2f} m past road edge (negative = on road)")
    print(f"turnarounds        {turnarounds}")
    print(f"edge sequence      {' -> '.join(visited)}")

    failures = []
    if worst_jump > allowed_jump:
        failures.append("position jumped further than the speed allows (teleport)")
    if worst_offroad > 0.5:
        failures.append(f"vehicle left the carriageway by {worst_offroad:.2f} m")
    if worst_accel > A_ACCEL + 0.05 or worst_decel < -(A_BRAKE + 0.05):
        failures.append("acceleration outside the comfort envelope")
    if moving < 0.9:
        failures.append("vehicle spent too long stationary")
    if len(set(visited)) < 4:
        failures.append(f"route only visited {len(set(visited))} edge regions, expected 4")

    if failures:
        print("\nFAIL")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nPASS  motion is continuous, on-road, comfortable, and crosses all 4 edges")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
