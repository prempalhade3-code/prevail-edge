import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import List, Dict, Any, Optional

# Ensure workspace root is in path to import python.mobility
root_dir = Path(__file__).resolve().parents[2]
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from python.mobility.region_mapper import RegionMapper


DETERMINISTIC_WAYPOINTS: List[Dict[str, Any]] = [
    {"lat": 12.9716, "lon": 77.5946, "speed": 10.0, "heading": 45.0, "expected_edge": "edge-a"},
    {"lat": 12.9720, "lon": 77.5950, "speed": 12.0, "heading": 45.0, "expected_edge": "edge-a"},
    {"lat": 12.9745, "lon": 77.6045, "speed": 14.0, "heading": 60.0, "expected_edge": "edge-b"},
    {"lat": 12.9750, "lon": 77.6050, "speed": 15.0, "heading": 60.0, "expected_edge": "edge-b"},
    {"lat": 12.9650, "lon": 77.6100, "speed": 11.0, "heading": 135.0, "expected_edge": "edge-c"},
]


def generate_trace_samples(
    session_id: str = "sim-vehicle-01",
    config_path: str = None,
) -> List[Dict[str, Any]]:
    """Generates the contract-valid deterministic trajectory trace A -> A -> B -> B -> C."""
    mapper = RegionMapper(config_path=config_path)
    samples = []
    base_time_ms = int(time.time() * 1000)

    for idx, wp in enumerate(DETERMINISTIC_WAYPOINTS):
        edge_id = mapper.get_edge_id(wp["lat"], wp["lon"])
        sample = {
            "session_id": session_id,
            "timestamp_ms": base_time_ms + (idx * 2000),
            "latitude": wp["lat"],
            "longitude": wp["lon"],
            "speed_mps": wp["speed"],
            "edge_id": edge_id,
            "heading_deg": wp["heading"],
        }
        samples.append(sample)

    return samples


def post_sample(url: str, sample: Dict[str, Any]) -> None:
    """POST trajectory sample to runtime or backend ingest endpoint."""
    payload = json.dumps(sample).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        if resp.status >= 400:
            raise urllib.error.HTTPError(url, resp.status, "ingest failed", resp.headers, None)


def run_replayer(
    interval_sec: float = 1.0,
    continuous: bool = False,
    output_file: str = None,
    runtime_url: Optional[str] = None,
    predictor_url: Optional[str] = None,
):
    """Runs the replayer emitting JSON lines to stdout / log and optional file."""
    mapper = RegionMapper()
    session_id = "sim-vehicle-01"
    last_edge_id = None
    step_count = 0

    runtime_url = runtime_url or os.environ.get("PREVAIL_RUNTIME_URL")
    predictor_url = predictor_url or os.environ.get("PREVAIL_PREDICTOR_URL")

    print(f"[vehicle-sim] Starting trajectory replayer for session={session_id}...", file=sys.stderr)
    if runtime_url:
        print(f"[vehicle-sim] Ingest target: {runtime_url.rstrip('/')}/v1/trajectory", file=sys.stderr)

    file_handle = open(output_file, "a", encoding="utf-8") if output_file else None

    try:
        while True:
            for wp in DETERMINISTIC_WAYPOINTS:
                step_count += 1
                edge_id = mapper.get_edge_id(wp["lat"], wp["lon"])
                timestamp_ms = int(time.time() * 1000)

                sample = {
                    "session_id": session_id,
                    "timestamp_ms": timestamp_ms,
                    "latitude": wp["lat"],
                    "longitude": wp["lon"],
                    "speed_mps": wp["speed"],
                    "edge_id": edge_id,
                    "heading_deg": wp["heading"],
                }

                json_line = json.dumps(sample)
                print(json_line, flush=True)

                if runtime_url:
                    try:
                        post_sample(f"{runtime_url.rstrip('/')}/v1/trajectory", sample)
                    except (urllib.error.URLError, urllib.error.HTTPError) as exc:
                        print(f"[vehicle-sim] WARN: runtime ingest failed: {exc}", file=sys.stderr)

                if predictor_url:
                    try:
                        post_sample(
                            f"{predictor_url.rstrip('/')}/trajectory",
                            {
                                "session_id": sample["session_id"],
                                "edge_id": sample["edge_id"],
                                "timestamp_ms": sample["timestamp_ms"],
                                "latitude": sample["latitude"],
                                "longitude": sample["longitude"],
                                "speed_mps": sample["speed_mps"],
                            },
                        )
                    except (urllib.error.URLError, urllib.error.HTTPError):
                        pass

                if file_handle:
                    file_handle.write(json_line + "\n")
                    file_handle.flush()

                if edge_id != last_edge_id:
                    print(
                        f"[vehicle-sim] Transition detected at step {step_count}: "
                        f"{last_edge_id or 'START'} -> {edge_id} (lat={wp['lat']}, lon={wp['lon']})",
                        file=sys.stderr,
                        flush=True,
                    )
                    last_edge_id = edge_id

                time.sleep(interval_sec)

            if not continuous:
                print("[vehicle-sim] Trajectory trace replay completed successfully.", file=sys.stderr)
                break

    finally:
        if file_handle:
            file_handle.close()


if __name__ == "__main__":
    is_continuous = "--continuous" in sys.argv
    run_replayer(
        interval_sec=1.0,
        continuous=is_continuous,
        runtime_url=os.environ.get("PREVAIL_RUNTIME_URL"),
        predictor_url=os.environ.get("PREVAIL_PREDICTOR_URL"),
    )
