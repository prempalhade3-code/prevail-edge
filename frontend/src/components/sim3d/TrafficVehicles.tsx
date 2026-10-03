/**
 * Background traffic, drawn as instanced car models.
 *
 * Each vehicle id maps to a fixed model so a given car keeps its appearance, and
 * every model's meshes are merged into one geometry up front, so the whole traffic
 * flow costs roughly one draw call per model. Poses come from the simulator via the
 * runtime, never from local animation.
 */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import {
  type BufferGeometry,
  Euler,
  InstancedMesh,
  type Material,
  Matrix4,
  MeshLambertMaterial,
  type Mesh,
  type MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { pickTrafficModel } from "../../lib/cityScene";
import type { TrafficTracker } from "../../lib/liveStore";

/** Kenney cars are about 2.55 units long, so this brings them to roughly 4.3 m. */
const CAR_SCALE = 1.7;

export const TRAFFIC_MODELS = [
  "sedan",
  "suv",
  "hatchback-sports",
  "van",
  "taxi",
  "truck",
  "delivery",
  "suv-luxury",
];

const MAX_PER_MODEL = 24;

type Merged = { geometry: BufferGeometry; material: Material; lift: number };

function useMergedCar(model: string): Merged | null {
  const { scene } = useGLTF(`/models/vehicles/${model}.glb`);
  return useMemo(() => {
    scene.updateWorldMatrix(true, true);
    const inverse = new Matrix4().copy(scene.matrixWorld).invert();
    const geometries: BufferGeometry[] = [];
    let material: Material | null = null;

    scene.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
      // Instancing needs a uniform attribute set across the merged parts.
      for (const name of Object.keys(geometry.attributes)) {
        if (!["position", "normal", "uv"].includes(name)) geometry.deleteAttribute(name);
      }
      geometries.push(geometry);
      if (!material) {
        const source = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as MeshStandardMaterial;
        if (source.map) {
          source.map.colorSpace = SRGBColorSpace;
          source.map.needsUpdate = true;
          material = new MeshLambertMaterial({ map: source.map, color: "#ffffff" });
        } else {
          material = source;
        }
      }
    });

    if (!geometries.length || !material) return null;
    const merged = mergeGeometries(geometries, false);
    if (!merged) return null;
    merged.computeBoundingBox();
    const lift = -(merged.boundingBox?.min.y ?? 0);
    return { geometry: merged, material, lift };
  }, [scene]);
}

type ModelFleetProps = {
  model: string;
  traffic: React.MutableRefObject<TrafficTracker>;
};

function ModelFleet({ model, traffic }: ModelFleetProps) {
  const merged = useMergedCar(model);
  const mesh = useRef<InstancedMesh>(null);
  const scratch = useMemo(
    () => ({
      matrix: new Matrix4(),
      position: new Vector3(),
      quaternion: new Quaternion(),
      euler: new Euler(),
      scale: new Vector3(CAR_SCALE, CAR_SCALE, CAR_SCALE),
    }),
    [],
  );

  useFrame(() => {
    const node = mesh.current;
    if (!node || !merged) return;
    let written = 0;
    for (const entry of traffic.current.poses()) {
      if (written >= MAX_PER_MODEL) break;
      if (pickTrafficModel(entry.id, TRAFFIC_MODELS) !== model) continue;
      const pose = entry.pose;
      scratch.position.set(pose.x, merged.lift * CAR_SCALE, pose.z);
      scratch.euler.set(0, pose.yaw, 0);
      scratch.quaternion.setFromEuler(scratch.euler);
      scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
      node.setMatrixAt(written, scratch.matrix);
      written += 1;
    }
    node.count = written;
    node.instanceMatrix.needsUpdate = true;
  });

  if (!merged) return null;
  return (
    <instancedMesh
      ref={mesh}
      geometry={merged.geometry}
      material={merged.material}
      args={[merged.geometry, merged.material, MAX_PER_MODEL]}
      frustumCulled={false}
    />
  );
}

export function TrafficVehicles({ traffic }: { traffic: React.MutableRefObject<TrafficTracker> }) {
  return (
    <>
      {TRAFFIC_MODELS.map((model) => (
        <ModelFleet key={model} model={model} traffic={traffic} />
      ))}
    </>
  );
}

export function preloadTraffic() {
  for (const model of TRAFFIC_MODELS) {
    useGLTF.preload(`/models/vehicles/${model}.glb`);
  }
}
