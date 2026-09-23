use crate::types::PredictionResult;
use reqwest::Client;
use std::time::{SystemTime, UNIX_EPOCH};

/// Client for Atharva's predictor service. Falls back to mock when unavailable.
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

    pub async fn predict(&self, session_id: &str) -> PredictionResult {
        let url = format!("{}/predict", self.base_url.trim_end_matches('/'));
        let body = serde_json::json!({ "session_id": session_id });
        match self.http.post(&url).json(&body).send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(p) = resp.json::<PredictionResult>().await {
                    return p;
                }
            }
            _ => {}
        }
        mock_prediction(session_id)
    }
}

/// Contract-compatible mock until `python/predictor` is deployed (Atharva).
pub fn mock_prediction(session_id: &str) -> PredictionResult {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let mut probabilities = std::collections::HashMap::new();
    probabilities.insert("edge-b".into(), 0.82);
    probabilities.insert("edge-c".into(), 0.13);
    probabilities.insert("edge-d".into(), 0.05);
    PredictionResult {
        session_id: session_id.to_string(),
        model_version: "mock-v0".into(),
        probabilities,
        eta_sec: Some(14.0),
        computed_at_ms: now,
    }
}
