# Contributing to PREVAIL

Simple Git workflow for a team of four. Ask in chat if anything is unclear.

## Branches

| Branch | Purpose |
|--------|---------|
| `main` | Stable. Only merged, reviewed work. Tag demos here. |
| `develop` | Integration branch. Most PRs merge here first. |
| `feature/<short-name>` | Your task (e.g. `feature/phase1-docker-compose`) |

**Rule:** Do not push directly to `main`. Use Pull Requests (PRs).

## Daily workflow

1. **Update local `develop`**
   ```bash
   git checkout develop
   git pull origin develop
   ```
2. **Create a feature branch**
   ```bash
   git checkout -b feature/your-task-name
   ```
3. **Work and commit** (small, clear commits)
   ```bash
   git add .
   git commit -m "Short description of why you changed something"
   ```
4. **Push your branch**
   ```bash
   git push -u origin feature/your-task-name
   ```
5. **Open a Pull Request** on GitHub: base = `develop`, compare = your feature branch.
6. **Review:** At least one teammate reviews. Fix comments if needed.
7. **Merge** via GitHub “Merge pull request” (squash is fine for small teams).
8. **Delete** the feature branch after merge.

## When to merge `develop` → `main`

- End of a phase milestone (e.g. Phase 1 edges talk over QUIC)
- Demo or submission deadline
- Maintainer opens PR `develop` → `main`, team quick review, merge

## Who owns what (assigned)

See [docs/TEAM-DEVELOPMENT-PLAN.md](docs/TEAM-DEVELOPMENT-PLAN.md) for full detail.

| Person | Branch | Folders |
|--------|--------|---------|
| **Prem** (primary owner) | `feature/core-runtime`, `feature/ui-dashboard` | `proto/`, `rust/`, `flink/prevail-coordinator/`, `frontend/`, `backend/`, `docs/adr/` |
| **Chirag** | `feature/mobility-platform` | `deploy/`, `sim/`, `python/mobility/` |
| **Atharva** | `feature/ml-predictor` | `python/predictor/` |
| **Ram** | `feature/stream-experiments` | `flink/prevail-job/`, `experiments/`, `tests/integration/`, `deploy/postgres/` |

Prem reviews PRs that touch contracts or cross-module integration.

## Commits

- One logical change per commit when possible.
- Message: what and why in one line, optional body.
- Do not commit secrets (`.env`, API keys).

## Phase 0 gate

Do not merge runtime/Flink code until ADRs in `docs/` are agreed (see master engineering plan §13).
