import { EDGE_IDS } from "../types";
import { deniedImageEdges, latestOf, payload } from "../lib/events";
import { edgeLabel } from "../lib/format";
import type { TimelineEvent } from "../types";
import { Card, Eyebrow, StatusPill } from "./ui";

export function CapabilityPanel({ events }: { events: TimelineEvent[] }) {
  const denied = deniedImageEdges(events);
  const last = latestOf(events, ["ImageCapabilityDenied"]);
  return (
    <Card accent={last ? "red" : "none"}>
      <Eyebrow>Image capability</Eyebrow>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {EDGE_IDS.map((id) => {
          const known = denied.has(id) ? false : denied.size ? true : null;
          return (
            <div key={id} className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="font-mono text-sm text-slate-800">{edgeLabel(id)}</p>
              <p className="text-xs text-slate-500">
                IMAGE {known == null ? "—" : known ? "✓" : "✕"}
              </p>
            </div>
          );
        })}
      </div>
      {last ? (
        <div className="mt-4 space-y-2">
          <StatusPill tone="red">Image capability denied</StatusPill>
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            <span>Predicted {edgeLabel(payload(last).predicted || last.edge_id)}</span>
            <span>→</span>
            <span>Capability check</span>
            <span>→</span>
            <span>Denied</span>
            <span>→</span>
            <span>Next capable edge</span>
          </div>
          <p className="text-sm text-slate-600">{last.message}</p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500">
          Marks fill from live ImageCapabilityDenied events. Edges stay unknown until the backend emits one.
        </p>
      )}
    </Card>
  );
}
