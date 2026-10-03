/**
 * Live PREVAIL metropolitan corridor.
 *
 * Snapshot traffic stays on a ref so React never re-renders this tree at
 * telemetry rate. Buildings and trees are instanced PBR masses.
 */
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
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
  snapshotRef: MutableRefObject<SystemSnapshot | null>;
  cameraMode: CameraMode;
};

export function CityWorld({ snapshotRef, cameraMode }: CityWorldProps) {
  const [scene, setScene] = useState<CityScene | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const heroTracker = useRef(new PoseTracker());
  const trafficTracker = useRef(new TrafficTracker());
  const heroPose = useRef<Pose>({ x: 0, z: 0, yaw: 0, speed: 0 });
  const view = useRef<PrevailView>(createPrevailView());
  const focus = useRef(new Vector3());
  const lastSnap = useRef<SystemSnapshot | null>(null);

  useEffect(() => {
    loadCityScene()
      .then(setScene)
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  useFrame(() => {
    const snapshot = snapshotRef.current;
    if (snapshot && snapshot !== lastSnap.current) {
      lastSnap.current = snapshot;
      if (snapshot.vehicle_latitude != null && snapshot.vehicle_longitude != null) {
        heroTracker.current.setTarget(
          snapshot.vehicle_latitude,
          snapshot.vehicle_longitude,
          snapshot.vehicle_heading ?? 0,
          snapshot.vehicle_speed_mps ?? 0,
        );
      }
      if (snapshot.traffic_vehicles?.length) {
        trafficTracker.current.sync(snapshot.traffic_vehicles);
      }
      updatePrevailView(view.current, snapshot);
    }
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
      <color attach="background" args={["#9eb6c8"]} />
      <fog attach="fog" args={[far ? "#9eb6c8" : "#a3b9c8", far ? 420 : 80, far ? 1600 : 560]} />
      <hemisphereLight args={["#f3f7fb", "#6b6254", 0.88]} />
      <directionalLight
        castShadow
        intensity={1.85}
        position={[90, 140, 55]}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-far={220}
        shadow-camera-left={-50}
        shadow-camera-right={50}
        shadow-camera-top={50}
        shadow-camera-bottom={-50}
        shadow-bias={-0.00025}
      />

      <Roads roads={scene.roads} />
      <RouteOverlay route={scene.route} />
      <MetroBuildings instances={scene.buildings} focus={focus} radius={far ? 520 : 240} />
      <MetroTrees instances={scene.trees} focus={focus} radius={far ? 360 : 160} />
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
