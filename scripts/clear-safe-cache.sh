#!/usr/bin/env bash
# Safe cache cleanup — does NOT delete projects, git repos, or source code.
set -euo pipefail

echo "=== Disk before ==="
df -h / | tail -1
echo ""

echo "This clears ONLY caches and temp files:"
echo "  • Docker failed/partial downloads (~21 GB)"
echo "  • Cursor agent worker cache (~5 GB)"
echo "  • npm cache (~3.4 GB)"
echo "  • Homebrew cache (~1 GB)"
echo "  • Browser/tool caches (~1 GB)"
echo ""
read -p "Continue? (y/N) " ans
[[ "$ans" == "y" || "$ans" == "Y" ]] || exit 0

# npm
echo "[1/7] npm cache…"
npm cache clean --force 2>/dev/null || true

# Homebrew
echo "[2/7] Homebrew cache…"
brew cleanup -s 2>/dev/null || true

# pip / playwright / tool caches
echo "[3/7] pip, Playwright, Google caches…"
rm -rf ~/Library/Caches/pip
rm -rf ~/Library/Caches/ms-playwright
rm -rf ~/Library/Caches/Google ~/Library/Caches/com.google.antigravity ~/Library/Caches/antigravity-updater
rm -rf ~/Library/Caches/Cyberbotics ~/Library/Caches/node-gyp

# Temp build dirs
echo "[4/7] /tmp build folders…"
rm -rf /tmp/prevail-ui /tmp/prevail-ui-build /tmp/prevail-fe-build

# Cursor caches (NOT settings, NOT your code)
echo "[5/7] Cursor caches…"
rm -rf ~/Library/Application\ Support/Cursor/CachedData
rm -rf ~/Library/Application\ Support/Cursor/Cache
rm -rf ~/Library/Application\ Support/Cursor/GPUCache
rm -rf ~/Library/Application\ Support/Cursor/logs
rm -rf ~/Library/Application\ Support/Cursor/snapshots
rm -rf ~/Library/Application\ Support/Cursor/User/globalStorage/anysphere.cursor-agent-worker

# Cargo download cache (rebuilds automatically)
echo "[6/7] Cargo download cache…"
rm -rf ~/.cargo/registry/cache 2>/dev/null || true

# Docker — biggest win (partial CARLA download)
echo "[7/7] Docker unused data (start Docker Desktop first)…"
if docker info >/dev/null 2>&1; then
  docker system prune -a -f
else
  echo "  Docker not running — open Docker Desktop, then run:"
  echo "  docker system prune -a -f"
fi

echo ""
echo "=== Disk after ==="
df -h / | tail -1
