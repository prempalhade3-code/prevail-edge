import { ArrowRight, ShieldAlert } from "lucide-react";
import { latestOf, payload } from "../lib/events";
import { transferMode } from "../lib/handoff";
import { fmtMs, placeName } from "../lib/format";
import type { SystemSnapshot, TimelineEvent } from "../types";
import { EmptyState, SectionLabel, StatusPill } from "./ui";

export function HandoffStory({
  snapshot,
  events,
}: {
  snapshot: SystemSnapshot | null;
  events: TimelineEvent[];
}) {
  const transfer = latestOf(events, ["AuthorityTransferred"]);
  const wrong = latestOf(events, ["WrongPrediction"]);
  const release = latestOf(events, ["ShadowRelease", "ShadowFlinkStopped"]);
  const data = payload(transfer);
  const mode = transferMode(transfer);
  const warm = mode === "warm";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className={`panel p-5 ${transfer ? "animate-rise" : ""}`}>
        <div className="flex items-center justify-between">
          <SectionLabel>{warm ? "Warm handoff" : transfer ? "Reactive handoff" : "Authority transfer"}</SectionLabel>
          {transfer && (
            <StatusPill tone={warm ? "green" : "amber"}>{warm ? "Warm" : "Reactive"}</StatusPill>
          )}
        </div>
        {transfer ? (
          <div className="mt-4">
            <div className="flex items-center gap-3">
              <PlaceChip label={placeName(data.from)} />
              <ArrowRight className="h-4 w-4 text-stone-400" />
              <PlaceChip label={placeName(data.to || transfer.edge_id)} strong />
            </div>
            <p className="mt-4 text-3xl font-semibold tracking-tight text-ink">{fmtMs(data.latency_ms)}</p>
            <p className="mt-1 text-sm text-stone-500">
              Measured handoff latency · epoch {data.epoch || snapshot?.authority.epoch || "—"}
            </p>
            <p className="mt-3 text-sm text-stone-600">{data.reason || transfer.message}</p>
          </div>
        ) : (
          <div className="mt-4">
            <EmptyState
              title="No authority transfer yet"
              detail="A warm or reactive handoff appears from live AuthorityTransferred events."
            />
          </div>
        )}
      </div>

      <div className={`panel p-5 ${wrong ? "animate-rise" : ""}`}>
        <div className="flex items-center justify-between">
          <SectionLabel>Prediction missed</SectionLabel>
          {wrong && (
            <StatusPill tone="red">
              <ShieldAlert className="h-3.5 w-3.5" />
              Wrong prediction
            </StatusPill>
          )}
        </div>
        {wrong ? (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-rose-50 px-3 py-3">
                <p className="text-xs text-rose-700">Predicted</p>
                <p className="mt-1 font-semibold text-ink">{placeName(payload(wrong).predicted)}</p>
              </div>
              <div className="rounded-2xl bg-emerald-50 px-3 py-3">
                <p className="text-xs text-emerald-700">Actual</p>
                <p className="mt-1 font-semibold text-ink">{placeName(payload(wrong).actual || wrong.edge_id)}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-stone-600">
              <span className="rounded-full bg-stone-100 px-3 py-1">Shadow released</span>
              <span className="text-stone-300">→</span>
              <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">Reactive handoff</span>
              <span className="text-stone-300">→</span>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-800">
                {placeName(payload(wrong).actual || wrong.edge_id)} becomes authoritative
              </span>
            </div>
            {release && <p className="text-sm text-stone-500">{release.message}</p>}
            <p className="text-sm text-stone-600">{wrong.message}</p>
          </div>
        ) : (
          <div className="mt-4">
            <EmptyState
              title="No wrong-prediction event"
              detail="This panel stays quiet until the backend emits WrongPrediction."
            />
          </div>
        )}
      </div>
    </div>
  );
}

function PlaceChip({ label, strong }: { label: string; strong?: boolean }) {
  return (
    <span
      className={`rounded-2xl px-3 py-2 text-sm font-semibold ${
        strong ? "bg-ink text-white" : "bg-stone-100 text-stone-700"
      }`}
    >
      {label}
    </span>
  );
}
