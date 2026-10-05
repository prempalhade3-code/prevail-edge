import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { edgeLabel, fmtMs, fmtPct } from "../lib/format";
import type { HistoryMetric, LiveAccuracy, LiveMetrics, SystemSnapshot } from "../types";
import { Card, Eyebrow, Metric } from "./ui";

function avg(metrics: HistoryMetric[], name: string): number | null {
  const rows = metrics.filter((m) => m.metric_name === name);
  if (!rows.length) return null;
  return rows.reduce((sum, row) => sum + Number(row.value || 0), 0) / rows.length;
}

function count(metrics: HistoryMetric[], name: string): number {
  return metrics.filter((m) => m.metric_name === name).length;
}

export function AnalyticsTab({
  snapshot,
  accuracy,
  metrics,
  liveMetrics,
}: {
  snapshot: SystemSnapshot | null;
  accuracy: LiveAccuracy | null;
  metrics: HistoryMetric[];
  liveMetrics: LiveMetrics | null;
}) {
  const warm = avg(metrics, "handoff_warm");
  const reactive = avg(metrics, "handoff_reactive");
  const chart = [
    { name: "Top-1", value: (accuracy?.live_top1_accuracy ?? 0) * 100 },
    { name: "Top-2", value: (accuracy?.live_top2_accuracy ?? 0) * 100 },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric live label="Live top-1" value={fmtPct(accuracy?.live_top1_accuracy)} />
        <Metric live label="Live top-2" value={fmtPct(accuracy?.live_top2_accuracy)} />
        <Metric live label="Handoffs scored" value={accuracy?.handoffs_scored ?? 0} />
        <Metric live label="Accuracy source" value={accuracy?.source ?? "—"} />
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Metric live label="Warm latency" value={fmtMs(warm)} />
        <Metric live label="Reactive latency" value={fmtMs(reactive)} />
        <Metric live label="Warm samples" value={count(metrics, "handoff_warm")} />
        <Metric live label="Reactive samples" value={count(metrics, "handoff_reactive")} />
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Metric live label="Active shadows" value={liveMetrics?.shadow_count ?? snapshot?.shadows.length ?? 0} />
        <Metric live label="Restores" value={count(metrics, "flinkstatealigned")} />
        <Metric live label="Shadow starts" value={count(metrics, "shadowflinkstarted")} />
        <Metric live label="Sync ratio" value={fmtPct(avg(metrics, "shadow_sync_ratio"))} />
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Metric live label="Authority" value={edgeLabel(snapshot?.authority.holder_edge_id)} />
        <Metric live label="Epoch" value={snapshot?.authority.epoch ?? "—"} />
        <Metric live label="Failovers" value={count(metrics, "authorityfailover")} />
        <Metric live label="Single authority" value={liveMetrics ? String(liveMetrics.single_authority_invariant) : "—"} />
      </div>
      <Card>
        <Eyebrow>Live accuracy</Eyebrow>
        <div className="mt-4 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}>
              <CartesianGrid stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "#64748B", fontSize: 12 }} />
              <YAxis tick={{ fill: "#64748B", fontSize: 12 }} domain={[0, 100]} />
              <Tooltip />
              <Bar dataKey="value" fill="#0891B2" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
