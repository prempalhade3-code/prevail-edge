import { useState } from "react";
import { LiveMap } from "../components/LiveMap";
import { LiveNow } from "../components/LiveNow";
import { Pipeline } from "../components/Pipeline";
import { RecentEvents } from "../components/RecentEvents";
import { RouteBar } from "../components/RouteBar";
import { cityFor, edgeSequenceForCities } from "../data/cities";
import type { City } from "../data/cities";
import type { VehiclePose } from "../hooks/useSmoothedVehicle";
import { edgeLabel, fmtHeading, fmtSpeed, placeName } from "../lib/format";
import { metersBetween } from "../lib/geo";
import type { DriveStatus, SystemSnapshot, TimelineEvent } from "../types";

export function SimulationPage({
  snapshot,
  drive,
  pose,
  events,
  liveEvents,
  cities,
  source,
  destination,
  setSource,
  setDestination,
  pending,
  error,
  onStart,
  onPause,
  onResume,
  onStop,
  onReset,
}: {
  snapshot: SystemSnapshot | null;
  drive: DriveStatus | null;
  pose: VehiclePose;
  events: TimelineEvent[];
  liveEvents: TimelineEvent[];
  cities: City[];
  source: string;
  destination: string;
  setSource: (id: string) => void;
  setDestination: (id: string) => void;
  pending: boolean;
  error: string | null;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onReset: () => void;
}) {
  const [follow, setFollow] = useState(true);
  const live = Boolean(drive?.running);
  const from = live && drive?.source ? drive.source : source;
  const to = live && drive?.destination ? drive.destination : destination;
  const src = cityFor(from);
  const holding =
    live &&
    pose.ready &&
    src &&
    metersBetween(pose.lat, pose.lon, src.latitude, src.longitude) < 90;
  const edgePath = edgeSequenceForCities(from, to);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RouteBar
        source={source}
        destination={destination}
        setSource={setSource}
        setDestination={setDestination}
        cities={cities}
        status={drive}
        pending={pending}
        error={error}
        onStart={onStart}
        onPause={onPause}
        onResume={onResume}
        onStop={onStop}
        onReset={onReset}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-4 lg:flex-row">
        <section className="relative min-h-[58vh] flex-1 overflow-hidden rounded-[28px] border border-white/70 shadow-float lg:min-h-0 lg:w-[68%]">
          <LiveMap
            snapshot={snapshot}
            drive={drive}
            follow={follow}
            pose={pose}
            source={source}
            destination={destination}
          />
          <button
            type="button"
            onClick={() => setFollow((v) => !v)}
            className="absolute right-4 top-4 z-[1000] rounded-full bg-white/95 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-card transition hover:text-ink"
          >
            {follow ? "following vehicle" : "free pan"}
          </button>
          <div className="absolute bottom-4 left-4 z-[1000] max-w-[320px] rounded-2xl bg-ink/88 px-4 py-3 text-white shadow-float backdrop-blur">
            <p className="text-xs font-medium text-blue-200">vehicle</p>
            <p className="mt-1 text-sm font-semibold">
              {placeName(from)} → {placeName(to)}
            </p>
            <p className="mt-1 text-xs text-slate-300">
              {live ? edgeLabel(snapshot?.current_edge_id) : edgePath.map(edgeLabel).join(" → ") || "—"}
              {live ? ` · ${fmtSpeed(snapshot?.vehicle_speed_mps)} · ${fmtHeading(snapshot?.vehicle_heading)}` : ""}
            </p>
            {live && drive?.posted != null && drive.total != null && (
              <p className="mt-1 font-mono text-[11px] text-slate-400">
                {drive.posted}/{drive.total}
                {holding ? " · holding at source" : ""}
              </p>
            )}
          </div>
        </section>

        <aside className="flex min-h-0 w-full flex-col gap-4 lg:w-[32%] lg:overflow-y-auto">
          <LiveNow snapshot={snapshot} drive={drive} events={liveEvents} source={source} destination={destination} />
          <Pipeline events={liveEvents} snapshot={snapshot} drive={drive} />
          <RecentEvents events={live ? liveEvents : events} />
        </aside>
      </div>
    </div>
  );
}
