use prevail_runtime::api::{serve, AppState};
use prevail_runtime::config::load_session_config;
use prevail_runtime::mesh::MeshControlHandler;
use prevail_runtime::proto::control_envelope;
use prevail_runtime::quic::{MeshAddressBook, QuicControlServer};
use prevail_runtime::runtime::PrevailRuntime;
use prevail_runtime::transport::QuicTransport;
use std::env;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
        .init();

    let host = env::var("PREVAIL_RUNTIME_HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port: u16 = env::var("PREVAIL_RUNTIME_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8090);
    let predictor_url = env::var("PREVAIL_PREDICTOR_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:8091".into());

    // Default deploy config paths when running from repo root
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

    let runtime = Arc::new(RwLock::new(PrevailRuntime::new_for_edge(
        &session.run_id,
        &session.session_id,
        &session.authority_secret,
        &predictor_url,
        &local_edge_id,
        &session.bootstrap_edge_id,
    )));

    start_control_mesh(&local_edge_id, &runtime).await;

    let live_sim = env::var("PREVAIL_LIVE_SIM").is_ok() || env::var("PREVAIL_SKIP_DEMO_BOOTSTRAP").is_ok();
    if !live_sim {
        let mut rt = runtime.write().await;
        rt.advance_demo().await;
    }

    spawn_mesh_tick(runtime.clone());

    let addr: SocketAddr = format!("{}:{}", host, port).parse().expect("valid listen addr");
    let state = AppState {
        runtime: runtime.clone(),
    };

    if let Err(e) = serve(addr, state).await {
        tracing::error!("server error: {}", e);
        std::process::exit(1);
    }
}

/// Drives warm-shadow catch-up and reports readiness to the authority.
///
/// Owned by the process rather than by a dashboard connection, so progress does
/// not depend on anyone watching.
fn spawn_mesh_tick(runtime: prevail_runtime::SharedRuntime) {
    const TICK: std::time::Duration = std::time::Duration::from_millis(250);

    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(TICK);
        loop {
            ticker.tick().await;

            let (transport, report) = {
                let mut rt = runtime.write().await;
                rt.tick_warm_shadow();
                (rt.transport(), rt.sync_report())
            };

            if let Some((holder, status)) = report {
                let payload = control_envelope::Payload::ShadowSyncStatus(status);
                if let Err(e) = transport.request(&holder, payload).await {
                    tracing::debug!("sync report to {holder} failed: {e}");
                }
            }
        }
    });
}

/// Binds this edge's QUIC listener and attaches the mesh client.
///
/// A failure here is logged as an error and leaves the runtime on its
/// placeholder transport: the HTTP API stays up so the operator can see a
/// degraded mesh rather than losing the process entirely.
async fn start_control_mesh(local_edge_id: &str, runtime: &prevail_runtime::SharedRuntime) {
    let address_book = MeshAddressBook::from_env_or_default();

    let Some(bind_addr) = address_book.address_of(local_edge_id) else {
        tracing::error!(
            edge = %local_edge_id,
            peers = ?address_book.edge_ids(),
            "edge has no QUIC address in the mesh address book; control plane disabled"
        );
        return;
    };

    match QuicControlServer::bind(bind_addr) {
        Ok(server) => {
            tracing::info!(edge = %local_edge_id, addr = %server.local_addr(), "QUIC control plane listening");
            let handler = Arc::new(MeshControlHandler::new(local_edge_id, runtime.clone()));
            tokio::spawn(server.serve(handler));
        }
        Err(e) => {
            tracing::error!(edge = %local_edge_id, addr = %bind_addr, "QUIC listener bind failed: {e}");
            return;
        }
    }

    match QuicTransport::new(local_edge_id, address_book) {
        Ok(transport) => {
            runtime.write().await.attach_transport(Arc::new(transport));
            tracing::info!(edge = %local_edge_id, "mesh client attached");
        }
        Err(e) => {
            tracing::error!(edge = %local_edge_id, "QUIC mesh client failed: {e}");
        }
    }
}
