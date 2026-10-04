//! Real QUIC control plane for the edge mesh.
//!
//! Each edge process runs one [`QuicControlServer`] and holds a
//! [`QuicControlClient`] for talking to its peers. Messages are
//! [`crate::proto::ControlEnvelope`] values, one request/response pair per
//! bidirectional stream, so QUIC provides framing and the envelope provides
//! the type.
//!
//! The mesh runs on loopback between processes we start ourselves, so peers
//! authenticate with self-signed certificates (see [`lab_client_config`]).

use crate::proto::{control_envelope, ControlEnvelope};
use prost::Message;
use quinn::{ClientConfig, Endpoint, ServerConfig};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};
use std::collections::HashMap;
use std::net::{SocketAddr, ToSocketAddrs};
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;

/// ALPN identifier so a stray client cannot negotiate against this mesh.
const ALPN: &[u8] = b"prevail-control-v0";

/// Peers are local processes; allow sufficient time for TLS handshake under load.
const CONNECT_TIMEOUT: Duration = Duration::from_millis(5000);
const REQUEST_TIMEOUT: Duration = Duration::from_millis(5000);

#[derive(Debug, Error)]
pub enum QuicError {
    #[error("peer {0} is not a known mesh member")]
    UnknownPeer(String),
    #[error("connect to {addr} failed: {source}")]
    Connect {
        addr: SocketAddr,
        #[source]
        source: Box<dyn std::error::Error + Send + Sync>,
    },
    #[error("stream to {0} failed: {1}")]
    Stream(String, String),
    #[error("decode from {0} failed: {1}")]
    Decode(String, String),
    #[error("timed out waiting for {0}")]
    Timeout(String),
    #[error("tls setup failed: {0}")]
    Tls(String),
    #[error("endpoint bind on {addr} failed: {source}")]
    Bind {
        addr: SocketAddr,
        #[source]
        source: std::io::Error,
    },
}

/// Static mesh membership: which edge lives at which QUIC address.
#[derive(Debug, Clone, Default)]
pub struct MeshAddressBook {
    peers: HashMap<String, SocketAddr>,
}

impl MeshAddressBook {
    pub fn new(peers: HashMap<String, SocketAddr>) -> Self {
        Self { peers }
    }

    /// Parses `edge-a=127.0.0.1:9001,edge-b=127.0.0.1:9002`.
    pub fn parse(spec: &str) -> Self {
        let mut peers = HashMap::new();
        for entry in spec.split(',') {
            let entry = entry.trim();
            if entry.is_empty() {
                continue;
            }
            if let Some((edge, addr)) = entry.split_once('=') {
                if let Some(parsed) = resolve_socket_addr(addr.trim()) {
                    peers.insert(edge.trim().to_string(), parsed);
                }
            }
        }
        Self { peers }
    }

    /// Reads the mesh layout from `PREVAIL_MESH_PEERS`, falling back to the
    /// four-edge loopback layout the lab demo launches.
    pub fn from_env_or_default() -> Self {
        match std::env::var("PREVAIL_MESH_PEERS") {
            Ok(spec) if !spec.trim().is_empty() => Self::parse(&spec),
            _ => Self::parse(
                "edge-a=127.0.0.1:9101,edge-b=127.0.0.1:9102,\
                 edge-c=127.0.0.1:9103,edge-d=127.0.0.1:9104",
            ),
        }
    }

    pub fn address_of(&self, edge_id: &str) -> Option<SocketAddr> {
        self.peers.get(edge_id).copied()
    }

    pub fn edge_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.peers.keys().cloned().collect();
        ids.sort();
        ids
    }

    pub fn is_empty(&self) -> bool {
        self.peers.is_empty()
    }
}

fn resolve_socket_addr(addr: &str) -> Option<SocketAddr> {
    if let Ok(parsed) = addr.parse::<SocketAddr>() {
        return Some(parsed);
    }
    addr.to_socket_addrs().ok().and_then(|mut iter| iter.next())
}

/// Accepts any peer certificate.
///
/// The mesh is a set of loopback processes started by the same operator, and
/// each generates its own certificate at boot, so there is no CA to pin
/// against. Confidentiality still holds; peer identity comes from the
/// `from_edge_id` in the envelope and from the authority signature, not TLS.
/// Do not reuse this verifier for anything reachable off the host.
#[derive(Debug)]
struct AcceptAnyPeer;

