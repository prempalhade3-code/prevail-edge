# PREVAIL — Mobility & Deployment Platform

This subsystem manages the emulated edge topology, node capabilities, vehicle trajectory simulation replayer, and GPS mobility tools for PREVAIL.

## System Topology & Config

- **`deploy/config/edge-regions.json`**: Geographical center coordinates and coverage radii for edge nodes (`edge-a`, `edge-b`, `edge-c`, `edge-d`). Coordinates match the PREVAIL dashboard Leaflet map (`12.9716, 77.5946` center).
- **`deploy/config/edge-capabilities.json`**: Resource limits (CPU/RAM ratios) and feature flags (`supports_stream`, `supports_image`, `supports_gpu`) used by Prem's speculation capability filter.

## Quick Start (Docker Compose)

Start the full topology stack with one command:

```bash
docker compose -f deploy/docker-compose.yml up --build -d
```

Check status and verify container healthchecks are green:

```bash
docker compose -f deploy/docker-compose.yml ps
```

View vehicle trajectory simulation logs showing monotonic `edge_id` region transitions (`edge-a → edge-a → edge-b → edge-b → edge-c`):

```bash
docker compose -f deploy/docker-compose.yml logs -f vehicle-sim
```

Stop the stack:

```bash
docker compose -f deploy/docker-compose.yml down
```

## Python Mobility Package (`python/mobility`)

The package provides GPS-to-edge mapping, Haversine distance, ETA estimation, and SUMO trace conversion.

### Running Unit Tests

Execute the unit test suite:

```bash
python -m unittest discover -s python/mobility/tests
```

### Usage Examples

```python
from python.mobility import RegionMapper, estimate_eta

# Initialize mapper
mapper = RegionMapper()

# Lookup edge ID from GPS coordinates
edge_id = mapper.get_edge_id(12.9716, 77.5946)
print(f"Edge region: {edge_id}")  # Output: edge-a

# Estimate ETA to target edge node
eta_sec = estimate_eta(current_gps=(12.9716, 77.5946), target_edge_id="edge-b", speed_mps=15.0)
print(f"ETA: {eta_sec} seconds")
```

## Vehicle Trajectory Replayer (`sim/vehicle`)

The replayer outputs JSON line samples conforming to `docs/contracts/trajectory-sample.schema.json`:

```bash
python sim/vehicle/replayer.py
```

### SUMO Trace Conversion

To convert an offline SUMO Floating Car Data (FCD) XML trace file into PREVAIL JSONL format:

```python
from python.mobility import SUMOAdapter

adapter = SUMOAdapter()
adapter.convert_to_jsonl("path/to/sumo_fcd.xml", "output_trajectory.jsonl", session_id="vehicle-01")
```
