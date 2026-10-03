/**
 * Viewpoints onto the simulation.
 *
 * These are observation cameras, not driving controls: the vehicle is driven by the
 * simulator and the camera only chooses how to watch it. Each mode has a desired eye
 * and target which the camera eases toward, so switching views glides rather than cuts.
 *
 *   chase     just behind and above the car, aimed down the road ahead
 *   cockpit   from the driver's seat
 *   orbit     free look around the car, mouse driven
 *   tactical  high enough to take in the coverage rings and the route
 *   edge      frames the car together with the edge site that matters right now
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Vector3 } from "three";
import type { EdgeRegionGeo } from "../../lib/cityScene";
import type { Pose, PrevailView } from "../../lib/liveStore";

export const CAMERA_MODES = ["chase", "cockpit", "orbit", "tactical", "edge"] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

export const CAMERA_LABEL: Record<CameraMode, string> = {
  chase: "Chase",
  cockpit: "Cockpit",
  orbit: "Orbit",
  tactical: "Tactical",
  edge: "Edge focus",
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

  // Orbit mode drives the camera itself, so the rig must not fight it.
  const orbiting = mode === "orbit";

  useEffect(() => {
    initialised.current = false;
  }, [mode]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1);
    const p = pose.current;
    scratch.car.set(p.x, 0, p.z);
    scratch.forward.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    scratch.right.set(scratch.forward.z, 0, -scratch.forward.x);

    if (orbiting) {
      // Keep the orbit pivot on the car; OrbitControls owns the eye position.
      target.current.copy(scratch.car).setY(1.2);
      return;
    }

    const { desiredEye, desiredTarget } = scratch;

    switch (mode) {
      case "cockpit": {
        desiredEye
          .copy(scratch.car)
          .addScaledVector(scratch.forward, 0.72)
          .addScaledVector(scratch.right, -0.28)
          .setY(1.32);
        desiredTarget.copy(scratch.car).addScaledVector(scratch.forward, 28).setY(1.2);
        break;
      }
      case "tactical": {
        // Neighbourhood altitude: roads, blocks and the nearest coverage ring stay readable.
        desiredEye.copy(scratch.car).addScaledVector(scratch.forward, -90).setY(168);
        desiredTarget.copy(scratch.car).addScaledVector(scratch.forward, 70).setY(0);
        break;
      }
      case "edge": {
        const v = view.current;
        const focusId = v.predictedEdge ?? v.authorityHolder ?? regions[0]?.edge_id;
        const site = focusId ? sites.get(focusId) : undefined;
        if (site) {
          // Stay near the vehicle and look toward the active site so the link,
          // coverage, and roadside hardware stay readable. Sites can be kilometres
          // away; framing the midpoint would put the camera in the stratosphere.
          const away = new Vector3().subVectors(site, scratch.car);
          const distance = away.length();
          away.normalize();
          const side = new Vector3(away.z, 0, -away.x);
          const look = Math.min(distance * 0.45, 160);
          desiredTarget.copy(scratch.car).addScaledVector(away, look).setY(10);
          desiredEye
            .copy(scratch.car)
            .addScaledVector(away, -48)
            .addScaledVector(side, 62)
            .setY(42);
        } else {
          desiredEye.copy(scratch.car).addScaledVector(scratch.forward, -30).setY(18);
          desiredTarget.copy(scratch.car).setY(2);
        }
        break;
      }
      case "chase":
      default: {
        const speedPull = Math.min(p.speed * 0.18, 3.2);
        desiredEye
          .copy(scratch.car)
          .addScaledVector(scratch.forward, -(7.8 + speedPull))
          .addScaledVector(scratch.right, 0.35)
          .setY(3.1 + speedPull * 0.1);
        desiredTarget.copy(scratch.car).addScaledVector(scratch.forward, 14).setY(1.15);
        break;
      }
    }

    const jumped = !initialised.current || eye.current.distanceTo(desiredEye) > 180;
    if (jumped) {
      initialised.current = true;
      eye.current.copy(desiredEye);
      target.current.copy(desiredTarget);
    } else {
      // Cockpit is rigidly attached; the others ease so the ride stays smooth.
      const ease = mode === "cockpit" ? 1 : mode === "tactical" ? 2.0 : 4.5;
      const k = Math.min(1, ease * delta);
      eye.current.lerp(desiredEye, k);
      target.current.lerp(desiredTarget, k);
    }

    camera.position.copy(eye.current);
    camera.lookAt(target.current);
  });

  return orbiting ? (
    <OrbitControls
      makeDefault
      enablePan={false}
      minDistance={6}
      maxDistance={2500}
      maxPolarAngle={Math.PI * 0.49}
      target={target.current}
    />
  ) : null;
}
