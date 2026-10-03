/**
 * Instanced street trees. A trunk plus two canopy masses, merged once per
 * variant so thousands of trees cost two draw calls.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  ConeGeometry,
  CylinderGeometry,
  Euler,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { PropInstance } from "../../lib/cityScene";

const CELL = 120;
const REFILL = 80;

function treeGeometry(variant: 0 | 1) {
  const trunk = new CylinderGeometry(0.18, 0.28, 2.4, 6);
  trunk.translate(0, 1.2, 0);
  if (variant === 0) {
    const a = new SphereGeometry(1.7, 8, 6);
    a.translate(0, 3.4, 0);
    const b = new SphereGeometry(1.25, 8, 6);
    b.translate(0.35, 4.5, -0.15);
    return mergeGeometries([trunk, a, b], false)!;
  }
  const crown = new ConeGeometry(1.55, 4.2, 7);
  crown.translate(0, 4.1, 0);
  return mergeGeometries([trunk, crown], false)!;
}

function buildGrid(instances: PropInstance[]) {
  const grid = new Map<string, PropInstance[]>();
  for (const inst of instances) {
    const key = `${Math.floor(inst.x / CELL)},${Math.floor(inst.z / CELL)}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(inst);
    else grid.set(key, [inst]);
  }
  return grid;
}

function TreeFleet({
  variant,
  items,
  radius,
  focus,
}: {
  variant: 0 | 1;
  items: PropInstance[];
  radius: number;
  focus: React.MutableRefObject<Vector3>;
}) {
  const geometry = useMemo(() => treeGeometry(variant), [variant]);
  const material = useMemo(
    () =>
      new MeshStandardMaterial({
        color: variant === 0 ? "#2f5a32" : "#1f4a2c",
        roughness: 0.86,
        metalness: 0.02,
      }),
    [variant],
  );
  const mesh = useRef<InstancedMesh>(null);
  const grid = useMemo(() => buildGrid(items), [items]);
  const last = useRef(new Vector3(Infinity, 0, Infinity));
  const scratch = useMemo(
    () => ({
      matrix: new Matrix4(),
      position: new Vector3(),
      quaternion: new Quaternion(),
      euler: new Euler(),
      scale: new Vector3(),
    }),
    [],
  );

  const refill = (center: Vector3) => {
    const node = mesh.current;
    if (!node) return;
    const cells = Math.ceil(radius / CELL);
    const cx = Math.floor(center.x / CELL);
    const cz = Math.floor(center.z / CELL);
    const limit = radius * radius;
    let written = 0;
    for (let ix = cx - cells; ix <= cx + cells; ix += 1) {
      for (let iz = cz - cells; iz <= cz + cells; iz += 1) {
        const bucket = grid.get(`${ix},${iz}`);
        if (!bucket) continue;
        for (const inst of bucket) {
          const dx = inst.x - center.x;
          const dz = inst.z - center.z;
          if (dx * dx + dz * dz > limit) continue;
          const s = 1.15 + (Math.abs(Math.sin(inst.x * 0.13 + inst.z * 0.07)) * 0.7);
          scratch.position.set(inst.x, 0, inst.z);
          scratch.euler.set(0, inst.yaw, 0);
          scratch.quaternion.setFromEuler(scratch.euler);
          scratch.scale.setScalar(s);
          scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
          node.setMatrixAt(written, scratch.matrix);
          written += 1;
        }
      }
    }
    node.count = written;
    node.instanceMatrix.needsUpdate = true;
    node.computeBoundingSphere();
  };

  useEffect(() => {
    last.current.set(Infinity, 0, Infinity);
  }, [items, radius]);

  useFrame(() => {
    const node = mesh.current;
    if (!node) return;
    if (node.count > 0 && focus.current.distanceTo(last.current) < REFILL) return;
    last.current.copy(focus.current);
    refill(focus.current);
  });

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, Math.max(items.length, 1)]}
      frustumCulled={false}
    />
  );
}

export function MetroTrees({
  instances,
  focus,
  radius,
}: {
  instances: PropInstance[];
  focus: React.MutableRefObject<Vector3>;
  radius: number;
}) {
  const [leafy, conifer] = useMemo(() => {
    const a: PropInstance[] = [];
    const b: PropInstance[] = [];
    for (const inst of instances) {
      if (Math.abs(Math.sin(inst.x + inst.z)) > 0.25) a.push(inst);
      else b.push(inst);
    }
    return [a, b];
  }, [instances]);

  return (
    <>
      <TreeFleet variant={0} items={leafy} radius={radius} focus={focus} />
      <TreeFleet variant={1} items={conifer} radius={radius} focus={focus} />
    </>
  );
}
