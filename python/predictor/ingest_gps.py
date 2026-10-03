"""Map GPS traces (T-Drive / GeoLife / JSONL) onto the PREVAIL region graph."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Dict, Iterable, List

from python.mobility.region_mapper import RegionMapper


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
