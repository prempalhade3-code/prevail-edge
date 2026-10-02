import { useMemo } from "react";
import * as THREE from "three";
import type { RoadSegment } from "../../lib/geo";

function segmentDirection(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3().subVectors(b, a).normalize();
}

function buildRoadRibbon(points: [number, number, number][], width: number): THREE.BufferGeometry | null {
  if (points.length < 2) return null;
  const verts: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const left: THREE.Vector3[] = [];
  const right: THREE.Vector3[] = [];

  for (let i = 0; i < points.length; i++) {
    const p = new THREE.Vector3(...points[i]);
    const prev = new THREE.Vector3(...points[Math.max(0, i - 1)]);
    const next = new THREE.Vector3(...points[Math.min(points.length - 1, i + 1)]);
    const dir = segmentDirection(prev, next);
    const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    left.push(p.clone().addScaledVector(perp, width / 2));
    right.push(p.clone().addScaledVector(perp, -width / 2));
  }

  for (let i = 0; i < left.length; i++) {
    verts.push(left[i].x, left[i].y, left[i].z, right[i].x, right[i].y, right[i].z);
    uvs.push(0, i * 0.5, 1, i * 0.5);
    if (i < left.length - 1) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function RoadNetwork({ segments }: { segments: RoadSegment[] }) {
  const roadMeshes = useMemo(() => {
    return segments.map((seg, idx) => {
      const laneWidth = 3.6;
      const width = Math.max(seg.lanes, 2) * laneWidth;
      const geo = buildRoadRibbon(seg.points, width);
      return { key: `${seg.name}-${idx}`, geo, width, points: seg.points };
    });
  }, [segments]);

  return (
    <group>
      {/* Ground / terrain */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[3200, 3200, 32, 32]} />
        <meshStandardMaterial color="#1a2e1a" roughness={0.95} metalness={0.05} />
      </mesh>

      {roadMeshes.map(({ key, geo, width, points }) =>
        geo ? (
          <group key={key}>
            <mesh geometry={geo} receiveShadow castShadow>
              <meshStandardMaterial color="#2a2a2a" roughness={0.88} metalness={0.08} />
            </mesh>
            {/* Sidewalks */}
            {points.slice(0, -1).map((pt, i) => {
              const next = points[i + 1];
              const mid: [number, number, number] = [
                (pt[0] + next[0]) / 2,
                0.06,
                (pt[2] + next[2]) / 2,
              ];
              const dx = next[0] - pt[0];
              const dz = next[2] - pt[2];
              const len = Math.hypot(dx, dz) || 1;
              const yaw = Math.atan2(dx, dz);
              return (
                <group key={`sw-${key}-${i}`} position={mid} rotation={[0, yaw, 0]}>
                  <mesh position={[-width / 2 - 1.2, 0, 0]} receiveShadow>
                    <boxGeometry args={[2.4, 0.12, len + 0.5]} />
                    <meshStandardMaterial color="#3d3d3d" roughness={0.9} />
                  </mesh>
                  <mesh position={[width / 2 + 1.2, 0, 0]} receiveShadow>
                    <boxGeometry args={[2.4, 0.12, len + 0.5]} />
                    <meshStandardMaterial color="#3d3d3d" roughness={0.9} />
                  </mesh>
                </group>
              );
            })}
            {/* Center lane marking dashes */}
            {points.slice(0, -1).map((pt, i) => {
              if (i % 3 !== 0) return null;
              const next = points[i + 1];
              const mid: [number, number, number] = [(pt[0] + next[0]) / 2, 0.05, (pt[2] + next[2]) / 2];
              const dx = next[0] - pt[0];
              const dz = next[2] - pt[2];
              const len = Math.hypot(dx, dz) || 1;
              const yaw = Math.atan2(dx, dz);
              return (
                <mesh key={`dash-${key}-${i}`} position={mid} rotation={[-Math.PI / 2, 0, yaw]}>
                  <planeGeometry args={[0.15, Math.min(len, 3)]} />
                  <meshStandardMaterial color="#e8e8e8" emissive="#cccccc" emissiveIntensity={0.15} />
                </mesh>
              );
            })}
          </group>
        ) : null,
      )}
    </group>
  );
}
