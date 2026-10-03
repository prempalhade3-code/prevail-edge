use crate::proto::control_envelope;
use crate::quic::{MeshAddressBook, QuicControlClient, QuicError};
use crate::types::{PeerPing, PeerPong};
use async_trait::async_trait;
use std::collections::HashMap;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TransportError {
    #[error("peer {0} unreachable")]
    Unreachable(String),
    #[error("quic control plane: {0}")]
    Quic(#[from] QuicError),
    #[error("peer {peer} replied with an unexpected message: {detail}")]
    UnexpectedReply { peer: String, detail: String },
}

/// Control-plane mesh between edge runtimes.
///
/// Async because the real implementation is QUIC; [`InMemoryTransport`] exists
/// so unit tests can exercise runtime logic without binding sockets.
#[async_trait]
pub trait ControlTransport: Send + Sync {
    async fn send_ping(&self, ping: PeerPing) -> Result<PeerPong, TransportError>;
    fn peers(&self) -> Vec<String>;

    /// Reported to the dashboard so a degraded mesh is visible rather than silent.
    fn kind(&self) -> &'static str;
}

/// Loopback stand-in used by unit tests. Never used by a running edge process.
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

#[async_trait]
impl ControlTransport for InMemoryTransport {
    async fn send_ping(&self, ping: PeerPing) -> Result<PeerPong, TransportError> {
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

    fn kind(&self) -> &'static str {
        "in-memory"
    }
}

/// Control transport backed by the real QUIC mesh.
pub struct QuicTransport {
    client: QuicControlClient,
    peers: Vec<String>,
}

impl QuicTransport {
    /// Builds a transport for `local_edge_id`, excluding it from its own peer list.
    pub fn new(
        local_edge_id: impl Into<String>,
        address_book: MeshAddressBook,
    ) -> Result<Self, TransportError> {
        let local_edge_id = local_edge_id.into();
        let peers = address_book
            .edge_ids()
            .into_iter()
            .filter(|id| id != &local_edge_id)
            .collect();
        let client = QuicControlClient::new(local_edge_id, address_book)?;
        Ok(Self { client, peers })
    }

    pub fn client(&self) -> &QuicControlClient {
        &self.client
    }
}

#[async_trait]
impl ControlTransport for QuicTransport {
    async fn send_ping(&self, ping: PeerPing) -> Result<PeerPong, TransportError> {
        let peer = ping.edge_id.clone();
        let reply = self
            .client
            .request(
                &peer,
                control_envelope::Payload::PeerPing(crate::proto::PeerPing {
                    edge_id: ping.edge_id,
                    sent_at_ms: ping.sent_at_ms,
                }),
            )
            .await?;

        match reply.payload {
            Some(control_envelope::Payload::PeerPong(pong)) => Ok(PeerPong {
                edge_id: pong.edge_id,
                received_at_ms: pong.received_at_ms,
            }),
            other => Err(TransportError::UnexpectedReply {
                peer,
                detail: format!("{other:?}"),
            }),
        }
    }

    fn peers(&self) -> Vec<String> {
        self.peers.clone()
    }

    fn kind(&self) -> &'static str {
        "quic"
    }
}

/// Pings every peer concurrently and reports which answered.
pub async fn mesh_health(transport: &dyn ControlTransport) -> HashMap<String, bool> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock after unix epoch")
        .as_millis() as i64;

    let checks = transport.peers().into_iter().map(|peer| async move {
        let ok = transport
            .send_ping(PeerPing {
                edge_id: peer.clone(),
                sent_at_ms: now,
            })
            .await
            .is_ok();
        (peer, ok)
    });

    futures_util::future::join_all(checks).await.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::quic::{PingOnlyHandler, QuicControlServer};
    use std::sync::Arc;

    #[tokio::test]
    async fn quic_transport_reports_live_and_dead_peers() {
        let server = QuicControlServer::bind("127.0.0.1:0".parse().unwrap()).unwrap();
        let live_addr = server.local_addr();
        tokio::spawn(server.serve(Arc::new(PingOnlyHandler {
            local_edge_id: "edge-b".into(),
        })));

        let book = MeshAddressBook::new(HashMap::from([
            ("edge-a".to_string(), "127.0.0.1:9".parse().unwrap()),
            ("edge-b".to_string(), live_addr),
            ("edge-c".to_string(), "127.0.0.1:1".parse().unwrap()),
        ]));

        let transport = QuicTransport::new("edge-a", book).unwrap();
        assert_eq!(transport.kind(), "quic");
        assert_eq!(
            transport.peers(),
            vec!["edge-b", "edge-c"],
            "an edge must not list itself as a peer"
        );

        let health = mesh_health(&transport).await;
        assert_eq!(health.get("edge-b"), Some(&true), "live peer answers");
        assert_eq!(health.get("edge-c"), Some(&false), "dead peer does not");
        assert!(!health.contains_key("edge-a"), "self is not probed");
    }
}
