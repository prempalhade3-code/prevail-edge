/**
 * Metropolitan building stock.
 *
 * Each OSM-validated placement from the city builder is drawn as a PBR massing
 * model (house, campus, office, tower) instead of a Kenney toy. Footprints stay
 * close to the clearance-tested positions so nothing sits on the carriageway;
 * height is what changes, which is what makes an IT-corridor skyline.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BoxGeometry,
  Euler,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import type { PropInstance } from "../../lib/cityScene";
import { facadeTexture, type FacadeKind } from "../../lib/facades";

const CELL = 120;
const REFILL = 70;

type Archetype = {
  kind: FacadeKind;
  width: number;
  depth: number;
  height: number;
};

function hash02(x: number, z: number): number {
  const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

function classify(inst: PropInstance): Archetype {
  const h = hash02(inst.x, inst.z);
  const house = inst.model.startsWith("building-type");
  const towerName = inst.model.includes("skyscraper");
  if (towerName || (!house && h > 0.72)) {
    return { kind: "tower", width: 13.5, depth: 13.5, height: 46 + h * 38 };
  }
  if (!house && h > 0.38) {
    return { kind: "office", width: 15, depth: 12, height: 26 + h * 18 };
  }
  if (!house || h > 0.82) {
    return { kind: "campus", width: 18, depth: 14, height: 16 + h * 8 };
  }
  return { kind: "house", width: 8.4, depth: 7.2, height: 7.2 + h * 2.2 };
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

function Fleet({
  kind,
  items,
  radius,
  focus,
}: {
  kind: FacadeKind;
  items: PropInstance[];
  radius: number;
  focus: React.MutableRefObject<Vector3>;
}) {
  const geometry = useMemo(() => new BoxGeometry(1, 1, 1), []);
  const material = useMemo(() => {
    const map = facadeTexture(kind);
    return new MeshStandardMaterial({
      map,
      roughness: kind === "tower" ? 0.22 : 0.55,
      metalness: kind === "tower" || kind === "office" ? 0.45 : 0.08,
      envMapIntensity: 1.15,
    });
  }, [kind]);

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
          const spec = classify(inst);
          if (spec.kind !== kind) continue;
          scratch.position.set(inst.x, spec.height / 2, inst.z);
          scratch.euler.set(0, inst.yaw, 0);
          scratch.quaternion.setFromEuler(scratch.euler);
          scratch.scale.set(spec.width, spec.height, spec.depth);
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
      castShadow
      receiveShadow
      frustumCulled={false}
    />
  );
}

export function MetroBuildings({
  instances,
  focus,
  radius,
}: {
  instances: PropInstance[];
  focus: React.MutableRefObject<Vector3>;
  radius: number;
}) {
  const groups = useMemo(() => {
    const byKind: Record<FacadeKind, PropInstance[]> = {
      office: [],
      tower: [],
      campus: [],
      house: [],
    };
    for (const inst of instances) byKind[classify(inst).kind].push(inst);
    return byKind;
  }, [instances]);

  return (
    <>
      {(Object.keys(groups) as FacadeKind[]).map((kind) =>
        groups[kind].length ? (
          <Fleet key={kind} kind={kind} items={groups[kind]} radius={radius} focus={focus} />
        ) : null,
      )}
    </>
  );
}
