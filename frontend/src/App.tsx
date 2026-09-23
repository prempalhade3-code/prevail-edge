import { EdgeMap } from "./components/EdgeMap";
import { CurrentNodePanel } from "./components/CurrentNodePanel";
import { PredictionPanel } from "./components/PredictionPanel";
import { ShadowPanel } from "./components/ShadowPanel";
import { TimelinePanel } from "./components/TimelinePanel";
import { useLiveSnapshot } from "./hooks/useLiveSnapshot";

export default function App() {
  const { snapshot, connected, error, advanceDemo } = useLiveSnapshot();

  return (
    <div className="min-h-screen p-4 md:p-6 max-w-7xl mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">PREVAIL</h1>
          <p className="text-sm text-slate-400">
            Predict · Pre-position · Promote · Continue
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs px-2 py-1 rounded ${connected ? "bg-emerald-900 text-emerald-300" : "bg-red-900 text-red-300"}`}
          >
            {connected ? "Live" : "Polling / reconnecting"}
          </span>
          <button
            type="button"
            onClick={() => advanceDemo().catch(console.error)}
            className="px-4 py-2 rounded bg-prevail-accent hover:bg-blue-600 text-sm font-medium"
          >
            Advance demo step
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 p-3 rounded bg-amber-950 border border-amber-700 text-amber-200 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <EdgeMap snapshot={snapshot} />
          <TimelinePanel events={snapshot?.timeline ?? []} />
        </div>
        <div className="space-y-4">
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
        </div>
      </div>

      <footer className="mt-8 text-xs text-slate-600 text-center">
        Mode: {snapshot?.mode ?? "—"} · Run: {snapshot?.run_id ?? "—"}
      </footer>
    </div>
  );
}
