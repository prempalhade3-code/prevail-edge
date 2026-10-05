import { allOf, latestOf, payload } from "../lib/events";
import { edgeLabel, fmtPct, fmtTime } from "../lib/format";
import type { SystemSnapshot, TimelineEvent } from "../types";
import { Card, EmptyState, Eyebrow, StatusPill } from "./ui";

export function ShadowFlinkPanel({ snapshot, events }: { snapshot: SystemSnapshot | null; events: TimelineEvent[] }) {
  const shadows = snapshot?.shadows ?? [];
  const started = allOf(events, ["ShadowFlinkStarted", "ShadowFlinkArmed"]);
  const stopped = allOf(events, ["ShadowFlinkStopped"]);
  const restore = latestOf(events, ["FlinkCheckpointRestoreQueued"]);

  if (!shadows.length && !started.length) {
    return (
      <Card>
        <Eyebrow>Shadow Flink</Eyebrow>
        <div className="mt-4">
          <EmptyState title="No shadow Flink jobs" detail="Warm shadows appear here from /v1/snapshot and ShadowFlinkStarted events." />
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {shadows.map((shadow) => {
        const start = started.find((e) => e.edge_id === shadow.edge_id);
        const stop = stopped.find((e) => e.edge_id === shadow.edge_id);
        const warm = shadow.sync_ratio >= 0.95;
        return (
          <Card key={shadow.edge_id} accent={warm ? "green" : "cyan"}>
            <div className="flex items-start justify-between">
              <div>
                <Eyebrow>{edgeLabel(shadow.edge_id)}</Eyebrow>
                <p className="mt-2 font-mono text-lg text-slate-900">{shadow.role.replaceAll("_", " ")}</p>
              </div>
              <StatusPill tone={stop ? "red" : warm ? "green" : "cyan"}>
                {stop ? "Canceled" : warm ? "Warm ready" : "Syncing"}
              </StatusPill>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-700"
                style={{ width: `${Math.min(100, shadow.sync_ratio * 100)}%` }}
              />
            </div>
            <p className="mt-2 font-mono text-sm text-slate-600">SYNC {fmtPct(shadow.sync_ratio)}</p>
            <dl className="mt-3 space-y-1 text-xs text-slate-500">
              <div>Job {payload(start).job_id || snapshot?.flink_job_id || "—"}</div>
              <div>Created {fmtTime(start?.timestamp_ms)}</div>
              <div>Restore {payload(restore).version ? `v${payload(restore).version}` : restore?.message || "—"}</div>
              <div>Output {shadow.output_suppressed ? "suppressed" : "enabled"}</div>
            </dl>
          </Card>
        );
      })}
    </div>
  );
}
