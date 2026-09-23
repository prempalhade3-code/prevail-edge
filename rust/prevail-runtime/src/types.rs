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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PredictionResult {
    pub session_id: String,
    pub model_version: String,
    pub probabilities: HashMap<String, f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eta_sec: Option<f64>,
    pub computed_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EdgeCapability {
    pub edge_id: String,
    pub supports_stream: bool,
    pub supports_image: bool,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeculationConfig {
    pub max_shadows: usize,
    pub min_confidence: f64,
    pub promotion_sync_threshold: f64,
    pub promotion_margin_sec: f64,
    pub estimated_sync_sec: f64,
    pub require_image_capability: bool,
}

impl Default for SpeculationConfig {
    fn default() -> Self {
        Self {
            max_shadows: 1,
            min_confidence: 0.60,
            promotion_sync_threshold: 0.95,
            promotion_margin_sec: 2.0,
            estimated_sync_sec: 5.0,
            require_image_capability: false,
        }
    }
}
