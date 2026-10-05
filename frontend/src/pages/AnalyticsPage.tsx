import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, Metric, PageIntro } from "../components/ui";
import { measuredLatencies } from "../lib/handoff";
import { edgeLabel, fmtMs, fmtPct } from "../lib/format";
import type { HistoryMetric, LiveAccuracy, LiveMetrics, SystemSnapshot, TimelineEvent } from "../types";

function avg(metrics: HistoryMetric[], name: string): number | null {
  const rows = metrics.filter((m) => m.metric_name === name);
  if (!rows.length) return null;
  return rows.reduce((sum, row) => sum + Number(row.value || 0), 0) / rows.length;
}

function count(metrics: HistoryMetric[], name: string): number {
  return metrics.filter((m) => m.metric_name === name).length;
}

export function AnalyticsPage({
  snapshot,
  accuracy,
  metrics,
  liveMetrics,
  events,
}: {
  snapshot: SystemSnapshot | null;
  accuracy: LiveAccuracy | null;
  metrics: HistoryMetric[];
  liveMetrics: LiveMetrics | null;
  events: TimelineEvent[];
}) {
  const fromHistoryWarm = avg(metrics, "handoff_warm");
  const fromHistoryReactive = avg(metrics, "handoff_reactive");
  const fromEvents = measuredLatencies(events);
  const warm = fromHistoryWarm ?? fromEvents.warm;
  const reactive = fromHistoryReactive ?? fromEvents.reactive;
  const chart = [
    { name: "Top-1", value: accuracy?.live_top1_accuracy },
    { name: "Top-2", value: accuracy?.live_top2_accuracy },
  ]
    .filter((row): row is { name: string; value: number } => row.value != null)
    .map((row) => ({ name: row.name, value: Number((row.value * 100).toFixed(1)) }));

  return (
    <div className="space-y-5 px-5 py-6">
      <PageIntro
        title="Analytics"
        detail="Live handoff and accuracy numbers only. Training accuracy is never shown as production accuracy."
      />
      <div className="grid gap-3 md:grid-cols-4">
        <Metric live label="Live top-1" value={fmtPct(accuracy?.live_top1_accuracy)} hint={accuracy?.source ?? "awaiting /v1/history/accuracy"} />
        <Metric live label="Live top-2" value={fmtPct(accuracy?.live_top2_accuracy)} />
        <Metric live label="Handoffs scored" value={accuracy?.handoffs_scored ?? "—"} />
        <Metric label="Training accuracy" value="Not shown" hint="Kept separate from live scores" />
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Metric live label="Warm handoff latency" value={fmtMs(warm)} />
        <Metric live label="Reactive handoff latency" value={fmtMs(reactive)} />
        <Metric live label="Warm promotions" value={count(metrics, "handoff_warm") || fromEvents.warmCount} />
        <Metric live label="Reactive fallbacks" value={count(metrics, "handoff_reactive") || fromEvents.reactiveCount} />
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Metric live label="Active shadows" value={liveMetrics?.shadow_count ?? snapshot?.shadows.length ?? "—"} />
        <Metric live label="Transitions" value={liveMetrics?.transition_count ?? "—"} />
        <Metric live label="Authority" value={edgeLabel(snapshot?.authority.holder_edge_id)} />
        <Metric live label="Single authority" value={liveMetrics ? (liveMetrics.single_authority_invariant ? "Held" : "Split") : "—"} />
      </div>
      <Card>
        <p className="text-xs font-semibold text-stone-500">Live accuracy</p>
        <div className="mt-4 h-56">
          {chart.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <CartesianGrid stroke="#E7E5E4" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "#78716c", fontSize: 12 }} />
                <YAxis tick={{ fill: "#78716c", fontSize: 12 }} domain={[0, 100]} />
                <Tooltip />
                <Bar dataKey="value" fill="#0d9488" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="pt-16 text-center text-sm text-stone-500">No scored live handoffs yet.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
