use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrajectorySample {
    pub session_id: String,
    pub timestamp_ms: i64,
    pub latitude: f64,
    pub longitude: f64,
    pub speed_mps: f64,
    pub edge_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heading_deg: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sensor_tuple: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_event_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workload_class: Option<String>,
    /// Base64-encoded JPEG (or other) image payload for image-class work.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_jpeg_b64: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PredictionResult {
    pub session_id: String,
    pub model_version: String,
    pub probabilities: HashMap<String, f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eta_sec: Option<f64>,
    pub computed_at_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub for_edge: Option<String>,
    #[serde(default)]
    pub route_terminal: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EdgeCapability {
    pub edge_id: String,
    pub supports_stream: bool,
    pub supports_image: bool,
    #[serde(default)]
    pub supports_video: bool,
    pub supports_gpu: bool,
    pub cpu_available_ratio: f64,
    pub memory_available_ratio: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ShadowRole {
    Authoritative,
    WarmShadow,
    Idle,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ShadowState {
    pub edge_id: String,
    pub role: ShadowRole,
    pub sync_ratio: f64,
    pub output_suppressed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthorityToken {
    pub session_id: String,
    pub epoch: u64,
    pub holder_edge_id: String,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TimelineEvent {
    pub run_id: String,
    pub timestamp_ms: i64,
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edge_id: Option<String>,
    pub message: String,
    #[serde(default)]
    pub payload: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerPing {
    pub edge_id: String,
    pub sent_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerPong {
    pub edge_id: String,
    pub received_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopologyNode {
    pub edge_id: String,
    pub latitude: f64,
    pub longitude: f64,
    pub role: ShadowRole,
    pub sync_ratio: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemSnapshot {
    pub run_id: String,
    pub session_id: String,
    pub current_edge_id: String,
    pub authority: AuthorityToken,
    pub prediction: Option<PredictionResult>,
    pub shadows: Vec<ShadowState>,
    pub topology: Vec<TopologyNode>,
    pub timeline: Vec<TimelineEvent>,
    pub mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vehicle_latitude: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vehicle_longitude: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vehicle_heading: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vehicle_speed_mps: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vehicle_updated_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub vehicle_trail: Vec<VehicleTrailPoint>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub traffic_vehicles: Vec<TrafficVehicle>,
    #[serde(default)]
    pub predictor_degraded: bool,
    #[serde(default)]
    pub tee_bytes: u64,
    #[serde(default)]
    pub cpu_available_ratio: f64,
    #[serde(default)]
    pub memory_available_ratio: f64,
    #[serde(default)]
    pub rss_bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flink_job_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VehicleTrailPoint {
    pub latitude: f64,
    pub longitude: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrafficVehicle {
    pub vehicle_id: String,
    pub latitude: f64,
    pub longitude: f64,
    pub heading_deg: f64,
    pub speed_mps: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeculationConfig {
    pub max_shadows: usize,
    pub min_confidence: f64,
    pub promotion_sync_threshold: f64,
    pub promotion_margin_sec: f64,
    pub estimated_sync_sec: f64,
    pub require_image_capability: bool,
    pub capability_check_enabled: bool,
    pub speculation_enabled: bool,
    pub mode: String,
}

impl Default for SpeculationConfig {
    fn default() -> Self {
        let max_shadows = std::env::var("PREVAIL_SPECULATION_MAX_SHADOWS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1);
        let min_confidence = std::env::var("PREVAIL_SPECULATION_MIN_CONFIDENCE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(0.60);
        let require_image = env_flag("PREVAIL_REQUIRE_IMAGE_CAPABILITY", false);
        let capability_check = env_flag("PREVAIL_CAPABILITY_CHECK_ENABLED", true);
        let speculation_enabled = env_flag("PREVAIL_SPECULATION_ENABLED", true);
        let mode = std::env::var("PREVAIL_MODE").unwrap_or_else(|_| "prevail".into());
        Self {
            max_shadows,
            min_confidence,
            promotion_sync_threshold: std::env::var("PREVAIL_PROMOTION_SYNC_THRESHOLD")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0.95),
            promotion_margin_sec: std::env::var("PREVAIL_PROMOTION_MARGIN_SEC")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(2.0),
            estimated_sync_sec: std::env::var("PREVAIL_ESTIMATED_SYNC_SEC")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(5.0),
            require_image_capability: require_image,
            capability_check_enabled: capability_check,
            speculation_enabled,
            mode,
        }
    }
}

fn env_flag(name: &str, default: bool) -> bool {
    match std::env::var(name) {
        Ok(v) => v == "1" || v.eq_ignore_ascii_case("true"),
        Err(_) => default,
    }
}
