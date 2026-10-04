use prevail_runtime::api::{serve, AppState};
use prevail_runtime::config::load_session_config;
use prevail_runtime::mesh::MeshControlHandler;
use prevail_runtime::proto::control_envelope;
use prevail_runtime::quic::{MeshAddressBook, QuicControlServer};
use prevail_runtime::runtime::PrevailRuntime;
use prevail_runtime::transport::QuicTransport;
use prevail_runtime::types::AuthorityToken;
use std::env;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
        .init();

    let host = env::var("PREVAIL_RUNTIME_HOST").unwrap_or_else(|_| "0.0.0.0".into());
    let port: u16 = env::var("PREVAIL_RUNTIME_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8090);
    let predictor_url = env::var("PREVAIL_PREDICTOR_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:8091".into());

    if env::var("PREVAIL_EDGE_REGIONS_PATH").is_err() {
        let default_regions = "deploy/config/edge-regions.json";
        if std::path::Path::new(default_regions).exists() {
            env::set_var("PREVAIL_EDGE_REGIONS_PATH", default_regions);
        }
    }
    if env::var("PREVAIL_EDGE_CAPABILITIES_PATH").is_err() {
        let default_caps = "deploy/config/edge-capabilities.json";
        if std::path::Path::new(default_caps).exists() {
            env::set_var("PREVAIL_EDGE_CAPABILITIES_PATH", default_caps);
        }
    }
    if env::var("PREVAIL_SESSION_CONFIG_PATH").is_err() {
        let default_session = "deploy/config/session.json";
        if std::path::Path::new(default_session).exists() {
            env::set_var("PREVAIL_SESSION_CONFIG_PATH", default_session);
        }
    }

    let session = load_session_config();
    let local_edge_id =
        env::var("PREVAIL_EDGE_ID").unwrap_or_else(|_| session.bootstrap_edge_id.clone());

    tracing::info!(
        edge = %local_edge_id,
        session = %session.session_id,
        run = %session.run_id,
        "starting prevail-runtime"
    );

    let (transport, quic_server, bind_addr) = bind_required_quic(&local_edge_id);
    let runtime = Arc::new(RwLock::new(PrevailRuntime::new_for_edge_with_transport(
        &session.run_id,
        &session.session_id,
        &session.authority_secret,
        &predictor_url,
        &local_edge_id,
        &session.bootstrap_edge_id,
        Arc::new(transport),
    )));

    let handler = Arc::new(MeshControlHandler::new(&local_edge_id, runtime.clone()));
    tokio::spawn(quic_server.serve(handler));
    tracing::info!(edge = %local_edge_id, addr = %bind_addr, "QUIC control plane listening");

    start_grpc_sidecar(&local_edge_id, runtime.clone());
    prevail_runtime::multicast::spawn_listener(runtime.clone());
    spawn_mesh_tick(runtime.clone());
    spawn_authority_rejoin(runtime.clone(), session.bootstrap_edge_id.clone());

    let addr: SocketAddr = format!("{}:{}", host, port).parse().expect("valid listen addr");
    let state = AppState {
        runtime: runtime.clone(),
    };

    if let Err(e) = serve(addr, state).await {
        tracing::error!("server error: {}", e);
        std::process::exit(1);
    }
}

/// QUIC is required for the production edge. Bind or exit — never fall back
/// to the in-memory test transport.
fn bind_required_quic(
    local_edge_id: &str,
) -> (QuicTransport, QuicControlServer, SocketAddr) {
    let address_book = MeshAddressBook::from_env_or_default();
    let Some(advertised) = address_book.address_of(local_edge_id) else {
        tracing::error!(
            edge = %local_edge_id,
            peers = ?address_book.edge_ids(),
            "edge has no QUIC address in PREVAIL_MESH_PEERS; refusing to start"
        );
        std::process::exit(2);
    };
    let bind_addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), advertised.port());
    let server = match QuicControlServer::bind(bind_addr) {
        Ok(server) => server,
        Err(e) => {
            tracing::error!(edge = %local_edge_id, addr = %bind_addr, "QUIC listener bind failed: {e}");
            std::process::exit(2);
        }
    };
    let transport = match QuicTransport::new(local_edge_id, address_book) {
        Ok(transport) => transport,
        Err(e) => {
            tracing::error!(edge = %local_edge_id, "QUIC mesh client failed: {e}");
            std::process::exit(2);
        }
    };
    (transport, server, bind_addr)
}

