import { EDGE_IDS } from "../types";
import type { HealthStatus, LiveMetrics, SystemSnapshot } from "../types";
import { Card, Eyebrow, StatusPill } from "./ui";

function pill(ok: boolean | null): { tone: "green" | "amber" | "red"; label: string } {
  if (ok == null) return { tone: "amber", label: "Warning" };
  return ok ? { tone: "green", label: "Healthy" } : { tone: "red", label: "Offline" };
}

export function SystemHealth({
  snapshot,
  health,
  liveMetrics,
}: {
  snapshot: SystemSnapshot | null;
  health: HealthStatus | null;
  liveMetrics: LiveMetrics | null;
}) {
  const rows = [
    {
      name: "FastAPI",
      detail: health?.service ?? "awaiting /health",
      ...pill(health ? health.status === "ok" : null),
    },
    {
      name: "PostgreSQL",
      detail: health?.database ?? "awaiting /health",
      ...pill(health ? health.postgres_enabled === true && health.database === "postgresql" : null),
    },
    {
      name: "ONNX predictor",
      detail: snapshot?.prediction?.model_version ?? "awaiting prediction",
      ...pill(snapshot ? !snapshot.predictor_degraded : null),
    },
    {
      name: "Docker edges",
      detail: liveMetrics ? `${liveMetrics.edges_reachable}/${liveMetrics.edges_total} reachable` : "awaiting /v1/metrics",
      ...pill(liveMetrics ? liveMetrics.edges_reachable === liveMetrics.edges_total : null),
    },
    {
      name: "Flink jobs",
      detail: snapshot?.flink_job_id ? `job ${snapshot.flink_job_id.slice(0, 12)}…` : "job id from snapshot when present",
      ...pill(snapshot?.flink_job_id ? true : null),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <Card key={row.name}>
            <div className="flex items-start justify-between">
              <Eyebrow>{row.name}</Eyebrow>
              <StatusPill tone={row.tone}>{row.label}</StatusPill>
            </div>
            <p className="mt-3 text-sm text-slate-600">{row.detail}</p>
          </Card>
        ))}
      </div>
      <Card>
        <Eyebrow>Edge runtimes</Eyebrow>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {EDGE_IDS.map((id) => {
            const ok = snapshot?.edge_snapshots?.[id]?.reachable !== false && (liveMetrics?.edges_reachable ?? 0) > 0;
            return (
              <div key={id} className="rounded-xl bg-slate-50 px-3 py-2">
                <p className="font-mono text-sm text-slate-800">{id}</p>
                <p className="text-xs text-slate-500">{ok ? "Reachable via mesh" : "Unknown / unreachable"}</p>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Health uses /health, /v1/metrics, and snapshot fields only. Flink TaskManager IDs are not exposed by the backend API.
        </p>
      </Card>
    </div>
  );
}
