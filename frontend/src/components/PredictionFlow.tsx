import { pipelineProgress } from "../lib/events";
import type { TimelineEvent } from "../types";
import { Card, Eyebrow } from "./ui";

const STEPS = [
  { id: "vehicle", label: "Vehicle" },
  { id: "prediction", label: "ONNX prediction" },
  { id: "predicted-edge", label: "Predicted edge" },
  { id: "shadow", label: "Shadow created" },
  { id: "restore", label: "Flink restore" },
  { id: "sync", label: "State sync" },
  { id: "warm", label: "Warm ready" },
] as const;

export function PredictionFlow({ events }: { events: TimelineEvent[] }) {
  const active = new Set(pipelineProgress(events));
  return (
    <Card>
      <Eyebrow>Prediction → shadow flow</Eyebrow>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {STEPS.map((step, index) => {
          const on = active.has(step.id);
          return (
            <div key={step.id} className="flex items-center gap-2">
              <div
                className={`rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] transition-all duration-500 ${
                  on ? "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200" : "bg-slate-50 text-slate-400"
                }`}
              >
                {step.label}
              </div>
              {index < STEPS.length - 1 && (
                <span className={`h-px w-6 ${on ? "bg-cyan-400" : "bg-slate-200"}`} />
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-slate-500">Steps light only when matching live backend events arrive.</p>
    </Card>
  );
}
