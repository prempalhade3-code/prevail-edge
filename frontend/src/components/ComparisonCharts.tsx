import type { SystemSnapshot, TimelineEvent } from "../types";

function num(payload: Record<string, string> | undefined, key: string): number | null {
  const raw = payload?.[key];
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function measuredLatencies(events: TimelineEvent[]) {
  const warm: number[] = [];
  const reactive: number[] = [];
  const starts = new Map<string, number>();

  for (const ev of events) {
    const target = ev.payload?.to_edge || ev.payload?.to || ev.edge_id;
    if (ev.event_type === "HandoffDetected" && target) {
      starts.set(target, ev.timestamp_ms);
    }
    if (ev.event_type !== "AuthorityTransferred") continue;
    const explicit = num(ev.payload, "latency_ms");
    const paired =
      target && starts.has(target)
        ? ev.timestamp_ms - (starts.get(target) ?? ev.timestamp_ms)
        : null;
    const latency = explicit ?? (paired != null && paired > 0 ? paired : null);
    if (latency == null || latency < 0) continue;
    const mode = ev.payload?.transfer_mode || (ev.message.includes("reactive") ? "reactive" : "warm");
    if (mode === "reactive") reactive.push(latency);
    else warm.push(latency);
  }

  const avg = (xs: number[]) =>
    xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;

  return {
    warm: avg(warm),
    reactive: avg(reactive),
    warmCount: warm.length,
    reactiveCount: reactive.length,
    total: events.filter((e) => e.event_type === "AuthorityTransferred").length,
  };
}

export function ComparisonCharts({ snapshot }: { snapshot: SystemSnapshot | null }) {
  const events: TimelineEvent[] = snapshot?.timeline ?? [];
  const stats = measuredLatencies(events);
  const hasWarm = stats.warm != null;
  const hasReactive = stats.reactive != null;
  const maxBar = Math.max(stats.warm ?? 1, stats.reactive ?? 1);
  const reduction =
    hasWarm && hasReactive && (stats.reactive ?? 0) > 0
      ? Math.round((((stats.reactive ?? 0) - (stats.warm ?? 0)) / (stats.reactive ?? 1)) * 100)
      : null;

  return (
    <div className="bg-black/58 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-[0.18em] text-white/50 font-semibold">
          Measured handoff latency
        </h3>
        <span className="text-[10px] px-2 py-0.5 rounded-full border border-white/15 text-white/55">
          {hasWarm || hasReactive ? "Live timeline" : "Waiting for handoff"}
        </span>
      </div>

      {!hasWarm && !hasReactive ? (
        <p className="text-[11px] text-white/45">
          No completed transfers yet. Warm vs reactive numbers appear after the first
          AuthorityTransferred event with a measured latency_ms.
        </p>
      ) : (
        <div className="space-y-3 mb-4">
          <div>
            <div className="flex justify-between text-[11px] font-mono text-white/70 mb-1">
              <span>Reactive fallback</span>
              <span className="text-rose-400 font-semibold">
                {hasReactive ? `${stats.reactive} ms` : "—"}
              </span>
            </div>
            <div className="h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-rose-500/80"
                style={{ width: hasReactive ? "100%" : "0%" }}
              />
            </div>
            <p className="text-[9px] text-white/35 mt-0.5">
              {stats.reactiveCount} measured MigrationFallback transfer{stats.reactiveCount === 1 ? "" : "s"}
            </p>
          </div>
          <div>
            <div className="flex justify-between text-[11px] font-mono text-white/70 mb-1">
              <span>Warm promotion</span>
              <span className="text-emerald-400 font-semibold">
                {hasWarm ? `${stats.warm} ms` : "—"}
              </span>
            </div>
            <div className="h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-emerald-400"
                style={{
                  width: hasWarm ? `${Math.min(100, Math.max(8, ((stats.warm ?? 0) / maxBar) * 100))}%` : "0%",
                }}
              />
            </div>
            <p className="text-[9px] text-white/35 mt-0.5">
              {stats.warmCount} measured warm promotion{stats.warmCount === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-center pt-2 border-t border-white/10">
        <div className="bg-white/5 p-2 rounded-lg border border-white/5">
          <div className="text-[10px] text-white/40 uppercase tracking-wider">Transfers</div>
          <div className="text-base font-bold font-mono text-white/90">{stats.total}</div>
        </div>
        <div className="bg-white/5 p-2 rounded-lg border border-white/5">
          <div className="text-[10px] text-white/40 uppercase tracking-wider">Saving</div>
          <div className="text-base font-bold font-mono text-emerald-300">
            {reduction == null ? "—" : `${reduction}%`}
          </div>
        </div>
      </div>
    </div>
  );
}
