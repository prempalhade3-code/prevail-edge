import { cityFor } from "../data/cities";
import { EDGE_IDS } from "../types";

export function placeName(id?: string | null): string {
  return cityFor(id)?.name ?? (id ? edgeLabel(id) : "—");
}

export function edgeLabel(id?: string | null): string {
  if (!id) return "—";
  const match = id.match(/edge-([a-d])/i);
  if (match) return `edge ${match[1].toLowerCase()}`;
  return id;
}

export function edgeShort(id?: string | null): string {
  if (!id) return "—";
  const match = id.match(/edge-([a-d])/i);
  return match ? match[1].toUpperCase() : id;
}

export function fmtCoord(value?: number, digits = 5): string {
  return value == null || Number.isNaN(value) ? "—" : value.toFixed(digits);
}

export function fmtSpeed(value?: number): string {
  return value == null || Number.isNaN(value) ? "—" : `${value.toFixed(1)} m/s`;
}

export function fmtHeading(value?: number): string {
  return value == null || Number.isNaN(value) ? "—" : `${Math.round(value)}°`;
}

export function fmtPct(value?: number | null, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—";
  const pct = value <= 1 ? value * 100 : value;
  return `${pct.toFixed(digits)}%`;
}

export function fmtMs(value?: string | number | null): string {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? `${Math.round(n)} ms` : "—";
}

export function fmtTime(ms?: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString();
}

export function topPredicted(probabilities?: Record<string, number> | null): {
  edge: string | null;
  confidence: number | null;
} {
  if (!probabilities) return { edge: null, confidence: null };
  const entries = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return { edge: null, confidence: null };
  return { edge: entries[0][0], confidence: entries[0][1] };
}

export function rankedPredictions(probabilities?: Record<string, number> | null): {
  edge: string;
  value: number;
}[] {
  if (!probabilities) return [];
  return Object.entries(probabilities)
    .map(([edge, value]) => ({ edge, value }))
    .sort((a, b) => b.value - a.value);
}

export function allEdgeProbabilities(probabilities?: Record<string, number> | null): {
  edge: string;
  value: number;
}[] {
  return EDGE_IDS.map((edge) => ({ edge, value: probabilities?.[edge] ?? 0 }));
}

export function roleFromTopology(
  edgeId: string,
  holder?: string,
  shadows?: { edge_id: string; role: string }[],
  topologyRole?: string,
): string {
  if (holder && edgeId === holder) return "AUTHORITATIVE";
  const shadow = shadows?.find((s) => s.edge_id === edgeId);
  if (shadow?.role === "WARM_SHADOW") return "WARM_SHADOW";
  if (topologyRole && topologyRole !== "IDLE") return topologyRole;
  if (holder && edgeId !== holder) return "FOLLOWER";
  return topologyRole || "IDLE";
}

export function roleLabel(role?: string): string {
  if (role === "AUTHORITATIVE") return "authority";
  if (role === "WARM_SHADOW") return "shadow";
  if (role === "FOLLOWER") return "follower";
  if (role === "FAILED") return "unavailable";
  return "available";
}
