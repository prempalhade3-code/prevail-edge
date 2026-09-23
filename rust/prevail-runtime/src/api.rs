use crate::runtime::SharedRuntime;
use crate::types::SystemSnapshot;
use axum::{
    extract::{State, ws::{Message, WebSocket, WebSocketUpgrade}, Query},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

#[derive(Clone)]
pub struct AppState {
    pub runtime: SharedRuntime,
}

pub fn build_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/health", get(health))
        .route("/v1/snapshot", get(snapshot))
        .route("/v1/topology", get(topology))
        .route("/v1/current-node", get(current_node))
        .route("/v1/prediction", get(prediction))
        .route("/v1/shadows", get(shadows))
        .route("/v1/events", get(events))
        .route("/v1/metrics", get(metrics))
        .route("/v1/demo/advance", post(advance_demo))
        .route("/v1/sidecar/authority", get(sidecar_authority))
        .route("/ws/live", get(ws_live))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({ "status": "ok", "service": "prevail-runtime" }))
}

async fn snapshot(State(state): State<AppState>) -> Json<SystemSnapshot> {
    let rt = state.runtime.read().await;
    Json(rt.snapshot())
}

async fn topology(State(state): State<AppState>) -> impl IntoResponse {
    let rt = state.runtime.read().await;
    Json(rt.snapshot().topology)
}

async fn current_node(State(state): State<AppState>) -> impl IntoResponse {
    let rt = state.runtime.read().await;
    Json(serde_json::json!({
        "edge_id": rt.snapshot().current_edge_id,
        "role": "AUTHORITATIVE",
        "authority_holder": rt.snapshot().authority.holder_edge_id,
        "epoch": rt.snapshot().authority.epoch,
    }))
}

async fn prediction(State(state): State<AppState>) -> impl IntoResponse {
    let rt = state.runtime.read().await;
    Json(rt.snapshot().prediction)
}

async fn shadows(State(state): State<AppState>) -> impl IntoResponse {
    let rt = state.runtime.read().await;
    Json(rt.snapshot().shadows)
}

async fn events(State(state): State<AppState>) -> impl IntoResponse {
    let rt = state.runtime.read().await;
    Json(rt.snapshot().timeline)
}

async fn metrics(State(state): State<AppState>) -> impl IntoResponse {
    let rt = state.runtime.read().await;
    Json(serde_json::json!({
        "transition_count": rt.snapshot().timeline.iter().filter(|e| e.event_type == "AuthorityTransferred").count(),
        "shadow_count": rt.snapshot().shadows.len(),
        "mode": rt.snapshot().mode,
        "peer_health": rt.peer_health(),
    }))
}

async fn advance_demo(State(state): State<AppState>) -> impl IntoResponse {
    let mut rt = state.runtime.write().await;
    rt.advance_demo().await;
    Json(rt.snapshot())
}

#[derive(Deserialize)]
struct SidecarQuery {
    session_id: Option<String>,
}

async fn sidecar_authority(
    State(state): State<AppState>,
    Query(q): Query<SidecarQuery>,
) -> impl IntoResponse {
    let rt = state.runtime.read().await;
    let (is_auth, holder, epoch) = rt.sidecar_authority();
    Json(serde_json::json!({
        "session_id": q.session_id.unwrap_or_else(|| rt.session_id.clone()),
        "is_authoritative": is_auth,
        "holder_edge_id": holder,
        "epoch": epoch,
        "output_enabled": is_auth,
    }))
}

async fn ws_live(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| live_socket(socket, state))
}

async fn live_socket(mut socket: WebSocket, state: AppState) {
    let mut tick = 0u64;
    loop {
        tick += 1;
        if tick % 5 == 0 {
            let mut rt = state.runtime.write().await;
            rt.tick_shadow_sync();
            if tick == 10 {
                rt.run_speculation_cycle().await;
            }
        }
        let snap = {
            let rt = state.runtime.read().await;
            rt.snapshot()
        };
        let text = serde_json::to_string(&snap).unwrap_or_default();
        if socket.send(Message::Text(text)).await.is_err() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
    }
}

pub async fn serve(addr: SocketAddr, state: AppState) -> Result<(), std::io::Error> {
    let app = build_router(state);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("prevail-runtime listening on {}", addr);
    axum::serve(listener, app).await
}
