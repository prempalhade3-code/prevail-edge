/** Project lat/lon to local meters (XZ plane, Y up). Origin = corridor center. */
export const ORIGIN_LAT = 12.9716;
export const ORIGIN_LON = 77.5946;

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((ORIGIN_LAT * Math.PI) / 180);

export function latLonToXZ(lat: number, lon: number): [number, number] {
  const x = (lon - ORIGIN_LON) * M_PER_DEG_LON;
  const z = -(lat - ORIGIN_LAT) * M_PER_DEG_LAT;
  return [x, z];
}

export function latLonToVec3(lat: number, lon: number, y = 0): [number, number, number] {
  const [x, z] = latLonToXZ(lat, lon);
  return [x, y, z];
}

export function headingToRad(headingDeg: number): number {
  return ((90 - headingDeg) * Math.PI) / 180;
}

export type RoadSegment = {
  name: string;
  lanes: number;
  points: [number, number, number][];
};

type GeoFeatureCollection = {
  features?: {
    geometry?: { type: string; coordinates: unknown };
    properties?: Record<string, unknown>;
  }[];
};

export function parseRoadGeoJson(geo: GeoFeatureCollection): RoadSegment[] {
  const segments: RoadSegment[] = [];
  for (const f of geo.features ?? []) {
    const g = f.geometry;
    if (!g) continue;
    const props = (f.properties ?? {}) as { name?: string; lanes?: number };
    const toPts = (coords: number[][]) =>
      coords.map((c) => latLonToVec3(c[1], c[0], 0.02));
    if (g.type === "LineString") {
      segments.push({
        name: props.name ?? "road",
        lanes: props.lanes ?? 2,
        points: toPts(g.coordinates as number[][]),
      });
    } else if (g.type === "MultiLineString") {
      for (const line of g.coordinates as number[][][]) {
        segments.push({
          name: props.name ?? "road",
          lanes: props.lanes ?? 2,
          points: toPts(line),
        });
      }
    }
  }
  return segments;
}
