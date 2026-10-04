#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
"$ROOT/scripts/ensure-mesh.sh"
PYTHONPATH="$ROOT" python experiments/sweep.py --experiment ALL --drive-live --scenario experiments/scenarios/golden.yaml
PYTHONPATH="$ROOT" python experiments/runner.py --scenario experiments/scenarios/golden.yaml
