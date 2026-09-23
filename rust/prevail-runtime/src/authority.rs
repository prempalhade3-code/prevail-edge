use crate::types::AuthorityToken;
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AuthorityError {
    #[error("epoch regression: current {current}, attempted {attempted}")]
    EpochRegression { current: u64, attempted: u64 },
    #[error("holder mismatch: expected {expected}, got {got}")]
    HolderMismatch { expected: String, got: String },
    #[error("invalid token signature")]
    InvalidSignature,
}

#[derive(Debug, Clone)]
pub struct AuthorityManager {
    token: AuthorityToken,
    secret: String,
}

impl AuthorityManager {
    pub fn new(session_id: &str, initial_edge: &str, secret: &str) -> Self {
        let token = AuthorityToken {
            session_id: session_id.to_string(),
            epoch: 0,
            holder_edge_id: initial_edge.to_string(),
            signature: sign(session_id, 0, initial_edge, secret),
        };
        Self {
            token,
            secret: secret.to_string(),
        }
    }

    pub fn token(&self) -> &AuthorityToken {
        &self.token
    }

    pub fn holder(&self) -> &str {
        &self.token.holder_edge_id
    }

    pub fn epoch(&self) -> u64 {
        self.token.epoch
    }

    pub fn validate(&self) -> Result<(), AuthorityError> {
        let expected = sign(
            &self.token.session_id,
            self.token.epoch,
            &self.token.holder_edge_id,
            &self.secret,
        );
        if expected != self.token.signature {
            return Err(AuthorityError::InvalidSignature);
        }
        Ok(())
    }

    /// Two-phase promotion: only the current holder may advance epoch.
    pub fn promote(&mut self, new_holder: &str, from_holder: &str) -> Result<AuthorityToken, AuthorityError> {
        if from_holder != self.token.holder_edge_id {
            return Err(AuthorityError::HolderMismatch {
                expected: self.token.holder_edge_id.clone(),
                got: from_holder.to_string(),
            });
        }
        let new_epoch = self.token.epoch + 1;
        self.token = AuthorityToken {
            session_id: self.token.session_id.clone(),
            epoch: new_epoch,
            holder_edge_id: new_holder.to_string(),
            signature: sign(&self.token.session_id, new_epoch, new_holder, &self.secret),
        };
        Ok(self.token.clone())
    }
}

fn sign(session_id: &str, epoch: u64, holder: &str, secret: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    (session_id, epoch, holder, secret).hash(&mut h);
    format!("prevail-{:016x}", h.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn promotion_increments_epoch() {
        let mut mgr = AuthorityManager::new("sess-1", "edge-a", "lab-secret");
        let old = mgr.holder().to_string();
        let t = mgr.promote("edge-b", &old).unwrap();
        assert_eq!(t.epoch, 1);
        assert_eq!(t.holder_edge_id, "edge-b");
        mgr.validate().unwrap();
    }

    #[test]
    fn wrong_holder_rejected() {
        let mut mgr = AuthorityManager::new("sess-1", "edge-a", "lab-secret");
        let err = mgr.promote("edge-b", "edge-c").unwrap_err();
        assert!(matches!(err, AuthorityError::HolderMismatch { .. }));
    }
}
