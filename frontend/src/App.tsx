import { useMemo, useState } from "react";
import { SimulationViewport } from "./components/sim3d/SimulationViewport";
import { MinimapPanel } from "./components/MinimapPanel";
import { useLiveSnapshot } from "./hooks/useLiveSnapshot";
import { CAMERA_LABEL, CAMERA_MODES, type CameraMode } from "./components/sim3d/CameraRig";

function Row({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-white/8">
      <span className="text-[10px] uppercase tracking-[0.16em] text-white/40">{label}</span>
      <span className={`text-[13px] font-mono ${accent ?? "text-white/88"}`}>{value}</span>
    </div>
  );
}

export default function App() {
  const { snapshot, connected } = useLiveSnapshot();
  const [cameraMode, setCameraMode] = useState<CameraMode>("chase");

  const topPred = useMemo(() => {
    if (!snapshot?.prediction?.probabilities) return null;
    return (
      Object.entries(snapshot.prediction.probabilities)
        .filter(([id]) => id !== snapshot.current_edge_id)
        .sort((a, b) => b[1] - a[1])[0] ?? null
    );
  }, [snapshot?.prediction, snapshot?.current_edge_id]);

  const topShadow = snapshot?.shadows?.[0];
  const handoffState = snapshot?.timeline
    ?.slice()
    .reverse()
    .find((e) =>
      ["AuthorityTransferred", "EdgePromoted", "MigrationFallback", "ShadowCreated"].includes(e.event_type),
    );

  const handoffLabel =
    handoffState?.event_type === "EdgePromoted"
      ? "Warm promotion"
      : handoffState?.event_type === "MigrationFallback"
        ? "Reactive fallback"
        : handoffState?.event_type === "ShadowCreated"
          ? "Shadow preparing"
          : handoffState?.event_type === "AuthorityTransferred"
            ? "Handoff complete"
            : "—";

  const speed = snapshot?.vehicle_speed_mps ?? 0;
  const sync = topShadow?.sync_ratio ?? 0;

  return (
    <div className="h-screen w-screen overflow-hidden bg-black relative">
      <div className="absolute inset-0">
        <SimulationViewport snapshot={snapshot} cameraMode={cameraMode} />
      </div>

      <aside className="absolute top-5 left-5 z-20 w-[280px] pointer-events-auto">
        <div className="bg-black/58 backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-4 shadow-2xl">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">PREVAIL</div>
              <div className="text-lg font-semibold tracking-wide text-white/90">Mission</div>
            </div>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide ${
                connected
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "bg-white/10 text-white/45 border border-white/10"
              }`}
            >
              {connected ? "Live" : "Link"}
            </span>
          </div>

          <div className="text-[28px] leading-none font-semibold font-mono text-white mb-1">
            {Math.round(speed * 3.6)}
            <span className="text-sm text-white/40 ml-1">km/h</span>
          </div>
          <div className="text-[11px] font-mono text-white/45 mb-3">
            {snapshot?.vehicle_latitude?.toFixed(5) ?? "—"}, {snapshot?.vehicle_longitude?.toFixed(5) ?? "—"}
          </div>

          <Row label="Current edge" value={snapshot?.current_edge_id ?? "—"} accent="text-emerald-300" />
          <Row label="Authority" value={snapshot?.authority?.holder_edge_id ?? "—"} accent="text-emerald-200" />
          <Row
            label="Predicted next"
            value={topPred ? `${topPred[0]}  ${(topPred[1] * 100).toFixed(0)}%` : "—"}
            accent="text-sky-300"
          />
          <Row label="ETA" value={snapshot?.prediction?.eta_sec ? `${snapshot.prediction.eta_sec.toFixed(0)}s` : "—"} />
          <Row
            label="Shadow"
            value={topShadow ? `${topShadow.edge_id}  ${(sync * 100).toFixed(0)}%` : "—"}
            accent="text-amber-300"
          />
          <Row label="Handoff" value={handoffLabel} />

          <div className="mt-3 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-amber-400/80"
              style={{ width: `${Math.round(sync * 100)}%` }}
            />
          </div>
          <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-white/35">
            Vehicle → {snapshot?.current_edge_id ?? "edge"} → {topPred?.[0] ?? "next"} → shadow → handoff
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1">
          {CAMERA_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setCameraMode(mode)}
              className={`px-2.5 py-1 text-[10px] uppercase tracking-wide rounded-full border ${
                cameraMode === mode
                  ? "bg-white/15 text-white border-white/25"
                  : "bg-black/40 text-white/50 border-white/10 hover:text-white/80"
              }`}
            >
              {CAMERA_LABEL[mode]}
            </button>
          ))}
        </div>
      </aside>

      <div className="absolute top-5 right-5 z-20 w-[min(340px,32vw)]">
        <MinimapPanel snapshot={snapshot} />
      </div>
    </div>
  );
}
