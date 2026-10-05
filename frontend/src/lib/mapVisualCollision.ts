import type { Map as LeafletMap } from "leaflet";

export type VisualKind = "tower" | "source" | "destination" | "city";

export interface VisualSpec {
  id: string;
  lat: number;
  lng: number;
  kind: VisualKind;
  priority: number;
  w: number;
  h: number;
}

export interface PlacedVisual extends VisualSpec {
  anchorX: number;
  anchorY: number;
  offsetX: number;
  offsetY: number;
  leader: boolean;
}

type Rect = { x: number; y: number; w: number; h: number };
type Offset = { dx: number; dy: number };
type AnchorPoint = { spec: VisualSpec; x: number; y: number };

const GEO_EPS = 0.00006;
const MARGIN = 10;
/** Screen-space grouping — catches near-but-not-identical coordinates (e.g. silk board + edge a). */
const PROXIMITY_PX = 88;

function geoKey(lat: number, lng: number): string {
  return `${Math.round(lat / GEO_EPS)}:${Math.round(lng / GEO_EPS)}`;
}

function overlaps(a: Rect, b: Rect, margin = MARGIN): boolean {
  return !(
    a.x + a.w + margin < b.x ||
    b.x + b.w + margin < a.x ||
    a.y + a.h + margin < b.y ||
    b.y + b.h + margin < a.y
  );
}

function bounds(anchorX: number, anchorY: number, off: Offset, w: number, h: number): Rect {
  return {
    x: anchorX + off.dx - w / 2,
    y: anchorY + off.dy - h,
    w,
    h,
  };
}

/** Reserve space at the geographic anchor so glyphs are not covered by other labels. */
function glyphGuard(anchorX: number, anchorY: number, kind: VisualKind): Rect {
  const w = kind === "city" ? 14 : 22;
  const h = kind === "city" ? 14 : 28;
  return {
    x: anchorX - w / 2,
    y: anchorY - h,
    w,
    h,
  };
}

function inViewport(rect: Rect, maxW: number, maxH: number): boolean {
  return rect.x >= 6 && rect.y >= 6 && rect.x + rect.w <= maxW - 6 && rect.y + rect.h <= maxH - 6;
}

/** Ring search around anchor — denser near center, wider when needed. */
function ringOffsets(maxRing = 12): Offset[] {
  const out: Offset[] = [{ dx: 0, dy: 0 }];
  for (let ring = 1; ring <= maxRing; ring += 1) {
    const r = ring * 14;
    const steps = Math.max(10, ring * 6);
    for (let i = 0; i < steps; i += 1) {
      const t = (Math.PI * 2 * i) / steps - Math.PI / 2;
      out.push({
        dx: Math.round(Math.cos(t) * r),
        dy: Math.round(Math.sin(t) * r * 0.72 - 6),
      });
    }
  }
  return out;
}

function clusterSpread(count: number, index: number, kinds: VisualKind[]): Offset {
  const hasEndpoint = kinds.some((k) => k === "source" || k === "destination");
  const hasTower = kinds.some((k) => k === "tower");
  const wide = hasEndpoint && hasTower;

  if (count === 1) return { dx: 0, dy: 0 };
  if (count === 2) {
    const spread = wide ? 96 : 72;
    return index === 0 ? { dx: -spread, dy: -18 } : { dx: spread, dy: -10 };
  }
  if (count === 3) {
    const r = wide ? 78 : 64;
    return (
      [
        { dx: 0, dy: -r - 6 },
        { dx: -r, dy: 6 },
        { dx: r, dy: 6 },
      ][index] ?? { dx: 0, dy: 0 }
    );
  }
  const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
  const radius = wide ? 82 : 68;
  return {
    dx: Math.round(Math.cos(angle) * radius),
    dy: Math.round(Math.sin(angle) * radius * 0.62 - 12),
  };
}

