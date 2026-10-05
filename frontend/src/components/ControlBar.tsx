import { EDGE_IDS } from "../types";
import { edgeLabel } from "../lib/format";
import type { DriveStatus } from "../types";
import { Eyebrow, StatusPill } from "./ui";

export function ControlBar({
  source,
  destination,
  setSource,
  setDestination,
  status,
  pending,
  error,
  onStart,
  onPause,
  onResume,
  onStop,
  onReset,
}: {
  source: string;
  destination: string;
  setSource: (id: string) => void;
  setDestination: (id: string) => void;
  status: DriveStatus | null;
  pending: boolean;
  error: string | null;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onReset: () => void;
}) {
  const running = Boolean(status?.running);
  const paused = Boolean(status?.paused);
  const liveSource = status?.source || source;
  const liveDest = status?.destination || destination;
  const control = status?.control || "idle";

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.05)] backdrop-blur-xl">
      <div>
        <Eyebrow>Source</Eyebrow>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800"
        >
          {EDGE_IDS.map((id) => (
            <option key={id} value={id}>
              {edgeLabel(id)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Eyebrow>Destination</Eyebrow>
        <select
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800"
        >
          {EDGE_IDS.map((id) => (
            <option key={id} value={id}>
              {edgeLabel(id)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending || running} onClick={onStart} className="btn-primary">
          Start Simulation
        </button>
        <button type="button" disabled={pending || !running || paused} onClick={onPause} className="btn-ghost">
          Pause
        </button>
        <button type="button" disabled={pending || !paused} onClick={onResume} className="btn-ghost">
          Resume
        </button>
        <button type="button" disabled={pending || (!running && !paused)} onClick={onStop} className="btn-ghost">
          Stop
        </button>
        <button type="button" disabled={pending} onClick={onReset} className="btn-ghost">
          Reset
        </button>
      </div>
      <div className="ml-auto flex flex-col items-end gap-1">
        <p className="font-mono text-sm font-semibold text-slate-800">
          {edgeLabel(liveSource)} → {edgeLabel(liveDest)}
        </p>
        <div className="flex items-center gap-2">
          <StatusPill tone={running ? (paused ? "amber" : "green") : "slate"}>{control}</StatusPill>
          {status?.posted != null && status.total != null && (
            <span className="font-mono text-xs text-slate-500">
              {status.posted}/{status.total}
            </span>
          )}
        </div>
        {error && <p className="max-w-sm text-right text-xs text-rose-600">{error}</p>}
      </div>
    </div>
  );
}
