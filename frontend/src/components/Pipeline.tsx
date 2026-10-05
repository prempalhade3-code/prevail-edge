import { latestOf, latestSyncRatio, pipelineProgress } from "../lib/events";
import { fmtPct } from "../lib/format";
import type { DriveStatus, SystemSnapshot, TimelineEvent } from "../types";

const STEPS = [
  { id: "vehicle", label: "vehicle" },
  { id: "prediction", label: "ai prediction" },
  { id: "shadow", label: "shadow created" },
  { id: "sync", label: "state syncing" },
  { id: "warm", label: "warm" },
  { id: "handoff", label: "handoff" },
] as const;

export function Pipeline({
  events,
  snapshot,
  drive,
}: {
  events: TimelineEvent[];
  snapshot: SystemSnapshot | null;
  drive: DriveStatus | null;
}) {
  const live = Boolean(drive?.running);
  const sync = latestSyncRatio(
    events,
    snapshot?.shadows.find((s) => s.role === "WARM_SHADOW")?.sync_ratio,
  );
  const active = live
    ? pipelineProgress(events, {
        running: true,
        hasVehicle: snapshot?.vehicle_latitude != null,
        syncRatio: sync,
      })
    : [];
  const current = active[active.length - 1];
  const refused = live ? latestOf(events, ["ShadowRefused"]) : undefined;
  const handoffFailed = live
    ? latestOf(events, ["WrongPrediction", "MigrationFallbackComplete"])
    : undefined;
  const failedStep = handoffFailed ? "handoff" : refused && !active.includes("shadow") ? "shadow" : null;

  return (
    <section className="panel p-5">
      <p className="text-sm font-semibold text-ink">live flow</p>
      <ol className="mt-4">
        {STEPS.map((step, index) => {
          const blocked = failedStep === "shadow" && ["sync", "warm", "handoff"].includes(step.id);
          const on = !blocked && active.includes(step.id);
          const isCurrent = !blocked && step.id === current && !failedStep;
          const isFailed = failedStep === step.id;
          const done = on && !isCurrent && !isFailed;
          const syncing = step.id === "sync" && on && sync != null && sync < 0.95;
          return (
            <li key={step.id} className="relative flex items-start gap-3 pb-4 last:pb-0">
              {index < STEPS.length - 1 && (
                <span
                  className={`absolute left-[7px] top-4 h-[calc(100%-8px)] w-px ${
                    done || isCurrent ? "bg-blue-300" : "bg-slate-200"
                  }`}
                />
              )}
              <span
                className={`relative z-10 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] leading-none ${
                  isFailed
                    ? "border-rose-400 bg-rose-500 text-white"
                    : isCurrent
                      ? "border-blue-600 bg-blue-600 text-white shadow-[0_0_0_4px_rgba(37,99,235,0.16)]"
                      : done
                        ? "border-blue-500 bg-blue-500 text-white"
                        : "border-slate-300 bg-white text-transparent"
                }`}
              >
                {done ? "✓" : isCurrent ? "●" : isFailed ? "!" : "○"}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-medium ${
                    isFailed ? "text-rose-700" : isCurrent || done ? "text-ink" : "text-slate-400"
                  }`}
                >
                  {step.label}
                </p>
                {syncing && <p className="mt-0.5 font-mono text-xs text-sync">{fmtPct(sync, 0)}</p>}
                {isFailed && <p className="mt-0.5 text-xs text-rose-600">failed</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
