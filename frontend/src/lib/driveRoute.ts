import { EDGE_REGIONS } from "../data/regions";

const ROUTE = ["edge-a", "edge-b", "edge-c", "edge-d"] as const;
const STEPS_PER_LEG = 18;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function headingDeg(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const dy = toLat - fromLat;
  const dx = toLon - fromLon;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

export async function replayCorridor(sessionId: string, signal?: AbortSignal): Promise<void> {
  const points = ROUTE.map((id) => EDGE_REGIONS.find((r) => r.edge_id === id)!);
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i];
    const to = points[i + 1];
    for (let step = 0; step <= STEPS_PER_LEG; step += 1) {
      if (signal?.aborted) return;
      const t = step / STEPS_PER_LEG;
      const latitude = lerp(from.latitude, to.latitude, t);
      const longitude = lerp(from.longitude, to.longitude, t);
      const sample = {
        session_id: sessionId,
        timestamp_ms: Date.now(),
        latitude,
        longitude,
        speed_mps: 12 + i * 2,
        heading_deg: headingDeg(from.latitude, from.longitude, to.latitude, to.longitude),
        edge_id: t < 0.55 ? from.edge_id : to.edge_id,
        workload_class: "stream",
      };
      const resp = await fetch("/v1/trajectory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sample),
        signal,
      });
      if (!resp.ok) {
        throw new Error(`trajectory ingest failed (${resp.status})`);
      }
      await new Promise((resolve) => setTimeout(resolve, 220));
    }
  }
}
