/**
 * Edge servers as physical roadside infrastructure, and the PREVAIL control state
 * drawn into the world.
 *
 * Each site is a micro data centre: a concrete pad, an equipment shelter, a lattice
 * communications mast with sector antennas, and a status beacon. Role is encoded in
 * colour and in a coverage ring sized to the region's real radius (over a kilometre),
 * so coverage, prediction, shadow warm-up, synchronisation and authority transfer are
 * all legible from the scene itself rather than from a log.
 *
 * Every colour and number here is derived from the live snapshot. Nothing animates to
 * suggest progress that the runtime has not actually reported.
 */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import {
  AdditiveBlending,
  type Group,
  type Mesh,
  type MeshStandardMaterial,
  DoubleSide,
} from "three";
import type { EdgeRegionGeo } from "../../lib/cityScene";
import type { PrevailView } from "../../lib/liveStore";

export type EdgeRole = "authoritative" | "shadow" | "predicted" | "idle";

export const ROLE_COLOR: Record<EdgeRole, string> = {
  authoritative: "#2fe08a",
  shadow: "#ffb02e",
  predicted: "#4aa8ff",
  idle: "#64748b",
};

const ROLE_LABEL: Record<EdgeRole, string> = {
  authoritative: "AUTHORITATIVE",
  shadow: "WARM SHADOW",
  predicted: "PREDICTED NEXT",
  idle: "STANDBY",
};

export function roleOf(view: PrevailView, edgeId: string): EdgeRole {
  if (view.authorityHolder === edgeId) return "authoritative";
  if (view.shadows.some((s) => s.edge_id === edgeId)) return "shadow";
  if (view.predictedEdge === edgeId) return "predicted";
  return "idle";
}

export function syncRatioOf(view: PrevailView, edgeId: string): number {
  return view.shadows.find((s) => s.edge_id === edgeId)?.sync_ratio ?? 0;
}

const MAST_HEIGHT = 22;