impl ServerCertVerifier for AcceptAnyPeer {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![
            SignatureScheme::ECDSA_NISTP256_SHA256,
            SignatureScheme::ED25519,
            SignatureScheme::RSA_PSS_SHA256,
            SignatureScheme::RSA_PKCS1_SHA256,
        ]
    }
}

/// Installs the process-wide rustls crypto provider exactly once.
fn ensure_crypto_provider() {
    use std::sync::Once;
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        // Ignore the error: a host application may have installed one already.
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

/// Server config with a freshly generated self-signed certificate.
pub fn lab_server_config() -> Result<ServerConfig, QuicError> {
    ensure_crypto_provider();

    let cert = rcgen::generate_simple_self_signed(vec!["prevail-edge".to_string()])
        .map_err(|e| QuicError::Tls(format!("certificate generation: {e}")))?;
    let cert_der = CertificateDer::from(cert.cert);
    let key_der = PrivateKeyDer::try_from(cert.key_pair.serialize_der())
        .map_err(|e| QuicError::Tls(format!("private key: {e}")))?;

    let mut tls = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![cert_der], key_der)
        .map_err(|e| QuicError::Tls(format!("server tls: {e}")))?;
    tls.alpn_protocols = vec![ALPN.to_vec()];

    let quic_tls = quinn::crypto::rustls::QuicServerConfig::try_from(tls)
        .map_err(|e| QuicError::Tls(format!("quic server tls: {e}")))?;

    let mut config = ServerConfig::with_crypto(Arc::new(quic_tls));
    let transport = Arc::get_mut(&mut config.transport)
        .expect("fresh ServerConfig holds the only transport reference");
    transport.max_concurrent_uni_streams(0u32.into());
    transport.keep_alive_interval(Some(Duration::from_secs(2)));

    Ok(config)
}

/// Client config that trusts any mesh peer. See [`AcceptAnyPeer`].
pub fn lab_client_config() -> Result<ClientConfig, QuicError> {
    ensure_crypto_provider();

    let mut tls = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(AcceptAnyPeer))
        .with_no_client_auth();
    tls.alpn_protocols = vec![ALPN.to_vec()];

    let quic_tls = quinn::crypto::rustls::QuicClientConfig::try_from(tls)
        .map_err(|e| QuicError::Tls(format!("quic client tls: {e}")))?;

    Ok(ClientConfig::new(Arc::new(quic_tls)))
}

/// Handles one inbound control message and produces the reply.
///
/// Async because real handlers take the runtime lock to mutate shadow and
/// authority state.
#[async_trait::async_trait]
pub trait ControlHandler: Send + Sync + 'static {
    async fn handle(&self, envelope: ControlEnvelope) -> ControlEnvelope;
}

/// Replies to [`control_envelope::Payload::PeerPing`] and ignores the rest.
/// Used by the transport tests; running edges use `mesh::MeshControlHandler`.
pub struct PingOnlyHandler {
    pub local_edge_id: String,
}

#[async_trait::async_trait]
impl ControlHandler for PingOnlyHandler {
    async fn handle(&self, envelope: ControlEnvelope) -> ControlEnvelope {
        let payload = match envelope.payload {
            Some(control_envelope::Payload::PeerPing(ping)) => {
                Some(control_envelope::Payload::PeerPong(crate::proto::PeerPong {
                    edge_id: self.local_edge_id.clone(),
                    received_at_ms: ping.sent_at_ms,
                    ..Default::default()
                }))
            }
            _ => None,
        };

        reply_envelope(&self.local_edge_id, envelope.correlation_id, payload)
    }
}

/// Builds a response envelope that echoes the request's correlation id.
pub fn reply_envelope(
    local_edge_id: &str,
    correlation_id: u64,
    payload: Option<control_envelope::Payload>,
) -> ControlEnvelope {
    ControlEnvelope {
        from_edge_id: local_edge_id.to_string(),
        sent_at_ms: now_ms(),
        correlation_id,
        payload,
    }
}

/// QUIC listener for one edge process.
pub struct QuicControlServer {
    endpoint: Endpoint,
    local_addr: SocketAddr,
}

impl QuicControlServer {
    /// Binds a QUIC endpoint. Passing port 0 lets the OS choose, which is what
    /// the tests use to avoid fighting over fixed ports.
    pub fn bind(addr: SocketAddr) -> Result<Self, QuicError> {
        let config = lab_server_config()?;
        let endpoint =
            Endpoint::server(config, addr).map_err(|source| QuicError::Bind { addr, source })?;
        let local_addr = endpoint
            .local_addr()
            .map_err(|source| QuicError::Bind { addr, source })?;
        Ok(Self {
            endpoint,
            local_addr,
        })
    }