/** Push units in a dense group to distinct screen slots around their centroid. */
function spreadFromCentroid(
  index: number,
  count: number,
  anchor: { x: number; y: number },
  centroid: { x: number; y: number },
  kinds: VisualKind[],
): Offset {
  if (count === 1) return { dx: 0, dy: 0 };

  const hasEndpoint = kinds.some((k) => k === "source" || k === "destination");
  const hasTower = kinds.some((k) => k === "tower");
  const wide = hasEndpoint && hasTower;
  const radius = wide ? 98 : count >= 4 ? 88 : 76;
  const angle = (Math.PI * 2 * index) / count - Math.PI / 2;

  const slotX = centroid.x + Math.cos(angle) * radius;
  const slotY = centroid.y + Math.sin(angle) * radius * 0.58 - 28;

  return {
    dx: Math.round(slotX - anchor.x),
    dy: Math.round(slotY - anchor.y),
  };
}

function preferOffsets(kind: VisualKind, seed: Offset): Offset[] {
  const scored = ringOffsets().map((o) => ({ dx: o.dx + seed.dx, dy: o.dy + seed.dy }));
  scored.sort((a, b) => score(kind, a) - score(kind, b));
  const seen = new Set<string>();
  const ordered: Offset[] = [];
  for (const o of [seed, ...scored]) {
    const key = `${o.dx}:${o.dy}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(o);
  }
  return ordered;
}

function isFixedAnchor(kind: VisualKind): boolean {
  return kind === "source" || kind === "destination";
}

function score(kind: VisualKind, o: Offset): number {
  const d = Math.hypot(o.dx, o.dy);
  if (kind === "tower") {
    if (o.dx === 0 && o.dy === 0) return 0;
    if (Math.abs(o.dx) > Math.abs(o.dy)) return 10 + d * 0.04;
    return 20 + d * 0.07;
  }
  if (kind === "source" || kind === "destination") {
    if (o.dy >= -4 && Math.abs(o.dx) < 24) return 5 + d * 0.035;
    return 14 + d * 0.055;
  }
  if (Math.abs(o.dx) <= 28 && o.dy <= 0) return 8 + d * 0.045;
  return 17 + d * 0.065;
}

type PlacementGroup = {
  count: number;
  index: number;
  seed: Offset;
  centroid: { x: number; y: number };
  kinds: VisualKind[];
};

/** Group markers that share coordinates or sit within screen proximity. */
function buildPlacementGroups(anchors: AnchorPoint[]): Map<string, PlacementGroup> {
  const assigned = new Set<string>();
  const groups: AnchorPoint[][] = [];

  for (const seed of anchors) {
    if (assigned.has(seed.spec.id)) continue;

    const group: AnchorPoint[] = [];
    const queue: AnchorPoint[] = [seed];
    assigned.add(seed.spec.id);
    group.push(seed);

    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const other of anchors) {
        if (assigned.has(other.spec.id)) continue;
        if (isFixedAnchor(other.spec.kind)) continue;
        const sameGeo =
          geoKey(current.spec.lat, current.spec.lng) === geoKey(other.spec.lat, other.spec.lng);
        const near = Math.hypot(other.x - current.x, other.y - current.y) <= PROXIMITY_PX;
        if (sameGeo || near) {
          assigned.add(other.spec.id);
          group.push(other);
          queue.push(other);
        }
      }
    }

    groups.push(group);
  }

  const result = new Map<string, PlacementGroup>();
  for (const group of groups) {
    group.sort((a, b) => b.spec.priority - a.spec.priority);
    const kinds = group.map((g) => g.spec.kind);
    const centroid = group.reduce(
      (acc, g) => ({ x: acc.x + g.x / group.length, y: acc.y + g.y / group.length }),
      { x: 0, y: 0 },
    );

    group.forEach((item, index) => {
      const sameGeoGroup = group.every(
        (g) => geoKey(g.spec.lat, g.spec.lng) === geoKey(group[0]!.spec.lat, group[0]!.spec.lng),
      );
      const seed = sameGeoGroup
        ? clusterSpread(group.length, index, kinds)
        : spreadFromCentroid(index, group.length, item, centroid, kinds);

      result.set(item.spec.id, {
        count: group.length,
        index,
        seed,
        centroid,
        kinds,
      });
    });
  }
  return result;
}

function fits(
  anchorX: number,
  anchorY: number,
  off: Offset,
  spec: VisualSpec,
  occupied: Rect[],
  maxW: number,
  maxH: number,
): boolean {
  const rect = bounds(anchorX, anchorY, off, spec.w, spec.h);
  const guard = glyphGuard(anchorX, anchorY, spec.kind);
  if (!inViewport(rect, maxW, maxH)) return false;
  if (occupied.some((o) => overlaps(rect, o))) return false;
  if (occupied.some((o) => overlaps(guard, o, 4))) return false;
  return true;
}

function commit(
  anchorX: number,
  anchorY: number,
  off: Offset,
  spec: VisualSpec,
  occupied: Rect[],
): void {
  occupied.push(bounds(anchorX, anchorY, off, spec.w, spec.h));
  occupied.push(glyphGuard(anchorX, anchorY, spec.kind));
}

export function placeVisualUnits(map: LeafletMap, specs: VisualSpec[]): PlacedVisual[] {
  const { x: maxW, y: maxH } = map.getSize();
  const sorted = [...specs].sort((a, b) => b.priority - a.priority);

  const anchors: AnchorPoint[] = sorted.map((spec) => {
    const pt = map.latLngToContainerPoint([spec.lat, spec.lng]);
    return { spec, x: pt.x, y: pt.y };
  });

  const placementGroups = buildPlacementGroups(anchors);
  const occupied: Rect[] = [];
  const placed: PlacedVisual[] = [];

  for (const { spec, x: anchorX, y: anchorY } of anchors) {
    const group = placementGroups.get(spec.id) ?? {
      count: 1,
      index: 0,
      seed: { dx: 0, dy: 0 },
      centroid: { x: anchorX, y: anchorY },
      kinds: [spec.kind],
    };

    if (isFixedAnchor(spec.kind)) {
      const off = { dx: 0, dy: 0 };
      commit(anchorX, anchorY, off, spec, occupied);
      placed.push({
        ...spec,
        anchorX,
        anchorY,
        offsetX: 0,
        offsetY: 0,
        leader: false,
      });
      continue;
    }

    const candidates = preferOffsets(spec.kind, group.seed);
    let chosen: Offset | null = null;

    for (const off of candidates) {
      if (fits(anchorX, anchorY, off, spec, occupied, maxW, maxH)) {
        chosen = off;
        commit(anchorX, anchorY, off, spec, occupied);
        break;
      }
    }

    if (!chosen) {
      for (const off of ringOffsets(18)) {
        if (fits(anchorX, anchorY, off, spec, occupied, maxW, maxH)) {
          chosen = off;
          commit(anchorX, anchorY, off, spec, occupied);
          break;
        }
      }
    }

    if (!chosen) {
      let best: { off: Offset; hits: number } | null = null;
      for (const off of ringOffsets(22)) {
        const rect = bounds(anchorX, anchorY, off, spec.w, spec.h);
        if (!inViewport(rect, maxW, maxH)) continue;
        const hits = occupied.filter((o) => overlaps(rect, o)).length;
        if (!best || hits < best.hits) best = { off, hits };
      }
      if (best && best.hits === 0) {
        chosen = best.off;
        commit(anchorX, anchorY, best.off, spec, occupied);
      }
    }

    if (!chosen) {
      chosen = group.seed;
      commit(anchorX, anchorY, chosen, spec, occupied);
    }

    placed.push({
      ...spec,
      anchorX,
      anchorY,
      offsetX: chosen.dx,
      offsetY: chosen.dy,
      leader: chosen.dx !== 0 || chosen.dy !== 0,
    });
  }

  return placed;
}
