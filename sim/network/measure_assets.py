#!/usr/bin/env python3
"""Measure GLB bounding boxes so the city builder can place assets at true scale.

Reads POSITION accessor min/max straight out of the glTF JSON chunk, so no mesh
library is needed. Emits frontend/public/models/catalog.json, which the renderer
and the city builder both read instead of guessing footprints.
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "frontend" / "public" / "models"


def glb_json(path: Path) -> dict | None:
    raw = path.read_bytes()
    if raw[:4] != b"glTF":
        return None
    _, _, total = struct.unpack_from("<III", raw, 0)
    offset = 12
    while offset < total:
        length, kind = struct.unpack_from("<II", raw, offset)
        offset += 8
        if kind == 0x4E4F534A:  # 'JSON'
            return json.loads(raw[offset : offset + length].decode("utf-8"))
        offset += length + (-length % 4)
    return None


def node_scale(gltf: dict) -> float:
    """Uniform scale applied at the root, if the exporter baked one in."""
    scenes = gltf.get("scenes") or []
    if not scenes:
        return 1.0
    nodes = gltf.get("nodes") or []
    for idx in scenes[0].get("nodes", []):
        scale = (nodes[idx] if idx < len(nodes) else {}).get("scale")
        if scale:
            return float(scale[0])
    return 1.0


def bbox(path: Path) -> dict | None:
    gltf = glb_json(path)
    if not gltf:
        return None

    accessors = gltf.get("accessors") or []
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    found = False

    for mesh in gltf.get("meshes") or []:
        for prim in mesh.get("primitives") or []:
            pos = (prim.get("attributes") or {}).get("POSITION")
            if pos is None or pos >= len(accessors):
                continue
            acc = accessors[pos]
            amin, amax = acc.get("min"), acc.get("max")
            if not amin or not amax:
                continue
            found = True
            for i in range(3):
                lo[i] = min(lo[i], float(amin[i]))
                hi[i] = max(hi[i], float(amax[i]))

    if not found:
        return None

    s = node_scale(gltf)
    size = [round((hi[i] - lo[i]) * s, 4) for i in range(3)]
    return {
        "size": size,
        "min_y": round(lo[1] * s, 4),
        "footprint": round(max(size[0], size[2]), 4),
        "height": size[1],
    }


def main() -> None:
    catalog: dict[str, dict] = {}
    for category in ("vehicles", "buildings", "houses", "nature", "props"):
        folder = MODELS / category
        if not folder.is_dir():
            continue
        entries = {}
        for glb in sorted(folder.glob("*.glb")):
            info = bbox(glb)
            if info:
                entries[glb.stem] = info | {"url": f"/models/{category}/{glb.name}"}
        catalog[category] = entries

    for glb in sorted(MODELS.glob("*.glb")):
        info = bbox(glb)
        if info:
            catalog.setdefault("root", {})[glb.stem] = info | {"url": f"/models/{glb.name}"}

    out = MODELS / "catalog.json"
    out.write_text(json.dumps(catalog, indent=2), encoding="utf-8")

    for category, entries in catalog.items():
        print(f"\n== {category} ({len(entries)})")
        for name, info in list(entries.items())[:40]:
            w, h, d = info["size"]
            print(f"   {name:34s} {w:7.2f} x {h:7.2f} x {d:7.2f}  minY={info['min_y']:7.3f}")
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
