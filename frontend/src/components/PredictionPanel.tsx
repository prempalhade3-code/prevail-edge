import type { PredictionResult } from "../types";

export function PredictionPanel({
  prediction,
  currentEdge,
  degraded = false,
}: {
  prediction: PredictionResult | null;
  currentEdge: string;
  degraded?: boolean;
}) {
  if (!prediction) {
    return <div className="hud-panel p-4 text-sm text-white/45">Waiting for predictor…</div>;
  }

  const data = Object.entries(prediction.probabilities)
    .filter(([id]) => id !== currentEdge)
    .map(([edge, value]) => ({ edge, pct: Math.round(value * 100) }))
    .sort((a, b) => b.pct - a.pct);

  return (
    <div className="hud-panel p-4">
      <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Next edge</h2>
      {degraded && (
        <p className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
          Predictor degraded — fallback ranking
        </p>
      )}
      <ul className="space-y-2">
        {data.map((d) => (
          <li key={d.edge}>
            <div className="mb-1 flex justify-between font-mono text-xs">
              <span>{d.edge}</span>
              <span className="text-sky-300">{d.pct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-sky-400" style={{ width: `${d.pct}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {prediction.eta_sec != null && (
        <p className="mt-3 text-xs text-white/45">ETA ~{prediction.eta_sec.toFixed(0)}s</p>
      )}
      <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-white/30">{prediction.model_version}</p>
    </div>
  );
}
