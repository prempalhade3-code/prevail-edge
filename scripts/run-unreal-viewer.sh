#!/usr/bin/env bash
# Open the PREVAIL Unreal 5 viewer. The FastAPI mesh must already be on :8000.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$ROOT/unreal/PrevailViewer/PrevailViewer.uproject"

find_editor() {
  if [[ -n "${UNREAL_EDITOR:-}" && -x "$UNREAL_EDITOR" ]]; then
    echo "$UNREAL_EDITOR"
    return
  fi
  local candidates=(
    "/Users/Shared/Epic Games/UE_5.8/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor"
    "/Users/Shared/Epic Games/UE_5.8/Engine/Binaries/Mac/UnrealEditor"
    "/Users/Shared/Epic Games/UE_5.7/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor"
    "/Users/Shared/Epic Games/UE_5.7/Engine/Binaries/Mac/UnrealEditor"
    "/Users/Shared/Epic Games/UE_5.6/Engine/Binaries/Mac/UnrealEditor"
    "/Users/Shared/Epic Games/UE_5.5/Engine/Binaries/Mac/UnrealEditor"
    "$HOME/Epic Games/UE_5.8/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor"
    "$HOME/Epic Games/UE_5.8/Engine/Binaries/Mac/UnrealEditor"
    "$HOME/Epic Games/UE_5.7/Engine/Binaries/Mac/UnrealEditor"
    "$HOME/Epic Games/UE_5.5/Engine/Binaries/Mac/UnrealEditor"
  )
  local path
  for path in "${candidates[@]}"; do
    if [[ -x "$path" ]]; then
      echo "$path"
      return
    fi
  done
  return 1
}

if EDITOR="$(find_editor)"; then
  echo "[prevail-ue] opening $PROJECT"
  echo "[prevail-ue] mesh must stay on http://127.0.0.1:8000"
  echo "[prevail-ue] click the PrevailViewer window; first launch compiles Metal shaders"
  # Launch Services is required so macOS creates a real Unreal window.
  APP="${EDITOR%.app/Contents/MacOS/UnrealEditor}.app"
  if [[ "$APP" == *.app && -d "$APP" ]]; then
    exec open -na "$APP" --args "$PROJECT" -game -windowed -resx=1280 -resy=720 -log
  fi
  exec "$EDITOR" "$PROJECT" -game -windowed -resx=1280 -resy=720 -log
fi

echo "Unreal Engine 5 is not installed yet."
echo
echo "1. Install Epic Games Launcher (free): https://store.epicgames.com/en-US/download"
echo "2. Unreal Engine → Library → Install 5.8"
echo "3. Re-run: $0"
echo
echo "The backend does not change. Keep the mesh on http://127.0.0.1:8000"
exit 1
