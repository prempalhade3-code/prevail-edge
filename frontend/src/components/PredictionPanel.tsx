import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
    return (
      <div className="rounded-lg bg-prevail-panel p-4 border border-slate-700 text-slate-400">
        Waiting for predictor…
      </div>
    );
  }

  const data = Object.entries(prediction.probabilities)
    .filter(([id]) => id !== currentEdge)
    .map(([edge, value]) => ({ edge, pct: Math.round(value * 100) }))
    .sort((a, b) => b.pct - a.pct);

  return (
    <div className="rounded-lg bg-prevail-panel p-4 border border-slate-700">
      <h2 className="text-sm font-semibold text-slate-300 mb-2">Next edge prediction</h2>
      {degraded && (
        <p className="text-xs text-amber-400 mb-2 border border-amber-600/40 rounded px-2 py-1">
          Predictor unavailable — showing explicit degraded fallback
        </p>
      )}
      <ul className="space-y-1 mb-3">
        {data.map((d) => (
          <li key={d.edge} className="flex justify-between text-sm">
            <span>{d.edge}</span>
            <span className="font-mono text-prevail-accent">{d.pct}%</span>
          </li>
        ))}
      </ul>
      {prediction.eta_sec != null && (
        <p className="text-xs text-slate-400 mb-2">ETA: ~{prediction.eta_sec.toFixed(0)} seconds</p>
      )}
      <p className="text-xs text-slate-500">Model: {prediction.model_version}</p>
      <div className="h-32 mt-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <XAxis dataKey="edge" tick={{ fill: "#94a3b8", fontSize: 11 }} />
            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="pct" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
