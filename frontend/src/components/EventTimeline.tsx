import { eventLabel, visibleEvents } from "../lib/events";
import { edgeLabel, fmtTime } from "../lib/format";
import type { TimelineEvent } from "../types";
import { Card, EmptyState, Eyebrow } from "./ui";

function tone(type: string): string {
  if (/Denied|Wrong|Fail|Rejected/.test(type)) return "border-rose-300";
  if (/Transferred|Promoted|Scored/.test(type)) return "border-emerald-300";
  if (/Shadow|Flink|Multicast|Tee|Sync/.test(type)) return "border-cyan-300";
  return "border-slate-200";
}

export function EventTimeline({ events, limit = 24 }: { events: TimelineEvent[]; limit?: number }) {
  const rows = visibleEvents(events, limit);
  return (
    <Card className="min-h-0">
      <Eyebrow>Live event timeline</Eyebrow>
      {rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="No non-resource events yet" detail="Prediction, shadow, and authority events will stream in from the live snapshot." />
        </div>
      ) : (
        <ul className="mt-4 max-h-[28rem] space-y-2 overflow-y-auto pr-1">
          {rows.map((event, i) => (
            <li key={`${event.timestamp_ms}-${event.event_type}-${i}`} className={`border-l-2 pl-3 ${tone(event.event_type)}`}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-800">{eventLabel(event.event_type)}</p>
                <p className="font-mono text-[11px] text-slate-400">{fmtTime(event.timestamp_ms)}</p>
              </div>
              <p className="text-sm text-slate-600">{event.message}</p>
              <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{edgeLabel(event.edge_id)}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
