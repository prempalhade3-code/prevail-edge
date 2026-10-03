/**
 * Motion smoothing between PREVAIL snapshots.
 *
 * Snapshots arrive about ten times a second while the scene renders at display
 * rate, so poses are dead-reckoned forward from the newest snapshot and the drawn
 * pose chases that prediction with a critically damped follow. This keeps motion
 * continuous without ever inventing movement: the prediction is only the reported
 * position advanced along the reported heading at the reported speed, and every
 * new snapshot corrects it.
 *
 * The hot path allocates nothing, so there is no per-frame garbage.
 */
import { headingToYaw, latLonToXZ, lerpAngle } from "./geo";
import type { SystemSnapshot } from "../types";

export type Pose = { x: number; z: number; yaw: number; speed: number };

/** How quickly the drawn pose converges on the predicted pose, per second. */
const FOLLOW_RATE = 9;
/** Dead reckoning is capped so a stalled feed cannot drift the vehicle away. */
const MAX_EXTRAPOLATION_S = 0.6;

function follow(current: number, target: number, delta: number): number {
  return current + (target - current) * Math.min(1, FOLLOW_RATE * delta);
}

export class PoseTracker {
  private targetX = 0;
  private targetZ = 0;
  private targetYaw = 0;
  private speed = 0;
  private sinceSnapshot = 0;
  private drawnX = 0;
  private drawnZ = 0;
  private drawnYaw = 0;
  private lastSample = 0;
  initialised = false;

  setTarget(lat: number, lon: number, headingDeg: number, speed: number): void {
    const [x, z] = latLonToXZ(lat, lon);
    this.targetX = x;
    this.targetZ = z;
    this.targetYaw = headingToYaw(headingDeg);
    this.speed = speed;
    this.sinceSnapshot = 0;
    if (!this.initialised) {
      this.drawnX = x;
      this.drawnZ = z;
      this.drawnYaw = this.targetYaw;
      this.initialised = true;
    }
  }

  /**
   * Advance by wall-clock time since the previous call and write the drawn pose.
   *
   * Timing is taken from the clock rather than a passed-in delta so that several
   * consumers in one frame cannot double-advance or depend on callback ordering:
   * the elapsed time is simply split between them and the total stays correct.
   */
  sample(out: Pose, now = performance.now()): void {
    const delta = this.lastSample === 0 ? 0 : Math.min((now - this.lastSample) / 1000, 0.25);
    this.lastSample = now;
    this.sinceSnapshot = Math.min(this.sinceSnapshot + delta, MAX_EXTRAPOLATION_S);

    // Advance the last known pose along its own heading. A yaw of PI - bearing
    // means the forward vector is (sin yaw, cos yaw).
    const reach = this.speed * this.sinceSnapshot;
    const predictedX = this.targetX + Math.sin(this.targetYaw) * reach;
    const predictedZ = this.targetZ + Math.cos(this.targetYaw) * reach;

    this.drawnX = follow(this.drawnX, predictedX, delta);
    this.drawnZ = follow(this.drawnZ, predictedZ, delta);
    this.drawnYaw = lerpAngle(this.drawnYaw, this.targetYaw, Math.min(1, FOLLOW_RATE * delta));

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

  /** Advance every tracked vehicle once per frame. */
  advance(now = performance.now()): void {
    for (const entry of this.entries.values()) {
      entry.tracker.sample(entry.pose, now);
    }
  }

  /** Read poses without advancing (call after `advance`). */
  poses(): IterableIterator<TrafficEntry> {
    return this.entries.values();
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * PREVAIL control-plane state, mirrored from the snapshot into a mutable object so
 * the 3D scene can read it inside the render loop without re-rendering React.
 */
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

/** The runtime reports a distribution over next edges; the top entry is the call. */
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
