#!/usr/bin/env python3
"""Run the full live E1–E6 research pack against the Compose backend."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    env = os.environ.copy()
    env.setdefault("PREVAIL_BACKEND_URL", "http://127.0.0.1:8000")
    env.setdefault("PREVAIL_RUNTIME_URL", "http://127.0.0.1:8090")
    cmd = [
        sys.executable,
        str(ROOT / "experiments" / "sweep.py"),
        "--experiment",
        "ALL",
        "--drive-live",
        "--scenario",
        str(ROOT / "experiments" / "scenarios" / "golden.yaml"),
    ]
    return subprocess.call(cmd, cwd=str(ROOT), env=env)


if __name__ == "__main__":
    raise SystemExit(main())
