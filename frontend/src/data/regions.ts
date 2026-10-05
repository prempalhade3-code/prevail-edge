export interface EdgeRegion {
  edge_id: string;
  name: string;
  shortName: string;
  latitude: number;
  longitude: number;
  polygon: [number, number][];
}

export const CORRIDOR_NAME = "Bengaluru metro road network";

export const EDGE_REGIONS: EdgeRegion[] = [
  {
    edge_id: "edge-a",
    name: "West Bengaluru",
    shortName: "edge a",
    latitude: 12.9212,
    longitude: 77.6291,
    polygon: [
      [12.898, 77.605],
      [12.95, 77.605],
      [12.95, 77.652],
      [12.898, 77.652],
    ],
  },
  {
    edge_id: "edge-b",
    name: "ORR Central",
    shortName: "edge b",
    latitude: 12.9255,
    longitude: 77.676,
    polygon: [
      [12.905, 77.652],
      [12.945, 77.652],
      [12.945, 77.692],
      [12.905, 77.692],
    ],
  },
  {
    edge_id: "edge-c",
    name: "East Bengaluru",
    shortName: "edge c",
    latitude: 12.9629,
    longitude: 77.7258,
    polygon: [
      [12.938, 77.688],
      [12.99, 77.688],
      [12.99, 77.77],
      [12.938, 77.77],
    ],
  },
  {
    edge_id: "edge-d",
    name: "South Bengaluru",
    shortName: "edge d",
    latitude: 12.8448,
    longitude: 77.6632,
    polygon: [
      [12.82, 77.63],
      [12.9, 77.63],
      [12.9, 77.7],
      [12.82, 77.7],
    ],
  },
];

export const DEFAULT_CENTER: [number, number] = [12.91, 77.68];

export function regionFor(edgeId?: string | null): EdgeRegion | undefined {
  if (!edgeId) return undefined;
  return EDGE_REGIONS.find((region) => region.edge_id === edgeId);
}
