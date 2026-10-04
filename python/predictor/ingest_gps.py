"""Map GPS traces (T-Drive / GeoLife / JSONL) onto the PREVAIL region graph."""

from __future__ import annotations

import argparse
import csv
import json
import math
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

FeaturedStep = Tuple[str, float, float]

from python.mobility.region_mapper import RegionMapper

# Microsoft T-Drive / GeoLife traces are Beijing. Plan §3.4 maps them onto
# the same PREVAIL region graph used at serving time.
BEIJING_LAT = (39.75, 40.15)
BEIJING_LON = (116.15, 116.70)
BANGALORE_LAT = (12.9087, 12.9690)
BANGALORE_LON = (77.6513, 77.7156)


def project_beijing_to_corridor(lat: float, lon: float) -> Tuple[float, float]:
    lat_t = (lat - BEIJING_LAT[0]) / (BEIJING_LAT[1] - BEIJING_LAT[0])
    lon_t = (lon - BEIJING_LON[0]) / (BEIJING_LON[1] - BEIJING_LON[0])
    lat_t = min(1.0, max(0.0, lat_t))
    lon_t = min(1.0, max(0.0, lon_t))
    return (
        BANGALORE_LAT[0] + lat_t * (BANGALORE_LAT[1] - BANGALORE_LAT[0]),
        BANGALORE_LON[0] + lon_t * (BANGALORE_LON[1] - BANGALORE_LON[0]),
    )


def sequences_from_jsonl(path: Path, mapper: RegionMapper | None = None) -> List[List[str]]:
    """Collapse a trajectory JSONL into one edge-id sequence per session."""
    mapper = mapper or RegionMapper()
    by_session: Dict[str, List[str]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        sample = json.loads(line)
        session = sample.get("session_id") or "session"
        edge = sample.get("edge_id")
        if not edge and "latitude" in sample and "longitude" in sample:
            edge = mapper.get_edge_id(float(sample["latitude"]), float(sample["longitude"]))
        if not edge:
            continue
        hist = by_session.setdefault(session, [])
        if not hist or hist[-1] != edge:
            hist.append(edge)
    return [seq for seq in by_session.values() if len(seq) >= 2]


def sequences_from_csv(path: Path, mapper: RegionMapper | None = None) -> List[List[str]]:
    """CSV columns: session_id,latitude,longitude[,timestamp]."""
    mapper = mapper or RegionMapper()
    by_session: Dict[str, List[str]] = {}
    with path.open(encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            session = row.get("session_id") or row.get("taxi_id") or row.get("user") or "session"
            lat = float(row["latitude"] if "latitude" in row else row["lat"])
            lon = float(row["longitude"] if "longitude" in row else row["lon"])
            edge = mapper.get_edge_id(lat, lon)
            hist = by_session.setdefault(session, [])
            if not hist or hist[-1] != edge:
                hist.append(edge)
    return [seq for seq in by_session.values() if len(seq) >= 2]


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1 - a)))


def _bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlmb = math.radians(lon2 - lon1)
    y = math.sin(dlmb) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dlmb)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def _parse_ts(raw: str) -> Optional[float]:
    raw = raw.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f"):
        try:
            return datetime.strptime(raw, fmt).timestamp()
        except ValueError:
            continue
    try:
        return float(raw)
    except ValueError:
        return None


def _append_featured(
    hist: List[FeaturedStep],
    edge: str,
    speed: float,
    heading: float,
) -> None:
    if not hist or hist[-1][0] != edge:
        hist.append((edge, speed, heading))
    else:
        hist[-1] = (edge, speed, heading)


def sequences_from_tdrive(path: Path, mapper: RegionMapper | None = None) -> List[List[str]]:
    """Official T-Drive line format: taxi_id,datetime,longitude,latitude."""
    mapper = mapper or RegionMapper()
    by_taxi: Dict[str, List[str]] = {}
    text = path.read_text(encoding="utf-8", errors="ignore")
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.lower().startswith("taxi"):
            continue
        parts = [p.strip() for p in line.replace("\t", ",").split(",")]
        if len(parts) < 4:
            continue
        try:
            lon = float(parts[2])
            lat = float(parts[3])
        except ValueError:
            continue
        plat, plon = project_beijing_to_corridor(lat, lon)
        edge = mapper.get_edge_id(plat, plon)
        hist = by_taxi.setdefault(parts[0], [])
        if not hist or hist[-1] != edge:
            hist.append(edge)
    return [seq for seq in by_taxi.values() if len(seq) >= 2]


def featured_from_tdrive(path: Path, mapper: RegionMapper | None = None) -> List[List[FeaturedStep]]:
    """Official T-Drive with per-transition speed (m/s) and heading (deg)."""
    mapper = mapper or RegionMapper()
    by_taxi: Dict[str, List[FeaturedStep]] = {}
    prev: Dict[str, Tuple[float, float, float]] = {}
    text = path.read_text(encoding="utf-8", errors="ignore")
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.lower().startswith("taxi"):
            continue
        parts = [p.strip() for p in line.replace("\t", ",").split(",")]
        if len(parts) < 4:
            continue
        try:
            lon = float(parts[2])
            lat = float(parts[3])
        except ValueError:
            continue
        ts = _parse_ts(parts[1]) if len(parts) > 1 else None
        plat, plon = project_beijing_to_corridor(lat, lon)
        edge = mapper.get_edge_id(plat, plon)
        taxi = parts[0]
        speed, heading = 12.0, 90.0
        if taxi in prev:
            plat0, plon0, t0 = prev[taxi]
            dist = _haversine_m(plat0, plon0, plat, plon)
            dt = (ts - t0) if ts is not None and t0 else 0.0
            if dt > 0:
                speed = dist / dt
            heading = _bearing_deg(plat0, plon0, plat, plon)
        if ts is not None:
            prev[taxi] = (plat, plon, ts)
        _append_featured(by_taxi.setdefault(taxi, []), edge, speed, heading)
    return [seq for seq in by_taxi.values() if len(seq) >= 2]


