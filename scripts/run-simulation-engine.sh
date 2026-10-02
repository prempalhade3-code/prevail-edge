#!/usr/bin/env bash
# Start CARLA bridge (connects Unreal engine ↔ PREVAIL runtime)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PREVAIL_RUNTIME_URL="${PREVAIL_RUNTIME_URL:-http://127.0.0.1:8090}"
export CARLA_HOST="${CARLA_HOST:-127.0.0.1}"
export CARLA_PORT="${CARLA_PORT:-2000}"

echo "=== PREVAIL Simulation Engine Bridge ==="
echo "CARLA server expected at ${CARLA_HOST}:${CARLA_PORT}"
echo "PREVAIL runtime at ${PREVAIL_RUNTIME_URL}"
echo "Stream: ws://127.0.0.1:8765  Status: http://127.0.0.1:8766/status"
echo ""
echo "If CARLA is not running:"
echo "  Linux/GPU: docker compose -f docker-compose.carla.yml up"
echo "  Or: ./CarlaUE4.sh -prefernvidia -quality-level=Epic"
echo "  Mac: set CARLA_HOST=<linux-machine-ip>"
echo ""

python3 sim/carla/prevail_bridge.py
