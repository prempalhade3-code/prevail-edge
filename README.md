# PREVAIL

**Predictive edge state pre-positioning for mobile stream-processing workloads.**

PREVAIL predicts where a mobile device will move next, proactively maintains **warm shadow** replicas at likely future edge nodes, and **promotes** the correct node to authoritative when movement happens—reducing handoff latency versus reactive migration.

## Status

- **Phase:** Prem core + dashboard v0.1 (Rust runtime, FastAPI, React UI)
- **Plan:** See [docs/PREVAIL-Master-Engineering-Plan.md](docs/PREVAIL-Master-Engineering-Plan.md) (authoritative v2.0 roadmap)

### Run locally (Prem stack)

```bash
# Terminal 1 — core runtime :8090
cd rust/prevail-runtime && CARGO_TARGET_DIR=./target cargo run --release

# Terminal 2 — observability API :8000
cd backend && pip install -r requirements.txt && PREVAIL_RUNTIME_URL=http://127.0.0.1:8090 python -m prevail_backend.main

# Terminal 3 — dashboard :5173
cd frontend && npm install && npm run dev
```

Open http://localhost:5173 — use **Advance demo step** to walk predict → shadow → promote.

## Team workflow

Read [CONTRIBUTING.md](CONTRIBUTING.md) before writing code. Summary:

- `main` — stable, demo-ready
- `develop` — day-to-day integration
- `feature/*` — one task per branch → Pull Request → review → merge

## Planned layout (monorepo)

```
proto/              # Protobuf control messages
rust/               # Edge runtime (speculation, shadows, authority)
python/             # GRU predictor, mobility/SUMO adapters
flink/              # Stream processing job
sim/                # Vehicle scenario replay
deploy/             # Docker Compose
backend/            # FastAPI observability
frontend/           # React dashboard
experiments/        # Scenario YAML, benchmarks
docs/               # ADRs, engineering plan
```

## Stack (high level)

| Layer | Technology |
|-------|------------|
| Stream processing | Apache Flink |
| Edge runtime | Rust, QUIC, Protobuf |
| Prediction | Python, PyTorch, GRU |
| Mobility | SUMO, T-Drive/GeoLife |
| Emulation | Docker Compose |
| Dashboard | FastAPI, React, PostgreSQL |

## License

To be decided by the team (add `LICENSE` before public release).

## Contact

Repository maintainers: add team names here after setup.
