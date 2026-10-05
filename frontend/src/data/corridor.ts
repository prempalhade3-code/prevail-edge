import { roadRoute } from "../lib/roadGraphRoute";

/** Preview geometry — same road-graph.json + weighted shortest path as backend plan_ticks. */
export function corridorSlice(source: string, destination: string): [number, number][] {
  return roadRoute(source, destination);
}
