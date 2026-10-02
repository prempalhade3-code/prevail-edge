# PREVAIL integration tests

## Run (no external services)

```bash
pip install jsonschema pyyaml
PYTHONPATH=. python -m unittest discover -s tests/integration -v
```

## Run with Postgres

Start postgres via Compose, then:

```bash
PREVAIL_INTEGRATION_TESTS=1 PYTHONPATH=. python -m unittest tests/integration/test_postgres_schema.py -v
```

## Coverage

| Test | Scenario |
|------|----------|
| `test_trajectory_contract.py` | Fixture validates schema + region config |
| `test_experiment_runner.py` | Golden scenario dry-run + missing file error |
| `test_postgres_schema.py` | Schema tables + seed run (requires Postgres) |
