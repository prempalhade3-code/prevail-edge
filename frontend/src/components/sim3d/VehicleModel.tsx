import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

type VehicleModelProps = {
  color?: string;
  accent?: string;
  showDriver?: boolean;
  scale?: number;
};

function Wheel({ position }: { position: [number, number, number] }) {
  return (
    <mesh position={position} castShadow rotation={[0, 0, Math.PI / 2]}>
      <cylinderGeometry args={[0.38, 0.38, 0.28, 16]} />
      <meshStandardMaterial color="#111111" roughness={0.85} metalness={0.2} />
    </mesh>
  );
}

export function VehicleModel({
  color = "#c41e3a",
  accent = "#1a1a1a",
  showDriver = false,
  scale = 1,
}: VehicleModelProps) {
  const driverRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (driverRef.current && showDriver) {
      driverRef.current.rotation.y = Math.sin(clock.elapsedTime * 2) * 0.04;
    }
  });

  return (
    <group scale={scale}>
      {/* Chassis */}
      <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.85, 0.45, 4.2]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.65} />
      </mesh>
      {/* Hood slope */}
      <mesh position={[0, 0.72, 1.35]} castShadow rotation={[0.35, 0, 0]}>
        <boxGeometry args={[1.7, 0.12, 1.4]} />
        <meshStandardMaterial color={color} roughness={0.3} metalness={0.7} />
      </mesh>
      {/* Cabin */}
      <mesh position={[0, 1.05, -0.35]} castShadow>
        <boxGeometry args={[1.55, 0.75, 2.1]} />
        <meshStandardMaterial color={accent} roughness={0.25} metalness={0.5} />
      </mesh>
      {/* Windshield */}
      <mesh position={[0, 1.08, 0.55]} castShadow rotation={[-0.45, 0, 0]}>
        <boxGeometry args={[1.45, 0.06, 0.9]} />
        <meshStandardMaterial
          color="#88ccff"
          roughness={0.05}
          metalness={0.9}
          transparent
          opacity={0.55}
        />
      </mesh>
      {/* Rear window */}
      <mesh position={[0, 1.05, -1.25]} castShadow rotation={[0.35, 0, 0]}>
        <boxGeometry args={[1.4, 0.05, 0.7]} />
        <meshStandardMaterial color="#334455" roughness={0.1} metalness={0.8} transparent opacity={0.6} />
      </mesh>
      {/* Headlights */}
      <mesh position={[-0.65, 0.55, 2.05]} castShadow>
        <boxGeometry args={[0.35, 0.18, 0.12]} />
        <meshStandardMaterial color="#fff8e7" emissive="#fff4cc" emissiveIntensity={0.8} />
      </mesh>
      <mesh position={[0.65, 0.55, 2.05]} castShadow>
        <boxGeometry args={[0.35, 0.18, 0.12]} />
        <meshStandardMaterial color="#fff8e7" emissive="#fff4cc" emissiveIntensity={0.8} />
      </mesh>
      {/* Taillights */}
      <mesh position={[-0.7, 0.55, -2.05]}>
        <boxGeometry args={[0.3, 0.15, 0.08]} />
        <meshStandardMaterial color="#ff2222" emissive="#ff0000" emissiveIntensity={0.6} />
      </mesh>
      <mesh position={[0.7, 0.55, -2.05]}>
        <boxGeometry args={[0.3, 0.15, 0.08]} />
        <meshStandardMaterial color="#ff2222" emissive="#ff0000" emissiveIntensity={0.6} />
      </mesh>
      <Wheel position={[-0.85, 0.38, 1.35]} />
      <Wheel position={[0.85, 0.38, 1.35]} />
      <Wheel position={[-0.85, 0.38, -1.35]} />
      <Wheel position={[0.85, 0.38, -1.35]} />

      {showDriver && (
        <group ref={driverRef} position={[0.35, 0.95, 0.15]}>
          {/* Driver body */}
          <mesh castShadow position={[0, 0.15, 0]}>
            <boxGeometry args={[0.42, 0.55, 0.38]} />
            <meshStandardMaterial color="#2d3748" roughness={0.8} />
          </mesh>
          {/* Driver head */}
          <mesh castShadow position={[0, 0.55, 0.05]}>
            <sphereGeometry args={[0.22, 16, 16]} />
            <meshStandardMaterial color="#d4a574" roughness={0.7} />
          </mesh>
          {/* Arms on wheel */}
          <mesh castShadow position={[-0.15, 0.25, 0.35]} rotation={[0.8, 0, 0.3]}>
            <boxGeometry args={[0.12, 0.45, 0.12]} />
            <meshStandardMaterial color="#2d3748" />
          </mesh>
          <mesh castShadow position={[0.15, 0.25, 0.35]} rotation={[0.8, 0, -0.3]}>
            <boxGeometry args={[0.12, 0.45, 0.12]} />
            <meshStandardMaterial color="#2d3748" />
          </mesh>
          {/* Steering wheel */}
          <mesh position={[0, 0.32, 0.42]} rotation={[0.6, 0, 0]}>
            <torusGeometry args={[0.18, 0.025, 8, 24]} />
            <meshStandardMaterial color="#111111" metalness={0.6} roughness={0.4} />
          </mesh>
        </group>
      )}
    </group>
  );
}
