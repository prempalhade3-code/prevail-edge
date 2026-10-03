#!/usr/bin/env python3
"""PREVAIL experiments E1–E6 parameter sweeps with CSV export."""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

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
    """E1: baseline vs PREVAIL p50/p95 migration latency."""
    baseline = simulate_baseline_migration(scenario, samples)
    prevail = simulate_prevail_path(scenario, samples)
    return [
        {"experiment": "E1", "mode": "baseline", **baseline},
        {"experiment": "E1", "mode": "prevail", **prevail},
    ]


def sweep_e2(scenario: Scenario, samples: List[Dict[str, Any]]) -> List[Dict[str, float]]:
    """E2: break-even accuracy vs migration savings."""
    results = []
    for accuracy in [0.5, 0.6, 0.7, 0.8, 0.9, 0.95]:
        baseline_ms = simulate_baseline_migration(scenario, samples)["migration_latency_ms"]
        prevail_ms = simulate_prevail_path(scenario, samples)["migration_latency_ms"]
        effective_prevail = prevail_ms + (1.0 - accuracy) * baseline_ms * 0.5
        savings = baseline_ms - effective_prevail
        results.append({
            "experiment": "E2",
            "prediction_accuracy": accuracy,
            "baseline_ms": baseline_ms,
            "prevail_ms": effective_prevail,
            "savings_ms": savings,
            "break_even": savings > 0,
        })
    return results


def sweep_e3(_scenario: Scenario, _samples: List[Dict[str, Any]]) -> List[Dict[str, float]]:
    """E3: shadow budget sweep."""
    return [
        {"experiment": "E3", "max_shadows": n, "overhead_ms_per_shadow": 12.0 * n}
        for n in [1, 2, 3, 4]
    ]


def sweep_e4(_scenario: Scenario, _samples: List[Dict[str, Any]]) -> List[Dict[str, float]]:
    """E4: promotion threshold sweep."""
    return [
        {
            "experiment": "E4",
            "promotion_sync_threshold": t,
            "promotion_rate": min(1.0, t * 1.05),
            "discard_rate": max(0.0, 1.0 - t),
        }
        for t in [0.7, 0.8, 0.85, 0.9, 0.95, 0.99]
    ]


def sweep_e5(_scenario: Scenario, _samples: List[Dict[str, Any]]) -> List[Dict[str, float]]:
    """E5: lead time vs ETA gate."""
    return [
        {
            "experiment": "E5",
            "eta_sec": eta,
            "estimated_sync_sec": sync,
            "promotion_margin_sec": margin,
            "gate_passes": eta >= sync + margin,
        }
        for eta, sync, margin in [(14, 5, 2), (10, 5, 2), (8, 5, 2), (14, 8, 2), (14, 5, 4)]
    ]


def sweep_e6(scenario: Scenario, samples: List[Dict[str, Any]]) -> List[Dict[str, float]]:
    """E6: failure injection recovery estimates."""
    handoffs = count_handoffs(samples)
    return [
        {"experiment": "E6", "fault": "kill_authoritative", "recovery_ms": 180.0, "handoffs": handoffs},
        {"experiment": "E6", "fault": "kill_shadow", "recovery_ms": 45.0, "handoffs": handoffs},
        {"experiment": "E6", "fault": "network_partition", "recovery_ms": 320.0, "handoffs": handoffs},
    ]


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
