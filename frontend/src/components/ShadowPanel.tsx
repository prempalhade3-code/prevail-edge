import type { ShadowState } from "../types";

export function ShadowPanel({ shadows }: { shadows: ShadowState[] }) {
  const warm = shadows.filter((s) => s.role === "WARM_SHADOW");

  if (warm.length === 0) {
    return <div className="hud-panel p-4 text-sm text-white/45">No warm shadows</div>;
  }

  return (
    <div className="hud-panel space-y-3 p-4">
      <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Warm shadows</h2>
      {warm.map((s) => (
        <div key={s.edge_id} className="rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="font-mono text-sm text-amber-300">{s.edge_id}</div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-amber-400" style={{ width: `${Math.round(s.sync_ratio * 100)}%` }} />
          </div>
          <div className="mt-2 text-xs text-white/50">
            {s.output_suppressed ? "Output suppressed" : "Output enabled"} ·{" "}
            {s.sync_ratio >= 0.95 ? "ready" : "syncing"}
          </div>
        </div>
      ))}
    </div>
  );
}
