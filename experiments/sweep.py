#!/usr/bin/env python3
"""PREVAIL experiments E1–E6 parameter sweeps with CSV export."""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from experiments.metrics import fetch_live_metrics, fetch_live_snapshot  # noqa: E402
from experiments.runner import (  # noqa: E402
    RESULTS_DIR,
    Scenario,
    count_handoffs,
    load_scenario,
    persist_to_postgres,
    read_trajectory_samples,
    run_flink_job_if_available,
    simulate_baseline_migration,
    simulate_prevail_path,
)


def sweep_e1(scenario: Scenario, samples: List[Dict[str, Any]]) -> List[Dict[str, float]]:
    """E1: measured reactive fallback vs warm promotion from the live timeline."""
    baseline = simulate_baseline_migration(scenario, samples)
    prevail = simulate_prevail_path(scenario, samples)
    return [
        {"experiment": "E1", "mode": "baseline", **baseline},
        {"experiment": "E1", "mode": "prevail", **prevail},
    ]


def sweep_e2(scenario: Scenario, samples: List[Dict[str, Any]]) -> List[Dict[str, float]]:
    """E2: break-even using measured accuracy and latencies (no assumed accuracy grid)."""
    live = fetch_live_metrics() or {}
    baseline_ms = live.get("reactive_latency_ms") or 0.0
    prevail_ms = live.get("warm_latency_ms") or live.get("migration_latency_ms") or 0.0
    accuracy = live.get("prediction_accuracy")
    if accuracy is None:
        return [{
            "experiment": "E2",
            "metric_source": "unavailable",
            "prediction_accuracy": 0.0,
            "baseline_ms": 0.0,
            "prevail_ms": 0.0,
            "savings_ms": 0.0,
            "break_even": 0.0,
        }]
    savings = baseline_ms - prevail_ms
    return [{
        "experiment": "E2",
        "metric_source": "live_timeline",
        "prediction_accuracy": accuracy,
        "baseline_ms": baseline_ms,
        "prevail_ms": prevail_ms,
        "savings_ms": savings,
        "break_even": 1.0 if savings > 0 else 0.0,
        "handoff_count": live.get("handoff_count", 0.0),
        "samples_processed": float(len(samples)),
    }]


def sweep_e3(_scenario: Scenario, _samples: List[Dict[str, Any]]) -> List[Dict[str, float]]:
    """E3: observed shadow budget from the live run."""
    live = fetch_live_metrics() or {}
    max_shadows = float(os.environ.get("PREVAIL_SPECULATION_MAX_SHADOWS", "1"))
    return [{
        "experiment": "E3",
        "metric_source": "live_timeline" if live.get("live_runtime") else "unavailable",
        "max_shadows": max_shadows,
        "shadows_created": live.get("shadows_created", 0.0),
        "average_sync_ratio": live.get("average_sync_ratio", 0.0),
    }]


def sweep_e4(_scenario: Scenario, _samples: List[Dict[str, Any]]) -> List[Dict[str, float]]:
    """E4: observed promotion vs fallback rate at the configured threshold."""
    live = fetch_live_metrics() or {}
    threshold = float(os.environ.get("PREVAIL_PROMOTION_SYNC_THRESHOLD", "0.95"))
    warm = live.get("warm_count", 0.0)
    reactive = live.get("reactive_count", 0.0)
    total = warm + reactive
    return [{
        "experiment": "E4",
        "metric_source": "live_timeline" if live.get("live_runtime") else "unavailable",
        "promotion_sync_threshold": threshold,
        "promotion_rate": (warm / total) if total else 0.0,
        "discard_rate": (reactive / total) if total else 0.0,
        "warm_count": warm,
        "reactive_count": reactive,
    }]


