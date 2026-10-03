export type ShadowRole = "AUTHORITATIVE" | "WARM_SHADOW" | "IDLE";

export interface AuthorityToken {
  session_id: string;
  epoch: number;
  holder_edge_id: string;
  signature: string;
}

export interface PredictionResult {
  session_id: string;
  model_version: string;
  probabilities: Record<string, number>;
  eta_sec?: number;
  computed_at_ms: number;
}

export interface ShadowState {
  edge_id: string;
  role: ShadowRole;
  sync_ratio: number;
  output_suppressed: boolean;
}

export interface TimelineEvent {
  run_id: string;
  timestamp_ms: number;
  event_type: string;
  edge_id?: string;
  message: string;
  payload?: Record<string, string>;
}

export interface TopologyNode {
  edge_id: string;
  latitude: number;
  longitude: number;
  role: ShadowRole;
  sync_ratio?: number;
}

export interface SystemSnapshot {
  run_id: string;
  session_id: string;
  current_edge_id: string;
  authority: AuthorityToken;
  prediction: PredictionResult | null;
  shadows: ShadowState[];
  topology: TopologyNode[];
  timeline: TimelineEvent[];
  mode: string;
  vehicle_latitude?: number;
  vehicle_longitude?: number;
  vehicle_heading?: number;
  vehicle_speed_mps?: number;
  vehicle_updated_ms?: number;
  vehicle_trail?: { latitude: number; longitude: number }[];
  traffic_vehicles?: {
    vehicle_id: string;
    latitude: number;
    longitude: number;
    heading_deg: number;
    speed_mps: number;
  }[];
  predictor_degraded?: boolean;
}
