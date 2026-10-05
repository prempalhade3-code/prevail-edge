import { latestOf, payload } from "../lib/events";
import { edgeLabel, fmtMs } from "../lib/format";
import type { SystemSnapshot, TimelineEvent } from "../types";
import { Card, EmptyState, Eyebrow, StatusPill } from "./ui";

export function AuthorityFlow({ snapshot, events }: { snapshot: SystemSnapshot | null; events: TimelineEvent[] }) {
  const transfer = latestOf(events, ["AuthorityTransferred"]);
  const wrong = latestOf(events, ["WrongPrediction"]);
  const failover = latestOf(events, ["AuthorityFailover"]);
  const data = payload(transfer);
  const mode = (data.transfer_mode || data.mode || "").toLowerCase();
  const warm = mode === "warm";

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card accent={transfer ? (warm ? "green" : "amber") : "none"}>
        <Eyebrow>Authority flow</Eyebrow>
        {transfer ? (
          <>
            <div className="mt-4 flex items-center gap-3">
              <span className="rounded-xl bg-slate-50 px-3 py-2 font-mono text-sm">{edgeLabel(data.from)}</span>
              <span className={`text-xs font-semibold uppercase tracking-[0.16em] ${warm ? "text-emerald-600" : "text-amber-600"}`}>
                {warm ? "Warm promotion" : "Reactive fallback"}
              </span>
              <span className="rounded-xl bg-slate-50 px-3 py-2 font-mono text-sm">{edgeLabel(data.to || transfer.edge_id)}</span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-sm text-slate-600">
              <div>Epoch <span className="font-mono text-slate-900">{data.epoch || snapshot?.authority.epoch}</span></div>
              <div>Latency <span className="font-mono text-slate-900">{fmtMs(data.latency_ms)}</span></div>
              <div className="col-span-2">Reason <span className="text-slate-800">{data.reason || transfer.message}</span></div>
            </dl>
          </>
        ) : (
          <div className="mt-4">
            <EmptyState title="No authority transfer yet" detail="A warm or reactive handoff will appear from live AuthorityTransferred events." />
          </div>
        )}
      </Card>
      <Card accent={wrong ? "red" : failover ? "amber" : "none"}>
        <Eyebrow>Exception path</Eyebrow>
        {wrong ? (
          <div className="mt-4 space-y-2">
            <StatusPill tone="red">Wrong prediction</StatusPill>
            <p className="font-mono text-sm">Predicted → {edgeLabel(payload(wrong).predicted)}</p>
            <p className="font-mono text-sm">Actual → {edgeLabel(payload(wrong).actual || wrong.edge_id)}</p>
            <p className="text-sm text-slate-500">{wrong.message}</p>
          </div>
        ) : failover ? (
          <div className="mt-4 space-y-2">
            <StatusPill tone="amber">Failover</StatusPill>
            <p className="text-sm text-slate-700">{failover.message}</p>
            <p className="font-mono text-xs text-slate-500">epoch {payload(failover).epoch || snapshot?.authority.epoch}</p>
          </div>
        ) : (
          <div className="mt-4">
            <EmptyState title="No wrong-prediction or failover event" detail="These cards stay quiet until the backend emits the matching event." />
          </div>
        )}
      </Card>
    </div>
  );
}