def sweep_e5(_scenario: Scenario, _samples: List[Dict[str, Any]]) -> List[Dict[str, float]]:
    """E5: live predictor ETA versus the speculation lead-time gate."""
    snap = fetch_live_snapshot() or {}
    eta = (snap.get("prediction") or {}).get("eta_sec")
    sync = float(os.environ.get("PREVAIL_ESTIMATED_SYNC_SEC", "5"))
    margin = float(os.environ.get("PREVAIL_PROMOTION_MARGIN_SEC", "2"))
    if eta is None:
        return [{
            "experiment": "E5",
            "metric_source": "unavailable",
            "eta_sec": 0.0,
            "estimated_sync_sec": sync,
            "promotion_margin_sec": margin,
            "gate_passes": 0.0,
        }]
    return [{
        "experiment": "E5",
        "metric_source": "live_prediction",
        "eta_sec": float(eta),
        "estimated_sync_sec": sync,
        "promotion_margin_sec": margin,
        "gate_passes": 1.0 if float(eta) >= sync + margin else 0.0,
    }]


def sweep_e6(scenario: Scenario, samples: List[Dict[str, Any]]) -> List[Dict[str, float]]:
    """E6: observed fallback/wrong-prediction counts. Does not invent recovery times."""
    live = fetch_live_metrics() or {}
    return [{
        "experiment": "E6",
        "metric_source": "live_timeline" if live.get("live_runtime") else "unavailable",
        "handoffs": live.get("handoff_count", float(count_handoffs(samples))),
        "wrong_prediction_count": live.get("wrong_prediction_count", 0.0),
        "reactive_count": live.get("reactive_count", 0.0),
        "warm_count": live.get("warm_count", 0.0),
        "scenario_id": 0.0,
    }]


SWEEPS = {
    "E1": sweep_e1,
    "E2": sweep_e2,
    "E3": sweep_e3,
    "E4": sweep_e4,
    "E5": sweep_e5,
    "E6": sweep_e6,
}


def write_sweep_csv(experiment: str, rows: List[Dict[str, Any]]) -> Path:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    run_id = f"sweep-{experiment}-{uuid.uuid4().hex[:8]}"
    out = RESULTS_DIR / f"{experiment}_{run_id}.csv"
    if not rows:
        return out
    keys = sorted({k for row in rows for k in row.keys()})
    with out.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=keys)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
    return out


def validate_handoffs(scenario: Scenario, samples: List[Dict[str, Any]]) -> bool:
    if not scenario.expected_handoffs:
        return True
    observed = []
    last = None
    for s in samples:
        if last and s["edge_id"] != last:
            observed.append({"from": last, "to": s["edge_id"]})
        last = s["edge_id"]
    return observed == scenario.expected_handoffs


def main() -> int:
    parser = argparse.ArgumentParser(description="PREVAIL E1–E6 experiment sweeps")
    parser.add_argument("--experiment", choices=list(SWEEPS.keys()) + ["ALL"], default="ALL")
    parser.add_argument("--scenario", default=str(ROOT / "experiments" / "scenarios" / "golden.yaml"))
    args = parser.parse_args()

    scenario = load_scenario(Path(args.scenario))
    samples = read_trajectory_samples(scenario.stream_file)
    handoffs_ok = validate_handoffs(scenario, samples)
    print(f"[sweep] handoffs_valid={handoffs_ok} samples={len(samples)}")

    flink_metrics = run_flink_job_if_available(scenario.stream_file, scenario.mode)
    if flink_metrics:
        print(f"[sweep] flink_metrics={json.dumps(flink_metrics)}")

    exps = list(SWEEPS.keys()) if args.experiment == "ALL" else [args.experiment]
    outputs: List[Path] = []
    for exp in exps:
        rows = SWEEPS[exp](scenario, samples)
        out = write_sweep_csv(exp, rows)
        outputs.append(out)
        print(f"[sweep] {exp} → {out} ({len(rows)} rows)")
        if rows and exp == "E1":
            persist_to_postgres(f"run-{exp}-{int(time.time())}", scenario, rows[1])

    for p in outputs:
        print(f"[sweep] Wrote {p}")
    return 0 if handoffs_ok else 1


if __name__ == "__main__":
    sys.exit(main())