/** Static hardware: pad, shelter, mast, antennas. Built once per site. */
function EdgeHardware() {
  return (
    <group>
      <mesh position={[0, 0.08, 0]} receiveShadow>
        <boxGeometry args={[11, 0.16, 9]} />
        <meshStandardMaterial color="#9a978e" roughness={0.95} />
      </mesh>

      {/* Equipment shelter */}
      <group position={[-2.6, 0, 0]}>
        <mesh position={[0, 1.45, 0]} castShadow receiveShadow>
          <boxGeometry args={[4.2, 2.7, 3.2]} />
          <meshStandardMaterial color="#d8dae0" roughness={0.7} metalness={0.25} />
        </mesh>
        <mesh position={[0, 2.88, 0]} castShadow>
          <boxGeometry args={[4.5, 0.18, 3.5]} />
          <meshStandardMaterial color="#7e858f" roughness={0.6} metalness={0.4} />
        </mesh>
        {/* Louvred vents and door */}
        <mesh position={[0, 1.5, 1.63]}>
          <boxGeometry args={[1.5, 1.9, 0.08]} />
          <meshStandardMaterial color="#5b616b" roughness={0.6} metalness={0.5} />
        </mesh>
        <mesh position={[1.45, 1.9, 1.63]}>
          <boxGeometry args={[1.0, 0.8, 0.06]} />
          <meshStandardMaterial color="#454a52" roughness={0.5} metalness={0.6} />
        </mesh>
        {/* Cooling units on the flank */}
        {[-0.8, 0.8].map((z) => (
          <mesh key={z} position={[-2.2, 1.6, z]}>
            <boxGeometry args={[0.35, 1.1, 1.1]} />
            <meshStandardMaterial color="#aeb3ba" roughness={0.5} metalness={0.55} />
          </mesh>
        ))}
      </group>

      {/* Lattice mast */}
      <group position={[2.8, 0, 0]}>
        {[
          [-0.45, -0.45],
          [0.45, -0.45],
          [-0.45, 0.45],
          [0.45, 0.45],
        ].map(([x, z], i) => (
          <mesh key={i} position={[x, MAST_HEIGHT / 2, z]} castShadow>
            <boxGeometry args={[0.12, MAST_HEIGHT, 0.12]} />
            <meshStandardMaterial color="#b9bec6" roughness={0.45} metalness={0.75} />
          </mesh>
        ))}
        {Array.from({ length: 9 }, (_, i) => (
          <mesh key={`b${i}`} position={[0, 2 + i * 2.3, 0]}>
            <boxGeometry args={[1.02, 0.08, 1.02]} />
            <meshStandardMaterial color="#9aa0a8" roughness={0.5} metalness={0.7} />
          </mesh>
        ))}

        {/* Sector antennas */}
        {[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((angle, i) => (
          <group key={`a${i}`} rotation={[0, angle, 0]}>
            <mesh position={[0, MAST_HEIGHT - 1.6, 1.15]} castShadow>
              <boxGeometry args={[0.42, 2.3, 0.16]} />
              <meshStandardMaterial color="#eef1f4" roughness={0.45} />
            </mesh>
          </group>
        ))}

        {/* Microwave backhaul dish */}
        <mesh position={[0, MAST_HEIGHT - 5.5, 1.0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[1.05, 1.05, 0.22, 20]} />
          <meshStandardMaterial color="#e6e9ec" roughness={0.5} metalness={0.3} />
        </mesh>
      </group>
    </group>
  );
}

type EdgeSiteProps = {
  region: EdgeRegionGeo;
  view: React.MutableRefObject<PrevailView>;
};

function EdgeSite({ region, view }: EdgeSiteProps) {
  const beacon = useRef<Mesh>(null);
  const beaconMat = useRef<MeshStandardMaterial>(null);
  const ringMat = useRef<MeshStandardMaterial>(null);
  const discMat = useRef<MeshStandardMaterial>(null);
  const shaft = useRef<Mesh>(null);
  const shaftMat = useRef<MeshStandardMaterial>(null);
  const syncBar = useRef<Mesh>(null);
  const label = useRef<Group>(null);
  const roleRef = useRef<EdgeRole>("idle");
  const syncRef = useRef(0);

  useFrame(({ clock, camera }) => {
    const role = roleOf(view.current, region.edge_id);
    const sync = syncRatioOf(view.current, region.edge_id);
    roleRef.current = role;
    syncRef.current = sync;
    const colour = ROLE_COLOR[role];
    const t = clock.elapsedTime;

    // Beacon: steady when authoritative, pulsing while a shadow warms or is predicted.
    if (beaconMat.current) {
      beaconMat.current.color.set(colour);
      beaconMat.current.emissive.set(colour);
      const pulse =
        role === "authoritative" ? 2.4 : role === "idle" ? 0.25 : 1.1 + Math.sin(t * 4) * 0.7;
      beaconMat.current.emissiveIntensity = pulse;
    }
    if (beacon.current) {
      beacon.current.scale.setScalar(role === "idle" ? 0.7 : 1.0);
    }

    // Coverage ring and ground wash.
    if (ringMat.current) {
      ringMat.current.color.set(colour);
      ringMat.current.emissive.set(colour);
      ringMat.current.emissiveIntensity = role === "idle" ? 0.25 : 1.3;
      ringMat.current.opacity = role === "idle" ? 0.18 : 0.6;
    }
    if (discMat.current) {
      discMat.current.color.set(colour);
      discMat.current.opacity = role === "authoritative" ? 0.075 : role === "idle" ? 0.012 : 0.04;
    }

    // Vertical shaft so an active site is findable from street level.
    if (shaftMat.current && shaft.current) {
      const active = role !== "idle";
      shaft.current.visible = active;
      if (active) {
        shaftMat.current.color.set(colour);
        shaftMat.current.opacity = role === "authoritative" ? 0.2 : 0.12 + Math.sin(t * 3) * 0.05;
      }
    }

    // Synchronisation progress, scaled directly by the reported sync ratio.
    if (syncBar.current) {
      const showing = role === "shadow";
      syncBar.current.visible = showing;
      if (showing) {
        syncBar.current.scale.y = Math.max(0.001, sync);
        syncBar.current.position.y = 4.4 + (sync * 6) / 2;
      }
    }

    if (label.current) {
      label.current.quaternion.copy(camera.quaternion);
    }
  });

  const coverage = region.coverage_radius_m;

  return (
    <group position={[region.x, 0, region.z]} rotation={[0, region.yaw, 0]}>
      <EdgeHardware />

      {/* Status beacon at the mast head */}
      <mesh ref={beacon} position={[2.8, MAST_HEIGHT + 1.1, 0]}>
        <sphereGeometry args={[0.85, 20, 16]} />
        <meshStandardMaterial ref={beaconMat} toneMapped={false} />
      </mesh>

      {/* Sync progress column beside the shelter */}
      <mesh ref={syncBar} position={[-5.4, 4.4, 0]}>
        <boxGeometry args={[0.5, 6, 0.5]} />
        <meshStandardMaterial
          color={ROLE_COLOR.shadow}
          emissive={ROLE_COLOR.shadow}
          emissiveIntensity={1.6}
          toneMapped={false}
        />
      </mesh>

      <mesh ref={shaft} position={[2.8, 140, 0]}>
        <cylinderGeometry args={[3.5, 10, 280, 16, 1, true]} />
        <meshStandardMaterial
          ref={shaftMat}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
          side={DoubleSide}
          toneMapped={false}
        />
      </mesh>

      {/* Coverage boundary at the region's true radius */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.12, 0]}>
        <ringGeometry args={[coverage - 9, coverage, 128]} />
        <meshStandardMaterial
          ref={ringMat}
          transparent
          depthWrite={false}
          side={DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <circleGeometry args={[coverage, 96]} />
        <meshStandardMaterial
          ref={discMat}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </mesh>

      <group ref={label} position={[2.8, MAST_HEIGHT + 5.5, 0]}>
        <Text fontSize={3.1} color="#ffffff" anchorX="center" anchorY="middle" outlineWidth={0.1} outlineColor="#06121f">
          {region.edge_id.toUpperCase()}
        </Text>
        <EdgeStatusText region={region} view={view} />
      </group>
    </group>
  );
}

/** Role and sync text, refreshed only when the underlying values change. */
function EdgeStatusText({
  region,
  view,
}: {
  region: EdgeRegionGeo;
  view: React.MutableRefObject<PrevailView>;
}) {
  const textRef = useRef<{ text: string } | null>(null);
  const last = useRef("");

  useFrame(() => {
    const role = roleOf(view.current, region.edge_id);
    const sync = syncRatioOf(view.current, region.edge_id);
    const next =
      role === "shadow" ? `${ROLE_LABEL[role]}  ${(sync * 100).toFixed(0)}%` : ROLE_LABEL[role];
    if (next !== last.current && textRef.current) {
      last.current = next;
      textRef.current.text = next;
    }
  });

  return (
    <Text
      ref={textRef as never}
      position={[0, -3.0, 0]}
      fontSize={1.9}
      color="#cfe3f5"
      anchorX="center"
      anchorY="middle"
      outlineWidth={0.07}
      outlineColor="#06121f"
    >
      STANDBY
    </Text>
  );
}

export function EdgeInfrastructure({
  regions,
  view,
}: {
  regions: EdgeRegionGeo[];
  view: React.MutableRefObject<PrevailView>;
}) {
  const sites = useMemo(() => regions, [regions]);
  return (
    <>
      {sites.map((region) => (
        <EdgeSite key={region.edge_id} region={region} view={view} />
      ))}
    </>
  );
}
