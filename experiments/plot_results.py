"""Write research plots from measured E1–E6 CSV rows. No invented zeros."""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Dict, Iterable, List


def _svg_bars(title: str, labels: List[str], values: List[float], dest: Path) -> None:
    width = 640
    height = 280
    pad = 40
    usable = width - 2 * pad
    bar_w = max(12, usable // max(1, len(values) * 2))
    vmax = max(values + [1.0])
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}">',
        f'<rect width="100%" height="100%" fill="#0f172a"/>',
        f'<text x="{pad}" y="24" fill="#e2e8f0" font-size="16">{title}</text>',
    ]
    for i, (label, value) in enumerate(zip(labels, values)):
        h = int((value / vmax) * (height - 80))
        x = pad + i * (bar_w * 2)
        y = height - 40 - h
        parts.append(f'<rect x="{x}" y="{y}" width="{bar_w}" height="{h}" fill="#38bdf8"/>')
        parts.append(f'<text x="{x}" y="{height - 18}" fill="#94a3b8" font-size="10">{label}</text>')
        parts.append(f'<text x="{x}" y="{y - 4}" fill="#e2e8f0" font-size="10">{value:.2f}</text>')
    parts.append("</svg>")
    dest.write_text("\n".join(parts), encoding="utf-8")


def plot_rows(experiment: str, rows: List[Dict[str, float]], dest_dir: Path) -> List[Path]:
    dest_dir.mkdir(parents=True, exist_ok=True)
    written: List[Path] = []
    if not rows:
        raise RuntimeError(f"{experiment}: no measured rows to plot")
    if experiment == "E1":
        labels = [str(r.get("mode") or i) for i, r in enumerate(rows)]
        values = [float(r.get("migration_latency_ms") or 0) for r in rows]
        path = dest_dir / "E1_warm_vs_reactive.svg"
        _svg_bars("E1 warm vs reactive latency (ms)", labels, values, path)
        written.append(path)
    elif experiment == "E2":
        labels = [f"{float(r.get('prediction_accuracy') or 0):.1f}" for r in rows]
        values = [float(r.get("savings_ms") or 0) for r in rows]
        path = dest_dir / "E2_break_even.svg"
        _svg_bars("E2 break-even savings (ms)", labels, values, path)
        written.append(path)
    else:
        keys = [k for k in rows[0] if k not in {"experiment", "metric_source", "scenario_id"}]
        labels = keys[:6]
        values = [float(rows[0].get(k) or 0) for k in labels]
        path = dest_dir / f"{experiment}_metrics.svg"
        _svg_bars(f"{experiment} live metrics", labels, values, path)
        written.append(path)
    return written


def plot_csv(path: Path, dest_dir: Path) -> List[Path]:
    with path.open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    experiment = path.name.split("_", 1)[0]
    return plot_rows(experiment, [{k: _num(v) for k, v in row.items()} for row in rows], dest_dir)


def _num(value: str):
    try:
        return float(value)
    except (TypeError, ValueError):
        return value
