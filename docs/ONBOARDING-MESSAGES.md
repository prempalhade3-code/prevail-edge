# Ready-to-send onboarding messages

Copy-paste to WhatsApp/Discord/email. Replace nothing unless your repo URL differs.

---

## Message for Chirag (@chiragkochar89)

Hi Chirag — we’ve split PREVAIL work so everyone owns a real subsystem. **Prem owns the core runtime and UI**; your stream is **mobility + Docker platform** — important for the whole demo, but bounded so we don’t step on each other.

**Your branch:** `feature/mobility-platform` (never push to `main`)

**You own:**
- `deploy/` — Docker Compose, edge-a…d containers, Postgres service
- `sim/vehicle/` — replay trajectory files (A→B→C)
- `python/mobility/` — GPS → edge region, distance/ETA, SUMO export scripts
- `deploy/config/edge-regions.json` + `edge-capabilities.json`

**First task (this week):**
1. Accept GitHub invite: https://github.com/prempalhade3-code/prevail-edge
2. `git clone https://github.com/prempalhade3-code/prevail-edge.git`
3. `git checkout develop` then `git checkout -b feature/mobility-platform`
4. Add `docker-compose.yml` with services `edge-a`…`edge-d`, `vehicle-sim`, `postgres` (healthchecks OK)
5. Add `edge-regions.json` for 4 edges (simple lat/lon boxes is fine for v1)

**Do not edit:** `rust/`, `frontend/`, `backend/`, `proto/`, `python/predictor/`

**Output format:** Trajectory samples must match `docs/contracts/trajectory-sample.schema.json`

**Workflow:**
```
git pull origin develop
# work on feature/mobility-platform
git commit -m "[deploy] ..."
git push -u origin feature/mobility-platform
```
Open PR → **base: develop** → tag Prem for review.

Read `docs/TEAM-DEVELOPMENT-PLAN.md` §3 and `CONTRIBUTING.md`.

---

## Message for Atharva (@Neelkanth27)

Hi Atharva — you own the **ML predictor subsystem** (GRU + inference). Prem owns speculation *decisions* in Rust; you supply **probabilities only** — that’s the correct split for PREVAIL.

**Your branch:** `feature/ml-predictor`

**You own:**
- `python/predictor/` — T-Drive/GeoLife prep, GRU train/export, inference HTTP service
- `python/predictor/baseline/` — optional destination-matrix baseline

**First task (this week):**
1. Accept invite & clone repo (same as above)
2. `git checkout -b feature/ml-predictor`
3. Build **mock inference** `POST /predict` returning fixed distribution, e.g. edge-b: 0.82, edge-c: 0.13, edge-d: 0.05 — must match `docs/contracts/prediction-result.schema.json`
4. Dockerfile for predictor service (Chirag will wire into Compose later)

**Later:** Train real GRU once Chirag’s `edge-regions.json` exists (same label IDs).

**Do not edit:** `rust/`, `frontend/`, `deploy/` (except via small PR to add your service), `flink/`

**Workflow:** Same as Chirag — PR to `develop`, Prem reviews.

Read `docs/TEAM-DEVELOPMENT-PLAN.md` §4.

---

## Message for Ram (@RamRajurkar)

Hi Ram — you own **Flink stream workload + experiments/validation** — real systems work (keyed state, baseline migration metrics, Postgres schema, experiment runner). Prem owns the PREVAIL coordinator integration; you build the **application job** and **research measurement harness**.

**Your branch:** `feature/stream-experiments`

**You own:**
- `flink/prevail-job/` — operators, keyed state, checkpoints, reactive migration baseline
- `experiments/` — scenario YAML + batch runner
- `tests/integration/`
- `deploy/postgres/` — SQL migrations for metrics/timeline

**First task (this week):**
1. Accept invite & clone repo
2. `git checkout -b feature/stream-experiments`
3. Create Postgres schema for `runs`, `timeline_events`, `metric_samples`
4. Flink job reading JSON-lines stream file with keyed state by `vehicle_id`
5. Add `experiments/scenarios/golden.yaml` skeleton

**Sidecar gating:** Prem will ship `proto/prevail_sidecar.proto` — until then, stub `isAuthoritative() = true` in your sink.

**Do not edit:** `rust/prevail-runtime/`, `flink/prevail-coordinator/`, `frontend/`, `backend/`

**Workflow:** PR to `develop`, Prem reviews integration points.

Read `docs/TEAM-DEVELOPMENT-PLAN.md` §5.

---

## Message for Prem (keep for yourself)

You are **primary owner**: `proto/`, `rust/prevail-runtime/`, `flink/prevail-coordinator/`, entire `frontend/` + `backend/`, ADRs.

**Branches:** `feature/core-runtime` + `feature/ui-dashboard`

**Week 1:** Ship proto v0 + contract schemas + UI mock + Rust repo skeleton. Unblock friends with mocks.

**Review rule:** You approve all PRs that touch cross-module contracts.

See `docs/TEAM-DEVELOPMENT-PLAN.md` §10 for build order.
