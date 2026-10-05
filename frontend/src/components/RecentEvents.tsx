import { eventLine, importantEvents } from "../lib/events";
import { fmtTime } from "../lib/format";
import type { TimelineEvent } from "../types";

export function RecentEvents({ events }: { events: TimelineEvent[] }) {
  const rows = importantEvents(events, 16).reduce<{ event: TimelineEvent; count: number }[]>((acc, event) => {
    const line = eventLine(event);
    const last = acc[acc.length - 1];
    if (last && eventLine(last.event) === line) {
      last.count += 1;
      return acc;
    }
    acc.push({ event, count: 1 });
    return acc;
  }, []).slice(0, 8);
  return (
    <section className="panel p-5">
      <p className="text-sm font-semibold text-ink">recent activity</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted">waiting for live events</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {rows.map(({ event, count }, index) => (
            <li key={`${event.timestamp_ms}-${event.event_type}-${index}`} className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-ink">
                {eventLine(event)}
                {count > 1 ? ` ×${count}` : ""}
              </p>
              <span className="shrink-0 font-mono text-xs text-slate-400">{fmtTime(event.timestamp_ms)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
