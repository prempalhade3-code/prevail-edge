import type { TimelineEvent } from "../types";

const NOISE = new Set(["ResourceSnapshot"]);

export function visibleEvents(events: TimelineEvent[] | undefined, limit = 80): TimelineEvent[] {
  return [...(events ?? [])]
    .filter((e) => !NOISE.has(e.event_type))
    .sort((a, b) => b.timestamp_ms - a.timestamp_ms)
    .slice(0, limit);
}

export function latestOf(events: TimelineEvent[] | undefined, types: string[]): TimelineEvent | undefined {
  return visibleEvents(events, 400).find((e) => types.includes(e.event_type));
}

export function allOf(events: TimelineEvent[] | undefined, types: string[]): TimelineEvent[] {
  return visibleEvents(events, 400).filter((e) => types.includes(e.event_type));
}

export function payload(event?: TimelineEvent): Record<string, string> {
  const raw = event?.payload;
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return raw;
}

export function deniedImageEdges(events: TimelineEvent[] | undefined): Set<string> {
  const denied = new Set<string>();
  for (const event of allOf(events, ["ImageCapabilityDenied"])) {
    const predicted = payload(event).predicted || event.edge_id;
    if (predicted) denied.add(predicted);
  }
  return denied;
}

export function mergeEvents(left: TimelineEvent[] = [], right: TimelineEvent[] = []): TimelineEvent[] {
  const seen = new Set<string>();
  const out: TimelineEvent[] = [];
  for (const event of [...left, ...right]) {
    const key = `${event.timestamp_ms}|${event.event_type}|${event.edge_id ?? ""}|${event.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...event, payload: payload(event) });
  }
  return out.sort((a, b) => b.timestamp_ms - a.timestamp_ms);
}

export type PipelineStep =
  | "vehicle"
  | "prediction"
  | "predicted-edge"
  | "shadow"
  | "restore"
  | "sync"
  | "warm"
  | "handoff";

export function pipelineProgress(
  events: TimelineEvent[] | undefined,
  opts?: { running?: boolean; hasVehicle?: boolean; syncRatio?: number },
): PipelineStep[] {
  const types = new Set(visibleEvents(events, 200).map((e) => e.event_type));
  const steps: PipelineStep[] = [];
  if (opts?.hasVehicle || opts?.running || types.has("PredictionIssued")) {
    steps.push("vehicle");
  }
  if (types.has("PredictionIssued") || types.has("PredictionUpdated") || types.has("SpeculationDecision")) {
    steps.push("prediction", "predicted-edge");
  }
  if (types.has("ShadowCreated") || types.has("ShadowPrepared") || types.has("ShadowFlinkStarted")) {
    steps.push("shadow");
  }
  if (types.has("FlinkCheckpointRestoreQueued") || types.has("ShadowFlinkArmed") || types.has("FlinkStateAligned")) {
    steps.push("restore");
  }
  if (
    steps.includes("shadow") &&
    (types.has("ShadowSyncUpdate") || types.has("FlinkStateAligned") || types.has("TeeBytes") || types.has("MulticastFanout"))
  ) {
    steps.push("sync");
  }
  if (
    types.has("ShadowWarm") ||
    types.has("EdgePromoted") ||
    (opts?.syncRatio != null && opts.syncRatio >= 0.95) ||
    visibleEvents(events, 80).some(
      (e) => e.event_type === "ShadowSyncUpdate" && Number(payload(e).sync_ratio || 0) >= 0.95,
    )
  ) {
    steps.push("warm");
  }
  if (types.has("AuthorityTransferred") || types.has("EdgePromoted")) {
    steps.push("handoff");
  }
  return steps;
}

const IMPORTANT = new Set([
  "PredictionIssued",
  "PredictionUpdated",
  "ShadowCreated",
  "ShadowPrepared",
  "ShadowFlinkStarted",
  "ShadowFlinkArmed",
  "FlinkCheckpointRestoreQueued",
  "FlinkStateAligned",
  "ShadowSyncUpdate",
  "ShadowWarm",
  "EdgePromoted",
  "AuthorityTransferred",
  "WrongPrediction",
  "ShadowRelease",
  "ShadowRefused",
  "ShadowFlinkStopped",
  "MigrationFallbackComplete",
]);

export function importantEvents(events: TimelineEvent[] | undefined, limit = 5): TimelineEvent[] {
  return visibleEvents(events, 400)
    .filter((event) => IMPORTANT.has(event.event_type))
    .slice(0, limit);
}

const EVENT_LABELS: Record<string, string> = {
  PredictionIssued: "Prediction issued",
  PredictionUpdated: "Prediction updated",
  ShadowCreated: "Shadow created",
  ShadowPrepared: "Shadow prepared",
  ShadowFlinkStarted: "Flink shadow started",
  ShadowFlinkArmed: "Flink shadow armed",
  FlinkCheckpointRestoreQueued: "State restore queued",
  FlinkStateAligned: "State aligned",
  ShadowSyncUpdate: "State synchronization",
  ShadowWarm: "Shadow reached warm state",
  EdgePromoted: "Edge promoted",
  AuthorityTransferred: "Authority transferred",
  WrongPrediction: "Reactive fallback triggered",
  ShadowRelease: "Shadow released",
  ShadowRefused: "Shadow refused",
  ShadowFlinkStopped: "Flink shadow stopped",
  MigrationFallbackComplete: "Reactive fallback completed",
};

export function eventLabel(type?: string): string {
  if (!type) return "event";
  return (EVENT_LABELS[type] ?? type.replace(/([a-z])([A-Z])/g, "$1 $2")).toLowerCase();
}

export function eventLine(event: TimelineEvent): string {
  const data = payload(event);
  const edge = event.edge_id || data.to || data.actual || data.predicted;
  const sync = Number(data.sync_ratio);
  if (event.event_type === "ShadowSyncUpdate" && Number.isFinite(sync)) {
    return `state sync ${Math.round((sync <= 1 ? sync * 100 : sync))}%`;
  }
  if (event.event_type === "ShadowCreated" && edge) return `shadow created on ${edge.replace("edge-", "edge ")}`;
  if (event.event_type === "AuthorityTransferred" && edge) return `authority transferred to ${edge.replace("edge-", "edge ")}`;
  if (event.event_type === "WrongPrediction") return "wrong prediction";
  if (event.event_type === "MigrationFallbackComplete") return "reactive handoff";
  if (event.event_type === "ShadowWarm") return "shadow warm";
  return eventLabel(event.event_type);
}

export function latestSyncRatio(events: TimelineEvent[] | undefined, fallback?: number): number | undefined {
  const sync = latestOf(events, ["ShadowSyncUpdate"]);
  if (sync) {
    const value = Number(payload(sync).sync_ratio);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}
