export type ShadowRole = "AUTHORITATIVE" | "WARM_SHADOW" | "IDLE";

export type NavId =
  | "live"
  | "edges"
  | "prediction"
  | "shadows"
  | "analytics"
  | "timeline"
  | "health"
  | "resilience";

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
  for_edge?: string;
  route_terminal?: boolean;
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
  payload?: Record<string, string> | string;
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
  tee_bytes?: number;
  cpu_available_ratio?: number;
  memory_available_ratio?: number;
  rss_bytes?: number;
  flink_job_id?: string;
  edge_snapshots?: Record<string, { reachable?: boolean }>;
}

export interface DriveStatus {
  accepted?: boolean;
  running: boolean;
  paused: boolean;
  stopped: boolean;
  scenario?: string | null;
  path?: string[];
  posted?: number;
  total?: number;
  error?: string | null;
  control?: string;
  source?: string;
  destination?: string;
  city_path?: string[];
  wait_for_warm?: boolean;
  warm_ready?: boolean;
  warm_state?: "waiting" | "ready" | "timeout" | "failed" | null;
  warm_shadow_target?: string | null;
}

export interface HealthStatus {
  status: string;
  service: string;
  runtime_reachable: boolean;
  postgres_enabled: boolean;
  database: string;
  drive?: DriveStatus;
}

export interface LiveAccuracy {
  run_id: string;
  handoffs_scored: number;
  live_top1_accuracy: number | null;
  live_top2_accuracy: number | null;
  source: string;
}

export interface LiveMetrics {
  transition_count: number;
  shadow_count: number;
  mode: string;
  edges_reachable: number;
  edges_total: number;
  authority_holders_reported: string[];
  single_authority_invariant: boolean;
}

export interface HistoryMetric {
  run_id?: string;
  metric_name: string;
  value: number;
  edge_id?: string;
  timestamp_ms?: number;
  metadata?: Record<string, string>;
}

export const EDGE_IDS = ["edge-a", "edge-b", "edge-c", "edge-d"] as const;
export type EdgeId = (typeof EDGE_IDS)[number];
