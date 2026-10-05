import { latestOf, payload } from "../lib/events";
import { edgeLabel, fmtPct } from "../lib/format";
import type { SystemSnapshot, TimelineEvent } from "../types";
import { Card, Eyebrow, StatusPill } from "./ui";

export function StateReplication({ snapshot, events }: { snapshot: SystemSnapshot | null; events: TimelineEvent[] }) {
  const fanout = latestOf(events, ["MulticastFanout"]);
  const align = latestOf(events, ["FlinkStateAligned"]);
  const shadows = (snapshot?.shadows ?? []).filter((s) => s.role === "WARM_SHADOW");
  const holder = snapshot?.authority.holder_edge_id;
  return (
    <Card>
      <div className="flex items-start justify-between">
        <Eyebrow>State replication</Eyebrow>
        <StatusPill tone={shadows.length ? "cyan" : "slate"}>{shadows.length ? "Tee active" : "Idle"}</StatusPill>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Authoritative</p>
          <p className="font-mono text-lg text-slate-900">{edgeLabel(holder)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Tee bytes</p>
          <p className="font-mono text-lg text-slate-900">{snapshot?.tee_bytes ?? 0}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Targets</p>
          <p className="font-mono text-lg text-slate-900">
            {shadows.length ? shadows.map((s) => edgeLabel(s.edge_id)).join(", ") : "—"}
          </p>
        </div>
      </div>
      {shadows.length > 0 && (
        <div className="mt-4 flex items-center gap-3">
          <div className="rounded-full bg-emerald-50 px-3 py-1 font-mono text-xs text-emerald-700">{edgeLabel(holder)}</div>
          <div className="relative h-px flex-1 overflow-hidden bg-cyan-100">
            <div className="absolute inset-y-0 w-8 animate-pulse bg-cyan-400" />
          </div>
          <div className="flex gap-2">
            {shadows.map((s) => (
              <div key={s.edge_id} className="rounded-full bg-cyan-50 px-3 py-1 font-mono text-xs text-cyan-700">
                {edgeLabel(s.edge_id)} {fmtPct(s.sync_ratio, 0)}
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">
        {fanout ? fanout.message : "Multicast events appear when the authority tees the live stream."}
        {align ? ` · ${align.message} v${payload(align).version || ""}` : ""}
      </p>
    </Card>
  );
}
