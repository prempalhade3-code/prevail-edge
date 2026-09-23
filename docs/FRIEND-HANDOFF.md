# Friend handoff — after Prem core v0.1

Repository state: `develop` includes Rust runtime, FastAPI, React dashboard, proto v0, ADRs.

---

## Message for Chirag (@chiragkochar89)

Hi Chirag — Prem's **core stack is live** in the repo. Your mobility/platform work plugs in next.

**Project in one line:** PREVAIL predicts which edge node a moving vehicle will reach next and pre-warms state there before handoff.

**Your subsystem:** `deploy/`, `sim/vehicle/`, `python/mobility/`

**Branch:** `feature/mobility-platform` → PR to `develop`

**Connects to Prem's work:**
- Replace mock topology in Rust with your `deploy/config/edge-regions.json` (same IDs: `edge-a`…`edge-d`)
- Vehicle sim emits JSON lines matching `docs/contracts/trajectory-sample.schema.json`
- Docker Compose should expose edge hostnames on the network Rust will use for real QUIC (Phase 1)

**Do not modify:** `rust/`, `proto/`, `frontend/`, `backend/`, `flink/prevail-coordinator/`

**Setup:**
```bash
git clone https://github.com/prempalhade3-code/prevail-edge.git
cd prevail-edge
git checkout feature/mobility-platform
git pull origin develop
git merge origin/develop
```

**First PR target:** `docker-compose.yml` + `edge-regions.json` + sim replay of `A→A→B→C`

**Test:** `docker compose up` healthy; sim prints `edge_id` transitions

---

## Message for Atharva (@Neelkanth27)

Hi Atharva — the **predictor slot** is ready for your GRU service.

**Your subsystem:** `python/predictor/`

**Branch:** `feature/ml-predictor` → PR to `develop`

**Connects to Prem's work:**
- Rust runtime calls `POST {PREVAIL_PREDICTOR_URL}/predict` with `{"session_id":"..."}` 
- Response must match `docs/contracts/prediction-result.schema.json`
- Until your service runs, runtime uses **mock** 82/13/5 — replace by running predictor on `:8091` and setting env `PREVAIL_PREDICTOR_URL=http://predictor:8091` in Compose (Chirag wires service)

**Do not modify:** `rust/prevail-runtime/`, speculation logic, UI

**Setup:** same clone/checkout as above on `feature/ml-predictor`

**First PR:** FastAPI/Flask `POST /predict` + Dockerfile + unit test (probabilities sum ≈ 1)

**Test:** `curl -X POST localhost:8091/predict -d '{"session_id":"test"}'`

---

## Message for Ram (@RamRajurkar)

Hi Ram — Flink workload + experiments connect to Prem's **sidecar authority API**.

**Your subsystem:** `flink/prevail-job/`, `experiments/`, `tests/integration/`, `deploy/postgres/`

**Branch:** `feature/stream-experiments` → PR to `develop`

**Connects to Prem's work:**
- Sidecar HTTP (gRPC proto in `proto/v0/prevail_sidecar.proto`): `GET http://runtime:8090/v1/sidecar/authority?session_id=...`
- Prem's Flink coordinator reference: `flink/prevail-coordinator/` — **do not edit**; call same sidecar contract from your operators
- Timeline events Prem emits will later land in your Postgres schema — match `docs/contracts/timeline-event.schema.json`

**Do not modify:** `rust/prevail-runtime/`, `flink/prevail-coordinator/`, `frontend/`, `backend/`

**Setup:** same clone on `feature/stream-experiments`

**First PR:** Postgres migrations + Flink job reading JSON-lines stream + `experiments/scenarios/golden.yaml`

**Test:** `mvn -q compile` in your job module; run job against sample stream file; baseline migration latency logged

---

## Git workflow (all)

1. `git checkout develop && git pull`
2. `git checkout feature/your-branch && git merge develop`
3. Commit → push → **PR to `develop`**
4. Tag Prem for review on integration files
