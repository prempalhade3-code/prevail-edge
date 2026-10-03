#!/usr/bin/env python3
"""Batch experiment runner — executes scenario YAML and exports metrics CSV."""

from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import yaml
except ImportError:
    yaml = None  # type: ignore

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from python.mobility.session_config import get_session_id  # noqa: E402


ROOT = Path(__file__).resolve().parents[1]
RESULTS_DIR = ROOT / "experiments" / "results"


@dataclass
class Scenario:
    id: str
    description: str
    stream_file: Path
    session_id: str
    mode: str
    repeats: int
    expected_handoffs: List[Dict[str, str]] = field(default_factory=list)
    baseline: Dict[str, float] = field(default_factory=dict)
    metrics: List[str] = field(default_factory=list)


def load_scenario(path: Path) -> Scenario:
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".json":
        raw = json.loads(text)
    elif yaml is not None:
        raw = yaml.safe_load(text)
    else:
        raise RuntimeError("PyYAML required for .yaml scenarios: pip install pyyaml")
    stream = ROOT / raw["stream_file"]
    return Scenario(
        id=raw["id"],
        description=raw.get("description", ""),
        stream_file=stream,
        session_id=raw.get("session_id") or get_session_id(),
        mode=raw.get("mode", "prevail"),
        repeats=int(raw.get("repeats", 1)),
        expected_handoffs=raw.get("expected_handoffs", []),
        baseline=raw.get("baseline", {}),
        metrics=raw.get("metrics", []),
    )


def read_trajectory_samples(path: Path) -> List[Dict[str, Any]]:
    samples = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            samples.append(json.loads(line))
    return samples


def count_handoffs(samples: List[Dict[str, Any]]) -> int:
    count = 0
    last_edge: Optional[str] = None
    for sample in samples:
        edge = sample["edge_id"]
        if last_edge is not None and edge != last_edge:
            count += 1
        last_edge = edge
    return count


def simulate_baseline_migration(scenario: Scenario, samples: List[Dict[str, Any]]) -> Dict[str, float]:
    """Prefer measured reactive transfers from the live mesh."""
    from experiments.metrics import fetch_live_metrics

    live = fetch_live_metrics()
    if live and live.get("reactive_count", 0) > 0:
        return {
            **live,
            "migration_latency_ms": live["reactive_latency_ms"],
            "samples_processed": float(len(samples)),
            "metric_source": "live_reactive",
        }
    handoffs = count_handoffs(samples)
    return {
        "migration_latency_ms": 0.0,
        "samples_processed": float(len(samples)),
        "handoff_count": float(handoffs),
        "metric_source": "unavailable",
        "live_runtime": 0.0,
    }


def simulate_prevail_path(scenario: Scenario, samples: List[Dict[str, Any]]) -> Dict[str, float]:
    """PREVAIL path — live timeline only. Never invent 45 ms."""
    from experiments.metrics import fetch_live_metrics

    live = fetch_live_metrics()
    if live is not None:
        live["samples_processed"] = float(len(samples))
        live["metric_source"] = "live_timeline"
        return live
    return {
        "migration_latency_ms": 0.0,
        "samples_processed": float(len(samples)),
        "handoff_count": 0.0,
        "metric_source": "unavailable",
        "live_runtime": 0.0,
    }


def run_flink_job_if_available(stream_file: Path, mode: str) -> Optional[Dict[str, float]]:
    """Run packaged Flink job when Maven jar exists and FLINK_HOME is set."""
    flink_home = os.environ.get("FLINK_HOME")
    jar = ROOT / "flink" / "prevail-job" / "target" / "prevail-job-0.1.0-SNAPSHOT.jar"
    if not flink_home or not jar.exists():
        return None
    cmd = [
        f"{flink_home}/bin/flink",
        "run",
        "-c",
        "dev.prevail.job.PrevailStreamJob",
        str(jar),
        "--stream",
        str(stream_file),
        "--mode",
        mode,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120, check=False)
        if result.returncode != 0:
            print(f"[runner] Flink job failed: {result.stderr}", file=sys.stderr)
            return None
        for line in result.stdout.splitlines():
            if line.startswith("METRICS_JSON:"):
                return json.loads(line.split(":", 1)[1])
    except (subprocess.TimeoutExpired, OSError) as exc:
        print(f"[runner] Flink unavailable: {exc}", file=sys.stderr)
    return None


