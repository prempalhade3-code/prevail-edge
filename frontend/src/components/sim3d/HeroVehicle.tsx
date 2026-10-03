/**
 * The tracked vehicle: a real car model with a posed driver at the wheel.
 *
 * The GLB is authored in metres with a 2.65 m wheelbase and its nose along -Z, so
 * it is turned to face +Z to match the renderer's heading convention. Wheels are
 * driven from the reported speed and the front pair steers with the yaw rate, so
 * everything visible is derived from live telemetry rather than animated on a timer.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { type Bone, type Group, type Object3D, MathUtils, SkinnedMesh } from "three";
import { angleDelta } from "../../lib/geo";
import type { Pose } from "../../lib/liveStore";
import { ModelErrorBoundary } from "./ModelErrorBoundary";

const WHEEL_RADIUS = 0.358;
const MAX_STEER = 0.52;

/**
 * Seated driving pose, in radians, applied to the rigged avatar.
 *
 * The rig rests in a standing T-pose, so the thighs are swung forward, the knees
 * bent back down, and the arms brought in and forward onto the wheel.
 */
const DRIVER_POSE: Record<string, [number, number, number]> = {
  Hips: [-0.12, 0, 0],
  Spine: [0.08, 0, 0],
  Spine1: [0.05, 0, 0],
  Spine2: [0.03, 0, 0],
  Neck: [0.05, 0, 0],
  LeftUpLeg: [-1.45, 0.12, 0.05],
  RightUpLeg: [-1.45, -0.12, -0.05],
  LeftLeg: [1.15, 0, 0],
  RightLeg: [1.15, 0, 0],
  LeftFoot: [0.3, 0, 0],
  RightFoot: [0.3, 0, 0],
  LeftShoulder: [0, 0, -0.15],
  RightShoulder: [0, 0, 0.15],
  LeftArm: [0.25, -1.0, -0.5],
  RightArm: [0.25, 1.0, 0.5],
  LeftForeArm: [0, -0.75, 0],
  RightForeArm: [0, 0.75, 0],
  LeftHand: [0, 0, -0.3],
  RightHand: [0, 0, 0.3],
};

function Driver() {
  const { scene } = useGLTF("/models/readyplayer.me.glb");

  const posed = useMemo(() => {
    const root = scene.clone(true);
    root.traverse((node: Object3D) => {
      const bone = node as Bone;
      const pose = DRIVER_POSE[bone.name];
      if (pose) bone.rotation.set(pose[0], pose[1], pose[2]);
      const skinned = node as SkinnedMesh;
      if (skinned.isSkinnedMesh) {
        skinned.frustumCulled = false;
        skinned.castShadow = false;
      }
    });
    return root;
  }, [scene]);

  // Seated at the wheel. The steering column sits at x = -0.35, so the driver is
  // on the left, matching this particular car's layout.
  return <primitive object={posed} position={[-0.38, -0.02, 0.12]} rotation={[0, Math.PI, 0]} scale={0.9} />;
}

export type HeroVehicleProps = {
  pose: React.MutableRefObject<Pose>;
};

export function HeroVehicle({ pose }: HeroVehicleProps) {
  const { scene } = useGLTF("/models/ferrari.glb");
  const group = useRef<Group>(null);
  const wheels = useRef<Record<string, Object3D | null>>({});
  const spin = useRef(0);
  const steer = useRef(0);
  const lastYaw = useRef<number | null>(null);

  const car = useMemo(() => {
    const root = scene.clone(true);
    root.traverse((node) => {
      node.castShadow = true;
      node.receiveShadow = false;
    });
    return root;
  }, [scene]);

  useEffect(() => {
    for (const name of ["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"]) {
      wheels.current[name] = car.getObjectByName(name) ?? null;
    }
    const missing = Object.entries(wheels.current)
      .filter(([, node]) => !node)
      .map(([name]) => name);
    if (missing.length) {
      console.warn(`[hero] wheel nodes not found: ${missing.join(", ")}`);
    }
  }, [car]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.25);
    const p = pose.current;
    const node = group.current;
    if (!node) return;

    node.position.set(p.x, 0, p.z);
    node.rotation.y = p.yaw;

    // Wheel rotation follows distance travelled, so it is always in step with speed.
    spin.current += (p.speed * delta) / WHEEL_RADIUS;

    const yawRate = lastYaw.current === null ? 0 : angleDelta(lastYaw.current, p.yaw) / Math.max(delta, 1e-4);
    lastYaw.current = p.yaw;
    const targetSteer = MathUtils.clamp(-yawRate * 0.55, -MAX_STEER, MAX_STEER);
    steer.current += (targetSteer - steer.current) * Math.min(1, delta * 6);

    for (const [name, wheel] of Object.entries(wheels.current)) {
      if (!wheel) continue;
      wheel.rotation.x = spin.current;
      wheel.rotation.y = name.startsWith("wheel_f") ? steer.current : 0;
    }
  });

  return (
    <group ref={group}>
      {/* The model's nose points along -Z; turn it to the renderer's +Z forward. */}
      <group rotation={[0, Math.PI, 0]}>
        <primitive object={car} />
        <ModelErrorBoundary>
          <Driver />
        </ModelErrorBoundary>
      </group>
    </group>
  );
}

useGLTF.preload("/models/ferrari.glb");
useGLTF.preload("/models/readyplayer.me.glb");
