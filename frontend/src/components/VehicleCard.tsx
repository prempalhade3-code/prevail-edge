import { edgeLabel, fmtCoord, fmtHeading, fmtSpeed } from "../lib/format";
import type { DriveStatus, SystemSnapshot } from "../types";
import { Card, Eyebrow, StatusPill } from "./ui";

export function VehicleCard({
  snapshot,
  drive,
}: {
  snapshot: SystemSnapshot | null;
  drive: DriveStatus | null;
}) {
  const control = drive?.control || (drive?.running ? "running" : "idle");
  return (
    <Card>
      <div className="flex items-start justify-between">
        <Eyebrow>Vehicle</Eyebrow>
        <StatusPill tone={drive?.running ? (drive.paused ? "amber" : "green") : "slate"}>{control}</StatusPill>
      </div>
      <p className="mt-3 font-mono text-3xl font-semibold tracking-tight text-slate-900">
        {edgeLabel(snapshot?.current_edge_id)}
      </p>
      <p className="mt-2 font-mono text-sm text-slate-500">
        {fmtCoord(snapshot?.vehicle_latitude)}, {fmtCoord(snapshot?.vehicle_longitude)}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Speed</p>
          <p className="font-mono text-slate-800">{fmtSpeed(snapshot?.vehicle_speed_mps)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Heading</p>
          <p className="font-mono text-slate-800">{fmtHeading(snapshot?.vehicle_heading)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Destination</p>
          <p className="font-mono text-slate-800">{edgeLabel(drive?.destination)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Session</p>
          <p className="font-mono text-slate-800">{snapshot?.session_id ?? "—"}</p>
        </div>
      </div>
    </Card>
  );
}
