/**
 * Frontend mirror of python/mobility/road_graph + shortest_path.
 * Uses deploy/config/road-graph.json (copied via `npm run sync:road-graph`) so
 * displayed routes always match backend vehicle movement.
 */
import graphData from "../data/road-graph.json";

type Coord = [number, number];

type GraphNode = {
  id: string;
  latitude: number;
  longitude: number;
  edge_id?: string;
};

function polylineLength(pts: Coord[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const dy = pts[i][0] - pts[i - 1][0];
    const dx = pts[i][1] - pts[i - 1][1];
    total += Math.hypot(dy, dx);
  }
  return total;
}

function buildGraph() {
  const nodes = new Map<string, GraphNode>();
  const adj = new Map<string, { to: string; weight: number }[]>();
  const geometries = new Map<string, Coord[]>();

  const rawNodes = graphData.nodes as Record<
    string,
    { latitude: number; longitude: number; edge_id?: string }
  >;

  for (const [id, meta] of Object.entries(rawNodes)) {
    nodes.set(id, {
      id,
      latitude: meta.latitude,
      longitude: meta.longitude,
      edge_id: meta.edge_id,
    });
    adj.set(id, []);
  }

  for (const edge of graphData.edges as {
    from: string;
    to: string;
    waypoints?: Coord[];
    distance_m?: number;
  }[]) {
    const src = edge.from;
    const dst = edge.to;
    let pts = (edge.waypoints ?? []).map((p) => [p[0], p[1]] as Coord);
    const sa = nodes.get(src);
    const da = nodes.get(dst);
    if (pts.length < 2 && sa && da) {
      pts = [
        [sa.latitude, sa.longitude],
        [da.latitude, da.longitude],
      ];
    }
    const dist = edge.distance_m ?? polylineLength(pts);
    adj.get(src)?.push({ to: dst, weight: dist });
    adj.get(dst)?.push({ to: src, weight: dist });
    geometries.set(`${src}->${dst}`, pts);
    geometries.set(`${dst}->${src}`, [...pts].reverse());
  }

  return { nodes, adj, geometries };
}

const GRAPH = buildGraph();

/** Weighted shortest path — same algorithm family as backend RoadGraph + route_planner.shortest_path. */
export function shortestCityPath(source: string, destination: string): string[] {
  if (source === destination) return [source];
  if (!GRAPH.adj.has(source) || !GRAPH.adj.has(destination)) return [];

  const dist = new Map<string, number>([[source, 0]]);
  const prev = new Map<string, string>();
  const heap: { cost: number; node: string }[] = [{ cost: 0, node: source }];
  const seen = new Set<string>();

  while (heap.length > 0) {
    heap.sort((a, b) => a.cost - b.cost);
    const current = heap.shift()!;
    if (seen.has(current.node)) continue;
    seen.add(current.node);
    if (current.node === destination) break;

    for (const { to, weight } of GRAPH.adj.get(current.node) ?? []) {
      const nextCost = current.cost + weight;
      if (nextCost < (dist.get(to) ?? Number.POSITIVE_INFINITY)) {
        dist.set(to, nextCost);
        prev.set(to, current.node);
        heap.push({ cost: nextCost, node: to });
      }
    }
  }

  if (!dist.has(destination)) return [];

  const path = [destination];
  while (path[path.length - 1] !== source) {
    const parent = prev.get(path[path.length - 1]!);
    if (!parent) return [];
    path.push(parent);
  }
  return path.reverse();
}

export function pathGeometry(cityPath: string[]): Coord[] {
  if (cityPath.length === 0) return [];
  if (cityPath.length === 1) {
    const node = GRAPH.nodes.get(cityPath[0]!);
    return node ? [[node.latitude, node.longitude]] : [];
  }

  const out: Coord[] = [];
  for (let i = 0; i < cityPath.length - 1; i += 1) {
    const segment = GRAPH.geometries.get(`${cityPath[i]}->${cityPath[i + 1]}`) ?? [];
    if (!segment.length) continue;
    if (out.length && out[out.length - 1]![0] === segment[0]![0] && out[out.length - 1]![1] === segment[0]![1]) {
      out.push(...segment.slice(1));
    } else {
      out.push(...segment);
    }
  }
  return out;
}

export function roadRoute(source: string, destination: string): Coord[] {
  return pathGeometry(shortestCityPath(source, destination));
}

export function edgeSequenceForRoadPath(source: string, destination: string): string[] {
  const seq: string[] = [];
  for (const cityId of shortestCityPath(source, destination)) {
    const edgeId = GRAPH.nodes.get(cityId)?.edge_id;
    if (edgeId && seq[seq.length - 1] !== edgeId) seq.push(edgeId);
  }
  return seq;
}
