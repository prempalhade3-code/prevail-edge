import { payload } from "./events";
import type { TimelineEvent } from "../types";

function num(data: Record<string, string>, key: string): number | null {
  const raw = data[key];
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function transferMode(event?: TimelineEvent): "warm" | "reactive" | null {
  if (!event) return null;
  const data = payload(event);
  const mode = (data.transfer_mode || data.mode || "").toLowerCase();
  if (mode === "warm") return "warm";
  if (mode === "reactive") return "reactive";
  if (event.message.toLowerCase().includes("reactive")) return "reactive";
  if (event.message.toLowerCase().includes("warm")) return "warm";
  return null;
}

export function measuredLatencies(events: TimelineEvent[]) {
  const warm: number[] = [];
  const reactive: number[] = [];
  const starts = new Map<string, number>();

  for (const ev of events) {
    const data = payload(ev);
    const target = data.to_edge || data.to || ev.edge_id;
    if (ev.event_type === "HandoffDetected" && target) {
      starts.set(target, ev.timestamp_ms);
    }
    if (ev.event_type !== "AuthorityTransferred") continue;
    const explicit = num(data, "latency_ms");
    const paired =
      target && starts.has(target) ? ev.timestamp_ms - (starts.get(target) ?? ev.timestamp_ms) : null;
    const latency = explicit ?? (paired != null && paired > 0 ? paired : null);
    if (latency == null || latency < 0) continue;
    const mode = transferMode(ev) ?? "warm";
    if (mode === "reactive") reactive.push(latency);
    else warm.push(latency);
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    warm: avg(warm),
    reactive: avg(reactive),
    warmCount: warm.length,
    reactiveCount: reactive.length,
    total: events.filter((e) => e.event_type === "AuthorityTransferred").length,
  };
}
