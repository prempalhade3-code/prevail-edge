import type { TimelineEvent } from "../types";

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString();
}

export function TimelinePanel({ events }: { events: TimelineEvent[] }) {
  const ordered = [...events].reverse().slice(0, 20);

  return (
    <div className="rounded-lg bg-prevail-panel p-4 border border-slate-700 max-h-96 overflow-y-auto">
      <h2 className="text-sm font-semibold text-slate-300 mb-3 sticky top-0 bg-prevail-panel">
        Event timeline
      </h2>
      <ul className="space-y-2 text-sm">
        {ordered.map((e, i) => (
          <li key={`${e.timestamp_ms}-${i}`} className="border-l-2 border-prevail-accent pl-3">
            <span className="font-mono text-xs text-slate-500">{formatTime(e.timestamp_ms)}</span>
            <div className="text-slate-200">{e.message}</div>
            <div className="text-xs text-slate-500">{e.event_type}</div>
          </li>
        ))}
        {ordered.length === 0 && <li className="text-slate-500">No events yet</li>}
      </ul>
    </div>
  );
}
