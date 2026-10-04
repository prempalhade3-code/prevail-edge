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


def require_measured(live: Dict[str, Any], experiment: str) -> None:
    if not live or not live.get("live_runtime"):
        raise RuntimeError(
            f"{experiment} requires a live PREVAIL mesh; refusing to write zeros"
        )


def sweep_e1(scenario: Scenario, samples: List[Dict[str, Any]]) -> List[Dict[str, float]]:
    """E1: measured reactive fallback vs warm promotion from the live timeline."""
    live = fetch_live_metrics()
    if not live:
        raise RuntimeError("E1 requires live warm/reactive measurements; mesh unavailable")
    require_measured(live, "E1")
    baseline = simulate_baseline_migration(scenario, samples)
    prevail = simulate_prevail_path(scenario, samples)
    if prevail.get("metric_source") == "unavailable":
        raise RuntimeError("E1 PREVAIL path has no live timeline")
    extra = {
        "tee_bytes": live.get("tee_bytes", 0.0),
        "cpu_overhead": live.get("cpu_overhead", 0.0),
        "ram_overhead": live.get("ram_overhead", 0.0),
        "rss_bytes": live.get("rss_bytes", 0.0),
        "sync_time_ms": live.get("sync_time_ms", 0.0),
        "topk_top1": live.get("topk_top1", 0.0),
        "topk_top2": live.get("topk_top2", 0.0),
    }
    return [
        {"experiment": "E1", "mode": "baseline", **baseline, **extra},
        {"experiment": "E1", "mode": "prevail", **prevail, **extra},
    ]


def sweep_e2(scenario: Scenario, samples: List[Dict[str, Any]]) -> List[Dict[str, float]]:
    """E2: break-even accuracy curve from measured latencies × accuracy grid."""
    live = fetch_live_metrics() or {}
    require_measured(live, "E2")
    baseline_ms = live.get("reactive_latency_ms") or scenario.baseline.get("checkpoint_save_ms", 0) + scenario.baseline.get("checkpoint_restore_ms", 0)
    prevail_ms = live.get("warm_latency_ms") or live.get("migration_latency_ms") or 0.0
    if baseline_ms <= 0 and prevail_ms <= 0:
        raise RuntimeError("E2: live latencies are missing")
    live_acc = live.get("prediction_accuracy")
    rows = []
    for accuracy in [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]:
        expected = accuracy * prevail_ms + (1.0 - accuracy) * baseline_ms
        savings = baseline_ms - expected
        rows.append({
            "experiment": "E2",
            "metric_source": "live_timeline" if live else "scenario_baseline",
            "prediction_accuracy": accuracy,
            "baseline_ms": float(baseline_ms),
            "prevail_ms": float(prevail_ms),
            "expected_ms": expected,
            "savings_ms": savings,
            "break_even": 1.0 if savings > 0 else 0.0,
            "observed_accuracy": float(live_acc or 0.0),
            "samples_processed": float(len(samples)),
        })
    return rows


def sweep_e3(_scenario: Scenario, _samples: List[Dict[str, Any]]) -> List[Dict[str, float]]:
    """E3: observed shadow budget from the live run."""
    live = fetch_live_metrics() or {}
    require_measured(live, "E3")
    max_shadows = float(os.environ.get("PREVAIL_SPECULATION_MAX_SHADOWS", "1"))
    return [{
        "experiment": "E3",
        "metric_source": "live_timeline",
        "max_shadows": max_shadows,
        "shadows_created": live.get("shadows_created", 0.0),
        "average_sync_ratio": live.get("average_sync_ratio", 0.0),
        "sync_time_ms": live.get("sync_time_ms", 0.0),
        "tee_bytes": live.get("tee_bytes", 0.0),
        "cpu_overhead": live.get("cpu_overhead", 0.0),
        "ram_overhead": live.get("ram_overhead", 0.0),
    }]


