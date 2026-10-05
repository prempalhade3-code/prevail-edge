import { allEdgeProbabilities, edgeLabel, fmtHeading, fmtPct, fmtSpeed, topPredicted } from "../lib/format";
import type { SystemSnapshot } from "../types";
import { Card, EmptyState, Eyebrow, StatusPill } from "./ui";

export function PredictionCard({ snapshot }: { snapshot: SystemSnapshot | null }) {
  const prediction = snapshot?.prediction;
  const top = topPredicted(prediction?.probabilities);
  if (!prediction) {
    return (
      <Card>
        <Eyebrow>Next edge prediction</Eyebrow>
        <EmptyState title="No live prediction yet" detail="Start a simulation so the ONNX predictor can score the next edge." />
      </Card>
    );
  }

  return (
    <Card accent="cyan">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Eyebrow>Next edge prediction</Eyebrow>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900">{edgeLabel(top.edge)}</p>
          <p className="text-sm text-slate-500">Confidence {fmtPct(top.confidence)}</p>
        </div>
        <StatusPill tone={snapshot?.predictor_degraded ? "amber" : "green"}>
          {snapshot?.predictor_degraded ? "Degraded" : "ONNX"}
        </StatusPill>
      </div>
      <ul className="mt-4 space-y-2">
        {allEdgeProbabilities(prediction.probabilities).map((row) => (
          <li key={row.edge}>
            <div className="mb-1 flex justify-between font-mono text-xs text-slate-600">
              <span>{edgeLabel(row.edge)}</span>
              <span>{fmtPct(row.value, 1)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-500"
                style={{ width: `${Math.max(1, row.value * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-slate-500">
        <p>Speed {fmtSpeed(snapshot?.vehicle_speed_mps)}</p>
        <p>Heading {fmtHeading(snapshot?.vehicle_heading)}</p>
        <p>Now {edgeLabel(snapshot?.current_edge_id)}</p>
      </div>
      <p className="mt-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">{prediction.model_version}</p>
    </Card>
  );
}
