/**
 * Live PREVAIL metropolitan corridor.
 *
 * Buildings and trees are PBR masses placed on OSM-validated sites. Edge story
 * is drawn on the road. Lighting uses a city HDRI so materials actually read.
 */
import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import { Vector3 } from "three";
import type { SystemSnapshot } from "../../types";
import { loadCityScene, type CityScene } from "../../lib/cityScene";
import {
  PoseTracker,
  TrafficTracker,
  createPrevailView,
  updatePrevailView,
  type Pose,
  type PrevailView,
} from "../../lib/liveStore";
import { Roads } from "./Roads";
import { MetroBuildings } from "./MetroBuildings";
import { MetroTrees } from "./MetroTrees";
import { StreetLights } from "./StreetLights";
import { HeroVehicle } from "./HeroVehicle";
import { TrafficVehicles } from "./TrafficVehicles";
import { HandoffStory } from "./HandoffStory";
import { RouteOverlay } from "./RouteOverlay";
import { CameraRig, type CameraMode } from "./CameraRig";
import { ModelErrorBoundary } from "./ModelErrorBoundary";

type CityWorldProps = {
  snapshot: SystemSnapshot | null;
  cameraMode: CameraMode;
};

export function CityWorld({ snapshot, cameraMode }: CityWorldProps) {
  const [scene, setScene] = useState<CityScene | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const heroTracker = useRef(new PoseTracker());
  const trafficTracker = useRef(new TrafficTracker());
  const heroPose = useRef<Pose>({ x: 0, z: 0, yaw: 0, speed: 0 });
  const view = useRef<PrevailView>(createPrevailView());
  const focus = useRef(new Vector3());

  useEffect(() => {
    loadCityScene()
      .then(setScene)
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.vehicle_latitude != null && snapshot.vehicle_longitude != null) {
      heroTracker.current.setTarget(
        snapshot.vehicle_latitude,
        snapshot.vehicle_longitude,
        snapshot.vehicle_heading ?? 0,
        snapshot.vehicle_speed_mps ?? 0,
      );
      heroTracker.current.sample(heroPose.current);
      focus.current.set(heroPose.current.x, 0, heroPose.current.z);
    }
    if (snapshot.traffic_vehicles?.length) {
      trafficTracker.current.sync(snapshot.traffic_vehicles);
    }
    updatePrevailView(view.current, snapshot);
  }, [snapshot]);

  useFrame(() => {
    heroTracker.current.sample(heroPose.current);
    trafficTracker.current.advance();
    focus.current.set(heroPose.current.x, 0, heroPose.current.z);
  });

  if (loadError) {
    return (
      <mesh position={[0, 4, 0]}>
        <boxGeometry args={[0.1, 0.1, 0.1]} />
        <meshBasicMaterial color="red" />
      </mesh>
    );
  }

  if (!scene) return null;

  const far = cameraMode === "tactical" || cameraMode === "edge";

  return (
    <>
      <color attach="background" args={["#7d93a6"]} />
      <fog attach="fog" args={far ? ["#8ea4b5", 700, 2800] : ["#93a6b4", 90, 520]} />
      <Environment preset="city" environmentIntensity={0.72} />
      <hemisphereLight args={["#d7e4ef", "#5b5346", 0.32]} />
      <directionalLight
        castShadow
        intensity={1.35}
        position={[120, 160, 70]}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={420}
        shadow-camera-left={-90}
        shadow-camera-right={90}
        shadow-camera-top={90}
        shadow-camera-bottom={-90}
      />

      <Roads roads={scene.roads} />
      <RouteOverlay route={scene.route} />
      <MetroBuildings instances={scene.buildings} focus={focus} radius={far ? 780 : 360} />
      <MetroTrees instances={scene.trees} focus={focus} radius={far ? 520 : 220} />
      <StreetLights roads={scene.roads} />

      <ModelErrorBoundary>
        <HeroVehicle pose={heroPose} />
      </ModelErrorBoundary>
      <ModelErrorBoundary>
        <TrafficVehicles traffic={trafficTracker} />
      </ModelErrorBoundary>

      <HandoffStory regions={scene.edge_regions} route={scene.route} pose={heroPose} view={view} />
      <CameraRig mode={cameraMode} pose={heroPose} view={view} regions={scene.edge_regions} />
    </>
  );
}
