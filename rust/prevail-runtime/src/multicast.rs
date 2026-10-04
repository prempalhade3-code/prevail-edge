//! UDP multicast fan-out of the authoritative input stream.
//!
//! One datagram from the holder reaches every joined shadow. QUIC remains the
//! control plane; this is the data-plane tee when `PREVAIL_MULTICAST_GROUP`
//! is set (Docker default: 239.20.20.1:47000).

use crate::runtime::SharedRuntime;
use crate::types::TrajectorySample;
use serde::{Deserialize, Serialize};
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::OnceLock;
use std::time::Duration;
use tokio::net::UdpSocket;

const DEFAULT_GROUP: &str = "239.20.20.1:47000";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MulticastSample {
    session_id: String,
    sequence: u64,
    sample: TrajectorySample,
}

fn group_addr() -> Option<SocketAddr> {
    let raw = std::env::var("PREVAIL_MULTICAST_GROUP").unwrap_or_default();
    if raw.is_empty() || raw == "0" || raw.eq_ignore_ascii_case("off") {
        return None;
    }
    raw.parse().ok().or_else(|| DEFAULT_GROUP.parse().ok())
}

pub fn enabled() -> bool {
    group_addr().is_some()
}

fn send_socket() -> Option<&'static std::net::UdpSocket> {
    static SOCK: OnceLock<Option<std::net::UdpSocket>> = OnceLock::new();
    SOCK.get_or_init(|| {
        let sock = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
        sock.set_multicast_ttl_v4(1).ok()?;
        sock.set_nonblocking(false).ok()?;
        Some(sock)
    })
    .as_ref()
}

pub fn publish_sample(sample: &TrajectorySample, sequence: u64) -> u64 {
    let Some(dest) = group_addr() else {
        return 0;
    };
    let Some(sock) = send_socket() else {
        return 0;
    };
    let body = MulticastSample {
        session_id: sample.session_id.clone(),
        sequence,
        sample: sample.clone(),
    };
    let Ok(bytes) = serde_json::to_vec(&body) else {
        return 0;
    };
    match sock.send_to(&bytes, dest) {
        Ok(n) => n as u64,
        Err(_) => 0,
    }
}

fn bind_receiver(port: u16, group: Ipv4Addr) -> std::io::Result<UdpSocket> {
    let sock = socket2::Socket::new(
        socket2::Domain::IPV4,
        socket2::Type::DGRAM,
        Some(socket2::Protocol::UDP),
    )?;
    sock.set_reuse_address(true)?;
    #[cfg(unix)]
    sock.set_reuse_port(true)?;
    sock.bind(&socket2::SockAddr::from(SocketAddr::from((
        Ipv4Addr::UNSPECIFIED,
        port,
    ))))?;
    sock.set_nonblocking(true)?;
    sock.join_multicast_v4(&group, &Ipv4Addr::UNSPECIFIED)?;
    UdpSocket::from_std(sock.into())
}

pub fn spawn_listener(runtime: SharedRuntime) {
    let Some(addr) = group_addr() else {
        tracing::info!("multicast disabled (PREVAIL_MULTICAST_GROUP unset)");
        return;
    };
    let group = match addr.ip() {
        std::net::IpAddr::V4(v4) => v4,
        _ => {
            tracing::warn!("multicast group must be IPv4");
            return;
        }
    };
    tokio::spawn(async move {
        let sock = match bind_receiver(addr.port(), group) {
            Ok(s) => s,
            Err(e) => {
                tracing::error!("multicast bind failed: {e}");
                return;
            }
        };
        tracing::info!(%addr, "multicast stream listener joined");
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            match sock.recv_from(&mut buf).await {
                Ok((n, _)) => {
                    if let Ok(msg) = serde_json::from_slice::<MulticastSample>(&buf[..n]) {
                        let mut rt = runtime.write().await;
                        rt.on_multicast_sample(msg.session_id, msg.sequence, msg.sample);
                    }
                }
                Err(e) => {
                    tracing::debug!("multicast recv: {e}");
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_without_env() {
        std::env::remove_var("PREVAIL_MULTICAST_GROUP");
        assert!(!enabled());
    }
}
