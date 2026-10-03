#!/usr/bin/env python3
"""Download CC0 Kenney + Three.js models required by the PREVAIL city renderer."""
from __future__ import annotations

import re
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "frontend" / "public" / "models"

OGA_PAGES = {
    "car": "https://opengameart.org/content/car-kit",
    "commercial": "https://opengameart.org/content/city-kit-commercial",
    "suburban": "https://opengameart.org/content/city-kit-suburban",
    "nature": "https://opengameart.org/content/nature-kit",
    "roads": "https://opengameart.org/content/city-kit-roads",
}

DEST = {
    "car": MODELS / "vehicles",
    "commercial": MODELS / "buildings",
    "suburban": MODELS / "houses",
    "nature": MODELS / "nature",
    "roads": MODELS / "props",
}

DIRECT = {
    "ferrari": (
        MODELS / "ferrari.glb",
        [
            "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/models/gltf/ferrari.glb",
            "https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models/gltf/ferrari.glb",
        ],
    ),
    "driver": (
        MODELS / "readyplayer.me.glb",
        [
            "https://models.readyplayer.me/64bfa15f0e72c63d7e56d08.glb",
            "https://models.readyplayer.me/65a8dba831b23abb4f401bae.glb",
        ],
    ),
}

UA = {"User-Agent": "PREVAIL-asset-fetch/1.0 (research simulator; CC0 Kenney + Three.js)"}


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=90) as resp:
        return resp.read()


def download(url: str, dest: Path) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        print(f"[assets] GET {url}")
        dest.write_bytes(get(url))
        print(f"[assets] wrote {dest} ({dest.stat().st_size} bytes)")
        return True
    except Exception as exc:
        print(f"[assets] fail {url}: {exc}")
        return False


def oga_zip_url(page: str) -> str | None:
    html = get(page).decode("utf-8", "ignore")
    matches = re.findall(r'href="(/sites/default/files/[^"]+\.zip)"', html)
    if not matches:
        matches = re.findall(r'href="(https://opengameart.org/sites/default/files/[^"]+\.zip)"', html)
    if not matches:
        return None
    href = matches[0]
    if href.startswith("http"):
        return href
    return "https://opengameart.org" + href


def extract_glb(zip_path: Path, dest: Path, prefixes: tuple[str, ...] | None = None) -> int:
    dest.mkdir(parents=True, exist_ok=True)
    count = 0
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            name = Path(info.filename).name
            if name.lower() == "colormap.png":
                tex = dest / "Textures"
                tex.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src, (tex / "colormap.png").open("wb") as out:
                    shutil.copyfileobj(src, out)
                continue
            if not name.lower().endswith(".glb"):
                continue
            if prefixes and not any(name.startswith(p) for p in prefixes):
                continue
            # Prefer GLB format folders when several copies exist.
            if "GLTF format" in info.filename.replace("\\", "/"):
                continue
            target = dest / name
            with zf.open(info) as src, target.open("wb") as out:
                shutil.copyfileobj(src, out)
            count += 1
    return count


def main() -> int:
    MODELS.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="prevail-assets-"))
    try:
        for key, page in OGA_PAGES.items():
            dest = DEST[key]
            try:
                zip_url = oga_zip_url(page)
            except Exception as exc:
                print(f"[assets] page fail {page}: {exc}")
                continue
            if not zip_url:
                print(f"[assets] no zip on {page}")
                continue
            zip_path = tmp / f"{key}.zip"
            if not download(zip_url, zip_path):
                continue
            prefixes = None
            if key == "nature":
                prefixes = ("tree", "plant")
            if key == "commercial":
                prefixes = ("building",)
            if key == "suburban":
                prefixes = ("building",)
            n = extract_glb(zip_path, dest, prefixes)
            print(f"[assets] extracted {n} glb -> {dest}")

        for name, (dest, urls) in DIRECT.items():
            if dest.exists() and dest.stat().st_size > 1000:
                print(f"[assets] already have {dest.name}")
                continue
            ok = False
            for url in urls:
                if download(url, dest):
                    ok = True
                    break
            if not ok:
                print(f"[assets] MISSING {name}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    for label, path in [
        ("vehicles", MODELS / "vehicles"),
        ("buildings", MODELS / "buildings"),
        ("houses", MODELS / "houses"),
        ("nature", MODELS / "nature"),
        ("props", MODELS / "props"),
    ]:
        n = len(list(path.glob("*.glb"))) if path.exists() else 0
        print(f"[assets] {label}: {n}")
    print(f"[assets] ferrari: {(MODELS / 'ferrari.glb').exists()}")
    print(f"[assets] driver:  {(MODELS / 'readyplayer.me.glb').exists()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