def persist_to_postgres(run_id: str, scenario: Scenario, metrics: Dict[str, float]) -> None:
    db_url = os.environ.get("PREVAIL_DATABASE_URL")
    if not db_url:
        return
    numeric = {k: float(v) for k, v in metrics.items() if isinstance(v, (int, float))}
    if "sqlite" in db_url or db_url.endswith(".db"):
        import sqlite3

        path = db_url.replace("sqlite:///", "").replace("sqlite://", "")
        conn = sqlite3.connect(path)
        try:
            conn.execute(
                """
                INSERT INTO runs (run_id, scenario_id, mode, status)
                VALUES (?, ?, ?, 'completed')
                ON CONFLICT(run_id) DO UPDATE SET status = 'completed'
                """,
                (run_id, scenario.id, scenario.mode),
            )
            ts = int(time.time() * 1000)
            for name, value in numeric.items():
                conn.execute(
                    """
                    INSERT INTO metric_samples (run_id, metric_name, value, edge_id, timestamp_ms, metadata)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (run_id, name, value, scenario.id, ts, json.dumps({"mode": scenario.mode})),
                )
            conn.commit()
        finally:
            conn.close()
        return
    try:
        import psycopg2
    except ImportError:
        print("[runner] psycopg2 not installed; skipping Postgres persist", file=sys.stderr)
        return

    conn = psycopg2.connect(db_url)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO runs (run_id, scenario_id, mode, status, completed_at)
                VALUES (%s, %s, %s, 'completed', NOW())
                ON CONFLICT (run_id) DO UPDATE SET status = 'completed', completed_at = NOW()
                """,
                (run_id, scenario.id, scenario.mode),
            )
            ts = int(time.time() * 1000)
            for name, value in numeric.items():
                cur.execute(
                    """
                    INSERT INTO metric_samples (run_id, metric_name, value, edge_id, timestamp_ms, metadata)
                    VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                    """,
                    (run_id, name, value, scenario.id, ts, json.dumps({"mode": scenario.mode})),
                )
        conn.commit()
    finally:
        conn.close()


def write_csv(run_id: str, scenario: Scenario, metrics: Dict[str, float], iteration: int) -> Path:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    out = RESULTS_DIR / f"{scenario.id}_{run_id}_iter{iteration}.csv"
    with out.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["run_id", "scenario_id", "mode", "metric_name", "value", "timestamp_ms"])
        ts = int(time.time() * 1000)
        for name, value in metrics.items():
            writer.writerow([run_id, scenario.id, scenario.mode, name, value, ts])
    return out


def run_scenario(scenario_path: Path, dry_run: bool = False) -> List[Path]:
    scenario = load_scenario(scenario_path)
    if not scenario.stream_file.exists():
        raise FileNotFoundError(f"Stream file not found: {scenario.stream_file}")

    samples = read_trajectory_samples(scenario.stream_file)
    outputs: List[Path] = []

    print(f"[runner] Scenario={scenario.id} mode={scenario.mode} repeats={scenario.repeats}")
    print(f"[runner] Stream={scenario.stream_file} samples={len(samples)}")

    for i in range(scenario.repeats):
        run_id = f"run-{scenario.id}-{uuid.uuid4().hex[:8]}"
        metrics = run_flink_job_if_available(scenario.stream_file, scenario.mode)
        if metrics is None:
            if scenario.mode == "baseline":
                metrics = simulate_baseline_migration(scenario, samples)
            else:
                metrics = simulate_prevail_path(scenario, samples)

        print(f"[runner] iter={i + 1} run_id={run_id} metrics={metrics}")

        if not dry_run:
            out = write_csv(run_id, scenario, metrics, i + 1)
            outputs.append(out)
            persist_to_postgres(run_id, scenario, metrics)

    return outputs


def main() -> int:
    parser = argparse.ArgumentParser(description="PREVAIL experiment batch runner")
    parser.add_argument(
        "--scenario",
        default=str(ROOT / "experiments" / "scenarios" / "golden.yaml"),
        help="Path to scenario YAML",
    )
    parser.add_argument("--dry-run", action="store_true", help="Compute metrics without writing files")
    args = parser.parse_args()

    try:
        outputs = run_scenario(Path(args.scenario), dry_run=args.dry_run)
        for path in outputs:
            print(f"[runner] Wrote {path}")
        return 0
    except Exception as exc:
        print(f"[runner] ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
