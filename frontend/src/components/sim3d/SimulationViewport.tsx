import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Sky, Stars } from "@react-three/drei";
import type { SystemSnapshot } from "../../types";
import { headingToRad, latLonToVec3, parseRoadGeoJson, ORIGIN_LAT, ORIGIN_LON } from "../../lib/geo";
import { RoadNetwork } from "./RoadNetwork";
import { CityEnvironment } from "./CityEnvironment";
import { VehicleModel } from "./VehicleModel";
import { EdgeServerTower } from "./EdgeServerTower";
import { ChaseCamera } from "./ChaseCamera";

const TRAFFIC_COLORS = ["#2563eb", "#7c3aed", "#059669", "#dc2626", "#ca8a04", "#0891b2", "#4b5563", "#9333ea"];

export function SimulationViewport({ snapshot }: { snapshot: SystemSnapshot | null }) {
  const [segments, setSegments] = useState<ReturnType<typeof parseRoadGeoJson>>([]);

  useEffect(() => {
    fetch("/sim/network/bangalore-corridor.geojson")
      .then((r) => r.json())
      .then((geo) => setSegments(parseRoadGeoJson(geo)))
      .catch(() => setSegments([]));
  }, []);

  const hero = useMemo(() => {
    if (snapshot?.vehicle_latitude != null && snapshot?.vehicle_longitude != null) {
      return {
        pos: latLonToVec3(snapshot.vehicle_latitude, snapshot.vehicle_longitude, 0.02),
        heading: headingToRad(snapshot.vehicle_heading ?? 0),
      };
    }
    return { pos: latLonToVec3(ORIGIN_LAT, ORIGIN_LON, 0.02), heading: 0 };
  }, [snapshot?.vehicle_latitude, snapshot?.vehicle_longitude, snapshot?.vehicle_heading]);

  const traffic = useMemo(
    () =>
      snapshot?.traffic_vehicles?.map((v, i) => ({
        id: v.vehicle_id,
        pos: latLonToVec3(v.latitude, v.longitude, 0.02),
        heading: headingToRad(v.heading_deg),
        color: TRAFFIC_COLORS[i % TRAFFIC_COLORS.length],
      })) ?? [],
    [snapshot?.traffic_vehicles],
  );

  const edgeTowers = useMemo(
    () =>
      snapshot?.topology.map((n) => ({
        id: n.edge_id,
        pos: latLonToVec3(n.latitude, n.longitude, 0),
        role: n.role,
      })) ?? [],
    [snapshot?.topology],
  );

  return (
    <div className="relative w-full h-full min-h-[520px] rounded-lg overflow-hidden border border-slate-700/50 shadow-2xl">
      <div className="absolute top-3 left-3 z-10 flex gap-2">
        <span className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider bg-black/60 border border-cyan-500/40 text-cyan-300 rounded">
          3D Live Simulation
        </span>
        <span className="px-2 py-1 text-[10px] bg-black/60 border border-emerald-500/30 text-emerald-300 rounded">
          Edge: {snapshot?.current_edge_id ?? "—"}
        </span>
      </div>
      <Canvas shadows camera={{ fov: 55, near: 0.1, far: 2500, position: [0, 20, 40] }}>
        <Suspense fallback={null}>
          <color attach="background" args={["#0a0f18"]} />
          <fog attach="fog" args={["#0a0f18", 80, 450]} />
          <Sky distance={450000} sunPosition={[100, 20, 100]} inclination={0.52} azimuth={0.25} />
          <Stars radius={300} depth={60} count={2000} factor={3} saturation={0} fade speed={0.5} />

          <ambientLight intensity={0.25} />
          <directionalLight
            castShadow
            intensity={1.4}
            position={[60, 80, 40]}
            shadow-mapSize={[2048, 2048]}
            shadow-camera-far={400}
            shadow-camera-left={-120}
            shadow-camera-right={120}
            shadow-camera-top={120}
            shadow-camera-bottom={-120}
          />
          <hemisphereLight args={["#88aaff", "#1a1a10", 0.35]} />

          <RoadNetwork segments={segments} />
          <CityEnvironment segments={segments} />

          {edgeTowers.map((e) => (
            <EdgeServerTower key={e.id} position={e.pos} edgeId={e.id} role={e.role} />
          ))}

          {/* Hero vehicle with driver */}
          <group position={hero.pos} rotation={[0, hero.heading, 0]}>
            <VehicleModel color="#0891b2" accent="#0f172a" showDriver scale={1} />
          </group>

          {/* Traffic fleet */}
          {traffic.map((v) => (
            <group key={v.id} position={v.pos} rotation={[0, v.heading, 0]}>
              <VehicleModel color={v.color} scale={0.92} />
            </group>
          ))}

          <ChaseCamera target={hero.pos} headingRad={hero.heading} />
        </Suspense>
      </Canvas>
    </div>
  );
}