    pub fn local_addr(&self) -> SocketAddr {
        self.local_addr
    }

    /// Serves until the endpoint closes. Each connection and each stream is
    /// handled concurrently so one slow peer cannot stall the mesh.
    pub async fn serve<H: ControlHandler>(self, handler: Arc<H>) {
        while let Some(incoming) = self.endpoint.accept().await {
            let handler = handler.clone();
            tokio::spawn(async move {
                let connection = match incoming.await {
                    Ok(c) => c,
                    Err(e) => {
                        tracing::debug!("mesh handshake failed: {e}");
                        return;
                    }
                };
                loop {
                    match connection.accept_bi().await {
                        Ok((send, recv)) => {
                            let handler = handler.clone();
                            tokio::spawn(async move {
                                if let Err(e) = serve_stream(send, recv, handler).await {
                                    tracing::debug!("mesh stream ended: {e}");
                                }
                            });
                        }
                        Err(_) => return, // peer closed the connection
                    }
                }
            });
        }
    }
}

async fn serve_stream<H: ControlHandler>(
    mut send: quinn::SendStream,
    mut recv: quinn::RecvStream,
    handler: Arc<H>,
) -> Result<(), String> {
    // The peer finishes its send side, which bounds the read for us.
    let raw = recv
        .read_to_end(64 * 1024)
        .await
        .map_err(|e| format!("read: {e}"))?;
    let envelope = ControlEnvelope::decode(raw.as_slice()).map_err(|e| format!("decode: {e}"))?;

    let reply = handler.handle(envelope).await;
    let bytes = reply.encode_to_vec();

    send.write_all(&bytes).await.map_err(|e| format!("write: {e}"))?;
    send.finish().map_err(|e| format!("finish: {e}"))?;
    Ok(())
}

/// Dials mesh peers. Connections are made per request: the mesh is small and
/// on loopback, so pooling would add reconnect bookkeeping for no real gain.
#[derive(Clone)]
pub struct QuicControlClient {
    endpoint: Endpoint,
    local_edge_id: String,
    address_book: MeshAddressBook,
}

impl QuicControlClient {
    pub fn new(
        local_edge_id: impl Into<String>,
        address_book: MeshAddressBook,
    ) -> Result<Self, QuicError> {
        let bind: SocketAddr = "0.0.0.0:0".parse().expect("valid wildcard addr");
        let mut endpoint =
            Endpoint::client(bind).map_err(|source| QuicError::Bind { addr: bind, source })?;
        endpoint.set_default_client_config(lab_client_config()?);
        Ok(Self {
            endpoint,
            local_edge_id: local_edge_id.into(),
            address_book,
        })
    }

    pub fn local_edge_id(&self) -> &str {
        &self.local_edge_id
    }

    pub fn address_book(&self) -> &MeshAddressBook {
        &self.address_book
    }

    /// Sends one envelope to `peer_edge_id` and waits for the reply.
    pub async fn request(
        &self,
        peer_edge_id: &str,
        payload: control_envelope::Payload,
    ) -> Result<ControlEnvelope, QuicError> {
        let addr = self
            .address_book
            .address_of(peer_edge_id)
            .ok_or_else(|| QuicError::UnknownPeer(peer_edge_id.to_string()))?;

        let envelope = ControlEnvelope {
            from_edge_id: self.local_edge_id.clone(),
            sent_at_ms: now_ms(),
            correlation_id: next_correlation_id(),
            payload: Some(payload),
        };

        let connecting = self
            .endpoint
            .connect(addr, "prevail-edge")
            .map_err(|e| QuicError::Connect {
                addr,
                source: Box::new(e),
            })?;

        let connection = tokio::time::timeout(CONNECT_TIMEOUT, connecting)
            .await
            .map_err(|_| QuicError::Timeout(format!("handshake with {peer_edge_id}")))?
            .map_err(|e| QuicError::Connect {
                addr,
                source: Box::new(e),
            })?;

        let result = self.exchange(&connection, peer_edge_id, &envelope).await;
        connection.close(0u32.into(), b"done");
        result
    }

