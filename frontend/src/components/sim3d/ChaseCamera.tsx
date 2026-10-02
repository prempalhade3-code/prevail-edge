import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

export function ChaseCamera({
  target,
  headingRad,
}: {
  target: [number, number, number];
  headingRad: number;
}) {
  const { camera } = useThree();
  const desired = useRef(new THREE.Vector3());
  const lookAt = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    const [tx, ty, tz] = target;
    const dist = 14;
    const height = 5.5;
    const dx = Math.sin(headingRad) * dist;
    const dz = Math.cos(headingRad) * dist;

    desired.current.set(tx - dx, ty + height, tz - dz);
    lookAt.current.set(tx + Math.sin(headingRad) * 8, ty + 1.2, tz + Math.cos(headingRad) * 8);

    camera.position.lerp(desired.current, 1 - Math.exp(-4 * delta));
    const smoothLook = new THREE.Vector3();
    smoothLook.copy(lookAt.current);
    camera.lookAt(smoothLook);
  });

  return null;
}
