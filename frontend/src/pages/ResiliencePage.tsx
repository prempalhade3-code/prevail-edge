import { allOf, latestOf, payload } from "../lib/events";
import { fmtTime, placeName } from "../lib/format";
import type { LiveMetrics, SystemSnapshot, TimelineEvent } from "../types";
import { Card, PageIntro, StatusPill } from "../components/ui";

const STEPS = ["Authority lost", "Failover detected", "New authority", "Epoch updated", "System recovered"];

export function ResiliencePage({
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
  const isolation = latestOf(events, ["NetworkIsolation", "EdgeIsolated", "IptablesDrop"]);
  const shadows = (snapshot?.shadows ?? []).filter((s) => s.role === "WARM_SHADOW");
  const failovers = allOf(events, ["AuthorityFailover"]);
  const progressed = failover ? (rejoin ? 5 : 4) : 0;
  const invariant = liveMetrics?.single_authority_invariant;

  return (
    <div className="space-y-5 px-5 py-6">
      <PageIntro
        title="Resilience"
        detail="Authority, epoch, and failover state from the live snapshot and timeline. Isolation is shown only when the backend emits a matching event."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <p className="text-xs font-semibold text-stone-500">Authority holder</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-ink">{placeName(snapshot?.authority.holder_edge_id)}</p>
        </Card>
        <Card>
          <p className="text-xs font-semibold text-stone-500">Current epoch</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-ink">{snapshot?.authority.epoch ?? "—"}</p>
        </Card>
        <Card>
          <p className="text-xs font-semibold text-stone-500">Warm shadows</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-ink">
            {shadows.length ? shadows.map((s) => placeName(s.edge_id)).join(", ") : "None"}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-semibold text-stone-500">Single-authority invariant</p>
          <div className="mt-3">
            <StatusPill tone={invariant == null ? "amber" : invariant ? "green" : "red"}>
              {invariant == null ? "Awaiting metrics" : invariant ? "Held" : "Split risk"}
            </StatusPill>
          </div>
        </Card>
      </div>
      <Card>
        <p className="text-xs font-semibold text-stone-500">Failover path</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div className={`rounded-2xl px-3 py-2 text-sm font-semibold ${i < progressed ? "bg-amber-50 text-amber-800" : "bg-stone-100 text-stone-400"}`}>
                {label}
              </div>
              {i < STEPS.length - 1 && <span className="h-px w-6 bg-stone-200" />}
            </div>
          ))}
        </div>
        <div className="mt-5 space-y-2 text-sm text-stone-600">
          <p>Failover status: {failover ? failover.message : "No failover in the current event window"}</p>
          <p>Rejoin: {rejoin ? `${rejoin.message} · ${placeName(payload(rejoin).holder)}` : "No rejoin event yet"}</p>
          <p>Network isolation: {isolation ? isolation.message : "No isolation event in view"}</p>
          <p>Rejected transfers: {rejected ? rejected.message : "None"}</p>
          <p>Last failover time: {failover ? fmtTime(failover.timestamp_ms) : "—"}</p>
          <p>Failover events in view: {failovers.length}</p>
        </div>
      </Card>
    </div>
  );
}