    async fn exchange(
        &self,
        connection: &quinn::Connection,
        peer_edge_id: &str,
        envelope: &ControlEnvelope,
    ) -> Result<ControlEnvelope, QuicError> {
        let (mut send, mut recv) = tokio::time::timeout(REQUEST_TIMEOUT, connection.open_bi())
            .await
            .map_err(|_| QuicError::Timeout(format!("open stream to {peer_edge_id}")))?
            .map_err(|e| QuicError::Stream(peer_edge_id.to_string(), e.to_string()))?;

        let bytes = envelope.encode_to_vec();
        send.write_all(&bytes)
            .await
            .map_err(|e| QuicError::Stream(peer_edge_id.to_string(), e.to_string()))?;
        // Signals end-of-request so the peer's read_to_end completes.
        send.finish()
            .map_err(|e| QuicError::Stream(peer_edge_id.to_string(), e.to_string()))?;

        let raw = tokio::time::timeout(REQUEST_TIMEOUT, recv.read_to_end(64 * 1024))
            .await
            .map_err(|_| QuicError::Timeout(format!("reply from {peer_edge_id}")))?
            .map_err(|e| QuicError::Stream(peer_edge_id.to_string(), e.to_string()))?;

        ControlEnvelope::decode(raw.as_slice())
            .map_err(|e| QuicError::Decode(peer_edge_id.to_string(), e.to_string()))
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock after unix epoch")
        .as_millis() as i64
}

fn next_correlation_id() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::PeerPing;

    /// Proves the control plane is really QUIC: a server on a real UDP socket,
    /// a client that completes a TLS handshake, and a Protobuf round trip.
    #[tokio::test]
    async fn peer_ping_round_trip_over_real_quic() {
        let server = QuicControlServer::bind("127.0.0.1:0".parse().unwrap())
            .expect("server binds on an ephemeral port");
        let addr = server.local_addr();

        tokio::spawn(server.serve(Arc::new(PingOnlyHandler {
            local_edge_id: "edge-b".into(),
        })));

        let book = MeshAddressBook::new(HashMap::from([("edge-b".to_string(), addr)]));
        let client = QuicControlClient::new("edge-a", book).expect("client endpoint binds");

        let reply = client
            .request(
                "edge-b",
                control_envelope::Payload::PeerPing(PeerPing {
                    edge_id: "edge-b".into(),
                    sent_at_ms: 1234,
                }),
            )
            .await
            .expect("peer replies over QUIC");

        assert_eq!(reply.from_edge_id, "edge-b");
        match reply.payload {
            Some(control_envelope::Payload::PeerPong(pong)) => {
                assert_eq!(pong.edge_id, "edge-b");
                assert_eq!(pong.received_at_ms, 1234, "server echoes the send timestamp");
            }
            other => panic!("expected PeerPong, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn unreachable_peer_is_an_error_not_a_hang() {
        // Port 1 on loopback has nothing listening, so the handshake must time out.
        let book = MeshAddressBook::new(HashMap::from([(
            "edge-z".to_string(),
            "127.0.0.1:1".parse().unwrap(),
        )]));
        let client = QuicControlClient::new("edge-a", book).expect("client endpoint binds");

        let result = client
            .request(
                "edge-z",
                control_envelope::Payload::PeerPing(PeerPing {
                    edge_id: "edge-z".into(),
                    sent_at_ms: 1,
                }),
            )
            .await;

        assert!(result.is_err(), "a dead peer must surface as an error");
    }

    #[tokio::test]
    async fn unknown_peer_is_rejected_before_dialing() {
        let client = QuicControlClient::new("edge-a", MeshAddressBook::default())
            .expect("client endpoint binds");

        let result = client
            .request(
                "edge-nope",
                control_envelope::Payload::PeerPing(PeerPing {
                    edge_id: "edge-nope".into(),
                    sent_at_ms: 1,
                }),
            )
            .await;

        assert!(matches!(result, Err(QuicError::UnknownPeer(_))));
    }

    #[test]
    fn address_book_parses_mesh_spec() {
        let book = MeshAddressBook::parse("edge-a=127.0.0.1:9101, edge-b=127.0.0.1:9102");
        assert_eq!(book.edge_ids(), vec!["edge-a", "edge-b"]);
        assert_eq!(
            book.address_of("edge-b"),
            Some("127.0.0.1:9102".parse().unwrap())
        );
        assert_eq!(book.address_of("edge-c"), None);
    }

    #[test]
    fn address_book_skips_malformed_entries() {
        let book = MeshAddressBook::parse("edge-a=127.0.0.1:9101,,garbage,edge-b=not-an-addr");
        assert_eq!(book.edge_ids(), vec!["edge-a"]);
    }
}
