use prevail_runtime::api::{serve, AppState};
use prevail_runtime::config::load_session_config;
use prevail_runtime::runtime::PrevailRuntime;
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
    )));

    let live_sim = env::var("PREVAIL_LIVE_SIM").is_ok() || env::var("PREVAIL_SKIP_DEMO_BOOTSTRAP").is_ok();
    if !live_sim {
        let mut rt = runtime.write().await;
        rt.advance_demo().await;
    }

    let addr: SocketAddr = format!("{}:{}", host, port).parse().expect("valid listen addr");
    let state = AppState {
        runtime: runtime.clone(),
    };

    if let Err(e) = serve(addr, state).await {
        tracing::error!("server error: {}", e);
        std::process::exit(1);
    }
}
