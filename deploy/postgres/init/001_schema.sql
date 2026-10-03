-- PREVAIL experiment and timeline schema (Ram — stream-experiments)
-- Applied automatically when postgres container starts via docker-entrypoint-initdb.d

CREATE TABLE IF NOT EXISTS runs (
    id SERIAL PRIMARY KEY,
    run_id VARCHAR(64) UNIQUE NOT NULL,
    scenario_id VARCHAR(64) NOT NULL,
    mode VARCHAR(32) NOT NULL DEFAULT 'prevail',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status VARCHAR(32) NOT NULL DEFAULT 'running'
);

CREATE TABLE IF NOT EXISTS timeline_events (
    id SERIAL PRIMARY KEY,
    run_id VARCHAR(64) NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    timestamp_ms BIGINT NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    edge_id VARCHAR(32),
    message TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_timeline_events_run_id ON timeline_events(run_id);
CREATE INDEX IF NOT EXISTS idx_timeline_events_type ON timeline_events(event_type);

-- Prevent duplicate timeline rows on backend restart / resync.
CREATE UNIQUE INDEX IF NOT EXISTS idx_timeline_events_dedupe
    ON timeline_events(run_id, timestamp_ms, event_type, message);

CREATE TABLE IF NOT EXISTS metric_samples (
    id SERIAL PRIMARY KEY,
    run_id VARCHAR(64) NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    metric_name VARCHAR(64) NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    edge_id VARCHAR(32),
    timestamp_ms BIGINT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_metric_samples_run_id ON metric_samples(run_id);
CREATE INDEX IF NOT EXISTS idx_metric_samples_name ON metric_samples(metric_name);

-- Seed reference run for dashboard development
INSERT INTO runs (run_id, scenario_id, mode, status, completed_at)
VALUES ('run-demo-1', 'golden', 'prevail', 'completed', NOW())
ON CONFLICT (run_id) DO NOTHING;
