"""Export a SUMO-shaped FCD JSONL from the corridor config without requiring SUMO."""

from __future__ import annotations

import json
from pathlib import Path

from python.mobility.region_mapper import RegionMapper
from python.mobility.session_config import get_session_id


def write_corridor_fcd(dest: Path, session_id: str | None = None) -> Path:
    mapper = RegionMapper()
    session_id = session_id or get_session_id()
    dest.parent.mkdir(parents=True, exist_ok=True)
    t = 0.0
    with dest.open("w", encoding="utf-8") as fh:
        for region in mapper.regions:
            for step in range(5):
                lat = region["latitude"] + step * 0.0002
                lon = region["longitude"] + step * 0.0002
                fh.write(
                    json.dumps(
                        {
                            "time": t,
                            "vehicle": {
                                "id": session_id,
                                "lat": lat,
                                "lon": lon,
                                "speed": 11.0 + step * 0.2,
                                "angle": 45.0,
                            },
                        }
                    )
                    + "\n"
                )
                t += 1.0
    return dest