fn spawn_mesh_tick(runtime: prevail_runtime::SharedRuntime) {
    const TICK: std::time::Duration = std::time::Duration::from_millis(250);

    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(TICK);
        loop {
            ticker.tick().await;

            let (transport, report, events, outbox, intent, holder) = {
                let mut rt = runtime.write().await;
                rt.tick_warm_shadow();
                let outbox = rt.drain_control_outbox();
                let intent = rt.take_flink_intent();
                let holder = rt.authority_holder();
                (
                    rt.transport(),
                    rt.sync_report(),
                    rt.drain_pending_timeline(),
                    outbox,
                    intent,
                    holder,
                )
            };

            if let Some(intent) = intent {
                let rt = runtime.clone();
                tokio::spawn(async move {
                    prevail_runtime::flink_jobs::apply_intent(rt, intent).await;
                });
            }

            let mut sends = Vec::new();
            for (peer, payload) in outbox {
                let ping = matches!(payload, control_envelope::Payload::PeerPing(_));
                let transport = transport.clone();
                let runtime = runtime.clone();
                let holder = holder.clone();
                sends.push(tokio::spawn(async move {
                    match transport.request(&peer, payload).await {
                        Ok(reply) => {
                            match reply.payload {
                                Some(control_envelope::Payload::PeerPong(pong)) => {
                                    runtime.write().await.observe_peer_pong(&pong);
                                }
                                Some(control_envelope::Payload::ShadowCreateAck(ack)) => {
                                    runtime.write().await.apply_shadow_create_ack(&peer, ack);
                                }
                                _ => {
                                    if ping && peer == holder {
                                        runtime.write().await.note_holder_seen();
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            tracing::debug!("control outbox to {peer} failed: {e}");
                        }
                    }
                }));
            }
            for send in sends {
                let _ = send.await;
            }
            if let Some((holder, status)) = report {
                let payload = control_envelope::Payload::ShadowSyncStatus(status);
                if let Err(e) = transport.request(&holder, payload).await {
                    tracing::debug!("sync report to {holder} failed: {e}");
                }
            }
            let obs = prevail_runtime::observability::ObservabilityClient::from_env();
            for event in events {
                obs.push_event(&event).await;
            }
        }
    });
}

fn spawn_authority_rejoin(runtime: prevail_runtime::SharedRuntime, bootstrap: String) {
    tokio::spawn(async move {
        let mut highest: Option<AuthorityToken> = None;
        let mut saw_peer = false;
        for attempt in 0..20 {
            let peers = {
                let rt = runtime.read().await;
                if rt.is_authority_reconciled() {
                    if rt.is_authoritative() {
                        prevail_runtime::flink_jobs::apply_intent(
                            runtime.clone(),
                            prevail_runtime::flink_jobs::FlinkIntent::EnsureAuthority,
                        )
                        .await;
                    }
                    return;
                }
                rt.transport().peers()
            };
            let mut responded = 0u32;
            for peer in peers {
                if let Some(token) = fetch_peer_authority_token(&peer).await {
                    saw_peer = true;
                    responded += 1;
                    if token.epoch > highest.as_ref().map(|h| h.epoch).unwrap_or(0) {
                        highest = Some(token);
                    }
                }
            }
            if let Some(token) = highest.clone() {
                if token.epoch > 0 {
                    let mut rt = runtime.write().await;
                    rt.apply_observed_token(&token);
                    if rt.is_authority_reconciled() {
                        tracing::info!(
                            epoch = token.epoch,
                            holder = %token.holder_edge_id,
                            "rejoin adopted peer authority"
                        );
                        return;
                    }
                }
            }
            if attempt >= 4
                && responded >= 2
                && highest.as_ref().map(|h| h.epoch).unwrap_or(0) == 0
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        }

        if runtime.read().await.is_authority_reconciled() {
            return;
        }
        if let Some(token) = highest.clone() {
            if token.epoch > 0 {
                runtime.write().await.apply_observed_token(&token);
                return;
            }
        }

        let local = runtime.read().await.local_edge_id().to_string();
        runtime.write().await.mark_authority_reconciled();
        if local == bootstrap && runtime.read().await.is_authoritative() {
            prevail_runtime::flink_jobs::apply_intent(
                runtime,
                prevail_runtime::flink_jobs::FlinkIntent::EnsureAuthority,
            )
            .await;
            tracing::info!(edge = %local, "clean-start bootstrap claimed authority after peer survey");
        } else {
            tracing::info!(edge = %local, saw_peer, "rejoin finished as non-authoritative");
        }
    });
}

async fn fetch_peer_authority_token(peer: &str) -> Option<AuthorityToken> {
    let url = peer_http_url(peer);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(800))
        .build()
        .ok()?;
    let body: serde_json::Value = client
        .get(format!("{url}/v1/authority-token"))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    let holder = body.get("holder_edge_id")?.as_str()?.to_string();
    let signature = body.get("signature")?.as_str()?.to_string();
    if holder.is_empty() || signature.is_empty() {
        return None;
    }
    Some(AuthorityToken {
        session_id: body.get("session_id")?.as_str()?.to_string(),
        epoch: body.get("epoch")?.as_u64()?,
        holder_edge_id: holder,
        signature,
    })
}

fn peer_http_url(peer: &str) -> String {
    if let Ok(map) = env::var("PREVAIL_EDGE_HTTP_URLS") {
        for part in map.split(',') {
            if let Some((id, url)) = part.split_once('=') {
                if id.trim() == peer {
                    return url.trim().to_string();
                }
            }
        }
    }
    format!("http://{peer}:8090")
}

fn start_grpc_sidecar(local_edge_id: &str, runtime: prevail_runtime::SharedRuntime) {
    let port: u16 = env::var("PREVAIL_SIDECAR_GRPC_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(50051);
    let host = env::var("PREVAIL_SIDECAR_GRPC_HOST").unwrap_or_else(|_| "0.0.0.0".into());
    let addr = format!("{host}:{port}").parse().expect("grpc addr");
    tracing::info!(edge = %local_edge_id, %addr, "starting gRPC sidecar");
    tokio::spawn(async move {
        if let Err(e) = prevail_runtime::sidecar_grpc::serve_sidecar(addr, runtime).await {
            tracing::error!("gRPC sidecar exited: {e}");
            std::process::exit(3);
        }
    });
}
