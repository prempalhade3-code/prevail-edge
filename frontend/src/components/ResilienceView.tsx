import { allOf, latestOf, payload } from "../lib/events";
import { edgeLabel, fmtTime } from "../lib/format";
import type { LiveMetrics, SystemSnapshot, TimelineEvent } from "../types";
import { Card, Eyebrow, StatusPill } from "./ui";

const STEPS = ["Authority lost", "Failover detected", "New authority", "Epoch updated", "System recovered"];

export function ResilienceView({
  snapshot,
  events,
  liveMetrics,
}: {
  snapshot: SystemSnapshot | null;
  events: TimelineEvent[];
  liveMetrics: LiveMetrics | null;
}) {
  const failover = latestOf(events, ["AuthorityFailover"]);
  const rejoin = latestOf(events, ["AuthorityRejoinAdopted"]);
  const rejected = latestOf(events, ["AuthorityTransferRejected"]);
  const shadows = (snapshot?.shadows ?? []).filter((s) => s.role === "WARM_SHADOW");
  const failovers = allOf(events, ["AuthorityFailover"]);
  const progressed = failover ? (rejoin ? 5 : 4) : 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <Eyebrow>Current authority</Eyebrow>
          <p className="mt-2 font-mono text-2xl text-slate-900">{edgeLabel(snapshot?.authority.holder_edge_id)}</p>
        </Card>
        <Card>
          <Eyebrow>Epoch</Eyebrow>
          <p className="mt-2 font-mono text-2xl text-slate-900">{snapshot?.authority.epoch ?? "—"}</p>
        </Card>
        <Card>
          <Eyebrow>Warm backups</Eyebrow>
          <p className="mt-2 font-mono text-2xl text-slate-900">
            {shadows.length ? shadows.map((s) => edgeLabel(s.edge_id)).join(", ") : "—"}
          </p>
        </Card>
        <Card>
          <Eyebrow>Single-authority</Eyebrow>
          <div className="mt-3">
            <StatusPill tone={liveMetrics?.single_authority_invariant ? "green" : "red"}>
              {liveMetrics?.single_authority_invariant ? "Invariant held" : "Split risk"}
            </StatusPill>
          </div>
        </Card>
      </div>
      <Card>
        <Eyebrow>Failover path</Eyebrow>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div className={`rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] ${i < progressed ? "bg-amber-50 text-amber-700" : "bg-slate-50 text-slate-400"}`}>
                {label}
              </div>
              {i < STEPS.length - 1 && <span className="h-px w-6 bg-slate-200" />}
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-1 text-sm text-slate-600">
          <p>Last failover: {failover ? `${failover.message} · ${fmtTime(failover.timestamp_ms)}` : "none in the live event window"}</p>
          <p>Recovery: {rejoin ? `${rejoin.message} holder ${edgeLabel(payload(rejoin).holder)}` : "no rejoin event yet"}</p>
          <p>Rejected transfers: {rejected ? rejected.message : "none"}</p>
          <p>Failover events in view: {failovers.length}</p>
        </div>
      </Card>
    </div>
  );
}
