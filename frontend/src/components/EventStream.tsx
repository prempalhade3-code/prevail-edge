import { eventLabel, payload, visibleEvents } from "../lib/events";
import { edgeLabel, fmtTime, placeName } from "../lib/format";
import type { TimelineEvent } from "../types";
import { EmptyState, SectionLabel } from "./ui";

function tone(type: string): string {
  if (/Denied|Wrong|Fail|Rejected/.test(type)) return "bg-rose-50 text-rose-700";
    if (/Transferred|Promoted|Scored|Warm/.test(type)) return "bg-blue-50 text-blue-800";
    if (/Shadow|Flink|Multicast|Tee|Sync/.test(type)) return "bg-cyan-50 text-cyan-800";
  if (/Prediction/.test(type)) return "bg-indigo-50 text-indigo-700";
  return "bg-stone-100 text-stone-600";
}

export function EventStream({ events, limit = 24 }: { events: TimelineEvent[]; limit?: number }) {
  const rows = visibleEvents(events, limit);
  return (
    <div className="panel p-5">
      <SectionLabel>Event timeline</SectionLabel>
      {rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No events available"
            detail="Prediction, shadow, and authority events stream in from the live snapshot and history API."
          />
        </div>
      ) : (
        <ul className="mt-4 max-h-[32rem] space-y-3 overflow-y-auto pr-1">
          {rows.map((event, i) => {
            const data = payload(event);
            const from = data.from || data.source;
            const to = data.to || data.to_edge || data.predicted || data.actual;
            return (
              <li key={`${event.timestamp_ms}-${event.event_type}-${i}`} className="rounded-2xl bg-stone-50/90 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone(event.event_type)}`}>
                    {eventLabel(event.event_type)}
                  </span>
                  <span className="font-mono text-xs text-stone-400">{fmtTime(event.timestamp_ms)}</span>
                </div>
                <p className="mt-2 text-sm text-stone-700">{event.message}</p>
                <p className="mt-1 text-xs text-stone-500">
                  {edgeLabel(event.edge_id)}
                  {from || to ? ` · ${placeName(from)} → ${placeName(to)}` : ""}
                  {data.latency_ms ? ` · ${data.latency_ms} ms` : ""}
                  {data.sync_ratio ? ` · sync ${data.sync_ratio}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
