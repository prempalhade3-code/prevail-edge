import { Brain } from "lucide-react";
import { allEdgeProbabilities, edgeLabel, fmtPct, topPredicted } from "../lib/format";
import type { SystemSnapshot } from "../types";
import { EmptyState, SectionLabel, StatusPill } from "./ui";

export function PredictionPanel({ snapshot }: { snapshot: SystemSnapshot | null }) {
  const prediction = snapshot?.prediction;
  const top = topPredicted(prediction?.probabilities);
  const ranked = allEdgeProbabilities(prediction?.probabilities).sort((a, b) => b.value - a.value);

  if (!prediction) {
    return (
      <div className="panel p-5">
        <SectionLabel>Next edge prediction</SectionLabel>
        <div className="mt-4">
          <EmptyState
            title="No prediction yet"
            detail="Start a simulation so the ONNX predictor can score the next edge."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="panel p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionLabel>Next edge prediction</SectionLabel>
          <p className="mt-2 flex items-center gap-2 text-xl font-semibold tracking-tight text-ink">
            <Brain className="h-5 w-5 text-indigo-600" />
            {edgeLabel(top.edge)}
          </p>
          <p className="mt-1 text-sm text-stone-500">{fmtPct(top.confidence)} confidence</p>
        </div>
        <StatusPill tone={snapshot?.predictor_degraded ? "amber" : "indigo"}>
          {snapshot?.predictor_degraded ? "Degraded" : "ONNX live"}
        </StatusPill>
      </div>
      <ol className="mt-5 space-y-3">
        {ranked.map((row, index) => (
          <li key={row.edge}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-medium text-stone-700">
                {index + 1}. {edgeLabel(row.edge)}
              </span>
              <span className="font-mono text-stone-600">{fmtPct(row.value)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-stone-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-teal-500 transition-all duration-700"
                style={{ width: `${Math.max(2, row.value * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ol>
      {prediction.model_version && (
        <p className="mt-4 text-xs text-stone-400">{prediction.model_version}</p>
      )}
    </div>
  );
}
