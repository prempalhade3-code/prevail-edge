# PREVAIL experiments

Batch runner for **live** PREVAIL vs reactive-fallback measurements.

Requires `./scripts/run-prevail-demo.sh` so `/v1/snapshot` has `AuthorityTransferred.latency_ms`.

```bash
python experiments/sweep.py --experiment ALL --scenario experiments/scenarios/golden.yaml
python experiments/runner.py --scenario experiments/scenarios/golden.yaml
```

If the mesh is down, CSVs are written with `metric_source=unavailable` and zeros — they do **not** invent 45/550 ms.

Image-capability scenario:

```bash
PREVAIL_REQUIRE_IMAGE_CAPABILITY=true python experiments/runner.py \
  --scenario experiments/scenarios/image-capability.yaml
```

Set `PREVAIL_DATABASE_URL` (Postgres or `sqlite:///experiments/prevail-timeline.db`) to persist metric samples.
