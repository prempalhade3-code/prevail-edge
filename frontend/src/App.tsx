import { useMemo, useState } from "react";
import { SimulationViewport } from "./components/sim3d/SimulationViewport";
import { MinimapPanel } from "./components/MinimapPanel";
import { PredictionPanel } from "./components/PredictionPanel";
import { ShadowPanel } from "./components/ShadowPanel";
import { TimelinePanel } from "./components/TimelinePanel";
import { CurrentNodePanel } from "./components/CurrentNodePanel";
import { ComparisonCharts } from "./components/ComparisonCharts";
import { useLiveSnapshot } from "./hooks/useLiveSnapshot";
import { CAMERA_LABEL, CAMERA_MODES, type CameraMode } from "./components/sim3d/CameraRig";

export default function App() {
  const { snapshot, snapshotRef, connected } = useLiveSnapshot();
  const [cameraMode, setCameraMode] = useState<CameraMode>("chase");
  const [showResearch, setShowResearch] = useState(false);

  const topPred = useMemo(() => {
    if (!snapshot?.prediction?.probabilities) return null;
    return (
      Object.entries(snapshot.prediction.probabilities)
        .filter(([id]) => id !== snapshot.current_edge_id)
        .sort((a, b) => b[1] - a[1])[0] ?? null
    );
  }, [snapshot?.prediction, snapshot?.current_edge_id]);

  const topShadow = snapshot?.shadows?.[0];
  const speedKmh = Math.round((snapshot?.vehicle_speed_mps ?? 0) * 3.6);
  const sync = Math.round((topShadow?.sync_ratio ?? 0) * 100);
  const eta = snapshot?.prediction?.eta_sec;

  const handoff = snapshot?.timeline
    ?.slice()
    .reverse()
    .find((e) =>
      ["AuthorityTransferred", "EdgePromoted", "MigrationFallback", "ShadowCreated"].includes(e.event_type),
    );
  const handoffLabel =
    handoff?.event_type === "EdgePromoted"
      ? "Warm promotion"
      : handoff?.event_type === "MigrationFallback"
        ? "Reactive fallback"
        : handoff?.event_type === "ShadowCreated"
          ? "Shadow warming"
          : handoff?.event_type === "AuthorityTransferred"
            ? "Handoff complete"
            : "Cruising";

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-zinc-950 font-sans text-white">
      <div className="absolute inset-0">
        <SimulationViewport snapshotRef={snapshotRef} cameraMode={cameraMode} />
      </div>

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/55" />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-6 pt-5">
        <div className="flex items-center gap-3">
          <div className="rounded-full border border-white/10 bg-zinc-950/70 px-3 py-1.5 backdrop-blur-xl">
            <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/45">Prevail</div>
          </div>
          <span
            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
              connected
                ? "border-emerald-400/30 bg-emerald-400/15 text-emerald-300"
                : "border-white/10 bg-zinc-950/70 text-white/40"
            }`}
          >
            {connected ? "Live" : "Link"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Chip label="Edge" value={snapshot?.current_edge_id ?? "—"} tone="emerald" />
          <Chip label="Next" value={topPred ? `${topPred[0]} ${Math.round(topPred[1] * 100)}%` : "—"} tone="sky" />
          <Chip label="Shadow" value={topShadow ? `${sync}%` : "—"} tone="amber" />
        </div>
      </header>

      <aside className="pointer-events-none absolute bottom-6 left-6 z-20 w-[300px]">
        <div className="rounded-3xl border border-white/10 bg-zinc-950/70 p-5 shadow-2xl backdrop-blur-xl">
          <div className="flex items-end justify-between">
            <div>
              <div className="font-mono text-[56px] font-semibold leading-none tracking-tight">
                {speedKmh}
                <span className="ml-1 align-super text-sm font-medium text-white/35">km/h</span>
              </div>
              <div className="mt-2 font-mono text-[11px] text-white/40">
                {snapshot?.vehicle_latitude?.toFixed(5) ?? "—"} · {snapshot?.vehicle_longitude?.toFixed(5) ?? "—"}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/35">Handoff</div>
              <div className="mt-1 text-sm text-white/80">{handoffLabel}</div>
              <div className="mt-1 text-xs text-amber-300/90">{eta != null ? `ETA ${eta.toFixed(0)}s` : "—"}</div>
            </div>
          </div>
          <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-gradient-to-r from-amber-300 to-emerald-300" style={{ width: `${sync}%` }} />
          </div>
          <div className="mt-3 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-white/35">
            <span>{snapshot?.authority?.holder_edge_id ?? "edge"}</span>
            <span>→</span>
            <span>{topPred?.[0] ?? "next"}</span>
          </div>
        </div>

        <div className="pointer-events-auto mt-3 flex flex-wrap gap-1.5">
          {CAMERA_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setCameraMode(mode)}
              className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] transition ${
                cameraMode === mode
                  ? "border-white/30 bg-white text-zinc-950"
                  : "border-white/10 bg-zinc-950/60 text-white/55 hover:text-white"
              }`}
            >
              {CAMERA_LABEL[mode]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowResearch((v) => !v)}
            className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${
              showResearch
                ? "border-amber-400/40 bg-amber-400/15 text-amber-200"
                : "border-white/10 bg-zinc-950/60 text-white/55 hover:text-white"
            }`}
          >
            {showResearch ? "Close lab" : "Lab"}
          </button>
        </div>
      </aside>

      <div className="pointer-events-none absolute bottom-6 right-6 z-20 w-[280px]">
        <MinimapPanel snapshot={snapshot} />
      </div>

      {showResearch && (
        <div className="absolute bottom-6 right-[312px] top-20 z-20 w-[340px] space-y-3 overflow-y-auto pr-1">
          {snapshot?.authority && (
            <CurrentNodePanel edgeId={snapshot.current_edge_id} authority={snapshot.authority} />
          )}
          <ComparisonCharts snapshot={snapshot} />
          <PredictionPanel
            prediction={snapshot?.prediction ?? null}
            currentEdge={snapshot?.current_edge_id ?? "edge-a"}
            degraded={snapshot?.predictor_degraded}
          />
          <ShadowPanel shadows={snapshot?.shadows ?? []} />
          <TimelinePanel events={snapshot?.timeline ?? []} />
        </div>
      )}
    </div>
  );
}

function Chip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "emerald" | "sky" | "amber";
}) {
  const tones = {
    emerald: "text-emerald-300",
    sky: "text-sky-300",
    amber: "text-amber-300",
  };
  return (
    <div className="rounded-full border border-white/10 bg-zinc-950/70 px-3 py-1.5 backdrop-blur-xl">
      <span className="mr-2 text-[10px] uppercase tracking-[0.16em] text-white/35">{label}</span>
      <span className={`font-mono text-[11px] ${tones[tone]}`}>{value}</span>
    </div>
  );
}
