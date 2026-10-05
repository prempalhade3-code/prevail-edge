import { cityFor } from "../data/cities";
import { latestOf, latestSyncRatio, payload } from "../lib/events";
import { transferMode } from "../lib/handoff";
import { edgeLabel, fmtHeading, fmtPct, fmtSpeed, placeName, rankedPredictions } from "../lib/format";
import { metersBetween } from "../lib/geo";
import type { DriveStatus, SystemSnapshot, TimelineEvent } from "../types";

export function LiveNow({
  snapshot,
  drive,
  events,
  source,
  destination,
}: {
  snapshot: SystemSnapshot | null;
  drive: DriveStatus | null;
  events: TimelineEvent[];
  source: string;
  destination: string;
}) {
  const live = Boolean(drive?.running);
  const from = live && drive?.source ? drive.source : source;
  const to = live && drive?.destination ? drive.destination : destination;
  const ranked = live ? rankedPredictions(snapshot?.prediction?.probabilities).slice(0, 3) : [];
  const shadow = live ? (snapshot?.shadows ?? []).find((s) => s.role === "WARM_SHADOW") : undefined;
  const sync = live ? latestSyncRatio(events, shadow?.sync_ratio) : undefined;
  const transfer = live ? latestOf(events, ["AuthorityTransferred"]) : undefined;
  const wrong = live ? latestOf(events, ["WrongPrediction"]) : undefined;
  const fallback = live ? latestOf(events, ["MigrationFallbackComplete"]) : undefined;
  const refused = live ? latestOf(events, ["ShadowRefused"]) : undefined;
  const mode = transferMode(transfer);
  const holder = live ? snapshot?.authority.holder_edge_id : undefined;
  const currentEdge = live ? snapshot?.current_edge_id : undefined;
  const src = cityFor(from);
  const holding =
    live &&
    snapshot?.vehicle_latitude != null &&
    snapshot.vehicle_longitude != null &&
    src &&
    metersBetween(snapshot.vehicle_latitude, snapshot.vehicle_longitude, src.latitude, src.longitude) < 90;
  const location = holding
    ? `holding at ${placeName(from)}`
    : live && snapshot?.vehicle_latitude != null
      ? `${snapshot.vehicle_latitude.toFixed(5)}, ${snapshot.vehicle_longitude?.toFixed(5)}`
      : "waiting";

  let handoff = "waiting";
  if (!live) handoff = "waiting";
  else if (fallback) handoff = "reactive handoff";
  else if (wrong) handoff = "reactive handoff";
  else if (transfer && mode === "warm") handoff = "warm handoff";
  else if (transfer && mode === "reactive") handoff = "reactive handoff";
  else if (transfer) handoff = "completed";
  else if (refused && !shadow) handoff = "waiting";
  else if (drive?.wait_for_warm) handoff = "waiting";

  let shadowState = "no active shadow";
  if (shadow) {
    if (sync != null && sync < 0.95) shadowState = `syncing ${fmtPct(sync)}`;
    else if (sync != null && sync >= 0.95) shadowState = "warm";
    else shadowState = "ready";
  }

  return (
    <section className="panel animate-rise p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-ink">live now</p>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
          {drive?.paused ? "paused" : live ? "live" : "idle"}
        </span>
      </div>

      <div className="mt-4 space-y-5">
        <Block label="vehicle">
          <p className="text-sm font-semibold text-ink">
            {placeName(from)} → {placeName(to)}
          </p>
          <p className="mt-1 text-sm text-muted">current location: {location}</p>
          <p className="mt-0.5 text-sm text-muted">speed: {live ? fmtSpeed(snapshot?.vehicle_speed_mps) : "—"}</p>
          <p className="mt-0.5 text-sm text-muted">heading: {live ? fmtHeading(snapshot?.vehicle_heading) : "—"}</p>
        </Block>

        <Block label="current edge">
          <p className="text-sm font-semibold text-ink">{currentEdge ? edgeLabel(currentEdge) : "—"}</p>
          <p className="mt-0.5 text-sm text-muted">
            {holder && currentEdge === holder ? "authoritative" : live && holder ? `authority on ${edgeLabel(holder)}` : "—"}
          </p>
        </Block>

        <Block label="ai prediction">
          {ranked.length ? (
            <>
              <p className="text-sm text-muted">next likely edge</p>
              <p className="mt-1 text-sm font-semibold text-ink">
                {edgeLabel(ranked[0].edge)} · {fmtPct(ranked[0].value)}
              </p>
              <ol className="mt-3 space-y-2">
                {ranked.slice(1).map((row) => (
                  <li key={row.edge} className="flex items-center justify-between text-sm text-muted">
                    <span>{edgeLabel(row.edge)}</span>
                    <span className="font-mono text-predict">{fmtPct(row.value)}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="text-sm text-muted">waiting for a live prediction</p>
          )}
        </Block>

        <Block label="shadow">
          {shadow ? (
            <>
              <p className="text-sm font-semibold text-ink">{edgeLabel(shadow.edge_id)}</p>
              <p className="mt-0.5 text-sm text-muted">{shadowState}</p>
            </>
          ) : (
            <p className="text-sm text-muted">no active shadow</p>
          )}
        </Block>

        <Block label="handoff">
          <p className="text-sm font-semibold text-ink">{handoff}</p>
          {wrong && (
            <p className="mt-0.5 text-sm text-muted">
              {edgeLabel(payload(wrong).predicted)} → {edgeLabel(payload(wrong).actual || wrong.edge_id)}
            </p>
          )}
        </Block>
      </div>
    </section>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line/80 pt-4 first:border-t-0 first:pt-0">
      <p className="text-sm text-muted">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}
