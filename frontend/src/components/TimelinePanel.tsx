import type { TimelineEvent } from "../types";

export function TimelinePanel({ events }: { events: TimelineEvent[] }) {
  const ordered = [...events]
    .reverse()
    .filter((e) => e.event_type !== "ResourceSnapshot")
    .slice(0, 10);

  return (
    <div className="hud-panel max-h-40 overflow-y-auto p-3">
      <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Timeline</h2>
      <ul className="space-y-2">
        {ordered.map((e, i) => (
          <li key={`${e.timestamp_ms}-${i}`} className="border-l border-sky-400/50 pl-3">
            <div className="font-mono text-[10px] text-white/35">
              {new Date(e.timestamp_ms).toLocaleTimeString()}
            </div>
            <div className="text-sm text-white/85">{e.message}</div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-white/30">{e.event_type}</div>
          </li>
        ))}
        {ordered.length === 0 && <li className="text-sm text-white/40">No events yet</li>}
      </ul>
    </div>
  );
}
