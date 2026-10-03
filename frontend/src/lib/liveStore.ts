/**
 * Motion smoothing between PREVAIL snapshots.
 *
 * Snapshots arrive a few times a second and can repeat or arrive stale from a
 * non-authoritative edge. The drawn pose coasts on the last measured velocity
 * and treats GPS as a correction, never as a teleport. Dead-reckoning along
 * compass heading used to run ahead of GPS and then snap back every tick.
 */
import { headingToYaw, latLonToXZ, lerpAngle } from "./geo";
import type { SystemSnapshot } from "../types";

export type Pose = { x: number; z: number; yaw: number; speed: number };

/** Seconds to catch ~63% of the way to the coasting GPS target. */
const FOLLOW_TAU = 0.11;
/** Coast at most this long if GPS stalls, so the car does not run away. */
const MAX_COAST_S = 0.7;
/** Ignore a GPS that is behind the car — that is a late snapshot. */
const STALE_BEHIND_M = 0.4;
/** Treat a GPS closer than this as the same sample. */
const SAME_SAMPLE_M = 0.08;

function damp(current: number, target: number, delta: number): number {
  const k = 1 - Math.exp(-delta / FOLLOW_TAU);
  return current + (target - current) * k;
}

export class PoseTracker {
  private goalX = 0;
  private goalZ = 0;
  private goalYaw = 0;
  private vx = 0;
  private vz = 0;
  private speed = 0;
  private drawnX = 0;
  private drawnZ = 0;
  private drawnYaw = 0;
  private lastSample = 0;
  private lastGoalAt = 0;
  initialised = false;

  private applyVelocity(speed: number, yaw: number): void {
    this.vx = Math.sin(yaw) * speed;
    this.vz = Math.cos(yaw) * speed;
  }

  private along(dx: number, dz: number): number {
    const travel = Math.hypot(this.vx, this.vz);
    if (travel < 0.2) {
      return dx * Math.sin(this.goalYaw) + dz * Math.cos(this.goalYaw);
    }
    return (dx * this.vx + dz * this.vz) / travel;
  }

  setTarget(lat: number, lon: number, headingDeg: number, speed: number): void {
    const [x, z] = latLonToXZ(lat, lon);
    const now = performance.now();
    const compassYaw = headingToYaw(headingDeg);

    if (!this.initialised) {
      this.drawnX = x;
      this.drawnZ = z;
      this.goalX = x;
      this.goalZ = z;
      this.drawnYaw = compassYaw;
      this.goalYaw = compassYaw;
      this.speed = speed;
      this.applyVelocity(speed, compassYaw);
      this.lastGoalAt = now;
      this.initialised = true;
      return;
    }

    const dx = x - this.goalX;
    const dz = z - this.goalZ;
    const moved = Math.hypot(dx, dz);

    // Same GPS again (aggregator / WS repeats). Keep coasting; do not reset age.
    if (moved < SAME_SAMPLE_M) {
      this.speed = speed;
      this.applyVelocity(speed, this.goalYaw);
      return;
    }

    if (this.speed > 0.4 && this.along(x - this.drawnX, z - this.drawnZ) < -STALE_BEHIND_M) {
      return;
    }

    const dt = Math.max((now - this.lastGoalAt) / 1000, 1e-3);
    const gpsYaw = Math.atan2(dx, dz);
    const yaw = moved / dt > 0.4 ? gpsYaw : compassYaw;

    this.goalX = x;
    this.goalZ = z;
    this.goalYaw = yaw;
    this.speed = speed;
    this.applyVelocity(speed > 0.3 ? speed : moved / dt, yaw);
    this.lastGoalAt = now;
  }

  sample(out: Pose, now = performance.now()): void {
    const delta = this.lastSample === 0 ? 0 : Math.min((now - this.lastSample) / 1000, 0.05);
    this.lastSample = now;

    const age = this.lastGoalAt === 0 ? 0 : Math.min((now - this.lastGoalAt) / 1000, MAX_COAST_S);
    const predX = this.goalX + this.vx * age;
    const predZ = this.goalZ + this.vz * age;

    this.drawnX = damp(this.drawnX, predX, delta);
    this.drawnZ = damp(this.drawnZ, predZ, delta);
    this.drawnYaw = lerpAngle(this.drawnYaw, this.goalYaw, Math.min(1, delta / FOLLOW_TAU));

    out.x = this.drawnX;
    out.z = this.drawnZ;
    out.yaw = this.drawnYaw;
    out.speed = this.speed;
  }
}

export type TrafficEntry = { id: string; pose: Pose; tracker: PoseTracker };

export class TrafficTracker {
  private entries = new Map<string, TrafficEntry>();

  sync(vehicles: NonNullable<SystemSnapshot["traffic_vehicles"]>): void {
    const seen = new Set<string>();
    for (const v of vehicles) {
      seen.add(v.vehicle_id);
      let entry = this.entries.get(v.vehicle_id);
      if (!entry) {
        entry = {
          id: v.vehicle_id,
          pose: { x: 0, z: 0, yaw: 0, speed: 0 },
          tracker: new PoseTracker(),
        };
        this.entries.set(v.vehicle_id, entry);
      }
      entry.tracker.setTarget(v.latitude, v.longitude, v.heading_deg, v.speed_mps);
    }
    for (const id of [...this.entries.keys()]) {
      if (!seen.has(id)) this.entries.delete(id);
    }
  }

  advance(now = performance.now()): void {
    for (const entry of this.entries.values()) {
      entry.tracker.sample(entry.pose, now);
    }
  }

  poses(): IterableIterator<TrafficEntry> {
    return this.entries.values();
  }

  get size(): number {
    return this.entries.size;
  }
}

export type PrevailView = {
  currentEdge: string | null;
  authorityHolder: string | null;
  epoch: number;
  predictedEdge: string | null;
  predictionConfidence: number;
  shadows: { edge_id: string; sync_ratio: number; role: string }[];
  vehicleSpeed: number;
  version: number;
};

export function createPrevailView(): PrevailView {
  return {
    currentEdge: null,
    authorityHolder: null,
    epoch: 0,
    predictedEdge: null,
    predictionConfidence: 0,
    shadows: [],
    vehicleSpeed: 0,
    version: 0,
  };
}

export function topPrediction(
  probabilities: Record<string, number> | undefined,
  exclude?: string | null,
): { edge: string | null; confidence: number } {
  if (!probabilities) return { edge: null, confidence: 0 };
  let edge: string | null = null;
  let confidence = 0;
  for (const [candidate, p] of Object.entries(probabilities)) {
    if (candidate === exclude) continue;
    if (p > confidence) {
      confidence = p;
      edge = candidate;
    }
  }
  return { edge, confidence };
}

export function updatePrevailView(view: PrevailView, snap: SystemSnapshot): void {
  const { edge, confidence } = topPrediction(snap.prediction?.probabilities, snap.current_edge_id);
  view.currentEdge = snap.current_edge_id ?? null;
  view.authorityHolder = snap.authority?.holder_edge_id ?? null;
  view.epoch = snap.authority?.epoch ?? 0;
  view.predictedEdge = edge;
  view.predictionConfidence = confidence;
  view.shadows = (snap.shadows ?? []).map((s) => ({
    edge_id: s.edge_id,
    sync_ratio: s.sync_ratio ?? 0,
    role: s.role ?? "WARM_SHADOW",
  }));
  view.vehicleSpeed = snap.vehicle_speed_mps ?? 0;
  view.version += 1;
}
