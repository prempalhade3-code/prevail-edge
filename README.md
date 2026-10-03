# PREVAIL

**Predictive edge state pre-positioning for mobile stream-processing workloads.**

PREVAIL predicts where a vehicle will move next, proactively maintains **warm shadow** replicas at likely future edge nodes, and **promotes** the correct node to authoritative when movement happens—reducing handoff latency versus reactive migration.

## Quick start (thesis demo)

```bash
./scripts/run-prevail-demo.sh
```

Open **http://127.0.0.1:8000** — immersive 3D simulation (primary) + tactical side map + PREVAIL status panels.

### What starts

| Process | Port |
|---------|------|
| edge-a (bootstrap authority) | HTTP 8090, QUIC 9101 |
| edge-b / edge-c / edge-d | HTTP 8092/8094/8096, QUIC 9102–9104 |
| ML predictor (GRU TorchScript) | 8091 |
| FastAPI aggregator + dashboard | 8000 |
| Road sim (OSM graph, IDM, 28 traffic vehicles) | → backend `/v1/trajectory` (routes to authority holder) |
| Postgres (optional, via Docker) | 5432 |
| Flink live tap (optional) | socket :9999 |

## Architecture

```
road_simulator ──POST /v1/trajectory──► backend :8000
                         │                    │
                         │                    └── forwards to current authority edge
                         │                              │
                         │                              ├── QUIC mesh (4 Rust runtimes)
                         │                              ├── predictor :8091
                         │                              ├── continuous speculation
                         │                              └── StateReplicate shadow sync
FastAPI backend :8000 ◄── aggregator (merges 4 edge snapshots)
       │
       └── WebSocket /ws/live ──► React 3D dashboard (R3F + Leaflet map)
```

See [docs/PREVAIL-Master-Engineering-Plan.md](docs/PREVAIL-Master-Engineering-Plan.md) and [docs/adr/ADR-011-loopback-edge-mesh.md](docs/adr/ADR-011-loopback-edge-mesh.md).

## Infrastructure (Docker)

Postgres + predictor only (edges run on host via Rust mesh):

```bash
cd deploy && docker compose up -d postgres
export PREVAIL_DATABASE_URL=postgresql://prevail:prevail_password@127.0.0.1:5432/prevail
```

## Experiments (E1–E6)

```bash
python experiments/sweep.py --experiment ALL --scenario experiments/scenarios/golden.json
python experiments/runner.py --scenario experiments/scenarios/golden.yaml
```

Results land in `experiments/results/*.csv`.

## Tests

```bash
# Rust runtime (QUIC mesh, authority, shadow) — 16 tests
cd rust/prevail-runtime && cargo test

# Python predictor + mobility
PYTHONPATH=. backend/.venv/bin/python -m pytest python/predictor/tests python/mobility/tests -q

# Integration invariants
PYTHONPATH=. python -m unittest discover -s tests/integration -v

# Live E2E (requires ./scripts/run-prevail-demo.sh running)
PREVAIL_E2E=1 PYTHONPATH=. python -m unittest tests/integration/test_e2e_invariants.py -v

# Postgres schema (requires Docker postgres + PREVAIL_INTEGRATION_TESTS=1)
PREVAIL_INTEGRATION_TESTS=1 PYTHONPATH=. python -m unittest tests/integration/test_postgres_schema.py -v
```

## Build UI separately (iCloud-safe)

```bash
./scripts/build-ui.sh
```

## Stack

| Layer | Technology |
|-------|------------|
| Edge runtime | Rust, Quinn QUIC, Protobuf |
| Stream processing | Apache Flink (file + live socket, standalone fat jar) |
| Prediction | Python FastAPI, PyTorch GRU |
| Mobility | GeoJSON corridor, IDM traffic, SUMO configs |
| Visualization | React Three Fiber city (Kenney CC0 + Three.js Ferrari), OSM roads, Leaflet map |
| Observability | FastAPI aggregator, PostgreSQL timeline (optional) |

## License

To be decided by the team.
