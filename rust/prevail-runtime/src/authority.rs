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
    #[error("session mismatch: expected {expected}, got {got}")]
    SessionMismatch { expected: String, got: String },
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

    /// Adopts a token minted by another edge.
    ///
    /// This is where the monotonic-epoch invariant is actually enforced: a
    /// replayed or out-of-order `AuthorityTransfer` carries an epoch at or
    /// below the one we already hold, and accepting it would let two edges
    /// believe they are authoritative for the same session at once.
    pub fn accept_transfer(&mut self, token: &AuthorityToken) -> Result<(), AuthorityError> {
        if token.session_id != self.token.session_id {
            return Err(AuthorityError::SessionMismatch {
                expected: self.token.session_id.clone(),
                got: token.session_id.clone(),
            });
        }

        let expected = sign(
            &token.session_id,
            token.epoch,
            &token.holder_edge_id,
            &self.secret,
        );
        if expected != token.signature {
            return Err(AuthorityError::InvalidSignature);
        }

        if token.epoch <= self.token.epoch {
            return Err(AuthorityError::EpochRegression {
                current: self.token.epoch,
                attempted: token.epoch,
            });
        }

        self.token = token.clone();
        Ok(())
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

    #[test]
    fn transfer_is_accepted_when_epoch_advances() {
        let mut holder = AuthorityManager::new("sess-1", "edge-a", "lab-secret");
        let mut peer = AuthorityManager::new("sess-1", "edge-a", "lab-secret");

        let token = holder.promote("edge-b", "edge-a").unwrap();
        peer.accept_transfer(&token).unwrap();

        assert_eq!(peer.holder(), "edge-b");
        assert_eq!(peer.epoch(), 1);
        peer.validate().unwrap();
    }

    #[test]
    fn replayed_transfer_is_rejected_as_epoch_regression() {
        let mut holder = AuthorityManager::new("sess-1", "edge-a", "lab-secret");
        let mut peer = AuthorityManager::new("sess-1", "edge-a", "lab-secret");

        let first = holder.promote("edge-b", "edge-a").unwrap();
        let second = holder.promote("edge-c", "edge-b").unwrap();

        peer.accept_transfer(&second).unwrap();

        // A delayed duplicate of the earlier transfer must not move authority back.
        let err = peer.accept_transfer(&first).unwrap_err();
        assert_eq!(
            err,
            AuthorityError::EpochRegression {
                current: 2,
                attempted: 1
            }
        );
        assert_eq!(peer.holder(), "edge-c", "holder is unchanged after a replay");
    }

    #[test]
    fn same_epoch_transfer_is_rejected() {
        let mut holder = AuthorityManager::new("sess-1", "edge-a", "lab-secret");
        let mut peer = AuthorityManager::new("sess-1", "edge-a", "lab-secret");

        let token = holder.promote("edge-b", "edge-a").unwrap();
        peer.accept_transfer(&token).unwrap();

        // Re-delivery of the exact same token is a duplicate, not progress.
        let err = peer.accept_transfer(&token).unwrap_err();
        assert!(matches!(err, AuthorityError::EpochRegression { .. }));
    }

    #[test]
    fn forged_token_is_rejected() {
        let mut peer = AuthorityManager::new("sess-1", "edge-a", "lab-secret");
        let forged = AuthorityToken {
            session_id: "sess-1".into(),
            epoch: 99,
            holder_edge_id: "edge-evil".into(),
            signature: "prevail-deadbeefdeadbeef".into(),
        };

        let err = peer.accept_transfer(&forged).unwrap_err();
        assert_eq!(err, AuthorityError::InvalidSignature);
        assert_eq!(peer.holder(), "edge-a");
    }

    #[test]
    fn token_for_another_session_is_rejected() {
        let mut peer = AuthorityManager::new("sess-1", "edge-a", "lab-secret");
        let mut other = AuthorityManager::new("sess-2", "edge-a", "lab-secret");
        let token = other.promote("edge-b", "edge-a").unwrap();

        let err = peer.accept_transfer(&token).unwrap_err();
        assert!(matches!(err, AuthorityError::SessionMismatch { .. }));
    }
}
