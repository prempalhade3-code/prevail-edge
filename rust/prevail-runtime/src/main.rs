use prevail_runtime::api::{serve, AppState};
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

    let runtime = Arc::new(RwLock::new(PrevailRuntime::new_lab(
        "run-demo-1",
        "session-vehicle-1",
        "lab-secret",
        &predictor_url,
    )));

    {
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
