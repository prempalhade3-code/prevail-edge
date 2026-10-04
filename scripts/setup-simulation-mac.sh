#!/usr/bin/env bash
# PREVAIL + CARLA setup for Apple Silicon Mac
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VENV_PIP="$ROOT/backend/.venv/bin/pip"
VENV_PY="$ROOT/backend/.venv/bin/python"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  PREVAIL Simulation Engine Setup (Mac Apple Silicon)    ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ── 1. Docker Desktop ──────────────────────────────────────────────────────
if ! docker info >/dev/null 2>&1; then
  echo "[1/5] Starting Docker Desktop…"
  open -a Docker 2>/dev/null || open -a "Docker Desktop" 2>/dev/null || true
  for i in $(seq 1 18); do
    docker info >/dev/null 2>&1 && break
    sleep 5; echo -n "."
  done
  echo ""
  docker info >/dev/null 2>&1 || { echo "ERROR: Start Docker Desktop manually, then re-run."; exit 1; }
fi
echo "[1/5] Docker: OK"

# ── 2. Bridge deps (venv only — never use system pip3) ─────────────────────
echo "[2/5] Bridge dependencies…"
if [[ ! -x "$VENV_PIP" ]]; then
  echo "ERROR: Backend venv missing. Run: cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
  exit 1
fi
if "$VENV_PY" -c "import numpy, PIL, websockets" 2>/dev/null; then
  echo "      Already installed (skipping pip)"
else
  echo "      Installing numpy Pillow websockets via backend/.venv…"
  "$VENV_PIP" install numpy Pillow websockets
fi

# ── 3. PREVAIL core ────────────────────────────────────────────────────────
echo "[3/5] Starting PREVAIL core…"
for p in 8090 8000; do
  lsof -ti :$p 2>/dev/null | xargs kill -9 2>/dev/null || true
done
pkill -f road_simulator 2>/dev/null || true
sleep 1

cd "$ROOT/rust/prevail-runtime"
PREVAIL_LIVE_SIM=1 CARGO_TARGET_DIR=./target ./target/release/prevail-runtime &
sleep 2

cd "$ROOT/backend"
PREVAIL_RUNTIME_URL=http://127.0.0.1:8090 "$VENV_PY" -m prevail_backend.main &
sleep 2

cd "$ROOT"
PREVAIL_TRAJECTORY_URL=http://127.0.0.1:8090/v1/trajectory \
  PREVAIL_TRAFFIC_URL=http://127.0.0.1:8090/v1/traffic \
  PREVAIL_SESSION_ID=sim-vehicle-01 \
  PYTHONPATH="$ROOT" python3 -m sim.vehicle.sumo_live &
sleep 2

curl -sf http://127.0.0.1:8090/health >/dev/null && curl -sf http://127.0.0.1:8000/health >/dev/null \
  && echo "      PREVAIL core: OK" || echo "      PREVAIL core: starting (wait 5s)"

# ── 4. CARLA engine (Docker) ───────────────────────────────────────────────
echo "[4/5] CARLA Docker (first run downloads ~4GB — do not Ctrl+C)…"
if docker image inspect carlasim/carla:0.9.15 >/dev/null 2>&1; then
  echo "      CARLA image already downloaded"
else
  echo "      Downloading carlasim/carla:0.9.15 …"
  docker pull --platform linux/amd64 carlasim/carla:0.9.15
fi

echo "      Building bridge container…"
docker compose -f docker-compose.simulation.yml build carla-bridge

for p in 8765 8766; do
  lsof -ti :$p 2>/dev/null | xargs kill -9 2>/dev/null || true
done
pkill -f prevail_bridge 2>/dev/null || true

echo "      Starting CARLA + bridge containers…"
docker compose -f docker-compose.simulation.yml up -d

# ── 5. Verify ──────────────────────────────────────────────────────────────
echo "[5/5] Waiting for bridge (CARLA boot ~2-3 min on Mac)…"
for i in $(seq 1 36); do
  if curl -sf http://127.0.0.1:8766/status >/dev/null 2>&1; then
    curl -s http://127.0.0.1:8766/status | "$VENV_PY" -c "
import sys,json
d=json.load(sys.stdin)
print('      Engine:', d.get('message',''))
print('      Connected:', d.get('connected', False))
"
    break
  fi
  sleep 5; echo -n "."
done
echo ""

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Setup complete → http://127.0.0.1:8000  (Cmd+Shift+R)   ║"
echo "║  CARLA logs: docker compose -f docker-compose.simulation.yml logs -f carla"
echo "╚══════════════════════════════════════════════════════════╝"
