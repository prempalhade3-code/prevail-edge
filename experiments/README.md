# PREVAIL experiments

Batch runner for scenario-based PREVAIL vs baseline comparison.

## Quick start

```bash
pip install pyyaml psycopg2-binary  # optional Postgres persist
python experiments/runner.py --scenario experiments/scenarios/golden.yaml
```

Dry run (no CSV output):

```bash
python experiments/runner.py --dry-run
```

## Scenarios

| File | Description |
|------|-------------|
| `scenarios/golden.yaml` | A→A→B→B→C handoff trace |

Results land in `experiments/results/*.csv`.

## Flink integration

When `FLINK_HOME` is set and the job jar is built:

```bash
cd flink/prevail-coordinator && mvn -q install
cd ../prevail-job && mvn -q package
export FLINK_HOME=/path/to/flink
python experiments/runner.py
```

Otherwise the runner uses deterministic Python simulators for baseline and PREVAIL metrics.

## Postgres metrics

Set `PREVAIL_DATABASE_URL=postgresql://prevail:prevail_password@localhost:5432/prevail`
to persist run records and metric samples.
