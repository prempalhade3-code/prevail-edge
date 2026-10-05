import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PredictionPanel } from "../components/PredictionPanel";
import { Pipeline } from "../components/Pipeline";
import { Card, Metric, PageIntro } from "../components/ui";
import { edgeLabel, fmtPct, rankedPredictions } from "../lib/format";
import type { DriveStatus, LiveAccuracy, SystemSnapshot, TimelineEvent } from "../types";

export function PredictionPage({
  snapshot,
  events,
  drive,
  accuracy,
}: {
  snapshot: SystemSnapshot | null;
  events: TimelineEvent[];
  drive: DriveStatus | null;
  accuracy: LiveAccuracy | null;
}) {
  const ranked = rankedPredictions(snapshot?.prediction?.probabilities);
  const top1 = ranked[0];
  const top2 = ranked[1];
  const chart = ranked.map((row) => ({ name: edgeLabel(row.edge), value: Number((row.value * 100).toFixed(1)) }));

  return (
    <div className="space-y-5 px-5 py-6">
      <PageIntro
        title="AI prediction"
        detail="Live ONNX probabilities from the current snapshot. Accuracy below is scored from live handoffs, not training metrics."
      />
      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <PredictionPanel snapshot={snapshot} />
        <Card>
          <p className="text-xs font-semibold text-stone-500">Probability distribution</p>
          <div className="mt-4 h-64">
            {chart.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart}>
                  <CartesianGrid stroke="#E7E5E4" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "#78716c", fontSize: 12 }} />
                  <YAxis tick={{ fill: "#78716c", fontSize: 12 }} domain={[0, 100]} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#4f46e5" radius={[10, 10, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="pt-16 text-center text-sm text-stone-500">Waiting for a live prediction.</p>
            )}
          </div>
        </Card>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Metric live label="Top-1 now" value={top1 ? edgeLabel(top1.edge) : "—"} hint={fmtPct(top1?.value)} />
        <Metric live label="Top-2 now" value={top2 ? edgeLabel(top2.edge) : "—"} hint={fmtPct(top2?.value)} />
        <Metric live label="Live top-1 accuracy" value={fmtPct(accuracy?.live_top1_accuracy)} hint={accuracy?.source ?? "awaiting scores"} />
        <Metric live label="Handoffs scored" value={accuracy?.handoffs_scored ?? "—"} hint="Not training accuracy" />
      </div>
      <Pipeline events={events} snapshot={snapshot} drive={drive} />
    </div>
  );
}
