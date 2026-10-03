/**
 * PREVAIL control plane, drawn as a spatial story on the ground — not sky lasers.
 *
 *   roadside gate     physical cabinet at the nearest point of the route to each edge
 *   coverage wash     low disc around the real coverage centre (readable from tactical)
 *   approach chevrons painted on the carriageway toward the predicted next gate
 *   sync column       height tracks the live shadow sync ratio
 *
 * Every colour and visibility flag is read from the live PrevailView.
 */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import {
  AdditiveBlending,
  DoubleSide,
  type Group,
  type Mesh,
  type MeshStandardMaterial,
  Vector3,
} from "three";
import type { EdgeRegionGeo } from "../../lib/cityScene";
import type { Pose, PrevailView } from "../../lib/liveStore";
import { ROLE_COLOR, roleOf, syncRatioOf, type EdgeRole } from "./EdgeInfrastructure";

const CHEVRON_COUNT = 6;

function nearestOnRoute(route: [number, number][], x: number, z: number): [number, number] {
  let best = route[0];
  let bestD = Infinity;
  for (const p of route) {
    const d = (p[0] - x) ** 2 + (p[1] - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function RoadsideCabinet({ role }: { role: EdgeRole }) {
  const colour = ROLE_COLOR[role];
  return (
    <group>
      <mesh position={[0, 0.06, 0]} receiveShadow>
        <boxGeometry args={[3.4, 0.12, 2.4]} />
        <meshStandardMaterial color="#6d6a64" roughness={0.95} />
      </mesh>
      <mesh position={[0, 1.15, 0]} castShadow>
        <boxGeometry args={[1.7, 2.2, 1.15]} />
        <meshStandardMaterial color="#c5c8ce" roughness={0.45} metalness={0.35} />
      </mesh>
      <mesh position={[0, 2.32, 0]}>
        <boxGeometry args={[1.85, 0.12, 1.28]} />
        <meshStandardMaterial color="#4a4e55" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0.95, 1.2, 0]}>
        <boxGeometry args={[0.08, 1.4, 0.7]} />
        <meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
      <mesh position={[0, 6.2, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.09, 8.4, 8]} />
        <meshStandardMaterial color="#b7bcc4" metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh position={[0, 10.6, 0]}>
        <boxGeometry args={[0.28, 1.6, 0.12]} />
        <meshStandardMaterial color="#e8edf2" roughness={0.4} />
      </mesh>
      <mesh position={[0, 11.7, 0]}>
        <sphereGeometry args={[0.22, 12, 10]} />
        <meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={2.2} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Gate({
  region,
  gate,
  view,
}: {
  region: EdgeRegionGeo;
  gate: [number, number];
  view: React.MutableRefObject<PrevailView>;
}) {
  const root = useRef<Group>(null);
  const wash = useRef<MeshStandardMaterial>(null);
  const sync = useRef<Mesh>(null);
  const label = useRef<Group>(null);
  const roleRef = useRef<EdgeRole>("idle");

  useFrame(({ camera }) => {
    const role = roleOf(view.current, region.edge_id);
    roleRef.current = role;
    const colour = ROLE_COLOR[role];
    if (wash.current) {
      wash.current.color.set(colour);
      wash.current.opacity = role === "authoritative" ? 0.1 : role === "idle" ? 0.02 : 0.07;
    }
    if (sync.current) {
      const ratio = syncRatioOf(view.current, region.edge_id);
      const showing = role === "shadow";
      sync.current.visible = showing;
      if (showing) {
        sync.current.scale.y = Math.max(0.04, ratio);
        sync.current.position.y = 0.2 + ratio * 1.6;
      }
    }
    if (label.current) label.current.quaternion.copy(camera.quaternion);
  });

  return (
    <group ref={root} position={[gate[0], 0, gate[1]]}>
      <RoadsideCabinet role="idle" />
      <mesh ref={sync} position={[-1.3, 0.2, 0]} visible={false}>
        <boxGeometry args={[0.18, 3.2, 0.18]} />
        <meshStandardMaterial
          color={ROLE_COLOR.shadow}
          emissive={ROLE_COLOR.shadow}
          emissiveIntensity={1.8}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <circleGeometry args={[28, 48]} />
        <meshStandardMaterial
          ref={wash}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <group ref={label} position={[0, 13.4, 0]}>
        <Text fontSize={1.6} color="#f4f7fb" anchorX="center" outlineWidth={0.06} outlineColor="#081018">
          {region.edge_id.toUpperCase()}
        </Text>
        <GateStatus region={region} view={view} />
      </group>
    </group>
  );
}

function GateStatus({
  region,
  view,
}: {
  region: EdgeRegionGeo;
  view: React.MutableRefObject<PrevailView>;
}) {
  const last = useRef("");
  const textRef = useRef<{ text: string } | null>(null);
  useFrame(() => {
    const role = roleOf(view.current, region.edge_id);
    const sync = syncRatioOf(view.current, region.edge_id);
    const next =
      role === "shadow"
        ? `SHADOW  ${(sync * 100).toFixed(0)}%`
        : role === "authoritative"
          ? "AUTHORITY"
          : role === "predicted"
            ? "PREDICTED NEXT"
            : "STANDBY";
    if (next !== last.current && textRef.current) {
      last.current = next;
      textRef.current.text = next;
    }
  });
  return (
    <Text
      ref={textRef as never}
      position={[0, -1.7, 0]}
      fontSize={0.95}
      color="#c5d4e4"
      anchorX="center"
      outlineWidth={0.05}
      outlineColor="#081018"
    >
      STANDBY
    </Text>
  );
}

function Coverage({
  region,
  view,
}: {
  region: EdgeRegionGeo;
  view: React.MutableRefObject<PrevailView>;
}) {
  const ring = useRef<MeshStandardMaterial>(null);
  useFrame(() => {
    const role = roleOf(view.current, region.edge_id);
    const colour = ROLE_COLOR[role];
    if (ring.current) {
      ring.current.color.set(colour);
      ring.current.emissive.set(colour);
      ring.current.opacity = role === "idle" ? 0.12 : 0.45;
    }
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[region.x, 0.08, region.z]}>
      <ringGeometry args={[region.coverage_radius_m - 8, region.coverage_radius_m, 96]} />
      <meshStandardMaterial
        ref={ring}
        transparent
        depthWrite={false}
        side={DoubleSide}
        toneMapped={false}
      />
    </mesh>
  );
}

function ApproachChevrons({
  pose,
  view,
  gates,
}: {
  pose: React.MutableRefObject<Pose>;
  view: React.MutableRefObject<PrevailView>;
  gates: Map<string, [number, number]>;
}) {
  const group = useRef<Group>(null);
  const mats = useRef<(MeshStandardMaterial | null)[]>([]);

  useFrame(() => {
    const predicted = view.current.predictedEdge;
    const gate = predicted ? gates.get(predicted) : undefined;
    const root = group.current;
    if (!root || !gate) {
      if (root) root.visible = false;
      return;
    }
    root.visible = true;
    const p = pose.current;
    const dx = gate[0] - p.x;
    const dz = gate[1] - p.z;
    const dist = Math.hypot(dx, dz) || 1;
    const ux = dx / dist;
    const uz = dz / dist;
    root.position.set(p.x, 0.06, p.z);
    root.rotation.y = Math.atan2(ux, uz);
    const colour = ROLE_COLOR.predicted;
    for (const mat of mats.current) {
      if (!mat) continue;
      mat.color.set(colour);
      mat.emissive.set(colour);
      mat.opacity = 0.25 + view.current.predictionConfidence * 0.5;
    }
  });

  return (
    <group ref={group} visible={false}>
      {Array.from({ length: CHEVRON_COUNT }, (_, i) => (
        <mesh key={i} position={[0, 0, 8 + i * 7]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.15, 1.15, 3, 1, 0, Math.PI * 0.7]} />
          <meshStandardMaterial
            ref={(node) => {
              mats.current[i] = node;
            }}
            transparent
            depthWrite={false}
            toneMapped={false}
            emissiveIntensity={1.4}
          />
        </mesh>
      ))}
    </group>
  );
}

export function HandoffStory({
  regions,
  route,
  pose,
  view,
}: {
  regions: EdgeRegionGeo[];
  route: [number, number][];
  pose: React.MutableRefObject<Pose>;
  view: React.MutableRefObject<PrevailView>;
}) {
  const gates = useMemo(() => {
    const map = new Map<string, [number, number]>();
    for (const r of regions) map.set(r.edge_id, nearestOnRoute(route, r.x, r.z));
    return map;
  }, [regions, route]);

  return (
    <group>
      {regions.map((region) => (
        <Coverage key={`c-${region.edge_id}`} region={region} view={view} />
      ))}
      {regions.map((region) => (
        <Gate
          key={`g-${region.edge_id}`}
          region={region}
          gate={gates.get(region.edge_id) ?? [region.x, region.z]}
          view={view}
        />
      ))}
      <ApproachChevrons pose={pose} view={view} gates={gates} />
    </group>
  );
}
