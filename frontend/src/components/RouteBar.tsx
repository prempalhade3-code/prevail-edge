import { ArrowLeftRight, LoaderCircle, Pause, Play, RotateCcw, Square } from "lucide-react";
import { CitySelect } from "./CitySelect";
import { VehicleSelector } from "./vehicle/VehicleSelector";
import { edgeSequenceForRoadPath } from "../lib/roadGraphRoute";
import type { City } from "../data/cities";
import { edgeLabel, placeName } from "../lib/format";
import type { DriveStatus } from "../types";

export function RouteBar({
  source,
  destination,
  setSource,
  setDestination,
  cities,
  status,
  pending,
  error,
  onStart,
  onPause,
  onResume,
  vehicleId,
  setVehicleId,
  onStop,
  onReset,
}: {
  source: string;
  destination: string;
  setSource: (id: string) => void;
  setDestination: (id: string) => void;
  vehicleId: string;
  setVehicleId: (id: string) => void;
  cities: City[];
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
  const sameCity = source === destination;
  const edgeSeq = sameCity ? [] : edgeSequenceForRoadPath(source, destination);
  const liveMismatch = Boolean(
    running && status?.source && (status.source !== source || status.destination !== destination),
  );

  return (
    <div className="relative z-30 mx-6 mt-4 overflow-visible panel px-5 py-3">
      <div className="flex flex-wrap items-end gap-3 overflow-visible">
        <CitySelect label="from" value={source} onChange={setSource} cities={cities} />
        <button
          type="button"
          aria-label="Swap cities"
          onClick={() => {
            setSource(destination);
            setDestination(source);
          }}
          className="mb-0.5 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-white text-slate-600 transition hover:border-blue-200 hover:text-electric"
        >
          <ArrowLeftRight className="h-4 w-4" />
        </button>
        <CitySelect label="to" value={destination} onChange={setDestination} cities={cities} />
        <VehicleSelector value={vehicleId} onChange={setVehicleId} disabled={running} />
        <div className="min-w-[240px] pb-1">
          <p className="text-sm text-muted">route</p>
          <p className="text-sm font-semibold text-ink">
            {placeName(source)} → {placeName(destination)}
          </p>
          {edgeSeq.length > 0 && (
            <>
              <p className="mt-2 text-sm text-muted">edge path</p>
              <p className="text-sm font-medium text-electric">{edgeSeq.map(edgeLabel).join(" → ")}</p>
            </>
          )}
          {running && status?.posted != null && status.total != null && (
            <p className="mt-1 font-mono text-xs text-slate-500">
              {status.posted}/{status.total} ticks
            </p>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {pending && <LoaderCircle className="h-4 w-4 animate-spin text-electric" />}
          <button type="button" disabled={pending || sameCity || running} onClick={onStart} className="btn-primary">
            <Play className="h-4 w-4" />
            start simulation
          </button>
          <button type="button" disabled={pending || !running || paused} onClick={onPause} className="btn-ghost">
            <Pause className="h-4 w-4" />
            pause
          </button>
          <button type="button" disabled={pending || !paused} onClick={onResume} className="btn-primary">
            <Play className="h-4 w-4" />
            resume
          </button>
          <button type="button" disabled={pending || !running} onClick={onStop} className="btn-ghost">
            <Square className="h-4 w-4" />
            stop
          </button>
          <button type="button" disabled={pending} onClick={onReset} className="btn-ghost">
            <RotateCcw className="h-4 w-4" />
            reset
          </button>
        </div>
      </div>
      {sameCity && <p className="mt-3 text-sm text-amber-700">Choose a different destination.</p>}
      {liveMismatch && (
        <p className="mt-3 text-sm text-amber-700">
          {placeName(status?.source)} → {placeName(status?.destination)} is running. Stop it before starting a
          different route.
        </p>
      )}
      {paused && !liveMismatch && (
        <p className="mt-3 text-sm text-amber-700">Paused. Resume continues from the current vehicle position.</p>
      )}
      {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
    </div>
  );
}
