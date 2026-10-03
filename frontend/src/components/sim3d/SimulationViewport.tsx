import { memo, Suspense, type MutableRefObject } from "react";
import { Canvas } from "@react-three/fiber";
import { ACESFilmicToneMapping } from "three";
import type { SystemSnapshot } from "../../types";
import { CityWorld } from "./CityWorld";
import type { CameraMode } from "./CameraRig";

export const SimulationViewport = memo(function SimulationViewport({
  snapshotRef,
  cameraMode,
}: {
  snapshotRef: MutableRefObject<SystemSnapshot | null>;
  cameraMode: CameraMode;
}) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#7f93a4]">
      <Canvas
        shadows
        dpr={1}
        gl={{
          antialias: true,
          powerPreference: "high-performance",
          stencil: false,
          alpha: false,
        }}
        onCreated={({ gl }) => {
          gl.toneMapping = ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.18;
        }}
        camera={{ fov: 52, near: 0.2, far: 1600, position: [0, 6, 14] }}
      >
        <Suspense fallback={null}>
          <CityWorld snapshotRef={snapshotRef} cameraMode={cameraMode} />
        </Suspense>
      </Canvas>
    </div>
  );
});
