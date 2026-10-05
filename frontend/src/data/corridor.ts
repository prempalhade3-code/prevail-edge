import { cityRoute } from "./cities";

/** Preview geometry for a city→city selection. Backend plan_ticks is authoritative after Start. */
export function corridorSlice(source: string, destination: string): [number, number][] {
  return cityRoute(source, destination);
}
