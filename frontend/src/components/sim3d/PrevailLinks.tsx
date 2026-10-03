/**
 * The PREVAIL control plane, drawn as links between the vehicle and the edge sites.
 *
 *   vehicle -> current authority    solid green, packets flowing to the edge
 *   vehicle -> predicted next edge  blue, appears only while a prediction is live
 *   authority -> warm shadow        amber, length tracks the real sync ratio
 *
 * A ring expands at a site when it takes authority, which is driven by the epoch
 * changing in the snapshot rather than by a timer. Every link is present only when
 * the runtime reports the corresponding relationship.
 */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  type Mesh,
  type MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import type { EdgeRegionGeo } from "../../lib/cityScene";
import type { Pose, PrevailView } from "../../lib/liveStore";
import { ROLE_COLOR } from "./EdgeInfrastructure";

const MAST_TIP = 20;
const CAR_ROOF = 1.2;
const FLOW_DOTS = 4;
const UP = new Vector3(0, 1, 0);

type BeamHandles = {
  tube: Mesh | null;
  material: MeshStandardMaterial | null;
  dots: (Mesh | null)[];
};

/** A thick line between two points, with packets travelling along it. */
function useBeam() {
  return useRef<BeamHandles>({ tube: null, material: null, dots: [] });
}

function Beam({
  handles,
  colour,
  radius,
}: {
  handles: React.MutableRefObject<BeamHandles>;
  colour: string;
  radius: number;
}) {
  return (
    <group>
      <mesh
        ref={(node) => {
          handles.current.tube = node;
        }}
        visible={false}
      >
        <cylinderGeometry args={[radius, radius, 1, 8, 1, true]} />
        <meshStandardMaterial
          ref={(node) => {
            handles.current.material = node as MeshStandardMaterial;
          }}
          color={colour}
          emissive={colour}
          emissiveIntensity={1.8}
          transparent
          opacity={0.5}
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      {Array.from({ length: FLOW_DOTS }, (_, i) => (
        <mesh
          key={i}
          ref={(node) => {
            handles.current.dots[i] = node;
          }}
          visible={false}
        >
          <sphereGeometry args={[radius * 2.4, 10, 8]} />
          <meshStandardMaterial
            color={colour}
            emissive={colour}
            emissiveIntensity={3}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Point a beam from `a` to `b`, optionally covering only a fraction of the span.
 * `phase` advances the travelling packets.
 */
function aimBeam(
  handles: BeamHandles,
  a: Vector3,
  b: Vector3,
  fraction: number,
  phase: number,
  scratch: { dir: Vector3; mid: Vector3; quat: Quaternion; end: Vector3 },
) {
  const tube = handles.tube;
  if (!tube) return;

  scratch.dir.subVectors(b, a);
  const full = scratch.dir.length();
  if (full < 1e-3 || fraction <= 0.001) {
    tube.visible = false;
    handles.dots.forEach((d) => d && (d.visible = false));
    return;
  }

  const span = full * fraction;
  scratch.end.copy(a).addScaledVector(scratch.dir, fraction / 1);
  scratch.mid.copy(a).addScaledVector(scratch.dir, fraction / 2);
  scratch.dir.normalize();

  tube.visible = true;
  tube.position.copy(scratch.mid);
  tube.scale.set(1, span, 1);
  scratch.quat.setFromUnitVectors(UP, scratch.dir);
  tube.quaternion.copy(scratch.quat);

  handles.dots.forEach((dot, i) => {
    if (!dot) return;
    dot.visible = true;
    const t = ((phase + i / FLOW_DOTS) % 1) * span;
    dot.position.copy(a).addScaledVector(scratch.dir, t);
  });
}

export type PrevailLinksProps = {
  regions: EdgeRegionGeo[];
  pose: React.MutableRefObject<Pose>;
  view: React.MutableRefObject<PrevailView>;
};

export function PrevailLinks({ regions, pose, view }: PrevailLinksProps) {
  const authority = useBeam();
  const prediction = useBeam();
  const sync = useBeam();

  const flash = useRef<Mesh>(null);
  const flashMat = useRef<MeshStandardMaterial>(null);
  const flashAge = useRef(Infinity);
  const lastEpoch = useRef(-1);

  const sites = useMemo(() => {
    const map = new Map<string, Vector3>();
    for (const r of regions) map.set(r.edge_id, new Vector3(r.x + 2.8, MAST_TIP, r.z));
    return map;
  }, [regions]);

  const scratch = useMemo(
    () => ({
      car: new Vector3(),
      dir: new Vector3(),
      mid: new Vector3(),
      end: new Vector3(),
      quat: new Quaternion(),
    }),
    [],
  );

  useFrame(({ clock }, delta) => {
    const v = view.current;
    const p = pose.current;
    scratch.car.set(p.x, CAR_ROOF, p.z);
    const t = clock.elapsedTime;

    const holder = v.authorityHolder ? sites.get(v.authorityHolder) : undefined;
    if (holder) {
      aimBeam(authority.current, scratch.car, holder, 1, (t * 0.5) % 1, scratch);
    } else if (authority.current.tube) {
      authority.current.tube.visible = false;
      authority.current.dots.forEach((d) => d && (d.visible = false));
    }

    // Prediction link only while a next edge is actually predicted and is not the
    // edge already holding authority.
    const predicted =
      v.predictedEdge && v.predictedEdge !== v.authorityHolder
        ? sites.get(v.predictedEdge)
        : undefined;
    if (predicted) {
      aimBeam(prediction.current, scratch.car, predicted, 1, (t * 0.28) % 1, scratch);
      if (prediction.current.material) {
        prediction.current.material.opacity = 0.2 + v.predictionConfidence * 0.5;
      }
    } else if (prediction.current.tube) {
      prediction.current.tube.visible = false;
      prediction.current.dots.forEach((d) => d && (d.visible = false));
    }

    // Replication link: how much of the span is drawn is the real sync ratio, so the
    // beam visibly grows as state is copied into the shadow.
    const shadow = v.shadows[0];
    const shadowSite = shadow ? sites.get(shadow.edge_id) : undefined;
    if (holder && shadowSite && shadow) {
      aimBeam(sync.current, holder, shadowSite, Math.max(shadow.sync_ratio, 0.02), (t * 0.9) % 1, scratch);
    } else if (sync.current.tube) {
      sync.current.tube.visible = false;
      sync.current.dots.forEach((d) => d && (d.visible = false));
    }

    // Authority transfer: a ring expands once, triggered by the epoch advancing.
    if (v.epoch !== lastEpoch.current) {
      if (lastEpoch.current >= 0) flashAge.current = 0;
      lastEpoch.current = v.epoch;
    }
    if (flash.current && flashMat.current) {
      if (flashAge.current < 1.6) {
        flashAge.current += delta;
        const site = holder;
        if (site) {
          const k = flashAge.current / 1.6;
          flash.current.visible = true;
          flash.current.position.set(site.x, 1.5, site.z);
          flash.current.scale.setScalar(12 + k * 260);
          flashMat.current.opacity = (1 - k) * 0.75;
        }
      } else {
        flash.current.visible = false;
      }
    }
  });

  return (
    <group>
      <Beam handles={authority} colour={ROLE_COLOR.authoritative} radius={0.5} />
      <Beam handles={prediction} colour={ROLE_COLOR.predicted} radius={0.38} />
      <Beam handles={sync} colour={ROLE_COLOR.shadow} radius={0.45} />

      <mesh ref={flash} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.86, 1, 64]} />
        <meshStandardMaterial
          ref={flashMat}
          color={ROLE_COLOR.authoritative}
          emissive={ROLE_COLOR.authoritative}
          emissiveIntensity={3}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
