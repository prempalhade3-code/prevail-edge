"""Fail closed if the deployed GRU was not trained on official T-Drive/GeoLife."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
META = ROOT / "models" / "training_metadata.json"
MODEL = ROOT / "models" / "gru_predictor.pt"
ONNX = ROOT / "models" / "gru_predictor.onnx"


def main() -> int:
    if not MODEL.exists():
        print(f"missing model: {MODEL}", file=sys.stderr)
        return 1
    if not META.exists():
        print(f"missing training metadata: {META}", file=sys.stderr)
        return 1
    meta = json.loads(META.read_text(encoding="utf-8"))
    if meta.get("source") != "official":
        print(f"model source is {meta.get('source')!r}, expected official", file=sys.stderr)
        return 1
    if int(meta.get("sequence_count") or 0) < 8:
        print("official sequence_count too small", file=sys.stderr)
        return 1
    if MODEL.stat().st_size < 1024:
        print("model artifact is implausibly small", file=sys.stderr)
        return 1
    if not ONNX.exists() or ONNX.stat().st_size < 64:
        print(f"missing ONNX model: {ONNX}", file=sys.stderr)
        return 1
    features = meta.get("features") or []
    if "speed_norm" not in features or "heading_norm" not in features:
        print(f"training metadata missing speed/heading features: {features}", file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, **meta}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
