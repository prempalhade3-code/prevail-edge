import type { Map as LeafletMap } from "leaflet";

export type LabelKind = "source" | "destination" | "city" | "edge";

export interface LabelSpec {
  id: string;
  lat: number;
  lng: number;
  text: string;
  kind: LabelKind;
  priority: number;
  role?: string;
  reserve?: { w: number; h: number; top: number; left: number };
}

export interface PlacedLabel extends LabelSpec {
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  align: "left" | "center" | "right";
  opacity: number;
  leader: boolean;
}

type Rect = { x: number; y: number; w: number; h: number };
type Offset = { dx: number; dy: number; align: "left" | "center" | "right" };

const COMMON: Offset[] = [
  { dx: 0, dy: 24, align: "center" },
  { dx: 0, dy: -28, align: "center" },
  { dx: 30, dy: -20, align: "left" },
  { dx: -30, dy: -20, align: "right" },
  { dx: 32, dy: 4, align: "left" },
  { dx: -32, dy: 4, align: "right" },
  { dx: 26, dy: 18, align: "left" },
  { dx: -26, dy: 18, align: "right" },
  { dx: 0, dy: 36, align: "center" },
  { dx: 0, dy: -42, align: "center" },
  { dx: 42, dy: -8, align: "left" },
  { dx: -42, dy: -8, align: "right" },
  { dx: 38, dy: 24, align: "left" },
  { dx: -38, dy: 24, align: "right" },
];

const BY_KIND: Record<LabelKind, Offset[]> = {
  edge: [
    { dx: 30, dy: -26, align: "left" },
    { dx: -30, dy: -26, align: "right" },
    { dx: 0, dy: 28, align: "center" },
    { dx: 34, dy: -6, align: "left" },
    { dx: -34, dy: -6, align: "right" },
    ...COMMON,
  ],
  source: [
    { dx: 0, dy: 26, align: "center" },
    { dx: 32, dy: -6, align: "left" },
    { dx: -32, dy: -6, align: "right" },
    { dx: 0, dy: -36, align: "center" },
    ...COMMON,
  ],
  destination: [
    { dx: 0, dy: 26, align: "center" },
    { dx: 32, dy: -6, align: "left" },
    { dx: -32, dy: -6, align: "right" },
    { dx: 0, dy: -36, align: "center" },
    ...COMMON,
  ],
  city: [
    { dx: 12, dy: -10, align: "left" },
    { dx: -12, dy: -10, align: "right" },
    { dx: 0, dy: -18, align: "center" },
    { dx: 0, dy: 14, align: "center" },
    ...COMMON,
  ],
};

function estimateSize(text: string, kind: LabelKind): { w: number; h: number } {
  const charW = kind === "edge" ? 6.1 : 6.3;
  const pad = kind === "edge" ? 6 : 4;
  return { w: Math.ceil(text.length * charW + pad * 2), h: 16 };
}

function overlaps(a: Rect, b: Rect, margin = 7): boolean {
  return !(
    a.x + a.w + margin < b.x ||
    b.x + b.w + margin < a.x ||
    a.y + a.h + margin < b.y ||
    b.y + b.h + margin < a.y
  );
}

function labelRect(x: number, y: number, w: number, h: number, align: "left" | "center" | "right"): Rect {
  if (align === "center") return { x: x - w / 2, y, w, h };
  if (align === "right") return { x: x - w, y, w, h };
  return { x, y, w, h };
}

function reserveRect(anchorX: number, anchorY: number, reserve: NonNullable<LabelSpec["reserve"]>): Rect {
  return { x: anchorX + reserve.left, y: anchorY + reserve.top, w: reserve.w, h: reserve.h };
}

function offsetsFor(spec: LabelSpec): Offset[] {
  const kindOffsets = BY_KIND[spec.kind];
  const seen = new Set<string>();
  const merged: Offset[] = [];
  for (const off of kindOffsets) {
    const key = `${off.dx}:${off.dy}:${off.align}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(off);
  }
  return merged;
}

export function placeLabels(map: LeafletMap, specs: LabelSpec[]): PlacedLabel[] {
  const sorted = [...specs].sort((a, b) => b.priority - a.priority);
  const placed: PlacedLabel[] = [];
  const occupied: Rect[] = [];
  const { x: maxW, y: maxH } = map.getSize();

  for (const spec of sorted) {
    const anchor = map.latLngToContainerPoint([spec.lat, spec.lng]);
    if (spec.reserve) occupied.push(reserveRect(anchor.x, anchor.y, spec.reserve));
  }

  for (const spec of sorted) {
    if (!spec.text) continue;
    const anchor = map.latLngToContainerPoint([spec.lat, spec.lng]);
    const size = estimateSize(spec.text, spec.kind);
    let chosen: PlacedLabel | null = null;

    for (const off of offsetsFor(spec)) {
      const rect = labelRect(anchor.x + off.dx, anchor.y + off.dy, size.w, size.h, off.align);
      if (rect.x < 8 || rect.y < 8 || rect.x + rect.w > maxW - 8 || rect.y + rect.h > maxH - 8) continue;
      if (occupied.some((o) => overlaps(rect, o))) continue;
      chosen = {
        ...spec,
        x: rect.x,
        y: rect.y,
        anchorX: anchor.x,
        anchorY: anchor.y,
        align: off.align,
        opacity: spec.kind === "city" && spec.priority < 50 ? 0.75 : 1,
        leader: Math.hypot(off.dx, off.dy) > 20,
      };
      occupied.push(rect);
      break;
    }

    if (chosen) {
      placed.push(chosen);
      continue;
    }

    if (spec.priority >= 44) {
      for (const off of offsetsFor(spec)) {
        const rect = labelRect(anchor.x + off.dx, anchor.y + off.dy, size.w, size.h, off.align);
        if (rect.x < 4 || rect.y < 4 || rect.x + rect.w > maxW - 4 || rect.y + rect.h > maxH - 4) continue;
        placed.push({
          ...spec,
          x: rect.x,
          y: rect.y,
          anchorX: anchor.x,
          anchorY: anchor.y,
          align: off.align,
          opacity: 0.82,
          leader: true,
        });
        occupied.push(rect);
        break;
      }
    }
  }

  return placed;
}