def sequences_from_geolife_plt(path: Path, mapper: RegionMapper | None = None) -> List[List[str]]:
    """Official GeoLife .plt: skip 6 header lines, then lat,lon,*,*,*,date,time."""
    mapper = mapper or RegionMapper()
    seq: List[str] = []
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    body = lines[6:] if len(lines) > 6 else lines
    for raw in body:
        parts = [p.strip() for p in raw.split(",")]
        if len(parts) < 2:
            continue
        try:
            lat = float(parts[0])
            lon = float(parts[1])
        except ValueError:
            continue
        plat, plon = project_beijing_to_corridor(lat, lon)
        edge = mapper.get_edge_id(plat, plon)
        if not seq or seq[-1] != edge:
            seq.append(edge)
    return [seq] if len(seq) >= 2 else []


def featured_from_geolife_plt(path: Path, mapper: RegionMapper | None = None) -> List[List[FeaturedStep]]:
    mapper = mapper or RegionMapper()
    seq: List[FeaturedStep] = []
    prev: Optional[Tuple[float, float, float]] = None
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    body = lines[6:] if len(lines) > 6 else lines
    for raw in body:
        parts = [p.strip() for p in raw.split(",")]
        if len(parts) < 2:
            continue
        try:
            lat = float(parts[0])
            lon = float(parts[1])
        except ValueError:
            continue
        ts = None
        if len(parts) >= 7:
            ts = _parse_ts(f"{parts[5]} {parts[6]}")
        plat, plon = project_beijing_to_corridor(lat, lon)
        edge = mapper.get_edge_id(plat, plon)
        speed, heading = 12.0, 90.0
        if prev is not None:
            plat0, plon0, t0 = prev
            dist = _haversine_m(plat0, plon0, plat, plon)
            dt = (ts - t0) if ts is not None and t0 else 0.0
            if dt > 0:
                speed = dist / dt
            heading = _bearing_deg(plat0, plon0, plat, plon)
        if ts is not None:
            prev = (plat, plon, ts)
        _append_featured(seq, edge, speed, heading)
    return [seq] if len(seq) >= 2 else []


def load_official_sequences(root: Optional[Path] = None) -> List[List[str]]:
    """Load every official T-Drive / GeoLife file under data/official."""
    root = root or Path(__file__).resolve().parent / "data" / "official"
    mapper = RegionMapper()
    sequences: List[List[str]] = []
    for path in sorted((root / "tdrive").glob("*")):
        if path.is_file():
            sequences.extend(sequences_from_tdrive(path, mapper))
    for path in sorted((root / "geolife").glob("*.plt")):
        sequences.extend(sequences_from_geolife_plt(path, mapper))
    return sequences


def load_official_featured_sequences(root: Optional[Path] = None) -> List[List[FeaturedStep]]:
    root = root or Path(__file__).resolve().parent / "data" / "official"
    mapper = RegionMapper()
    sequences: List[List[FeaturedStep]] = []
    for path in sorted((root / "tdrive").glob("*")):
        if path.is_file():
            sequences.extend(featured_from_tdrive(path, mapper))
    for path in sorted((root / "geolife").glob("*.plt")):
        sequences.extend(featured_from_geolife_plt(path, mapper))
    return sequences


def synthesize_geolife_tdrive(
    dest_csv: Path,
    sequences: int = 400,
    seed: int = 7,
) -> Path:
    """Generate GeoLife/T-Drive-shaped GPS CSV labeled on the PREVAIL corridor.

    Real dataset files are not vendored. This produces the same column layout
    (`user,latitude,longitude,timestamp`) used by those traces so the ingest
    path is identical when a researcher drops the official dumps in place.
    """
    import random

    mapper = RegionMapper()
    rng = random.Random(seed)
    dest_csv.parent.mkdir(parents=True, exist_ok=True)
    centers = [(r["edge_id"], r["latitude"], r["longitude"]) for r in mapper.regions]
    with dest_csv.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=["user", "latitude", "longitude", "timestamp"])
        writer.writeheader()
        ts = 1_700_000_000
        for user in range(sequences):
            start = rng.randint(0, len(centers) - 2)
            path = centers[start : start + rng.randint(2, len(centers) - start)]
            if len(path) < 2:
                path = centers[:2]
            for _, lat, lon in path:
                for _dwell in range(rng.randint(3, 8)):
                    writer.writerow(
                        {
                            "user": f"geolife-{user:03d}",
                            "latitude": lat + rng.uniform(-0.001, 0.001),
                            "longitude": lon + rng.uniform(-0.001, 0.001),
                            "timestamp": ts,
                        }
                    )
                    ts += 2
    return dest_csv


def write_sequences(sequences: Iterable[List[str]], dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("w", encoding="utf-8") as fh:
        for seq in sequences:
            fh.write(json.dumps(seq) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Label GPS traces with PREVAIL edge IDs")
    parser.add_argument("--input", required=True, help="JSONL trajectory or lat/lon CSV")
    parser.add_argument(
        "--output",
        default="python/predictor/models/labeled_sequences.jsonl",
    )
    args = parser.parse_args()
    src = Path(args.input)
    mapper = RegionMapper()
    if src.suffix.lower() == ".jsonl":
        sequences = sequences_from_jsonl(src, mapper)
    else:
        sequences = sequences_from_csv(src, mapper)
    write_sequences(sequences, Path(args.output))
    print(f"Wrote {len(sequences)} labeled sequences to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
