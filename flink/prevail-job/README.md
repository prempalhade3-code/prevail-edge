# PREVAIL Flink Stream Job

Ram's stream workload: keyed vehicle state, sidecar output gating, baseline migration latency model.

## Build

Install coordinator first (SidecarClient dependency):

```bash
cd ../prevail-coordinator && mvn -q install
cd ../prevail-job && mvn -q package
```

## Run locally (requires Flink distribution)

```bash
export FLINK_HOME=/path/to/flink-1.18.1
$FLINK_HOME/bin/flink run -c dev.prevail.job.PrevailStreamJob \
  target/prevail-job-0.1.0-SNAPSHOT.jar \
  --stream ../../sim/fixtures/sample-trajectory.jsonl \
  --mode prevail
```

## Baseline mode

```bash
$FLINK_HOME/bin/flink run -c dev.prevail.job.PrevailStreamJob \
  target/prevail-job-0.1.0-SNAPSHOT.jar \
  --stream ../../sim/fixtures/sample-trajectory.jsonl \
  --mode baseline
```

## Sidecar gating

Set `PREVAIL_SIDECAR_URL=http://127.0.0.1:8090` (Rust runtime). When sidecar is unreachable, output is allowed for local file-source testing.

## Tests

```bash
mvn test
```
