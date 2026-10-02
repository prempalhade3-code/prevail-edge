import { useRef } from "react";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ShadowRole } from "../../types";

function roleColors(role: ShadowRole): { main: string; glow: string; emissive: number } {
  if (role === "AUTHORITATIVE") return { main: "#10b981", glow: "#34d399", emissive: 1.2 };
  if (role === "WARM_SHADOW") return { main: "#f59e0b", glow: "#fbbf24", emissive: 0.9 };
  return { main: "#64748b", glow: "#94a3b8", emissive: 0.4 };
}

export function EdgeServerTower({
  position,
  edgeId,
  role,
}: {
  position: [number, number, number];
  edgeId: string;
  role: ShadowRole;
}) {
  const ringRef = useRef<THREE.Mesh>(null);
  const domeRef = useRef<THREE.MeshStandardMaterial>(null);
  const colors = roleColors(role);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ringRef.current) {
      ringRef.current.rotation.y = t * 0.5;
      ringRef.current.position.y = 22 + Math.sin(t * 2) * 0.3;
    }
    if (domeRef.current) {
      domeRef.current.opacity = 0.15 + Math.sin(t * 3) * 0.05;
    }
  });

  return (
    <group position={position}>
      {/* Elevated platform over road */}
      <mesh position={[0, 8, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[6, 7, 1.2, 6]} />
        <meshStandardMaterial color="#1e293b" roughness={0.5} metalness={0.6} />
      </mesh>
      {/* Support pillars */}
      {[
        [4, 0, 4],
        [-4, 0, 4],
        [4, 0, -4],
        [-4, 0, -4],
      ].map((p, i) => (
        <mesh key={i} position={[p[0], 4, p[2]]} castShadow>
          <boxGeometry args={[0.6, 8, 0.6]} />
          <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.6} />
        </mesh>
      ))}
      {/* Server rack cabinets */}
      {[-1.5, 0, 1.5].map((x, i) => (
        <mesh key={i} position={[x, 10, 0]} castShadow>
          <boxGeometry args={[1.2, 3.5, 2]} />
          <meshStandardMaterial color="#0f172a" roughness={0.4} metalness={0.7} />
        </mesh>
      ))}
      {/* Blinking status LEDs */}
      {[-1.5, 0, 1.5].map((x, i) => (
        <mesh key={`led-${i}`} position={[x, 11.5, 1.05]}>
          <sphereGeometry args={[0.08, 8, 8]} />
          <meshStandardMaterial color={colors.main} emissive={colors.glow} emissiveIntensity={colors.emissive} />
        </mesh>
      ))}
      {/* Antenna mast */}
      <mesh position={[0, 14, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.2, 8, 8]} />
        <meshStandardMaterial color="#475569" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, 18.5, 0]}>
        <sphereGeometry args={[0.5, 16, 16]} />
        <meshStandardMaterial color={colors.main} emissive={colors.glow} emissiveIntensity={colors.emissive} />
      </mesh>
      {/* Holographic coverage dome */}
      <mesh position={[0, 10, 0]}>
        <sphereGeometry args={[14, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          ref={domeRef}
          color={colors.glow}
          transparent
          opacity={0.12}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* Rotating data ring */}
      <mesh ref={ringRef} position={[0, 22, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[3, 0.06, 8, 48]} />
        <meshStandardMaterial color={colors.glow} emissive={colors.glow} emissiveIntensity={1} />
      </mesh>
      {/* Beam to ground */}
      <mesh position={[0, 5, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 10, 8]} />
        <meshStandardMaterial color={colors.glow} emissive={colors.glow} emissiveIntensity={0.5} transparent opacity={0.4} />
      </mesh>
      <pointLight position={[0, 12, 0]} intensity={0.6} distance={40} color={colors.glow} />

      <Html position={[0, 24, 0]} center distanceFactor={28} style={{ pointerEvents: "none" }}>
        <div className="px-2 py-1 rounded bg-black/80 border border-white/20 text-[10px] font-bold text-white whitespace-nowrap">
          {edgeId.toUpperCase()}
          <span className="ml-1 text-[9px] font-normal opacity-70">{role}</span>
        </div>
      </Html>
    </group>
  );
}
