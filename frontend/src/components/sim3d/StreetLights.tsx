/**
 * Street lights along high-rank roads. Positions are derived from the same OSM
 * polylines the vehicle drives, offset onto the pavement so they never sit in a lane.
 */
import { useLayoutEffect, useMemo, useRef } from "react";
import {
  CylinderGeometry,
  Euler,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { RoadPolyline } from "../../lib/cityScene";

function lightGeometry() {
  const pole = new CylinderGeometry(0.07, 0.09, 7.2, 6);
  pole.translate(0, 3.6, 0);
  const arm = new CylinderGeometry(0.05, 0.05, 1.6, 6);
  arm.rotateZ(Math.PI / 2);
  arm.translate(0.7, 7.05, 0);
  const lamp = new CylinderGeometry(0.16, 0.22, 0.18, 8);
  lamp.translate(1.35, 6.9, 0);
  return mergeGeometries([pole, arm, lamp], false)!;
}

function placeLights(roads: RoadPolyline[]): Matrix4[] {
  const matrices: Matrix4[] = [];
  const position = new Vector3();
  const quaternion = new Quaternion();
  const euler = new Euler();
  const scale = new Vector3(1, 1, 1);
  for (const road of roads) {
    if (road.rank < 3 || road.pts.length < 2) continue;
    let run = 0;
    let next = 0;
    for (let i = 0; i < road.pts.length - 1; i += 1) {
      const ax = road.pts[i][0];
      const az = road.pts[i][1];
      const bx = road.pts[i + 1][0];
      const bz = road.pts[i + 1][1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-3) continue;
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      const nx = -uz;
      const nz = ux;
      while (next <= run + len) {
        const t = next - run;
        const side = matrices.length % 2 === 0 ? 1 : -1;
        position.set(
          ax + ux * t + nx * (road.half_width + 1.15) * side,
          0,
          az + uz * t + nz * (road.half_width + 1.15) * side,
        );
        euler.set(0, Math.atan2(ux, uz) + (side > 0 ? 0 : Math.PI), 0);
        quaternion.setFromEuler(euler);
        matrices.push(new Matrix4().compose(position, quaternion, scale));
        if (matrices.length >= 720) return matrices;
        next += 34;
      }
      run += len;
    }
  }
  return matrices;
}

export function StreetLights({ roads }: { roads: RoadPolyline[] }) {
  const geometry = useMemo(() => lightGeometry(), []);
  const material = useMemo(
    () => new MeshStandardMaterial({ color: "#9aa0a8", roughness: 0.45, metalness: 0.65 }),
    [],
  );
  const matrices = useMemo(() => placeLights(roads), [roads]);
  const mesh = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const node = mesh.current;
    if (!node) return;
    matrices.forEach((m, i) => node.setMatrixAt(i, m));
    node.count = matrices.length;
    node.instanceMatrix.needsUpdate = true;
    node.computeBoundingSphere();
  }, [matrices]);

  if (!matrices.length) return null;
  return <instancedMesh ref={mesh} args={[geometry, material, matrices.length]} />;
}
