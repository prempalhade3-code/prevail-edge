#!/usr/bin/env python3
"""Generate an expanded Bangalore corridor road network for 3D sim + SUMO."""
from __future__ import annotations

import json
from pathlib import Path

ORIGIN = (77.5946, 12.9716)


def line(name: str, coords, lanes=2, speed=13.9):
    return {
        "type": "Feature",
        "properties": {"name": name, "lanes": lanes, "speed_limit_mps": speed},
        "geometry": {"type": "LineString", "coordinates": coords},
    }


def main():
    features = [
        # Main arterial spine (west → east → south)
        line("MG-Road-East-Spine", [
            [77.5850, 12.9800], [77.5885, 12.9785], [77.5910, 12.9765],
            [77.5930, 12.9745], [77.5946, 12.9716], [77.5965, 12.9720],
            [77.5990, 12.9735], [77.6015, 12.9745], [77.6040, 12.9752],
            [77.6050, 12.9750], [77.6065, 12.9735], [77.6080, 12.9710],
            [77.6095, 12.9685], [77.6100, 12.9650],
        ], lanes=4, speed=16.7),
        line("North-Loop-Connector", [
            [77.5946, 12.9716], [77.5920, 12.9730], [77.5890, 12.9755],
            [77.5865, 12.9780], [77.5850, 12.9800],
        ], lanes=2, speed=11.1),
        line("East-South-Highway", [
            [77.6050, 12.9750], [77.6070, 12.9720], [77.6085, 12.9690], [77.6100, 12.9650],
        ], lanes=3, speed=19.4),
        # Grid arterials
        line("West-Boulevard", [
            [77.5850, 12.9800], [77.5850, 12.9760], [77.5850, 12.9720], [77.5850, 12.9680],
        ], lanes=3, speed=13.9),
        line("Central-Avenue", [
            [77.5890, 12.9785], [77.5920, 12.9785], [77.5950, 12.9785], [77.5980, 12.9785],
        ], lanes=3, speed=13.9),
        line("South-Ring", [
            [77.5850, 12.9680], [77.5900, 12.9680], [77.5950, 12.9680], [77.6000, 12.9680], [77.6100, 12.9650],
        ], lanes=4, speed=16.7),
        # Cross streets
        *[
            line(f"Cross-{i}", [
                [77.5850 + i * 0.005, 12.9785],
                [77.5850 + i * 0.005, 12.9750],
                [77.5850 + i * 0.005, 12.9716],
                [77.5850 + i * 0.005, 12.9680],
            ], lanes=2, speed=11.1)
            for i in range(1, 6)
        ],
        # Connector loops
        line("Tech-Park-Loop", [
            [77.5980, 12.9785], [77.6000, 12.9770], [77.6020, 12.9755], [77.6040, 12.9752],
        ], lanes=2, speed=11.1),
        line("Market-Street", [
            [77.5910, 12.9765], [77.5930, 12.9755], [77.5950, 12.9748], [77.5965, 12.9720],
        ], lanes=2, speed=9.7),
    ]

    fc = {"type": "FeatureCollection", "name": "bangalore-prevail-corridor", "features": features}
    out = Path(__file__).with_name("bangalore-corridor.geojson")
    out.write_text(json.dumps(fc, indent=2), encoding="utf-8")
    print(f"Wrote {len(features)} features → {out}")


if __name__ == "__main__":
    main()
