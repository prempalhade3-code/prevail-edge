import type { DriveStatus, HealthStatus, LiveMetrics, NavId } from "../types";

const NAV: { id: NavId; label: string }[] = [
  { id: "live", label: "overview" },
  { id: "edges", label: "edge infrastructure" },
  { id: "prediction", label: "ai prediction" },
  { id: "shadows", label: "shadow / flink" },
  { id: "analytics", label: "analytics" },
  { id: "timeline", label: "event timeline" },
  { id: "health", label: "system health" },
  { id: "resilience", label: "resilience" },
];

function simLabel(drive: DriveStatus | null): { label: string; tone: string } {
  if (drive?.paused) return { label: "simulation paused", tone: "text-amber-800 bg-amber-50" };
  if (drive?.running) return { label: "simulation running", tone: "text-blue-800 bg-blue-50" };
  if (drive?.stopped) return { label: "simulation stopped", tone: "text-slate-600 bg-slate-100" };
  return { label: "idle", tone: "text-slate-600 bg-slate-100" };
}

export function AppHeader({
  nav,
  setNav,
  connected,
  drive,
  health,
  liveMetrics,
}: {
  nav: NavId;
  setNav: (id: NavId) => void;
  connected: boolean;
  drive: DriveStatus | null;
  health: HealthStatus | null;
  liveMetrics: LiveMetrics | null;
}) {
  const sim = simLabel(drive);
  const edgesKnown = liveMetrics?.edges_total != null;
  const edgeLabel = edgesKnown
    ? `${liveMetrics.edges_reachable ?? 0} edges${
        liveMetrics.edges_reachable === liveMetrics.edges_total ? " healthy" : ""
      }`
    : null;
  const online = connected
    ? edgeLabel
      ? `online · ${edgeLabel}`
      : "online"
    : "offline";

  return (
    <header className="shrink-0 border-b border-white/70 bg-white/80 backdrop-blur-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-4">
        <div>
          <p className="text-xl font-semibold tracking-tight text-ink">PREVAIL</p>
          <p className="text-sm text-muted">predictive edge state pre-positioning</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              connected ? "bg-blue-50 text-blue-800" : "bg-rose-50 text-rose-700"
            }`}
          >
            {online}
          </span>
          <span className={`rounded-full px-3 py-1.5 text-xs font-medium ${sim.tone}`}>{sim.label}</span>
          {health && health.status !== "ok" && (
            <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
              degraded
            </span>
          )}
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-6 py-3">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setNav(item.id)}
            className={`shrink-0 rounded-xl px-3 py-2 text-sm font-medium transition ${
              nav === item.id ? "bg-ink text-white" : "text-muted hover:bg-white hover:text-ink"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </header>
  );
}
