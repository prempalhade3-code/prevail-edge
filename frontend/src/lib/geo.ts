/**
 * Local metric frame shared with the simulator.
 *
 * The origin and the projection must match `sim/network/build_city.py` exactly,
 * otherwise reported positions would not line up with the rendered roads.
 * `assertSceneOrigin` checks that at runtime when the city scene loads.
 */
export const ORIGIN_LAT = 12.94;
export const ORIGIN_LON = 77.686;

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((ORIGIN_LAT * Math.PI) / 180);

export function latLonToXZ(lat: number, lon: number): [number, number] {
  return [(lon - ORIGIN_LON) * M_PER_DEG_LON, -(lat - ORIGIN_LAT) * M_PER_DEG_LAT];
}

export function latLonToVec3(lat: number, lon: number, y = 0): [number, number, number] {
  const [x, z] = latLonToXZ(lat, lon);
  return [x, y, z];
}

/**
 * Convert a compass bearing to a three.js Y rotation.
 *
 * The simulator reports bearing clockwise from north, where north is -Z and east
 * is +X, so the forward vector is (sin b, -cos b). A model whose neutral facing is
 * +Z has forward (sin y, cos y), which matches at y = PI - b.
 */
export function headingToYaw(headingDeg: number): number {
  return Math.PI - (headingDeg * Math.PI) / 180;
}

export function assertSceneOrigin(lat: number, lon: number): void {
  if (Math.abs(lat - ORIGIN_LAT) > 1e-6 || Math.abs(lon - ORIGIN_LON) > 1e-6) {
    console.error(
      `[geo] scene origin (${lat}, ${lon}) disagrees with the renderer ` +
        `(${ORIGIN_LAT}, ${ORIGIN_LON}); roads and vehicles will not align.`,
    );
  }
}

/** Shortest signed difference between two angles, in radians. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function lerpAngle(from: number, to: number, t: number): number {
  return from + angleDelta(from, to) * t;
}
