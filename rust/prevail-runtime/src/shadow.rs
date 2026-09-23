use crate::types::{ShadowRole, ShadowState};
use thiserror::Error;

#[derive(Debug, Error, PartialEq)]
pub enum ShadowError {
    #[error("shadow already exists on {0}")]
    AlreadyExists(String),
    #[error("no shadow on {0}")]
    NotFound(String),
    #[error("sync ratio {actual} below threshold {threshold}")]
    SyncNotReady { actual: f64, threshold: f64 },
}

#[derive(Debug, Default)]
pub struct ShadowManager {
    shadows: Vec<ShadowState>,
}

impl ShadowManager {
    pub fn list(&self) -> &[ShadowState] {
        &self.shadows
    }

    pub fn create(&mut self, edge_id: &str) -> Result<(), ShadowError> {
        if self.shadows.iter().any(|s| s.edge_id == edge_id) {
            return Err(ShadowError::AlreadyExists(edge_id.to_string()));
        }
        self.shadows.push(ShadowState {
            edge_id: edge_id.to_string(),
            role: ShadowRole::WarmShadow,
            sync_ratio: 0.0,
            output_suppressed: true,
        });
        Ok(())
    }

    pub fn discard(&mut self, edge_id: &str) -> Result<(), ShadowError> {
        let len_before = self.shadows.len();
        self.shadows.retain(|s| s.edge_id != edge_id);
        if self.shadows.len() == len_before {
            return Err(ShadowError::NotFound(edge_id.to_string()));
        }
        Ok(())
    }

    pub fn tick_sync(&mut self, edge_id: &str, delta: f64) {
        if let Some(s) = self.shadows.iter_mut().find(|s| s.edge_id == edge_id) {
            s.sync_ratio = (s.sync_ratio + delta).min(1.0);
        }
    }

    pub fn ready_for_promotion(&self, edge_id: &str, threshold: f64) -> Result<(), ShadowError> {
        let s = self
            .shadows
            .iter()
            .find(|s| s.edge_id == edge_id)
            .ok_or_else(|| ShadowError::NotFound(edge_id.to_string()))?;
        if s.sync_ratio < threshold {
            return Err(ShadowError::SyncNotReady {
                actual: s.sync_ratio,
                threshold,
            });
        }
        Ok(())
    }

    pub fn promote_shadow_to_authoritative(&mut self, edge_id: &str) {
        for s in &mut self.shadows {
            if s.edge_id == edge_id {
                s.role = ShadowRole::Authoritative;
                s.output_suppressed = false;
            } else {
                s.role = ShadowRole::Idle;
                s.sync_ratio = 0.0;
            }
        }
        self.shadows.retain(|s| s.role != ShadowRole::Idle);
    }

    pub fn clear(&mut self) {
        self.shadows.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sync_and_promote() {
        let mut mgr = ShadowManager::default();
        mgr.create("edge-b").unwrap();
        mgr.tick_sync("edge-b", 0.5);
        mgr.tick_sync("edge-b", 0.5);
        mgr.ready_for_promotion("edge-b", 0.95).unwrap();
        mgr.promote_shadow_to_authoritative("edge-b");
        assert_eq!(mgr.list()[0].role, ShadowRole::Authoritative);
    }
}
