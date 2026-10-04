//! Push TimelineEvent / metric samples to the FastAPI observability store.

use crate::types::TimelineEvent;
use reqwest::Client;
use serde_json::json;

#[derive(Clone)]
pub struct ObservabilityClient {
    http: Client,
    base_url: Option<String>,
}

impl ObservabilityClient {
    pub fn from_env() -> Self {
        Self {
            http: Client::new(),
            base_url: std::env::var("PREVAIL_OBSERVABILITY_URL")
                .ok()
                .filter(|s| !s.is_empty()),
        }
    }

    pub async fn push_event(&self, event: &TimelineEvent) {
        let Some(base) = &self.base_url else {
            return;
        };
        let url = format!("{}/v1/ingest/timeline", base.trim_end_matches('/'));
        let body = json!({
            "run_id": event.run_id,
            "timestamp_ms": event.timestamp_ms,
            "event_type": event.event_type,
            "edge_id": event.edge_id,
            "message": event.message,
            "payload": event.payload,
        });
        let _ = self.http.post(url).json(&body).send().await;
    }

    pub async fn push_metric(&self, run_id: &str, name: &str, value: f64, edge_id: Option<&str>) {
        let Some(base) = &self.base_url else {
            return;
        };
        let url = format!("{}/v1/ingest/metrics", base.trim_end_matches('/'));
        let body = json!({
            "run_id": run_id,
            "metric_name": name,
            "value": value,
            "edge_id": edge_id,
            "timestamp_ms": now_ms(),
            "metadata": {},
        });
        let _ = self.http.post(url).json(&body).send().await;
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}
