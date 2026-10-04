#!/usr/bin/env bash
# Start host mesh + observability API. The 2D dashboard is served at :8000.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

"$ROOT/scripts/ensure-mesh.sh"

if ! curl -sf http://127.0.0.1:8000/health >/dev/null; then
  echo "backend not healthy on :8000" >&2
  exit 1
fi

echo "PREVAIL demo: http://127.0.0.1:8000/"
echo "Drive the car with the A → D button. Live state streams from /ws/live."
