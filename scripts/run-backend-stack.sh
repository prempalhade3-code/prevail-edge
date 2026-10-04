#!/usr/bin/env bash
# Build artifacts and start the documented four-edge Docker + Flink backend.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ ! -x "$ROOT/rust/prevail-runtime/target/release/prevail-runtime" ]]; then
  echo "[stack] building prevail-runtime"
  (cd "$ROOT/rust/prevail-runtime" && cargo build --release)
fi

echo "[stack] building Flink coordinator + job"
(cd "$ROOT/flink/prevail-coordinator" && mvn -q -DskipTests install)
(cd "$ROOT/flink/prevail-job" && mvn -q -DskipTests package)

echo "[stack] ensuring official GRU artifact"
PYTHONPATH="$ROOT" "${PYTHON:-$ROOT/backend/.venv/bin/python}" -m python.predictor.download_official
PYTHONPATH="$ROOT" "${PYTHON:-$ROOT/backend/.venv/bin/python}" -m python.predictor.train --epochs 8 --sequences 0
PYTHONPATH="$ROOT" "${PYTHON:-$ROOT/backend/.venv/bin/python}" -m python.predictor.verify_model

chmod +x "$ROOT/deploy/edge-entrypoint.sh" "$ROOT/deploy/submit-flink-jobs.sh"

echo "[stack] docker compose up"
docker compose -f "$ROOT/deploy/docker-compose.yml" up --build -d
docker compose -f "$ROOT/deploy/docker-compose.yml" ps
