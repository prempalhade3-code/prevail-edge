import { EngineViewport } from "./components/EngineViewport";
import { MinimapPanel } from "./components/MinimapPanel";
import { CurrentNodePanel } from "./components/CurrentNodePanel";
import { PredictionPanel } from "./components/PredictionPanel";
import { ShadowPanel } from "./components/ShadowPanel";
import { TimelinePanel } from "./components/TimelinePanel";
import { useLiveSnapshot } from "./hooks/useLiveSnapshot";

export default function App() {
  const { snapshot, connected, error } = useLiveSnapshot();

  return (
    <div className="min-h-screen bg-[#06080f] text-slate-100">
      <header className="flex items-center justify-between px-4 py-2 border-b border-slate-800/80 bg-black/40 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-black tracking-widest text-cyan-400">PREVAIL</h1>
          <span className="text-[10px] text-slate-500 uppercase tracking-wider hidden sm:inline">
            CARLA Engine · Edge Computing Simulation
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wide ${
              connected
                ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                : "bg-red-950 text-red-400 border border-red-800"
            }`}
          >
            {connected ? "● PREVAIL Live" : "○ Reconnecting"}
          </span>
        </div>
      </header>

      {error && (
        <div className="mx-4 mt-2 p-2 rounded bg-amber-950/80 border border-amber-800 text-amber-200 text-xs">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-3 p-3 h-[calc(100vh-52px)]">
        {/* PRIMARY: CARLA / Unreal game-engine video stream (NOT browser WebGL) */}
        <div className="flex flex-col gap-3 min-h-0">
          <div className="flex-1 min-h-[420px]">
            <EngineViewport />
          </div>
          <div className="h-32 shrink-0">
            <TimelinePanel events={snapshot?.timeline ?? []} />
          </div>
        </div>

        {/* SIDE: geographic map + PREVAIL intelligence (separate from 3D engine) */}
        <aside className="flex flex-col gap-3 overflow-y-auto min-h-0">
          <MinimapPanel snapshot={snapshot} />
          <CurrentNodePanel
            edgeId={snapshot?.current_edge_id ?? "edge-a"}
            authority={
              snapshot?.authority ?? {
                session_id: "—",
                epoch: 0,
                holder_edge_id: "edge-a",
                signature: "",
              }
            }
          />
          <PredictionPanel
            prediction={snapshot?.prediction ?? null}
            currentEdge={snapshot?.current_edge_id ?? "edge-a"}
          />
          <ShadowPanel shadows={snapshot?.shadows ?? []} />
        </aside>
      </div>
    </div>
  );
}
