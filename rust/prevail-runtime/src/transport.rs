use crate::types::{PeerPing, PeerPong};
use std::collections::HashMap;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TransportError {
    #[error("peer {0} unreachable")]
    Unreachable(String),
}

/// Control-plane mesh. Production: QUIC; lab v1 uses in-memory + optional TCP fan-out.
pub trait ControlTransport: Send + Sync {
    fn send_ping(&self, ping: PeerPing) -> Result<PeerPong, TransportError>;
    fn peers(&self) -> Vec<String>;
}

#[derive(Debug, Default)]
pub struct InMemoryTransport {
    peers: Vec<String>,
    local_edge: String,
}

impl InMemoryTransport {
    pub fn new(local_edge: impl Into<String>, peers: Vec<String>) -> Self {
        Self {
            peers,
            local_edge: local_edge.into(),
        }
    }
}

impl ControlTransport for InMemoryTransport {
    fn send_ping(&self, ping: PeerPing) -> Result<PeerPong, TransportError> {
        if !self.peers.contains(&ping.edge_id) && ping.edge_id != self.local_edge {
            return Err(TransportError::Unreachable(ping.edge_id));
        }
        Ok(PeerPong {
            edge_id: self.local_edge.clone(),
            received_at_ms: ping.sent_at_ms,
        })
    }

    fn peers(&self) -> Vec<String> {
        self.peers.clone()
    }
}

pub fn mesh_health(transport: &dyn ControlTransport) -> HashMap<String, bool> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    transport
        .peers()
        .into_iter()
        .map(|p| {
            let ok = transport
                .send_ping(PeerPing {
                    edge_id: p.clone(),
                    sent_at_ms: now,
                })
                .is_ok();
            (p, ok)
        })
        .collect()
}

// Placeholder for QUIC (Chirag Compose network + Prem quinn wiring in Phase 1 integration).
pub struct QuicTransportStub {
    inner: InMemoryTransport,
}

impl QuicTransportStub {
    pub fn new(local_edge: impl Into<String>, peers: Vec<String>) -> Self {
        Self {
            inner: InMemoryTransport::new(local_edge, peers),
        }
    }
}

impl ControlTransport for QuicTransportStub {
    fn send_ping(&self, ping: PeerPing) -> Result<PeerPong, TransportError> {
        self.inner.send_ping(ping)
    }

    fn peers(&self) -> Vec<String> {
        self.inner.peers()
    }
}
