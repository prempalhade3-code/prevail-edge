//! Authoritative Flink keyed-state replica used for ADR-002 alignment
//! and ADR-007 reactive checkpoint transfer.

use crate::proto::FlinkKeyedState;
use crate::types::TrajectorySample;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct KeyedWorkloadState {
    pub session_id: String,
    pub version: u64,
    pub current_edge: String,
    pub sample_count: i64,
    pub speed_sum: f64,
    pub checkpointed_at_ms: i64,
    pub last_sensor_tuple: Option<String>,
    pub last_image_event_id: Option<String>,
    pub last_workload_class: Option<String>,
}

impl KeyedWorkloadState {
    pub fn new(session_id: &str) -> Self {
        Self {
            session_id: session_id.to_string(),
            version: 0,
            current_edge: String::new(),
            sample_count: 0,
            speed_sum: 0.0,
            checkpointed_at_ms: 0,
            last_sensor_tuple: None,
            last_image_event_id: None,
            last_workload_class: None,
        }
    }

    pub fn apply_sample(&mut self, sample: &TrajectorySample) {
        self.version += 1;
        self.current_edge = sample.edge_id.clone();
        self.sample_count += 1;
        self.speed_sum += sample.speed_mps;
        self.checkpointed_at_ms = sample.timestamp_ms;
        self.last_sensor_tuple = sample.sensor_tuple.clone();
        self.last_image_event_id = sample.image_event_id.clone();
        self.last_workload_class = sample.workload_class.clone();
    }

    pub fn apply_align(&mut self, other: &KeyedWorkloadState) {
        *self = other.clone();
    }

    pub fn avg_speed(&self) -> f64 {
        if self.sample_count == 0 {
            0.0
        } else {
            self.speed_sum / self.sample_count as f64
        }
    }

    pub fn to_proto(&self) -> FlinkKeyedState {
        let blob = serde_json::to_vec(self).unwrap_or_default();
        FlinkKeyedState {
            session_id: self.session_id.clone(),
            version: self.version,
            current_edge: self.current_edge.clone(),
            sample_count: self.sample_count,
            speed_sum: self.speed_sum,
            checkpointed_at_ms: self.checkpointed_at_ms,
            checkpoint_blob: blob,
        }
    }

    pub fn from_proto(msg: &FlinkKeyedState) -> Self {
        if !msg.checkpoint_blob.is_empty() {
            if let Ok(parsed) = serde_json::from_slice::<KeyedWorkloadState>(&msg.checkpoint_blob) {
                return parsed;
            }
        }
        Self {
            session_id: msg.session_id.clone(),
            version: msg.version,
            current_edge: msg.current_edge.clone(),
            sample_count: msg.sample_count,
            speed_sum: msg.speed_sum,
            checkpointed_at_ms: msg.checkpointed_at_ms,
            last_sensor_tuple: None,
            last_image_event_id: None,
            last_workload_class: None,
        }
    }

    pub fn write_checkpoint(&self, dir: &Path) -> std::io::Result<PathBuf> {
        std::fs::create_dir_all(dir)?;
        let path = dir.join(format!("{}-v{}.ckpt.json", self.session_id, self.version));
        std::fs::write(&path, serde_json::to_vec_pretty(self)?)?;
        Ok(path)
    }

    pub fn read_checkpoint(path: &Path) -> std::io::Result<Self> {
        let raw = std::fs::read(path)?;
        serde_json::from_slice(&raw).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
    }
}

pub fn checkpoint_dir() -> PathBuf {
    std::env::var("PREVAIL_CHECKPOINT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp/prevail-checkpoints"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_and_roundtrip_checkpoint() {
        let mut state = KeyedWorkloadState::new("sess");
        state.apply_sample(&TrajectorySample {
            session_id: "sess".into(),
            timestamp_ms: 10,
            latitude: 12.9,
            longitude: 77.6,
            speed_mps: 12.0,
            edge_id: "edge-a".into(),
            heading_deg: None,
            sensor_tuple: Some(r#"{"accel":1}"#.into()),
            image_event_id: Some("img-1".into()),
            workload_class: Some("image".into()),
            image_jpeg_b64: None,
        });
        let proto = state.to_proto();
        let restored = KeyedWorkloadState::from_proto(&proto);
        assert_eq!(restored.sample_count, 1);
        assert_eq!(restored.last_image_event_id.as_deref(), Some("img-1"));
        let dir = std::env::temp_dir().join("prevail-ckpt-test");
        let path = restored.write_checkpoint(&dir).unwrap();
        let disk = KeyedWorkloadState::read_checkpoint(&path).unwrap();
        assert_eq!(disk.version, 1);
    }
}
