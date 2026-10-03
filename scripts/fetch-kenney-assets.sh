#!/usr/bin/env bash
# Download CC0 Kenney + Three.js assets used by the PREVAIL city renderer.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODELS="$ROOT/frontend/public/models"
TMP="${TMPDIR:-/tmp}/prevail-assets"
mkdir -p "$MODELS"/{vehicles,buildings,houses,nature,props} "$TMP"

fetch() {
  local url="$1" dest="$2"
  if [[ -f "$dest" ]]; then
    echo "[assets] already have $(basename "$dest")"
    return 0
  fi
  echo "[assets] $url"
  curl -fL --retry 3 --retry-delay 2 -o "$dest" "$url"
}

extract_glb() {
  local zip="$1" dest="$2" pattern="$3"
  mkdir -p "$dest"
  unzip -qo "$zip" -d "$TMP/unpack"
  find "$TMP/unpack" -type f -iname "$pattern" -name "*.glb" | while read -r f; do
    cp "$f" "$dest/$(basename "$f")"
  done
  rm -rf "$TMP/unpack"
}

# OpenGameArt mirrors of Kenney CC0 packs (same files as kenney.nl).
fetch "https://opengameart.org/sites/default/files/kenney_car-kit_3.1.zip" "$TMP/car-kit.zip" || \
fetch "https://kenney.nl/media/pages/assets/car-kit/c8e1e8c0c8-1714540000/kenney_car-kit.zip" "$TMP/car-kit.zip"

fetch "https://opengameart.org/sites/default/files/kenney_city-kit-commercial_2.1.zip" "$TMP/city-commercial.zip" || true
fetch "https://opengameart.org/sites/default/files/kenney_city-kit-suburban.zip" "$TMP/city-suburban.zip" || true
fetch "https://opengameart.org/sites/default/files/kenney_nature-kit.zip" "$TMP/nature.zip" || true
fetch "https://opengameart.org/sites/default/files/kenney_city-kit-roads.zip" "$TMP/city-roads.zip" || true

# Three.js example Ferrari (MIT, used as the hero vehicle).
fetch "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/models/gltf/ferrari.glb" "$MODELS/ferrari.glb"

# Public Ready Player Me avatar (CC-friendly demo character).
fetch "https://models.readyplayer.me/64bfa15f0e72c63d7e56d08.glb" "$MODELS/readyplayer.me.glb" || \
fetch "https://models.readyplayer.me/64bfa15f0e72c63d64e56d08.glb" "$MODELS/readyplayer.me.glb" || true

if [[ -f "$TMP/car-kit.zip" ]]; then
  extract_glb "$TMP/car-kit.zip" "$MODELS/vehicles" "*"
fi
if [[ -f "$TMP/city-commercial.zip" ]]; then
  extract_glb "$TMP/city-commercial.zip" "$MODELS/buildings" "building*"
fi
if [[ -f "$TMP/city-suburban.zip" ]]; then
  extract_glb "$TMP/city-suburban.zip" "$MODELS/houses" "building*"
fi
if [[ -f "$TMP/nature.zip" ]]; then
  extract_glb "$TMP/nature.zip" "$MODELS/nature" "tree*"
  extract_glb "$TMP/nature.zip" "$MODELS/nature" "plant*"
fi
if [[ -f "$TMP/city-roads.zip" ]]; then
  extract_glb "$TMP/city-roads.zip" "$MODELS/props" "*"
fi

echo "[assets] vehicle count: $(find "$MODELS/vehicles" -name '*.glb' | wc -l | tr -d ' ')"
echo "[assets] buildings:     $(find "$MODELS/buildings" -name '*.glb' | wc -l | tr -d ' ')"
echo "[assets] houses:        $(find "$MODELS/houses" -name '*.glb' | wc -l | tr -d ' ')"
echo "[assets] nature:        $(find "$MODELS/nature" -name '*.glb' | wc -l | tr -d ' ')"
echo "[assets] props:         $(find "$MODELS/props" -name '*.glb' | wc -l | tr -d ' ')"
echo "[assets] hero:          $(test -f "$MODELS/ferrari.glb" && echo yes || echo MISSING)"
echo "[assets] driver:        $(test -f "$MODELS/readyplayer.me.glb" && echo yes || echo MISSING)"
