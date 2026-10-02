import { useMemo } from "react";
import * as THREE from "three";
import type { RoadSegment } from "../../lib/geo";

function seededRandom(seed: number) {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

export function CityEnvironment({ segments }: { segments: RoadSegment[] }) {
  const buildings = useMemo(() => {
    const items: {
      pos: [number, number, number];
      size: [number, number, number];
      color: string;
      seed: number;
    }[] = [];

    for (const seg of segments) {
      for (let i = 0; i < seg.points.length - 1; i += 2) {
        const pt = seg.points[i];
        const next = seg.points[i + 1];
        const dx = next[0] - pt[0];
        const dz = next[2] - pt[2];
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len;
        const nz = dx / len;
        const laneW = Math.max(seg.lanes, 2) * 3.6;

        for (const side of [-1, 1]) {
          for (let row = 0; row < 3; row++) {
            const seed = i * 17 + row * 31 + (side > 0 ? 999 : 0);
            const offset = laneW / 2 + 8 + row * 14 + seededRandom(seed) * 6;
            const along = (seededRandom(seed + 1) - 0.5) * len * 0.8;
            const h = 12 + seededRandom(seed + 2) * 45;
            const w = 8 + seededRandom(seed + 3) * 10;
            const d = 8 + seededRandom(seed + 4) * 10;
            items.push({
              pos: [pt[0] + nx * offset * side + (dx / len) * along, h / 2, pt[2] + nz * offset * side + (dz / len) * along],
              size: [w, h, d],
              color: new THREE.Color().setHSL(0.58, 0.08, 0.12 + seededRandom(seed + 5) * 0.18).getStyle(),
              seed,
            });
          }
        }
      }
    }
    return items;
  }, [segments]);

  const lamps = useMemo(() => {
    const items: { pos: [number, number, number] }[] = [];
    for (const seg of segments) {
      for (let i = 0; i < seg.points.length; i += 4) {
        const pt = seg.points[i];
        items.push([pt[0] + 12, 0, pt[2] + 8]);
        items.push([pt[0] - 12, 0, pt[2] - 8]);
      }
    }
    return items;
  }, [segments]);

  return (
    <group>
      {buildings.map((b, i) => (
        <group key={`bld-${i}`} position={b.pos}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={b.size} />
            <meshStandardMaterial color={b.color} roughness={0.75} metalness={0.15} />
          </mesh>
          {/* Window grid */}
          {Array.from({ length: Math.floor(b.size[1] / 4) }).map((_, floor) => (
            <mesh key={floor} position={[0, -b.size[1] / 2 + 2 + floor * 4, b.size[2] / 2 + 0.05]}>
              <planeGeometry args={[b.size[0] * 0.75, 2.5]} />
              <meshStandardMaterial
                color="#1a2535"
                emissive="#ffcc66"
                emissiveIntensity={seededRandom(b.seed + floor) > 0.4 ? 0.35 : 0.05}
                roughness={0.2}
                metalness={0.6}
              />
            </mesh>
          ))}
        </group>
      ))}

      {lamps.map((pos, i) => (
        <group key={`lamp-${i}`} position={pos}>
          <mesh castShadow position={[0, 2.5, 0]}>
            <cylinderGeometry args={[0.08, 0.12, 5, 8]} />
            <meshStandardMaterial color="#444444" metalness={0.7} roughness={0.4} />
          </mesh>
          <mesh position={[0, 5.1, 0.3]}>
            <boxGeometry args={[0.6, 0.15, 0.4]} />
            <meshStandardMaterial color="#ffffee" emissive="#ffeeaa" emissiveIntensity={1.2} />
          </mesh>
          <pointLight position={[0, 5, 0.5]} intensity={0.4} distance={18} color="#ffddaa" />
        </group>
      ))}
    </group>
  );
}
