import { EDGE_IDS } from "../types";
import { placeName } from "../lib/format";
import type { HealthStatus, LiveMetrics, SystemSnapshot } from "../types";
import { Card, PageIntro, StatusPill } from "../components/ui";

function pill(ok: boolean | null): { tone: "green" | "amber" | "red"; label: string } {
  if (ok == null) return { tone: "amber", label: "Warning" };
  return ok ? { tone: "green", label: "Healthy" } : { tone: "red", label: "Offline" };
}

export function HealthPage({
  snapshot,
  health,
  liveMetrics,
  connected,
}: {
  snapshot: SystemSnapshot | null;
  health: HealthStatus | null;
  liveMetrics: LiveMetrics | null;
  connected: boolean;
}) {
  const rows = [
    {
      name: "FastAPI",
      detail: health?.service ?? "Waiting for /health",
      ...pill(health ? health.status === "ok" : connected ? null : false),
    },
    {
      name: "Docker mesh",
      detail: liveMetrics ? `${liveMetrics.edges_reachable}/${liveMetrics.edges_total} edges reachable` : "Waiting for /v1/metrics",
      ...pill(liveMetrics ? liveMetrics.edges_reachable === liveMetrics.edges_total : null),
    },
    {
      name: "Flink JobManager",
      detail: snapshot?.flink_job_id ? `Job ${snapshot.flink_job_id.slice(0, 16)}` : "Job id appears in the snapshot when a job is known",
      ...pill(snapshot?.flink_job_id ? true : null),
    },
    {
      name: "TaskManagers",
      detail: "TaskManager identities are not exposed by the backend API",
      ...pill(null),
    },
    {
      name: "PostgreSQL",
      detail: health?.database ?? "Waiting for /health",
      ...pill(health ? health.postgres_enabled === true && health.database === "postgresql" : null),
    },
    {
      name: "ONNX predictor",
      detail: snapshot?.prediction?.model_version ?? "Waiting for a prediction",
      ...pill(snapshot ? !snapshot.predictor_degraded : null),
    },
  ];

  return (
    <div className="px-5 py-6">
      <PageIntro
        title="System health"
        detail="Statuses are derived only from /health, /v1/metrics, and the live snapshot. Missing data stays as a warning."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <Card key={row.name}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-semibold text-ink">{row.name}</h3>
              <StatusPill tone={row.tone}>{row.label}</StatusPill>
            </div>
            <p className="mt-3 text-sm text-stone-500">{row.detail}</p>
          </Card>
        ))}
      </div>
      <Card className="mt-4">
        <p className="text-xs font-semibold text-stone-500">Edge runtimes</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {EDGE_IDS.map((id) => {
            const reachable = snapshot?.edge_snapshots?.[id]?.reachable;
            return (
              <div key={id} className="rounded-2xl bg-stone-50 px-4 py-3">
                <p className="font-semibold text-ink">{placeName(id)}</p>
                <p className="mt-1 text-sm text-stone-500">
                  {reachable == null ? "Awaiting snapshot" : reachable ? "Reachable" : "Unreachable"}
                </p>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
