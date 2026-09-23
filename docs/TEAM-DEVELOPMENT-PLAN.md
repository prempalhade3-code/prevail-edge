# PREVAIL — Four-Person Development Plan

**Repository:** [prempalhade3-code/prevail-edge](https://github.com/prempalhade3-code/prevail-edge)  
**Authority:** [PREVAIL-Master-Engineering-Plan.md](./PREVAIL-Master-Engineering-Plan.md) v2.0  
**Primary technical owner:** Prem (UI + core runtime + integration)

---

## 1. Ownership overview

| Person | Role | Architectural weight | Long-lived branch |
|--------|------|----------------------|-------------------|
| **Prem** | Primary owner | **Highest** — core PREVAIL loop + full UI | `feature/core-runtime`, `feature/ui-dashboard` |
| **Chirag** | Friend 1 | Medium — mobility & platform | `feature/mobility-platform` |
| **Atharva** | Friend 2 | Medium — ML predictor subsystem | `feature/ml-predictor` |
| **Ram** | Friend 3 | Medium — Flink workload + experiments/validation | `feature/stream-experiments` |

**Integration branch:** `develop` (everyone merges here via PR)  
**Stable branch:** `main` (milestones only; no direct pushes)

---

## 2. Prem — primary owner

### 2.1 You own (exclusive write)

| Path | Subsystem |
|------|-----------|
| `proto/` | All Protobuf control + observability schemas (**contract source of truth**) |
| `rust/prevail-runtime/` | Speculation manager, warm shadow manager, chain-of-custody, QUIC peer comms |
| `flink/prevail-coordinator/` | ProcessFunction mobility hooks, Rust sidecar gRPC wiring, output-gating integration |
| `frontend/` | **Entire** React/TypeScript/Tailwind/Leaflet/Recharts dashboard |
| `backend/` | FastAPI REST + WebSocket (feeds UI only; **never** authority decisions) |
| `docs/adr/` | Phase 0 ADRs ADR-01–09 (you approve merges touching these) |

### 2.2 Core responsibilities (research-critical)

1. **Closed control loop:** predict → speculate → shadow → sync → promote/discard  
2. **Authority token** and promotion atomicity  
3. **Capability filter** integration with edge registry (reads caps friends deploy)  
4. **Flink ↔ Rust sidecar** boundary (ADR-04)  
5. **Demo narrative** on dashboard (map, prediction, shadow, timeline)

### 2.3 You do NOT delegate

- Shadow lifecycle semantics  
- Promotion/demotion logic  
- Protobuf breaking changes without team review  
- Frontend architecture and all UI components  

### 2.4 Deliverables by phase

| Phase | Your deliverables |
|-------|-------------------|
| 0 | `proto/v0/*.proto`, ADR docs, mock timeline JSON for UI |
| 1 | Rust QUIC ping; consume `TrajectorySample` from sim contract |
| 2 | Sidecar stub; Flink coordinator shell |
| 3 | Authority + reactive path hooks (Ram’s job plugs in) |
| 4 | Warm shadow + promotion (full PREVAIL path) |
| 5 | Speculation manager + capability filter |
| 7 | Full dashboard wired to backend + live WS |

### 2.5 Definition of done (your modules)

- Unit tests for token epoch, speculation gates  
- Golden scenario: promotion latency logged  
- UI shows all panels from master plan §44–48  
- No PR merges to `develop` for `rust/`, `proto/`, `frontend/`, `backend/` without your review  

### 2.6 Do-not-touch zones for you

Avoid committing directly in: `python/predictor/`, `python/mobility/`, `sim/` (except integration tests), `experiments/` (Ram), `deploy/` (Chirag) — review their PRs instead.

---

## 3. Chirag — Friend 1: Mobility & platform

**GitHub:** `@chiragkochar89`  
**Branch:** `feature/mobility-platform`

### 3.1 Owns

| Path | Work |
|------|------|
| `deploy/` | Docker Compose, edge containers skeleton, networks, env templates |
| `sim/vehicle/` | Trajectory replay, scenario YAML loader |
| `python/mobility/` | SUMO export adapters, GPS → edge region map, distance/ETA library |
| `deploy/config/edge-regions.json` | Region graph (Prem approves schema) |

### 3.2 Deliverables

1. **Phase 1:** Compose brings up 4 edge containers + vehicle sim container  
2. **Region map:** GPS → `edge_id` matching dashboard map coordinates  
3. **SUMO pipeline:** Offline script → trajectory file → sim replay format  
4. **ETA helper:** `estimate_eta(current_gps, target_edge_id, speed)` for Prem’s speculation gate  
5. **Edge capability config file** (static JSON): `supports_image`, CPU/RAM limits per edge  

### 3.3 Interfaces (contracts)

**Produces:**

- `TrajectorySample` JSON matching `proto` (see `docs/contracts/trajectory-sample.schema.json`)  
- `deploy/config/edge-regions.json`  
- `deploy/config/edge-capabilities.json`  

**Consumes:**

- Nothing from runtime until Phase 1 integration  

### 3.4 Must not modify

`rust/`, `proto/`, `frontend/`, `backend/`, `flink/prevail-coordinator/`, `python/predictor/`

### 3.5 Definition of done

- `docker compose up` starts stack (healthchecks green)  
- Sim emits trajectory; logs show `edge_id` transitions A→B→C  
- README in `deploy/` with one-command startup  
- Unit tests for region mapper + ETA  

### 3.6 First task (Week 1)

Create `deploy/docker-compose.yml` with services `edge-a`…`edge-d`, `vehicle-sim`, `postgres`; stub containers that echo health. Add `edge-regions.json` for 4 nodes.

---

## 4. Atharva — Friend 2: ML predictor

**GitHub:** `@Neelkanth27`  
**Branch:** `feature/ml-predictor`

### 4.1 Owns

| Path | Work |
|------|------|
| `python/predictor/` | Dataset ingest, GRU train, export, inference HTTP service |
| `python/predictor/baseline/` | Optional destination-matrix baseline |

### 4.2 Deliverables

1. T-Drive/GeoLife → edge-labeled sequences (uses Chirag’s region map)  
2. GRU training script; export TorchScript/ONNX (&lt;1 MB)  
3. **Inference API:** `POST /predict` → `PredictionResult` JSON (proto-compatible)  
4. Offline accuracy report (top-1, top-k)  
5. Optional Dask preprocessing script (clearly optional)

### 4.3 Interfaces

**Produces:**

- `PredictionResult`: `{ "session_id", "probabilities": { "edge-b": 0.82, ... }, "model_version" }`  
- See `docs/contracts/prediction-result.schema.json`  

**Consumes:**

- `edge-regions.json` from Chirag (for label space)  
- Mock trajectories until sim ready  

### 4.4 Must not modify

`rust/`, `proto/` (propose changes via PR to Prem), `frontend/`, speculation logic

### 4.5 Definition of done

- Inference returns valid probability distribution (sums ≈ 1)  
- Dockerized predictor service in Compose (Chirag adds service entry via PR)  
- Tests with frozen fixture trajectory  
- No training secrets in repo  

### 4.6 First task (Week 1)

Implement inference **mock** returning fixed distribution; then wire real GRU after region map lands. Train on synthetic sequence data until T-Drive pipeline ready.

---

## 5. Ram — Friend 3: Stream workload & experiments

**GitHub:** `@RamRajurkar`  
**Branch:** `feature/stream-experiments`

### 5.1 Owns

| Path | Work |
|------|------|
| `flink/prevail-job/` | Stream operators, keyed state, windows, checkpoint config, **reactive migration baseline** job path |
| `experiments/` | Scenario YAML, batch runner, metric export CSV |
| `tests/integration/` | End-to-end harness, fault scripts (documented manual steps) |
| `deploy/postgres/` | Schema migrations, seed for metrics tables |

### 5.2 Deliverables

1. **Flink job** processing sim stream (speed, aggregates) with keyed state  
2. **Baseline mode:** handoff via checkpoint restore (no PREVAIL) — per master plan §3.9  
3. **Sink gating hook:** calls sidecar interface Prem defines (`isAuthoritative()`) — stub until Prem ships sidecar  
4. **Postgres schema** for `timeline_events`, `metric_samples`, `runs`  
5. **Experiment runner:** runs scenario ID N times → writes metrics  
6. Integration tests using **mock runtime** responses  

### 5.3 Interfaces

**Consumes:**

- `proto` sidecar gRPC stub (Prem provides `.proto` + mock server)  
- Stream format from sim contract  
- Postgres connection string from deploy env  

**Produces:**

- Checkpoint blobs path convention for migration baseline  
- SQL migrations + experiment CSV outputs for Prem’s dashboard charts  

### 5.4 Must not modify

`rust/prevail-runtime/`, `flink/prevail-coordinator/`, `frontend/`, `backend/`, `proto/` (except via PR review)

### 5.5 Definition of done

- Flink job runs locally against sample stream file  
- Baseline migration measurable (latency logged to Postgres)  
- Experiment runner executes `experiments/scenarios/golden.yaml`  
- At least 3 integration tests (happy path, wrong region file, empty stream)  

### 5.6 First task (Week 1)

Postgres schema + `experiments/scenarios/golden.yaml` skeleton. Flink job reading JSON lines from file with keyed `vehicle_id` state.

---

## 6. Coverage matrix (no gaps, no duplicates)

| Subsystem (master plan §2.3) | Owner |
|------------------------------|-------|
| Trajectory predictor | Atharva |
| Speculation manager | **Prem** |
| Warm shadow manager | **Prem** |
| Chain-of-custody | **Prem** |
| Stream processing (Flink) | Ram (operators) + **Prem** (coordinator integration) |
| SUMO / vehicle sim / region map | Chirag |
| Docker platform | Chirag |
| Dashboard UI | **Prem** |
| FastAPI observability | **Prem** |
| PostgreSQL experiment log | Ram (schema) + **Prem** (TimelineEvent emitter in runtime) |
| Protobuf schemas | **Prem** |
| QUIC control plane | **Prem** |

---

## 7. Git workflow (four learners)

### 7.1 Branch map

```
main                          ← protected, milestones only
develop                       ← integration
feature/core-runtime          ← Prem (Rust, proto, coordinator)
feature/ui-dashboard          ← Prem (frontend + backend)
feature/mobility-platform     ← Chirag
feature/ml-predictor          ← Atharva
feature/stream-experiments    ← Ram
```

**Rule:** One person → primary branch. Short-lived branches OK (`feature/ui-dashboard/timeline-panel`) merge back to your primary branch before PR to `develop`.

### 7.2 Daily cycle

1. `git checkout develop && git pull origin develop`  
2. `git checkout feature/your-branch && git merge develop` (resolve conflicts)  
3. Work, commit, push  
4. Open PR → **base: `develop`**  
5. Required reviewer: **Prem** for any cross-cutting paths; peer review otherwise  
6. Squash merge OK  

### 7.3 Commit format

```
[area] Short why-focused message

Examples:
[deploy] Add edge-a..d compose services with healthchecks
[predictor] Export GRU TorchScript for edge inference
[runtime] Implement authority token epoch increment on promote
[ui] Add shadow sync panel with WebSocket updates
```

### 7.4 Sync schedule

- **Twice weekly:** everyone merges latest `develop` into their feature branch  
- **Phase gates:** Phase 0 ADRs merged to `develop` before Phase 1 runtime code  

---

## 8. Integration contracts & mocks

| Contract | File | Producer | Consumer | Mock until ready |
|----------|------|----------|----------|------------------|
| Trajectory samples | `docs/contracts/trajectory-sample.schema.json` | Chirag | Prem, Atharva | `sim/fixtures/sample-trajectory.jsonl` |
| Prediction result | `docs/contracts/prediction-result.schema.json` | Atharva | Prem | Fixed 82/13/5 distribution |
| Edge regions | `deploy/config/edge-regions.json` | Chirag | All | 4 static polygons |
| Sidecar authority | `proto/prevail_sidecar.proto` | Prem | Ram | Mock gRPC always returns `authoritative=true` |
| Timeline events | `docs/contracts/timeline-event.schema.json` | Prem | Ram (PG), UI | JSON fixture stream |

Prem ships **Phase 0 mocks** in Week 1 so friends are not blocked.

---

## 9. Parallel vs sequential work

| Can start in parallel (Week 1) | Needs dependency |
|-------------------------------|------------------|
| Prem: proto v0 + mocks | — |
| Prem: UI layout with mock WS data | — |
| Chirag: Compose + region map | — |
| Atharva: predictor mock + synthetic training | Region map for real labels |
| Ram: Postgres + Flink file source | Sidecar proto for gating (use mock) |
| Prem: Rust QUIC ping | Compose network (Chirag) |
| Integration: sim → runtime | Both Chirag + Prem Phase 1 |
| GRU on real data | Chirag region map + labels |
| Dashboard live data | Prem backend + Ram PG schema |
| End-to-end PREVAIL demo | Phase 4 Prem + all contracts |

---

## 10. Prem — personal build order

1. **Week 1:** `proto/v0`, contract JSON schemas, ADR-01/04 drafts, UI shell with mock data  
2. **Week 2:** Rust runtime skeleton + QUIC; backend read APIs from fixtures  
3. **Week 3:** Authority token + handoff detection (sim events); UI map wired to mock  
4. **Week 4:** Sidecar + Flink coordinator shell (integrate Ram’s operators)  
5. **Week 5–6:** Warm shadow + promotion (core research path)  
6. **Week 7:** Speculation manager + Atharva predictor integration  
7. **Week 8:** Live dashboard + experiment charts (Ram’s PG data)  

**From friends before integration:**

| Need | From | By |
|------|------|-----|
| Compose network + edge hostnames | Chirag | Week 2 |
| `edge-regions.json` | Chirag | Week 2 |
| Predictor HTTP (mock → real) | Atharva | Week 2 mock, Week 5 real |
| Flink job + PG schema | Ram | Week 3 |
| SUMO trajectory file | Chirag | Week 4 |

---

## 11. Environment setup (all members)

```bash
git clone https://github.com/prempalhade3-code/prevail-edge.git
cd prevail-edge
git checkout develop

# Tools (install what your stream needs)
# Prem/Chirag: Docker Desktop, Rust, Node 20+
# Atharva: Python 3.11+, PyTorch
# Ram: Java 17+, Flink (or Docker Flink image)
```

Copy `.env.example` → `.env` when Chirag adds it (no secrets in git).

---

## 12. Testing requirements (by stream)

| Stream | Minimum tests |
|--------|---------------|
| Prem | Rust unit tests; UI smoke (manual checklist Phase 7) |
| Chirag | Region mapper unit tests; compose health integration |
| Atharva | Inference output shape; prob sum ≈ 1 |
| Ram | Flink job unit; experiment runner dry-run; SQL migration test |

---

## 13. Milestone checklist before Phase 1 merge

- [ ] All 3 friends accepted GitHub invite  
- [ ] `develop` exists; feature branches pushed  
- [ ] Phase 0 ADRs on `develop`  
- [ ] Contract schemas in `docs/contracts/`  
- [ ] Each person completed Week 1 first task  
- [ ] Prem reviewed and merged first PR from each friend  

---

*End of team plan.*
