#!/usr/bin/env bash
# Build dashboard in /tmp (iCloud Documents hangs Vite in-place).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="/tmp/prevail-ui-build"

echo "[build-ui] Copying frontend -> $TMP"
rm -rf "$TMP"
rsync -a --exclude node_modules --exclude dist "$ROOT/frontend/" "$TMP/"

echo "[build-ui] npm install + vite build"
cd "$TMP"
npm install --prefer-offline --silent
node node_modules/vite/bin/vite.js build

echo "[build-ui] Copying dist -> frontend/dist"
rsync -a dist/ "$ROOT/frontend/dist/"
mkdir -p "$ROOT/frontend/dist/sim/network"
cp "$ROOT/frontend/public/sim/network/bangalore-corridor.geojson" \
  "$ROOT/frontend/dist/sim/network/" 2>/dev/null || true

echo "[build-ui] Done. Restart backend (T2) if it was already running."
