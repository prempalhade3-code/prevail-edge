/**
 * Observation cameras. Chase is a 3/4 follow so the car visibly travels
 * through the corridor instead of sitting glued to the centre of the frame.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { PerspectiveCamera, Vector3 } from "three";
import type { EdgeRegionGeo } from "../../lib/cityScene";
import type { Pose, PrevailView } from "../../lib/liveStore";

export const CAMERA_MODES = ["chase", "cockpit", "orbit", "tactical", "edge"] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

export const CAMERA_LABEL: Record<CameraMode, string> = {
  chase: "Drive",
  cockpit: "Cabin",
  orbit: "Free",
  tactical: "City",
  edge: "Edge",
};

type CameraRigProps = {
  mode: CameraMode;
  pose: React.MutableRefObject<Pose>;
  view: React.MutableRefObject<PrevailView>;
  regions: EdgeRegionGeo[];
};

export function CameraRig({ mode, pose, view, regions }: CameraRigProps) {
  const { camera } = useThree();
  const eye = useRef(new Vector3(0, 40, 60));
  const target = useRef(new Vector3());
  const initialised = useRef(false);
  const lastFov = useRef(52);

  const sites = useMemo(() => {
    const map = new Map<string, Vector3>();
    for (const r of regions) map.set(r.edge_id, new Vector3(r.x, 12, r.z));
    return map;
  }, [regions]);

  const scratch = useMemo(
    () => ({
      desiredEye: new Vector3(),
      desiredTarget: new Vector3(),
      car: new Vector3(),
      forward: new Vector3(),
      right: new Vector3(),
    }),
    [],
  );

  const orbiting = mode === "orbit";

  useEffect(() => {
    initialised.current = false;
  }, [mode]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.08);
    const p = pose.current;
    scratch.car.set(p.x, 0, p.z);
    scratch.forward.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    scratch.right.set(scratch.forward.z, 0, -scratch.forward.x);

    if (orbiting) {
      target.current.copy(scratch.car).setY(1.2);
      return;
    }

    const { desiredEye, desiredTarget } = scratch;

    switch (mode) {
      case "cockpit": {
        desiredEye
          .copy(scratch.car)
          .addScaledVector(scratch.forward, 0.55)
          .addScaledVector(scratch.right, -0.32)
          .setY(1.18);
        desiredTarget.copy(scratch.car).addScaledVector(scratch.forward, 36).setY(1.05);
        break;
      }
      case "tactical": {
        desiredEye.copy(scratch.car).addScaledVector(scratch.forward, -70).setY(130);
        desiredTarget.copy(scratch.car).addScaledVector(scratch.forward, 50).setY(0);
        break;
      }
      case "edge": {
        const v = view.current;
        const focusId = v.predictedEdge ?? v.authorityHolder ?? regions[0]?.edge_id;
        const site = focusId ? sites.get(focusId) : undefined;
        if (site) {
          const away = new Vector3().subVectors(site, scratch.car);
          const distance = away.length();
          away.normalize();
          const side = new Vector3(away.z, 0, -away.x);
          const look = Math.min(distance * 0.45, 140);
          desiredTarget.copy(scratch.car).addScaledVector(away, look).setY(10);
          desiredEye.copy(scratch.car).addScaledVector(away, -42).addScaledVector(side, 54).setY(36);
        } else {
          desiredEye.copy(scratch.car).addScaledVector(scratch.forward, -28).setY(16);
          desiredTarget.copy(scratch.car).setY(2);
        }
        break;
      }
      case "chase":
      default: {
        const pull = Math.min(p.speed * 0.12, 2.4);
        desiredEye
          .copy(scratch.car)
          .addScaledVector(scratch.forward, -(5.1 + pull))
          .addScaledVector(scratch.right, 3.6)
          .setY(1.95);
        desiredTarget
          .copy(scratch.car)
          .addScaledVector(scratch.forward, 7.5)
          .addScaledVector(scratch.right, 0.15)
          .setY(0.95);
        break;
      }
    }

    const jumped = !initialised.current || eye.current.distanceTo(desiredEye) > 160;
    if (jumped) {
      initialised.current = true;
      eye.current.copy(desiredEye);
      target.current.copy(desiredTarget);
    } else {
      // Loose enough that the car leads the frame and travel is obvious.
      const ease = mode === "cockpit" ? 1 : mode === "tactical" ? 2.4 : 2.15;
      const k = 1 - Math.exp(-ease * delta);
      eye.current.lerp(desiredEye, k);
      target.current.lerp(desiredTarget, k);
    }

    camera.position.copy(eye.current);
    camera.lookAt(target.current);

    if (camera instanceof PerspectiveCamera) {
      const wantFov = mode === "cockpit" ? 68 : mode === "tactical" ? 46 : 52 + Math.min(p.speed * 0.22, 8);
      if (Math.abs(wantFov - lastFov.current) > 0.15) {
        lastFov.current = wantFov;
        camera.fov = wantFov;
        camera.updateProjectionMatrix();
      }
    }
  });

  return orbiting ? (
    <OrbitControls
      makeDefault
      enablePan={false}
      minDistance={6}
      maxDistance={1800}
      maxPolarAngle={Math.PI * 0.49}
      target={target.current}
    />
  ) : null;
}
