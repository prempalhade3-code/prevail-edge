/**
 * Instanced renderer for the city's static props.
 *
 * Every building, tree and piece of street furniture is an instance of one of a few
 * dozen GLB models, so the whole city costs roughly one draw call per model part
 * rather than one per object. Instance matrices are refilled from a spatial grid
 * whenever the viewer moves far enough, which keeps instance counts small and acts
 * as a natural level of detail without ever popping geometry in the near field.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import {
  Box3,
  type BufferGeometry,
  Euler,
  InstancedMesh,
  type Material,
  Matrix4,
  MeshLambertMaterial,
  type Mesh,
  type MeshStandardMaterial,
  Object3D,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";
import type { PropInstance } from "../../lib/cityScene";
import { ModelErrorBoundary } from "./ModelErrorBoundary";

const REFILL_DISTANCE = 60;
const CELL = 100;

type Part = { geometry: BufferGeometry; material: Material; local: Matrix4 };

/** Kenney city kits ship a colormap atlas. Lambert keeps those colours readable. */
function prepareCityMaterial(source: Material): Material {
  const std = source as MeshStandardMaterial;
  if (std.map) {
    std.map.colorSpace = SRGBColorSpace;
    std.map.anisotropy = 8;
    std.map.needsUpdate = true;
    return new MeshLambertMaterial({
      map: std.map,
      color: "#ffffff",
      transparent: std.transparent,
      side: std.side,
    });
  }
  return source.clone();
}

/** Flatten a loaded GLB into instanceable parts, preserving nested transforms. */
function extractParts(root: Object3D): Part[] {
  root.updateWorldMatrix(true, true);
  const inverse = new Matrix4().copy(root.matrixWorld).invert();
  const parts: Part[] = [];
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    parts.push({
      geometry: mesh.geometry,
      material: prepareCityMaterial(source as Material),
      local: new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld),
    });
  });
  return parts;
}

type GridIndex = Map<string, PropInstance[]>;

function buildGrid(instances: PropInstance[]): GridIndex {
  const grid: GridIndex = new Map();
  for (const inst of instances) {
    const key = `${Math.floor(inst.x / CELL)},${Math.floor(inst.z / CELL)}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(inst);
    else grid.set(key, [inst]);
  }
  return grid;
}

type ModelGroupProps = {
  url: string;
  instances: PropInstance[];
  radius: number;
  focus: React.MutableRefObject<Vector3>;
  castShadow?: boolean;
  heightScale?: number;
};

function ModelGroup({
  url,
  instances,
  radius,
  focus,
  castShadow = false,
  heightScale = 1,
}: ModelGroupProps) {
  const { scene } = useGLTF(url);
  const parts = useMemo(() => extractParts(scene), [scene]);
  const grid = useMemo(() => buildGrid(instances), [instances]);

  // Measured with transforms applied, so models whose origin is not at their base
  // still sit exactly on the ground instead of floating or sinking.
  const groundOffset = useMemo(() => -new Box3().setFromObject(scene).min.y, [scene]);
  const meshes = useRef<(InstancedMesh | null)[]>([]);
  const lastFill = useRef(new Vector3(Infinity, 0, Infinity));

  const scratch = useMemo(
    () => ({
      matrix: new Matrix4(),
      composed: new Matrix4(),
      position: new Vector3(),
      quaternion: new Quaternion(),
      euler: new Euler(),
      scale: new Vector3(),
    }),
    [],
  );

  const refill = (center: Vector3) => {
    const cells = Math.ceil(radius / CELL);
    const cx = Math.floor(center.x / CELL);
    const cz = Math.floor(center.z / CELL);
    const limit = radius * radius;

    const visible: PropInstance[] = [];
    for (let ix = cx - cells; ix <= cx + cells; ix += 1) {
      for (let iz = cz - cells; iz <= cz + cells; iz += 1) {
        const bucket = grid.get(`${ix},${iz}`);
        if (!bucket) continue;
        for (const inst of bucket) {
          const dx = inst.x - center.x;
          const dz = inst.z - center.z;
          if (dx * dx + dz * dz <= limit) visible.push(inst);
        }
      }
    }

    parts.forEach((part, partIndex) => {
      const mesh = meshes.current[partIndex];
      if (!mesh) return;
      for (let i = 0; i < visible.length; i += 1) {
        const inst = visible[i];
        scratch.position.set(inst.x, groundOffset * inst.scale * heightScale, inst.z);
        scratch.euler.set(0, inst.yaw, 0);
        scratch.quaternion.setFromEuler(scratch.euler);
        scratch.scale.set(inst.scale, inst.scale * heightScale, inst.scale);
        scratch.composed.compose(scratch.position, scratch.quaternion, scratch.scale);
        scratch.matrix.multiplyMatrices(scratch.composed, part.local);
        mesh.setMatrixAt(i, scratch.matrix);
      }
      mesh.count = visible.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  };

  useEffect(() => {
    lastFill.current.set(Infinity, 0, Infinity);
  }, [instances, parts, radius, heightScale]);

  useFrame(() => {
    const center = focus.current;
    if (center.distanceTo(lastFill.current) < REFILL_DISTANCE) return;
    lastFill.current.copy(center);
    refill(center);
  });

  return (
    <>
      {parts.map((part, index) => (
        <instancedMesh
          key={index}
          ref={(node) => {
            meshes.current[index] = node;
          }}
          geometry={part.geometry}
          material={part.material}
          args={[part.geometry, part.material, Math.max(instances.length, 1)]}
          castShadow={castShadow}
          receiveShadow
          frustumCulled={false}
        />
      ))}
    </>
  );
}

export type InstancedCityProps = {
  category: string;
  instances: PropInstance[];
  radius: number;
  focus: React.MutableRefObject<Vector3>;
  castShadow?: boolean;
  heightScale?: number;
};

export function InstancedCity({
  category,
  instances,
  radius,
  focus,
  castShadow,
  heightScale = 1,
}: InstancedCityProps) {
  const groups = useMemo(() => {
    const byModel = new Map<string, PropInstance[]>();
    for (const inst of instances) {
      const bucket = byModel.get(inst.model);
      if (bucket) bucket.push(inst);
      else byModel.set(inst.model, [inst]);
    }
    return [...byModel.entries()];
  }, [instances]);

  return (
    <>
      {groups.map(([model, group]) => (
        <ModelErrorBoundary key={model}>
          <ModelGroup
            url={`/models/${category}/${model}.glb`}
            instances={group}
            radius={radius}
            focus={focus}
            castShadow={castShadow}
            heightScale={heightScale}
          />
        </ModelErrorBoundary>
      ))}
    </>
  );
}
