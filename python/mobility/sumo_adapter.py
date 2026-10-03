"""Convert SUMO FCD JSONL export to PREVAIL trajectory samples."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Iterator, List

from python.mobility.region_mapper import RegionMapper


def parse_fcd_line(line: str, mapper: RegionMapper, session_id: str) -> Dict[str, Any] | None:
    raw = json.loads(line)
    # SUMO FCD geo format: {"vehicle": {"id", "x", "y", "speed", "angle", "lat", "lon", ...}}
    vehicle = raw.get("vehicle") or raw
    lat = vehicle.get("lat") or vehicle.get("y")
    lon = vehicle.get("lon") or vehicle.get("x")
    if lat is None or lon is None:
        return None
    lat, lon = float(lat), float(lon)
    return {
        "session_id": session_id,
        "timestamp_ms": int(raw.get("time", 0) * 1000),
        "latitude": round(lat, 6),
        "longitude": round(lon, 6),
        "speed_mps": round(float(vehicle.get("speed", 0)), 2),
        "edge_id": mapper.get_edge_id(lat, lon),
        "heading_deg": round(float(vehicle.get("angle", 0)), 1),
    }


def fcd_to_trajectory_jsonl(
    fcd_path: Path,
    out_path: Path,
    session_id: str,
) -> int:
    mapper = RegionMapper()
    count = 0
    with fcd_path.open(encoding="utf-8") as src, out_path.open("w", encoding="utf-8") as dst:
        for line in src:
            line = line.strip()
            if not line:
                continue
            sample = parse_fcd_line(line, mapper, session_id)
            if sample:
                dst.write(json.dumps(sample) + "\n")
                count += 1
    return count


def iter_fcd_samples(fcd_path: Path, session_id: str) -> Iterator[Dict[str, Any]]:
    mapper = RegionMapper()
    for line in fcd_path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            sample = parse_fcd_line(line, mapper, session_id)
            if sample:
                yield sample


class SUMOAdapter:
    """Translates SUMO FCD export into PREVAIL trajectory JSONL."""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.mapper = RegionMapper()

    def convert_file(self, fcd_path: Path, out_path: Path) -> int:
        return fcd_to_trajectory_jsonl(fcd_path, out_path, self.session_id)

    def parse_line(self, line: str) -> Dict[str, Any] | None:
        return parse_fcd_line(line, self.mapper, self.session_id)
