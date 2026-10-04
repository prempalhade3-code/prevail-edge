use crate::types::{PredictionResult, TrajectorySample};
use reqwest::Client;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PredictOutcome {
    Live,
    Degraded,
}

/// Client for the ML predictor service. Surfaces outages explicitly instead of
/// silently substituting mock probabilities.
pub struct PredictorClient {
    http: Client,
    base_url: String,
}

impl PredictorClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            http: Client::new(),
            base_url: base_url.into(),
        }
    }

    pub async fn post_trajectory(&self, sample: &TrajectorySample) {
        let url = format!("{}/trajectory", self.base_url.trim_end_matches('/'));
        let body = serde_json::json!({
            "session_id": sample.session_id,
            "edge_id": sample.edge_id,
            "timestamp_ms": sample.timestamp_ms,
            "latitude": sample.latitude,
            "longitude": sample.longitude,
            "speed_mps": sample.speed_mps,
            "heading_deg": sample.heading_deg,
        });
        let _ = self.http.post(&url).json(&body).send().await;
    }

    pub async fn predict(&self, session_id: &str, current_edge: &str) -> (PredictionResult, PredictOutcome) {
        let url = format!("{}/predict", self.base_url.trim_end_matches('/'));
        let body = serde_json::json!({
            "session_id": session_id,
            "current_edge": current_edge,
        });
        match self.http.post(&url).json(&body).send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(p) = resp.json::<PredictionResult>().await {
                    return (p, PredictOutcome::Live);
                }
            }
            Ok(resp) => {
                tracing::warn!("predictor returned HTTP {}", resp.status());
            }
            Err(e) => {
                tracing::warn!("predictor unreachable: {e}");
            }
        }
        (degraded_prediction(session_id), PredictOutcome::Degraded)
    }
}

pub fn degraded_prediction(session_id: &str) -> PredictionResult {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let mut probabilities = std::collections::HashMap::new();
    for edge in ["edge-a", "edge-b", "edge-c", "edge-d"] {
        probabilities.insert(edge.into(), 0.25);
    }
    PredictionResult {
        session_id: session_id.to_string(),
        model_version: "degraded-unavailable".into(),
        probabilities,
        eta_sec: None,
        computed_at_ms: now,
    }
}
