export interface City {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  edge_id: string;
}

export const CITIES: City[] = [
  { id: "electronic-city", name: "Electronic City", latitude: 12.8448, longitude: 77.6632, edge_id: "edge-d" },
  { id: "silk-board", name: "Silk Board", latitude: 12.9175, longitude: 77.622, edge_id: "edge-a" },
  { id: "koramangala", name: "Koramangala", latitude: 12.9344, longitude: 77.6265, edge_id: "edge-a" },
  { id: "hsr-layout", name: "HSR Layout", latitude: 12.9116, longitude: 77.6389, edge_id: "edge-a" },
  { id: "bellandur", name: "Bellandur", latitude: 12.9255, longitude: 77.676, edge_id: "edge-b" },
  { id: "marathahalli", name: "Marathahalli", latitude: 12.956, longitude: 77.7016, edge_id: "edge-c" },
  { id: "whitefield", name: "Whitefield", latitude: 12.9698, longitude: 77.7499, edge_id: "edge-c" },
];

export const DEFAULT_FROM = "electronic-city";
export const DEFAULT_TO = "silk-board";

const LINKS: [string, string, [number, number][]][] = [
  ["electronic-city", "silk-board", [[12.8448, 77.6632], [12.86, 77.658], [12.88, 77.645], [12.9, 77.632], [12.9175, 77.622]]],
  ["silk-board", "koramangala", [[12.9175, 77.622], [12.925, 77.624], [12.9344, 77.6265]]],
  ["silk-board", "hsr-layout", [[12.9175, 77.622], [12.9145, 77.6305], [12.9116, 77.6389]]],
  ["koramangala", "hsr-layout", [[12.9344, 77.6265], [12.922, 77.632], [12.9116, 77.6389]]],
  ["hsr-layout", "bellandur", [[12.9116, 77.6389], [12.914, 77.652], [12.918, 77.664], [12.9222, 77.6709], [12.9255, 77.676]]],
  ["koramangala", "bellandur", [[12.9344, 77.6265], [12.93, 77.645], [12.928, 77.66], [12.9255, 77.676]]],
  ["bellandur", "marathahalli", [[12.9255, 77.676], [12.92688, 77.67821], [12.928155, 77.681794], [12.93042, 77.68516], [12.93318, 77.68842], [12.93641, 77.69188], [12.94134, 77.696074], [12.94488, 77.69862], [12.94872, 77.70041], [12.95261, 77.70188], [12.956, 77.7016]]],
  ["marathahalli", "whitefield", [[12.956, 77.7016], [12.958, 77.715], [12.962, 77.728], [12.966, 77.74], [12.9698, 77.7499]]],
];

const ADJ = new Map<string, { to: string; geom: [number, number][] }[]>();
for (const [from, to, geom] of LINKS) {
  if (!ADJ.has(from)) ADJ.set(from, []);
  if (!ADJ.has(to)) ADJ.set(to, []);
  ADJ.get(from)!.push({ to, geom });
  ADJ.get(to)!.push({ to: from, geom: [...geom].reverse() });
}

export function cityFor(id?: string | null): City | undefined {
  if (!id) return undefined;
  return CITIES.find((city) => city.id === id);
}

export function isCityId(id?: string | null): boolean {
  return Boolean(id && CITIES.some((city) => city.id === id));
}

export function cityPath(source: string, destination: string): string[] {
  if (source === destination) return [source];
  const prev = new Map<string, string>();
  const queue = [source];
  const seen = new Set([source]);
  while (queue.length) {
    const node = queue.shift()!;
    if (node === destination) break;
    for (const link of ADJ.get(node) ?? []) {
      if (seen.has(link.to)) continue;
      seen.add(link.to);
      prev.set(link.to, node);
      queue.push(link.to);
    }
  }
  if (!seen.has(destination)) return [];
  const path = [destination];
  while (path[path.length - 1] !== source) {
    const parent = prev.get(path[path.length - 1]);
    if (!parent) return [];
    path.push(parent);
  }
  return path.reverse();
}

export function cityRoute(source: string, destination: string): [number, number][] {
  const path = cityPath(source, destination);
  if (path.length < 2) {
    const city = cityFor(source);
    return city ? [[city.latitude, city.longitude]] : [];
  }
  const out: [number, number][] = [];
  for (let i = 0; i < path.length - 1; i += 1) {
    const link = (ADJ.get(path[i]) ?? []).find((item) => item.to === path[i + 1]);
    if (!link) continue;
    if (out.length && link.geom[0][0] === out[out.length - 1][0] && link.geom[0][1] === out[out.length - 1][1]) {
      out.push(...link.geom.slice(1));
    } else {
      out.push(...link.geom);
    }
  }
  return out;
}

export function edgeSequenceForCities(source: string, destination: string): string[] {
  const seq: string[] = [];
  for (const id of cityPath(source, destination)) {
    const zone = cityFor(id)?.edge_id;
    if (zone && seq[seq.length - 1] !== zone) seq.push(zone);
  }
  return seq;
}
