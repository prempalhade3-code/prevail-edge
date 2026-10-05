import type { ShadowState } from "../types";

function roleTone(role: string): string {
  if (role === "AUTHORITATIVE") return "text-emerald-300";
  if (role === "WARM_SHADOW") return "text-amber-300";
  return "text-white/50";
}

export function ShadowPanel({ shadows }: { shadows: ShadowState[] }) {
  if (shadows.length === 0) {
    return <div className="hud-panel p-4 text-sm text-white/45">No edge shadow state yet</div>;
  }

  return (
    <div className="hud-panel space-y-3 p-4">
      <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Edges</h2>
      {shadows.map((s) => (
        <div key={s.edge_id} className="rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="flex items-center justify-between">
            <div className={`font-mono text-sm ${roleTone(s.role)}`}>{s.edge_id}</div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-white/40">{s.role}</div>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-amber-400" style={{ width: `${Math.round(s.sync_ratio * 100)}%` }} />
          </div>
          <div className="mt-2 text-xs text-white/50">
            sync {(s.sync_ratio * 100).toFixed(0)}% · {s.output_suppressed ? "output suppressed" : "output enabled"}
          </div>
        </div>
      ))}
    </div>
  );
}