def sweep_e4(_scenario: Scenario, _samples: List[Dict[str, Any]]) -> List[Dict[str, float]]:
    """E4: observed promotion vs fallback rate at the configured threshold."""
    live = fetch_live_metrics() or {}
    require_measured(live, "E4")
    threshold = float(os.environ.get("PREVAIL_PROMOTION_SYNC_THRESHOLD", "0.95"))
    warm = live.get("warm_count", 0.0)
    reactive = live.get("reactive_count", 0.0)
    total = warm + reactive
    if total <= 0:
        raise RuntimeError("E4: no measured promotions or reactive fallbacks")
    return [{
        "experiment": "E4",
        "metric_source": "live_timeline",
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
    if eta is None:
        for ev in reversed(snap.get("timeline") or []):
            if ev.get("event_type") == "PredictionIssued":
                payload = ev.get("payload") or {}
                if payload.get("eta_sec") not in (None, ""):
                    eta = float(payload["eta_sec"])
                    break
    if eta is None:
        import urllib.request

        for port in (8090, 8092, 8094, 8096):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/v1/prediction", timeout=2) as resp:
                    pred = json.loads(resp.read().decode("utf-8"))
                if isinstance(pred, dict) and pred.get("eta_sec") is not None:
                    eta = float(pred["eta_sec"])
                    break
            except Exception:
                continue
    sync = float(os.environ.get("PREVAIL_ESTIMATED_SYNC_SEC", "5"))
    margin = float(os.environ.get("PREVAIL_PROMOTION_MARGIN_SEC", "2"))
    if eta is None:
        raise RuntimeError("E5: live predictor ETA unavailable")
    return [{
        "experiment": "E5",
        "metric_source": "live_prediction",
        "eta_sec": float(eta),
        "estimated_sync_sec": sync,
        "promotion_margin_sec": margin,
        "gate_passes": 1.0 if float(eta) >= sync + margin else 0.0,
        "topk_top1": (fetch_live_metrics() or {}).get("topk_top1", 0.0),
        "topk_top2": (fetch_live_metrics() or {}).get("topk_top2", 0.0),
    }]


def sweep_e6(scenario: Scenario, samples: List[Dict[str, Any]]) -> List[Dict[str, float]]:
    """E6: observed fallback/wrong-prediction counts. Does not invent recovery times."""
    live = fetch_live_metrics() or {}
    require_measured(live, "E6")
    return [{
        "experiment": "E6",
        "metric_source": "live_timeline",
        "handoffs": live.get("handoff_count", float(count_handoffs(samples))),
        "wrong_prediction_count": live.get("wrong_prediction_count", 0.0),
        "reactive_count": live.get("reactive_count", 0.0),
        "warm_count": live.get("warm_count", 0.0),
        "scenario_id": float(abs(hash(scenario.id)) % 100000),
    }]


SWEEPS = {
    "E1": sweep_e1,
    "E2": sweep_e2,
    "E3": sweep_e3,
    "E4": sweep_e4,
    "E5": sweep_e5,
    "E6": sweep_e6,
}


def write_break_even_plot(experiment: str, rows: List[Dict[str, Any]]) -> None:
    if experiment != "E2" or not rows:
        return
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    plot = RESULTS_DIR / "E2_break_even.csv"
    with plot.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=["prediction_accuracy", "expected_ms", "savings_ms", "break_even"])
        writer.writeheader()
        for row in rows:
            writer.writerow({
                "prediction_accuracy": row.get("prediction_accuracy"),
                "expected_ms": row.get("expected_ms"),
                "savings_ms": row.get("savings_ms"),
                "break_even": row.get("break_even"),
            })


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
    parser.add_argument("--scenario", default=str(ROOT / "experiments" / "scenarios" / "golden.json"))
    parser.add_argument("--drive-live", action="store_true", help="Replay the scenario into the live mesh first")
    parser.add_argument("--allow-offline", action="store_true", help="Do not use. Kept only to fail explicitly.")
    args = parser.parse_args()

    if args.allow_offline:
        print("[sweep] --allow-offline is rejected; E1–E6 are live-only", file=sys.stderr)
        return 2

    scenario = load_scenario(Path(args.scenario))
    samples = read_trajectory_samples(scenario.stream_file)
    handoffs_ok = validate_handoffs(scenario, samples)
    print(f"[sweep] handoffs_valid={handoffs_ok} samples={len(samples)}")

    from experiments.live_session import drive_trajectory, require_live_mesh, wait_for_handoffs
    from experiments.plot_results import plot_rows

    backend = os.environ.get("PREVAIL_BACKEND_URL", "http://127.0.0.1:8000")
    require_live_mesh(backend)
    if args.drive_live:
        posted = drive_trajectory(samples)
        print(f"[sweep] drove {posted} live samples")
        wait_for_handoffs(backend, minimum=1, timeout_s=45)

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
            persist_to_postgres(f"run-{exp}-{int(time.time())}", scenario, rows[-1])
        write_break_even_plot(exp, rows)
        for plot in plot_rows(exp, rows, RESULTS_DIR):
            print(f"[sweep] plot {plot}")

    for p in outputs:
        print(f"[sweep] Wrote {p}")
    return 0 if handoffs_ok else 1


if __name__ == "__main__":
    sys.exit(main())
