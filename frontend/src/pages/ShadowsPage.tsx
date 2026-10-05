import { allOf, latestOf, payload } from "../lib/events";
import { fmtPct, fmtTime, placeName, roleLabel } from "../lib/format";
import type { SystemSnapshot, TimelineEvent } from "../types";
import { Card, EmptyState, PageIntro, StatusPill } from "../components/ui";

const PHASES = ["Created", "Restoring", "Syncing", "Warm", "Promoted / released"] as const;

function phaseIndex(edgeId: string, snapshot: SystemSnapshot | null, events: TimelineEvent[]): number {
  const types = new Set(events.filter((e) => !e.edge_id || e.edge_id === edgeId).map((e) => e.event_type));
  const shadow = snapshot?.shadows.find((s) => s.edge_id === edgeId);
  if (types.has("ShadowRelease") || types.has("ShadowFlinkStopped") || types.has("EdgePromoted")) return 4;
  if ((shadow && shadow.sync_ratio >= 0.95) || types.has("ShadowWarm") || types.has("EdgePromoted")) return 3;
  if (types.has("ShadowSyncUpdate") || types.has("FlinkStateAligned") || types.has("MulticastFanout")) return 2;
  if (types.has("FlinkCheckpointRestoreQueued") || types.has("ShadowFlinkArmed")) return 1;
  if (types.has("ShadowCreated") || types.has("ShadowPrepared") || types.has("ShadowFlinkStarted") || shadow) return 0;
  return -1;
}

export function ShadowsPage({ snapshot, events }: { snapshot: SystemSnapshot | null; events: TimelineEvent[] }) {
  const shadows = snapshot?.shadows ?? [];
  const started = allOf(events, ["ShadowFlinkStarted", "ShadowFlinkArmed", "ShadowCreated", "ShadowPrepared"]);
  const refused = allOf(events, ["ShadowRefused", "ShadowRelease", "ShadowFlinkStopped"]);
  const ids = Array.from(new Set([...shadows.map((s) => s.edge_id), ...started.map((e) => e.edge_id).filter(Boolean)])) as string[];
  const restore = latestOf(events, ["FlinkCheckpointRestoreQueued"]);

  return (
    <div className="px-5 py-6">
      <PageIntro
        title="Shadow Flink"
        detail="Warm-shadow lifecycle from /v1/snapshot plus restore, sync, and cancel events. Progress is never invented."
      />
      {!ids.length ? (
        <div className="space-y-4">
          <EmptyState title="No active shadow" detail="Shadows appear here after ShadowCreated / ShadowFlinkStarted events." />
          {refused[0] && (
            <Card accent="amber">
              <p className="text-sm font-semibold text-ink">{refused[0].event_type}</p>
              <p className="mt-1 text-sm text-stone-600">{refused[0].message}</p>
              <p className="mt-1 text-xs text-stone-500">{placeName(refused[0].edge_id)}</p>
            </Card>
          )}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {ids.map((id) => {
            const shadow = shadows.find((s) => s.edge_id === id);
            const start = started.find((e) => e.edge_id === id);
            const stop = latestOf(events.filter((e) => e.edge_id === id), ["ShadowFlinkStopped", "ShadowRelease"]);
            const index = phaseIndex(id, snapshot, events);
            const warm = (shadow?.sync_ratio ?? 0) >= 0.95;
            return (
              <Card key={id} accent={stop ? "red" : warm ? "green" : "teal"}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-stone-500">Target</p>
                    <h3 className="mt-1 text-2xl font-semibold tracking-tight text-ink">{placeName(id)}</h3>
                    <p className="mt-1 text-sm text-stone-500">{shadow ? roleLabel(shadow.role) : "From events"}</p>
                  </div>
                  <StatusPill tone={stop ? "red" : warm ? "green" : "teal"}>
                    {stop ? "Released" : warm ? "Warm" : "Syncing"}
                  </StatusPill>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  {PHASES.map((label, i) => (
                    <span
                      key={label}
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        i <= index ? "bg-ink text-white" : "bg-stone-100 text-stone-400"
                      }`}
                    >
                      {label}
                    </span>
                  ))}
                </div>
                <div className="mt-5 h-2 overflow-hidden rounded-full bg-stone-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-teal-500 transition-all duration-700"
                    style={{ width: `${Math.min(100, (shadow?.sync_ratio ?? 0) * 100)}%` }}
                  />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm text-stone-600">
                  <div>Source {placeName(snapshot?.authority.holder_edge_id)}</div>
                  <div>Sync {fmtPct(shadow?.sync_ratio)}</div>
                  <div>Job {payload(start).job_id || snapshot?.flink_job_id || "—"}</div>
                  <div>Created {fmtTime(start?.timestamp_ms)}</div>
                  <div>Restore {payload(restore).version ? `v${payload(restore).version}` : restore?.message || "—"}</div>
                  <div>Output {shadow?.output_suppressed ? "suppressed" : shadow ? "enabled" : "—"}</div>
                </dl>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
