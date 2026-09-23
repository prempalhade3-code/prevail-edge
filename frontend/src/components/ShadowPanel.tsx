import type { ShadowState } from "../types";

export function ShadowPanel({ shadows }: { shadows: ShadowState[] }) {
  const warm = shadows.filter((s) => s.role === "WARM_SHADOW");

  if (warm.length === 0) {
    return (
      <div className="rounded-lg bg-prevail-panel p-4 border border-slate-700 text-slate-400 text-sm">
        No warm shadows active
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-prevail-panel p-4 border border-slate-700 space-y-3">
      <h2 className="text-sm font-semibold text-slate-300">Warm shadows</h2>
      {warm.map((s) => (
        <div key={s.edge_id} className="border border-slate-600 rounded p-3 text-sm">
          <div className="font-mono text-prevail-warm">{s.edge_id.toUpperCase()}</div>
          <div className="mt-1 text-slate-400">Synchronization: {(s.sync_ratio * 100).toFixed(0)}%</div>
          <div className="text-slate-400">
            Output: {s.output_suppressed ? "SUPPRESSED" : "ENABLED"}
          </div>
          <div className="mt-1 text-prevail-ok">
            {s.sync_ratio >= 0.95 ? "READY FOR PROMOTION" : "SYNCING…"}
          </div>
        </div>
      ))}
    </div>
  );
}
