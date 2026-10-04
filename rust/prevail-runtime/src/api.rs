use crate::runtime::SharedRuntime;
use crate::types::{ShadowRole, SystemSnapshot, TrafficVehicle, TrajectorySample};
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
        .route("/v1/authority-token", get(authority_token))
        .route("/v1/prediction", get(prediction))
        .route("/v1/shadows", get(shadows))
        .route("/v1/events", get(events))
        .route("/v1/metrics", get(metrics))
        .route("/v1/trajectory", post(ingest_trajectory))
        .route("/v1/session/reset", post(reset_session))
        .route("/v1/test/prediction", post(test_prediction))
        .route("/v1/flink/ingress", get(flink_ingress))
        .route("/v1/flink/restore", get(flink_restore).post(flink_restore_post))
        .route("/v1/traffic", post(update_traffic))
        .route("/v1/sidecar/authority", get(sidecar_authority))
        .route("/v1/sidecar/location", post(sidecar_location))
        .route("/v1/sidecar/promotion", post(sidecar_promotion))
        .route("/v1/sidecar/state", post(sidecar_state).get(sidecar_state_get))
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
    let role = match rt.local_role() {
        ShadowRole::Authoritative => "AUTHORITATIVE",
        ShadowRole::WarmShadow => "WARM_SHADOW",
        ShadowRole::Idle => "IDLE",
    };
    Json(serde_json::json!({
        "edge_id": rt.snapshot().current_edge_id,
        "local_edge_id": rt.local_edge_id(),
        "role": role,
        "authority_holder": rt.snapshot().authority.holder_edge_id,
        "epoch": rt.snapshot().authority.epoch,
        "output_suppressed": rt.output_suppressed(),
        "authority_reconciled": rt.is_authority_reconciled(),
    }))
}

async fn authority_token(State(state): State<AppState>) -> impl IntoResponse {
    let rt = state.runtime.read().await;
    let token = rt.authority_token();
    Json(serde_json::json!({
        "session_id": token.session_id,
        "epoch": token.epoch,
        "holder_edge_id": token.holder_edge_id,
        "signature": token.signature,
        "is_authoritative": rt.is_authoritative(),
        "is_warm_shadow": matches!(rt.local_role(), ShadowRole::WarmShadow),
        "authority_reconciled": rt.is_authority_reconciled(),
        "local_edge_id": rt.local_edge_id(),
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
    let snapshot = rt.snapshot();
    // Probes every peer over QUIC, so it must be awaited before serialising.
    let peer_health = rt.peer_health().await;
    Json(serde_json::json!({
        "transition_count": snapshot.timeline.iter().filter(|e| e.event_type == "AuthorityTransferred").count(),
        "shadow_count": snapshot.shadows.len(),
        "mode": snapshot.mode,
        "transport": rt.transport_kind(),
        "peer_health": peer_health,
    }))
}

async fn reset_session(State(state): State<AppState>) -> impl IntoResponse {
    let mut rt = state.runtime.write().await;
    rt.reset_session();
    Json(rt.snapshot())
}

#[derive(Deserialize)]
struct TestPredictionBody {
    probabilities: std::collections::HashMap<String, f64>,
    eta_sec: Option<f64>,
    requires_image: Option<bool>,
}

async fn test_prediction(
    State(state): State<AppState>,
    Json(body): Json<TestPredictionBody>,
) -> impl IntoResponse {
    let mut rt = state.runtime.write().await;
    rt.apply_test_prediction(
        body.probabilities,
        body.eta_sec.unwrap_or(30.0),
        body.requires_image.unwrap_or(false),
    );
    rt.run_speculation_cycle().await;
    Json(rt.snapshot())
}

async fn ingest_trajectory(
    State(state): State<AppState>,
    Json(sample): Json<TrajectorySample>,
) -> impl IntoResponse {
    let mut rt = state.runtime.write().await;
    rt.on_trajectory(sample).await;
    Json(rt.snapshot())
}

async fn update_traffic(
    State(state): State<AppState>,
    Json(vehicles): Json<Vec<TrafficVehicle>>,
) -> impl IntoResponse {
    let mut rt = state.runtime.write().await;
    rt.update_traffic(vehicles);
    Json(serde_json::json!({ "status": "ok", "count": rt.snapshot().traffic_vehicles.len() }))
}

#[derive(Deserialize)]
struct SidecarQuery {
    session_id: Option<String>,
}

async fn sidecar_location(
    State(state): State<AppState>,
    Json(sample): Json<TrajectorySample>,
) -> impl IntoResponse {
    let mut rt = state.runtime.write().await;
    rt.on_trajectory(sample).await;
    let snap = rt.snapshot();
    Json(serde_json::json!({
        "accepted": true,
        "current_authoritative_edge": snap.authority.holder_edge_id,
    }))
}

#[derive(Deserialize)]
struct PromotionBody {
    session_id: String,
    new_holder_edge_id: String,
    epoch: u64,
}

async fn sidecar_promotion(
    State(state): State<AppState>,
    Json(body): Json<PromotionBody>,
) -> impl IntoResponse {
    let mut rt = state.runtime.write().await;
    rt.on_flink_promotion(&body.session_id, &body.new_holder_edge_id, body.epoch);
    Json(serde_json::json!({ "output_gate_updated": true }))
}

#[derive(Deserialize)]
struct FlinkStateBody {
    session_id: String,
    version: Option<u64>,
    current_edge: Option<String>,
    sample_count: Option<i64>,
    speed_sum: Option<f64>,
}

async fn sidecar_state(
    State(state): State<AppState>,
    Json(body): Json<FlinkStateBody>,
) -> impl IntoResponse {
    let mut rt = state.runtime.write().await;
    let mut keyed = rt.keyed_state().clone();
    keyed.session_id = body.session_id;
    if let Some(v) = body.version {
        keyed.version = v;
    }
    if let Some(edge) = body.current_edge {
        keyed.current_edge = edge;
    }
    if let Some(c) = body.sample_count {
        keyed.sample_count = c;
    }
    if let Some(s) = body.speed_sum {
        keyed.speed_sum = s;
    }
    rt.apply_flink_state(keyed);
    Json(serde_json::json!({ "accepted": true }))
}

async fn sidecar_state_get(State(state): State<AppState>) -> impl IntoResponse {
    let rt = state.runtime.read().await;
    Json(rt.keyed_state().clone())
}

async fn flink_ingress(State(state): State<AppState>) -> impl IntoResponse {
    let mut rt = state.runtime.write().await;
    Json(rt.drain_flink_ingress(64))
}

async fn flink_restore(State(state): State<AppState>) -> impl IntoResponse {
    let rt = state.runtime.read().await;
    Json(rt.flink_restore_state())
}

async fn flink_restore_post(State(state): State<AppState>) -> impl IntoResponse {
    let mut rt = state.runtime.write().await;
    Json(rt.take_pending_flink_restore())
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

/// Streams snapshots to one client.
///
/// Read-only on purpose: advancing simulation state here would make the system
/// run faster the more dashboards were open. Warm-up and reporting are driven
/// by the runtime's own mesh tick.
async fn live_socket(mut socket: WebSocket, state: AppState) {
    loop {
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
