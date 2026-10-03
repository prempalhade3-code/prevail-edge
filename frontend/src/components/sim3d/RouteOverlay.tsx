/**
 * The planned route, painted as a thin lane marking — not a glowing tube.
 */
import { useMemo } from "react";
import { BufferAttribute, BufferGeometry } from "three";

const ROUTE_Y = 0.04;
const WIDTH = 0.28;

function routeGeometry(points: [number, number][]): BufferGeometry {
  const position: number[] = [];
  const index: number[] = [];
  const uv: number[] = [];
  const normal: number[] = [];
  let run = 0;

  for (let i = 0; i < points.length; i += 1) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    let dx = next[0] - prev[0];
    let dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    if (i > 0) run += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    position.push(
      points[i][0] - dz * WIDTH,
      ROUTE_Y,
      points[i][1] + dx * WIDTH,
      points[i][0] + dz * WIDTH,
      ROUTE_Y,
      points[i][1] - dx * WIDTH,
    );
    normal.push(0, 1, 0, 0, 1, 0);
    uv.push(0, run * 0.2, 1, run * 0.2);
  }
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = i * 2;
    index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(position), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(normal), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

export function RouteOverlay({ route }: { route: [number, number][] }) {
  const geometry = useMemo(() => routeGeometry(route), [route]);
  if (route.length < 2) return null;
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#d7c56a" roughness={0.45} metalness={0.05} />
    </mesh>
  );
}
