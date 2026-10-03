import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { ACESFilmicToneMapping } from "three";
import type { SystemSnapshot } from "../../types";
import { CityWorld } from "./CityWorld";
import type { CameraMode } from "./CameraRig";

export function SimulationViewport({
  snapshot,
  cameraMode,
}: {
  snapshot: SystemSnapshot | null;
  cameraMode: CameraMode;
}) {
  return (
    <div className="relative w-full h-full overflow-hidden bg-[#1a222b]">
      <Canvas
        shadows
        dpr={[1, 1.2]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.toneMapping = ACESFilmicToneMapping;
          gl.toneMappingExposure = 0.92;
        }}
        camera={{ fov: 42, near: 0.12, far: 3800, position: [0, 8, 18] }}
      >
        <Suspense fallback={null}>
          <CityWorld snapshot={snapshot} cameraMode={cameraMode} />
        </Suspense>
      </Canvas>
    </div>
  );
}
