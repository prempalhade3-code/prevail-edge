import { Gauge, Navigation } from "lucide-react";
import { fmtCoord, fmtHeading, fmtSpeed, placeName } from "../lib/format";
import type { DriveStatus, SystemSnapshot } from "../types";
import { SectionLabel, StatusPill } from "./ui";

export function VehiclePanel({
  snapshot,
  drive,
}: {
  snapshot: SystemSnapshot | null;
  drive: DriveStatus | null;
}) {
  const running = Boolean(drive?.running);
  const paused = Boolean(drive?.paused);
  const hasFix = snapshot?.vehicle_latitude != null && snapshot?.vehicle_longitude != null;
  const tone = paused ? "amber" : running ? "teal" : "slate";
  const label = paused ? "Paused" : running ? "Moving" : "Waiting for simulation";

  return (
    <div className="panel p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionLabel>Vehicle</SectionLabel>
          <p className="mt-2 text-xl font-semibold tracking-tight text-ink">
            {hasFix ? placeName(snapshot?.current_edge_id) : "No live fix yet"}
          </p>
        </div>
        <StatusPill tone={tone}>{label}</StatusPill>
      </div>
      <p className="mt-2 font-mono text-sm text-stone-500">
        {fmtCoord(snapshot?.vehicle_latitude)}, {fmtCoord(snapshot?.vehicle_longitude)}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="flex items-center gap-1 text-xs text-stone-500">
            <Gauge className="h-3.5 w-3.5" /> Speed
          </p>
          <p className="mt-1 font-semibold text-ink">{fmtSpeed(snapshot?.vehicle_speed_mps)}</p>
        </div>
        <div>
          <p className="flex items-center gap-1 text-xs text-stone-500">
            <Navigation className="h-3.5 w-3.5" /> Heading
          </p>
          <p className="mt-1 font-semibold text-ink">{fmtHeading(snapshot?.vehicle_heading)}</p>
        </div>
        <div>
          <p className="text-xs text-stone-500">Current edge</p>
          <p className="mt-1 font-semibold text-ink">{placeName(snapshot?.current_edge_id)}</p>
        </div>
        <div>
          <p className="text-xs text-stone-500">Destination</p>
          <p className="mt-1 font-semibold text-ink">{placeName(drive?.destination)}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between text-xs text-stone-500">
        <span>Session {snapshot?.session_id ? snapshot.session_id.slice(0, 10) : "—"}</span>
        <span>{drive?.control ?? "idle"}</span>
      </div>
    </div>
  );
}
