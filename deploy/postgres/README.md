# PREVAIL Postgres schema

Schema for experiment runs, timeline audit events, and metric samples.

## Tables

| Table | Purpose |
|-------|---------|
| `runs` | Experiment run metadata (scenario, mode, status) |
| `timeline_events` | Authority/shadow/handoff audit trail |
| `metric_samples` | Latency and throughput metrics from Flink/experiments |

## Apply locally

With Docker Compose (automatic on first postgres start):

```bash
docker compose -f deploy/docker-compose.yml up -d postgres
```

Manual apply:

```bash
psql "$PREVAIL_DATABASE_URL" -f deploy/postgres/init/001_schema.sql
```

Default connection (Compose):

```
postgresql://prevail:prevail_password@localhost:5432/prevail
```
