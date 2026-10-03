/**
 * Tracked vehicle plus a seated occupant that is visible from the drive camera.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { type Group, type Object3D, MathUtils } from "three";
import { angleDelta } from "../../lib/geo";
import type { Pose } from "../../lib/liveStore";

const WHEEL_RADIUS = 0.358;
const MAX_STEER = 0.52;

function Occupant() {
  return (
    <group position={[-0.36, 0.62, 0.1]} rotation={[0.08, Math.PI, 0]}>
      <mesh position={[0, 0.16, 0.04]} castShadow>
        <sphereGeometry args={[0.19, 12, 10]} />
        <meshStandardMaterial color="#1d2430" roughness={0.72} />
      </mesh>
      <mesh position={[0, 0.44, 0.07]} rotation={[0.18, 0, 0]} castShadow>
        <capsuleGeometry args={[0.17, 0.28, 4, 10]} />
        <meshStandardMaterial color="#252c3a" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.76, 0.1]} castShadow>
        <sphereGeometry args={[0.135, 16, 12]} />
        <meshStandardMaterial color="#c49a74" roughness={0.48} />
      </mesh>
      <mesh position={[0, 0.8, 0.08]}>
        <sphereGeometry args={[0.13, 12, 10]} />
        <meshStandardMaterial color="#1a1410" roughness={0.92} />
      </mesh>
      <mesh position={[-0.2, 0.46, 0.2]} rotation={[1.15, 0, 0.35]}>
        <capsuleGeometry args={[0.045, 0.28, 3, 6]} />
        <meshStandardMaterial color="#c49a74" roughness={0.5} />
      </mesh>
      <mesh position={[0.2, 0.46, 0.2]} rotation={[1.15, 0, -0.35]}>
        <capsuleGeometry args={[0.045, 0.28, 3, 6]} />
        <meshStandardMaterial color="#c49a74" roughness={0.5} />
      </mesh>
    </group>
  );
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
  }, [car]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const p = pose.current;
    const node = group.current;
    if (!node) return;

    node.position.set(p.x, 0, p.z);
    node.rotation.y = p.yaw;

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
      <group rotation={[0, Math.PI, 0]}>
        <primitive object={car} />
        <Occupant />
      </group>
    </group>
  );
}

useGLTF.preload("/models/ferrari.glb");
