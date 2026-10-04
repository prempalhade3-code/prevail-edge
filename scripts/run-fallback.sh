#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PREVAIL_MODE=baseline
PYTHONPATH="$ROOT" python experiments/sweep.py --experiment E1 --scenario experiments/scenarios/wrong-prediction.yaml
PYTHONPATH="$ROOT" python experiments/runner.py --scenario experiments/scenarios/wrong-prediction.yaml
