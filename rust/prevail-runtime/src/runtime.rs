use crate::authority::AuthorityManager;
use crate::config::{load_capabilities_from_file, load_topology_from_file, resolve_config_paths};
use crate::flink_jobs::FlinkIntent;
use crate::flink_state::{checkpoint_dir, KeyedWorkloadState};
use crate::predictor::PredictorClient;
use crate::proto::{self, control_envelope};
use crate::regions::{load_regions, map_edge_id, Region};
use crate::resources::apply_live_resources;
use crate::resources::ResourceSnapshot;
use crate::sample_codec::{has_image_payload, sample_from_proto, sample_to_proto};
use crate::shadow::{ShadowError, ShadowManager};
use crate::speculation::evaluate_speculation;
use crate::transport::{ControlTransport, InMemoryTransport};
use crate::types::{
    AuthorityToken, EdgeCapability, PredictionResult, ShadowRole, SpeculationConfig,
    SystemSnapshot, TimelineEvent, TopologyNode, TrajectorySample,
};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

pub struct PrevailRuntime {
    pub run_id: String,
    pub session_id: String,
    /// Fixed identity of this edge process.
    local_edge_id: String,
    bootstrap_edge_id: String,
    /// Edge the vehicle is currently in.
    pub edge_id: String,
    authority: AuthorityManager,
    shadows: ShadowManager,
    config: SpeculationConfig,
    capabilities: HashMap<String, EdgeCapability>,
    topology_coords: HashMap<String, (f64, f64)>,
    prediction: Option<PredictionResult>,
    timeline: Vec<TimelineEvent>,
    mode: String,
    transport: Arc<dyn ControlTransport>,
    predictor_url: String,
    demo_step: usize,
    vehicle_latitude: Option<f64>,
    vehicle_longitude: Option<f64>,
    vehicle_heading: Option<f64>,
    vehicle_speed_mps: Option<f64>,
    vehicle_updated_ms: Option<i64>,
    /// True when this process is holding a warm shadow for the session.
    is_warm_shadow: bool,
    /// Readiness this process reports as a shadow, measured locally.
    local_sync_ratio: f64,
    /// Records this shadow still has to apply to catch up with the authority.
    sync_lag_records: i64,
    /// Monotonic sequence for records produced at the authoritative edge.
    stream_sequence: u64,
    /// Records applied at this shadow (ADR-003 numerator).
    stream_applied: u64,
    /// Highest sequence number this shadow has observed from the authority.
    stream_latest_sequence: u64,
    vehicle_trail: Vec<crate::types::VehicleTrailPoint>,
    traffic_vehicles: Vec<crate::types::TrafficVehicle>,
    predictor_degraded: bool,
    trajectory_ticks: u64,
    last_sync_emit: HashMap<String, f64>,
    last_handoff_at_ms: Option<i64>,
    keyed_state: KeyedWorkloadState,
    last_peer_seen: HashMap<String, i64>,
    last_holder_seen_ms: i64,
    authority_reconciled: bool,
    peer_warm_shadows: HashSet<String>,
    last_reconcile_ping_ms: i64,
    pending_timeline: Vec<TimelineEvent>,
    shadow_last_report: HashMap<String, i64>,
    flink_ingress: VecDeque<TrajectorySample>,
    pending_flink_restore: Option<KeyedWorkloadState>,
    flink_intent: Option<FlinkIntent>,
    flink_job_id: Option<String>,
    flink_checkpoint_restored: bool,
    last_requires_image: bool,
    regions: Vec<Region>,
    tee_bytes: u64,
    last_resource_emit_ms: i64,
}

impl PrevailRuntime {
    pub fn new_lab(run_id: &str, session_id: &str, secret: &str, predictor_url: &str) -> Self {
        Self::new_for_edge(run_id, session_id, secret, predictor_url, "edge-a", "edge-a")
    }

    /// Test constructor. Production edges must use [`Self::new_for_edge_with_transport`]
    /// with a live QUIC transport — InMemory is isolated to unit tests.
    pub fn new_for_edge(
        run_id: &str,
        session_id: &str,
        secret: &str,
        predictor_url: &str,
        local_edge_id: &str,
        bootstrap_edge_id: &str,
    ) -> Self {
        let peers: Vec<String> = ["edge-a", "edge-b", "edge-c", "edge-d"]
            .into_iter()
            .filter(|id| *id != local_edge_id)
            .map(str::to_string)
            .collect();
        let mut rt = Self::new_for_edge_with_transport(
            run_id,
            session_id,
            secret,
            predictor_url,
            local_edge_id,
            bootstrap_edge_id,
            Arc::new(InMemoryTransport::new(local_edge_id, peers)),
        );
        // Isolated unit tests do not run peer rejoin; they start already reconciled.
        rt.authority_reconciled = true;
        rt
    }

    /// Builds a runtime that identifies as `local_edge_id` on the given control plane.
    pub fn new_for_edge_with_transport(
        run_id: &str,
        session_id: &str,
        secret: &str,
        predictor_url: &str,
        local_edge_id: &str,
        bootstrap_edge_id: &str,
        transport: Arc<dyn ControlTransport>,
    ) -> Self {
        let (regions_path, caps_path) = resolve_config_paths();
        let capabilities = caps_path
            .as_deref()
            .and_then(load_capabilities_from_file)
            .unwrap_or_else(default_capabilities);
        let topology_coords = regions_path
            .as_deref()
            .and_then(load_topology_from_file)
            .unwrap_or_else(default_topology);
        let regions = regions_path
            .as_deref()
            .and_then(load_regions)
            .unwrap_or_default();
        Self {
            run_id: run_id.to_string(),
            session_id: session_id.to_string(),
            local_edge_id: local_edge_id.to_string(),
            bootstrap_edge_id: bootstrap_edge_id.to_string(),
            edge_id: bootstrap_edge_id.to_string(),
            authority: AuthorityManager::new(session_id, bootstrap_edge_id, secret),
            shadows: ShadowManager::default(),
            config: SpeculationConfig::default(),
            capabilities,
            topology_coords,
            prediction: None,
            timeline: Vec::new(),
            mode: SpeculationConfig::default().mode,
            transport,
            predictor_url: predictor_url.to_string(),
            demo_step: 0,
            vehicle_latitude: None,
            vehicle_longitude: None,
            vehicle_heading: None,
            vehicle_speed_mps: None,
            vehicle_updated_ms: None,
            is_warm_shadow: false,
            local_sync_ratio: 0.0,
            sync_lag_records: 0,
            stream_sequence: 0,
            stream_applied: 0,
            stream_latest_sequence: 0,
            vehicle_trail: Vec::new(),
            traffic_vehicles: Vec::new(),
            predictor_degraded: false,
            trajectory_ticks: 0,
            last_sync_emit: HashMap::new(),
            last_handoff_at_ms: None,
            keyed_state: KeyedWorkloadState::new(session_id),
            last_peer_seen: HashMap::new(),
            last_holder_seen_ms: now_ms(),
            authority_reconciled: false,
            peer_warm_shadows: HashSet::new(),
            last_reconcile_ping_ms: 0,
            pending_timeline: Vec::new(),
            shadow_last_report: HashMap::new(),
            flink_ingress: VecDeque::new(),
            pending_flink_restore: None,
            flink_intent: None,
            flink_job_id: None,
            flink_checkpoint_restored: false,
            last_requires_image: false,
            regions,
            tee_bytes: 0,
            last_resource_emit_ms: 0,
        }
    }

    /// Returns every edge to bootstrap authority / empty shadows / no pose.
    pub fn reset_session(&mut self) {
        if self.is_warm_shadow {
            self.flink_intent = Some(FlinkIntent::Cancel);
        }
        let bootstrap = self.bootstrap_edge_id.clone();
        self.authority.reset(&bootstrap);
        self.shadows = ShadowManager::default();
        self.is_warm_shadow = false;
        self.local_sync_ratio = 0.0;
        self.sync_lag_records = 0;
        self.stream_sequence = 0;
        self.stream_applied = 0;
        self.stream_latest_sequence = 0;
        self.prediction = None;
        self.vehicle_latitude = None;
        self.vehicle_longitude = None;
        self.vehicle_heading = None;
        self.vehicle_speed_mps = None;
        self.vehicle_updated_ms = None;
        self.vehicle_trail.clear();
        self.traffic_vehicles.clear();
        self.trajectory_ticks = 0;
        self.last_sync_emit.clear();
        self.shadow_last_report.clear();
        self.flink_ingress.clear();
        self.pending_flink_restore = None;
        self.flink_checkpoint_restored = false;
        self.tee_bytes = 0;
        self.edge_id = bootstrap.clone();
        self.timeline.clear();
        self.pending_timeline.clear();
        self.authority_reconciled = true;
        self.peer_warm_shadows.clear();
        if self.local_edge_id == bootstrap {
            self.flink_intent = Some(FlinkIntent::EnsureAuthority);
        }
        self.emit(
            "SessionReset",
            Some(&bootstrap),
            "Session reset to bootstrap authority",
            HashMap::new(),
        );
    }

    pub fn local_edge_id(&self) -> &str {
        &self.local_edge_id
    }

    pub fn authority_holder(&self) -> String {
        if !self.authority_reconciled && self.authority.holder() == self.local_edge_id {
            return String::new();
        }
        self.authority.holder().to_string()
    }

    pub fn authority_token(&self) -> AuthorityToken {
        self.authority.token().clone()
    }

    pub fn is_authority_reconciled(&self) -> bool {
        self.authority_reconciled
    }

    pub fn mark_authority_reconciled(&mut self) {
        if self.authority_reconciled {
            return;
        }
        self.authority_reconciled = true;
        self.emit(
            "AuthorityReconciled",
            Some(&self.local_edge_id.clone()),
            "Adopted the highest valid peer authority state",
            HashMap::from([
                ("holder".into(), self.authority.holder().to_string()),
                ("epoch".into(), self.authority.epoch().to_string()),
            ]),
        );
    }

    pub fn apply_observed_token(&mut self, token: &AuthorityToken) -> bool {
        if token.holder_edge_id.is_empty() || token.signature.is_empty() {
            return false;
        }
        match self.authority.adopt_observed(token) {
            Ok(changed) => {
                if token.epoch > 0 {
                    self.mark_authority_reconciled();
                }
                if changed {
                    self.last_holder_seen_ms = now_ms();
                    if self.authority.holder() == self.local_edge_id {
                        self.is_warm_shadow = false;
                        self.local_sync_ratio = 1.0;
                    } else {
                        self.is_warm_shadow = false;
                        self.local_sync_ratio = 0.0;
                        self.emit(
                            "AuthorityRejoinAdopted",
                            Some(&self.local_edge_id.clone()),
                            "Adopted peer authority during rejoin",
                            HashMap::from([
                                ("holder".into(), token.holder_edge_id.clone()),
                                ("epoch".into(), token.epoch.to_string()),
                            ]),
                        );
                    }
                }
                changed
            }
            Err(_) => false,
        }
    }

    pub fn observe_peer_pong(&mut self, pong: &proto::PeerPong) {
        if pong.edge_id.is_empty() {
            return;
        }
        self.last_peer_seen.insert(pong.edge_id.clone(), now_ms());
        if pong.is_warm_shadow {
            self.peer_warm_shadows.insert(pong.edge_id.clone());
        } else {
            self.peer_warm_shadows.remove(&pong.edge_id);
        }
        if !pong.holder_edge_id.is_empty() && !pong.signature.is_empty() {
            let token = AuthorityToken {
                session_id: pong.session_id.clone(),
                epoch: pong.epoch,
                holder_edge_id: pong.holder_edge_id.clone(),
                signature: pong.signature.clone(),
            };
            self.apply_observed_token(&token);
            if pong.is_authoritative && pong.edge_id == pong.holder_edge_id {
                self.last_holder_seen_ms = now_ms();
            }
        }
    }

    pub fn apply_test_prediction(
        &mut self,
        probabilities: HashMap<String, f64>,
        eta_sec: f64,
        requires_image: bool,
    ) {
        self.last_requires_image = requires_image;
        self.predictor_degraded = false;
        self.prediction = Some(PredictionResult {
            session_id: self.session_id.clone(),
            model_version: "live-scenario".into(),
            probabilities,
            eta_sec: Some(eta_sec),
            computed_at_ms: now_ms(),
        });
        self.emit(
            "PredictionUpdated",
            None,
            "Scenario prediction applied for deterministic capability/shadow checks",
            HashMap::from([(
                "requires_image".into(),
                requires_image.to_string(),
            )]),
        );
    }

    pub fn take_flink_intent(&mut self) -> Option<FlinkIntent> {
        self.flink_intent.take()
    }

    pub fn record_flink_job(&mut self, job_id: &str, savepoint: &str) {
        self.flink_job_id = Some(job_id.to_string());
        if !savepoint.is_empty() {
            self.flink_checkpoint_restored = true;
            if self.is_warm_shadow {
                self.local_sync_ratio = self.local_sync_ratio.max(0.95);
            }
        }
        self.emit(
            "ShadowFlinkStarted",
            Some(&self.local_edge_id.clone()),
            "Flink job submitted for this edge",
            HashMap::from([
                ("job_id".into(), job_id.to_string()),
                ("savepoint".into(), savepoint.to_string()),
                (
                    "checkpoint_restored".into(),
                    self.flink_checkpoint_restored.to_string(),
                ),
            ]),
        );
    }

    pub fn record_flink_cancelled(&mut self) {
        if let Some(id) = self.flink_job_id.take() {
            self.emit(
                "ShadowFlinkStopped",
                Some(&self.local_edge_id.clone()),
                "Flink job cancelled",
                HashMap::from([("job_id".into(), id)]),
            );
        }
    }

    pub fn note_holder_seen(&mut self) {
        self.last_holder_seen_ms = now_ms();
    }

    /// Replaces the control-plane transport after construction.
    ///
    /// Production `main` constructs the runtime with QUIC already attached.
    /// Tests may swap transports; a live process must never fall back to
    /// [`InMemoryTransport`].
    pub fn attach_transport(&mut self, transport: Arc<dyn ControlTransport>) {
        self.emit(
            "MeshAttached",
            Some(&self.local_edge_id.clone()),
            &format!("control plane: {}", transport.kind()),
            HashMap::from([
                ("transport".to_string(), transport.kind().to_string()),
                ("peers".to_string(), transport.peers().join(",")),
            ]),
        );
        self.transport = transport;
    }

    /// Transport in use, surfaced so the dashboard can distinguish a real mesh
    /// from the test placeholder.
    pub fn transport_kind(&self) -> &'static str {
        self.transport.kind()
    }

    pub fn update_traffic(&mut self, vehicles: Vec<crate::types::TrafficVehicle>) {
        self.traffic_vehicles = vehicles;
    }

    fn emit(&mut self, event_type: &str, edge_id: Option<&str>, message: &str, payload: HashMap<String, String>) {
        let ts = now_ms();
        let event = TimelineEvent {
            run_id: self.run_id.clone(),
            timestamp_ms: ts,
            event_type: event_type.to_string(),
            edge_id: edge_id.map(str::to_string),
            message: message.to_string(),
            payload,
        };
        self.timeline.push(event.clone());
        self.pending_timeline.push(event);
    }

    pub fn drain_pending_timeline(&mut self) -> Vec<TimelineEvent> {
        std::mem::take(&mut self.pending_timeline)
    }

    pub fn apply_flink_state(&mut self, state: KeyedWorkloadState) {
        self.keyed_state = state;
    }

    fn enqueue_flink_sample(&mut self, sample: TrajectorySample) {
        const MAX: usize = 4096;
        self.flink_ingress.push_back(sample);
        while self.flink_ingress.len() > MAX {
            self.flink_ingress.pop_front();
        }
    }

    pub fn drain_flink_ingress(&mut self, limit: usize) -> Vec<TrajectorySample> {
        let n = limit.min(self.flink_ingress.len()).max(0);
        self.flink_ingress.drain(..n).collect()
    }

    pub fn take_pending_flink_restore(&mut self) -> Option<KeyedWorkloadState> {
        self.pending_flink_restore.take()
    }

    pub fn flink_restore_state(&self) -> KeyedWorkloadState {
        self.pending_flink_restore
            .clone()
            .unwrap_or_else(|| self.keyed_state.clone())
    }

    pub fn keyed_state(&self) -> &KeyedWorkloadState {
        &self.keyed_state
    }

    pub fn on_flink_promotion(&mut self, _session_id: &str, holder: &str, epoch: u64) {
        self.emit(
            "FlinkOutputGateUpdated",
            Some(holder),
            "Sidecar OnPromotion applied",
            HashMap::from([("epoch".into(), epoch.to_string())]),
        );
    }

    pub async fn refresh_prediction(&mut self) {
        let client = PredictorClient::new(&self.predictor_url);
        let (pred, outcome) = client.predict(&self.session_id, &self.edge_id).await;
        self.predictor_degraded = outcome == crate::predictor::PredictOutcome::Degraded;
        self.prediction = Some(pred.clone());
        let event = if self.predictor_degraded {
            "PredictionDegraded"
        } else {
            "PredictionIssued"
        };
        self.emit(
            event,
            None,
            if self.predictor_degraded {
                "Predictor unavailable — uniform fallback surfaced"
            } else {
                "Next-edge prediction updated"
            },
            {
                let mut payload = pred
                    .probabilities
                    .iter()
                    .map(|(k, v)| (k.clone(), format!("{:.2}", v)))
                    .collect::<HashMap<String, String>>();
                if let Some(eta) = pred.eta_sec {
                    payload.insert("eta_sec".into(), format!("{eta:.3}"));
                }
                payload
            },
        );
    }

    pub async fn on_trajectory(&mut self, mut sample: TrajectorySample) {
        if !self.regions.is_empty() {
            sample.edge_id = map_edge_id(sample.latitude, sample.longitude, &self.regions);
        }
        self.last_requires_image = has_image_payload(&sample);
        self.enqueue_flink_sample(sample.clone());
        if !self.is_authoritative() {
            let holder = self.authority.holder().to_string();
            if holder != self.local_edge_id {
                let proto_sample = sample_to_proto(&sample);
                let payload = control_envelope::Payload::StateReplicate(proto::StateReplicate {
                    session_id: self.session_id.clone(),
                    sequence: self.stream_sequence.saturating_add(1),
                    sample: Some(proto_sample),
                });
                if let Err(e) = self.transport.request(&holder, payload).await {
                    tracing::debug!("forward trajectory to holder {holder} failed: {e}");
                }
            }
            self.edge_id = sample.edge_id;
            self.vehicle_latitude = Some(sample.latitude);
            self.vehicle_longitude = Some(sample.longitude);
            self.vehicle_heading = sample.heading_deg;
            self.vehicle_speed_mps = Some(sample.speed_mps);
            self.vehicle_updated_ms = Some(now_ms());
            return;
        }
        if self.is_authoritative() {
            self.stream_sequence += 1;
            self.trajectory_ticks += 1;
            self.keyed_state.apply_sample(&sample);
            let client = PredictorClient::new(&self.predictor_url);
            client.post_trajectory(&sample).await;
            self.replicate_to_shadows(&sample, self.stream_sequence).await;
            if self.stream_sequence % 4 == 0 {
                self.align_shadow_state().await;
            }

            // Continuous speculation while authoritative — shadows must be warm
            // BEFORE the vehicle crosses the next edge boundary.
            if self.prediction.is_none() || self.trajectory_ticks % 8 == 1 {
                self.refresh_prediction().await;
            }
            if self.prediction.is_some() {
                self.run_speculation_cycle().await;
            }
        }

        let edge_changed = sample.edge_id != self.edge_id;
        if edge_changed {
            let started = now_ms();
            self.last_handoff_at_ms = Some(started);
            let mut payload = HashMap::new();
            payload.insert("from_edge".into(), self.edge_id.clone());
            payload.insert("to_edge".into(), sample.edge_id.clone());
            payload.insert("started_at_ms".into(), started.to_string());
            self.emit(
                "HandoffDetected",
                Some(&sample.edge_id),
                "Vehicle crossed edge boundary",
                payload,
            );
            self.score_live_prediction(&sample.edge_id);
            if self.is_authoritative() {
                self.handle_handoff(&sample.edge_id).await;
            }
        }
        self.edge_id = sample.edge_id;
        self.vehicle_latitude = Some(sample.latitude);
        self.vehicle_longitude = Some(sample.longitude);
        self.vehicle_heading = sample.heading_deg;
        self.vehicle_speed_mps = Some(sample.speed_mps);
        self.vehicle_updated_ms = Some(now_ms());
        self.vehicle_trail.push(crate::types::VehicleTrailPoint {
            latitude: sample.latitude,
            longitude: sample.longitude,
        });
        if self.vehicle_trail.len() > 120 {
            let drain = self.vehicle_trail.len() - 120;
            self.vehicle_trail.drain(0..drain);
        }
    }

    fn score_live_prediction(&mut self, actual: &str) {
        let Some(pred) = self.prediction.clone() else {
            return;
        };
        let mut ranked: Vec<(String, f64)> = pred
            .probabilities
            .iter()
            .filter(|(id, _)| id.as_str() != self.edge_id)
            .map(|(id, p)| (id.clone(), *p))
            .collect();
        ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        let top1 = ranked.first().map(|(id, _)| id.clone()).unwrap_or_default();
        let top2 = ranked.get(1).map(|(id, _)| id.clone()).unwrap_or_default();
        let top1_hit = top1 == actual;
        let top2_hit = top1_hit || top2 == actual;
        self.emit(
            "PredictionScored",
            Some(actual),
            "Live handoff scored against GRU top-k",
            HashMap::from([
                ("prediction_top1".into(), top1),
                ("prediction_top2".into(), top2),
                ("actual_edge".into(), actual.to_string()),
                ("top1_hit".into(), top1_hit.to_string()),
                ("top2_hit".into(), top2_hit.to_string()),
            ]),
        );
    }

    fn top_predicted_edge(&self) -> Option<String> {
        let pred = self.prediction.as_ref()?;
        pred.probabilities
            .iter()
            .filter(|(id, _)| id.as_str() != self.edge_id)
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(id, _)| id.clone())
    }

    async fn release_shadow(&mut self, target: &str, reason: &str) {
        let payload = control_envelope::Payload::ShadowRelease(proto::ShadowRelease {
            session_id: self.session_id.clone(),
            target_edge_id: target.to_string(),
            reason: reason.to_string(),
        });
        let _ = self.transport.request(target, payload).await;
        let _ = self.shadows.discard(target);
        self.emit(
            "ShadowReleased",
            Some(target),
            reason,
            HashMap::from([("reason".to_string(), reason.to_string())]),
        );
    }

    async fn handle_handoff(&mut self, new_edge: &str) {
        // Only the current holder can hand authority on.
        if !self.is_authoritative() {
            return;
        }
        if new_edge == self.local_edge_id {
            return;
        }

        let predicted = self.top_predicted_edge();
        let prediction_correct = predicted.as_deref() == Some(new_edge);
        if let Some(pred) = predicted.clone() {
            if !prediction_correct {
                self.emit(
                    "WrongPrediction",
                    Some(new_edge),
                    "Predicted edge did not match arrival",
                    HashMap::from([
                        ("predicted".to_string(), pred.clone()),
                        ("actual".to_string(), new_edge.to_string()),
                    ]),
                );
                if pred != new_edge {
                    self.release_shadow(&pred, "wrong prediction discarded").await;
                }
            }
        }

        let threshold = self.config.promotion_sync_threshold;
        let warm_ready = self.shadows.ready_for_promotion(new_edge, threshold).is_ok()
            && self.config.mode == "prevail";
        if warm_ready {
            if self.two_phase_promote(new_edge).await {
                return;
            }
            // Shadow is genuinely ready — never drop to reactive on a flaky ACK.
            self.emit(
                "WarmPromotionForced",
                Some(new_edge),
                "Shadow ready at threshold; completing warm transfer",
                HashMap::from([("sync_threshold".into(), threshold.to_string())]),
            );
            if self.transfer_authority_to(new_edge, "warm shadow promotion").await {
                let _ = self.send_demotion_notices().await;
            }
            return;
        }

        if self.shadows.list().iter().any(|s| s.edge_id == new_edge) {
            let _ = self.shadows.discard(new_edge);
            self.emit(
                "ShadowDiscarded",
                Some(new_edge),
                "Shadow discarded; sync not ready",
                HashMap::new(),
            );
        }

        self.reactive_migrate(new_edge, "no warm shadow ready").await;
    }

    async fn two_phase_promote(&mut self, new_edge: &str) -> bool {
        let request = proto::PromotionRequest {
            session_id: self.session_id.clone(),
            from_edge_id: self.local_edge_id.clone(),
            to_edge_id: new_edge.to_string(),
            expected_epoch: self.authority.epoch(),
        };
        match self
            .transport
            .request(
                new_edge,
                control_envelope::Payload::PromotionRequest(request),
            )
            .await
        {
            Ok(envelope) => match envelope.payload {
                Some(control_envelope::Payload::PromotionAck(ack)) if ack.accepted => {
                    self.emit(
                        "PromotionAck",
                        Some(new_edge),
                        "Target accepted two-phase promotion",
                        HashMap::from([("epoch".into(), ack.new_epoch.to_string())]),
                    );
                    self.transfer_authority_to(new_edge, "warm shadow promotion")
                        .await
                        && self.send_demotion_notices().await
                }
                Some(control_envelope::Payload::PromotionAck(ack)) => {
                    self.emit(
                        "PromotionAck",
                        Some(new_edge),
                        "Target refused promotion",
                        HashMap::from([("message".into(), ack.message)]),
                    );
                    false
                }
                _ => false,
            },
            Err(_) => false,
        }
    }

    async fn send_demotion_notices(&mut self) -> bool {
        let notice = proto::DemotionNotice {
            session_id: self.session_id.clone(),
            edge_id: self.local_edge_id.clone(),
            epoch: self.authority.epoch(),
        };
        for peer in self.transport.peers() {
            let _ = self
                .transport
                .request(
                    &peer,
                    control_envelope::Payload::DemotionNotice(notice.clone()),
                )
                .await;
        }
        true
    }

    async fn reactive_migrate(&mut self, new_edge: &str, reason: &str) {
        let start = proto::MigrationFallbackStart {
            session_id: self.session_id.clone(),
            from_edge_id: self.local_edge_id.clone(),
            to_edge_id: new_edge.to_string(),
            reason: reason.to_string(),
        };
        let _ = self
            .transport
            .request(
                new_edge,
                control_envelope::Payload::MigrationFallbackStart(start),
            )
            .await;
        self.emit(
            "MigrationFallback",
            Some(new_edge),
            &format!("Reactive migration fallback: {reason}"),
            HashMap::from([("reason".into(), reason.to_string())]),
        );

        let _ = self.keyed_state.write_checkpoint(&checkpoint_dir());
        let transfer = proto::CheckpointTransfer {
            session_id: self.session_id.clone(),
            from_edge_id: self.local_edge_id.clone(),
            to_edge_id: new_edge.to_string(),
            state: Some(self.keyed_state.to_proto()),
        };
        let restore_ms = match self
            .transport
            .request(
                new_edge,
                control_envelope::Payload::CheckpointTransfer(transfer),
            )
            .await
        {
            Ok(envelope) => match envelope.payload {
                Some(control_envelope::Payload::CheckpointAck(ack)) => ack.restore_ms,
                _ => 0,
            },
            Err(_) => 0,
        };

        self.transfer_authority_to(new_edge, "reactive migration")
            .await;
        let complete = proto::MigrationFallbackComplete {
            session_id: self.session_id.clone(),
            to_edge_id: new_edge.to_string(),
            latency_ms: restore_ms,
        };
        let _ = self
            .transport
            .request(
                new_edge,
                control_envelope::Payload::MigrationFallbackComplete(complete),
            )
            .await;
        self.emit(
            "MigrationFallbackComplete",
            Some(new_edge),
            "Checkpoint restore finished",
            HashMap::from([("restore_ms".into(), restore_ms.to_string())]),
        );
    }

    /// Mints the next authority token and publishes it to the whole mesh.
    ///
    /// The token is broadcast to every peer, not just the new holder, so an
    /// edge that was idle cannot keep serving a stale view of who is
    /// authoritative. Returns whether the new holder accepted.
    async fn transfer_authority_to(&mut self, new_edge: &str, reason: &str) -> bool {
        let from = self.authority.holder().to_string();
        let token = match self.authority.promote(new_edge, &from) {
            Ok(t) => t,
            Err(e) => {
                self.emit(
                    "AuthorityTransferFailed",
                    Some(new_edge),
                    &format!("could not mint token: {e}"),
                    HashMap::new(),
                );
                return false;
            }
        };

        let proto_token = proto::AuthorityToken {
            session_id: token.session_id.clone(),
            epoch: token.epoch,
            holder_edge_id: token.holder_edge_id.clone(),
            signature: token.signature.clone(),
        };

        let mut accepted_by_new_holder = false;
        for peer in self.transport.peers() {
            let payload = control_envelope::Payload::AuthorityTransfer(proto::AuthorityTransfer {
                token: Some(proto_token.clone()),
                previous_holder_edge_id: from.clone(),
            });
            match self.transport.request(&peer, payload).await {
                Ok(envelope) => match envelope.payload {
                    Some(control_envelope::Payload::PromotionAck(ack)) => {
                        if peer == new_edge {
                            accepted_by_new_holder = ack.accepted;
                        }
                        if !ack.accepted {
                            self.emit(
                                "AuthorityTransferRejected",
                                Some(&peer),
                                &format!("peer rejected transfer: {}", ack.message),
                                HashMap::new(),
                            );
                        }
                    }
                    other => self.emit(
                        "AuthorityTransferRejected",
                        Some(&peer),
                        "unexpected reply to authority transfer",
                        HashMap::from([("reply".to_string(), format!("{other:?}"))]),
                    ),
                },
                Err(e) => self.emit(
                    "AuthorityTransferRejected",
                    Some(&peer),
                    "peer unreachable for authority transfer",
                    HashMap::from([("error".to_string(), e.to_string())]),
                ),
            }
        }

        // Send outbound ShadowRelease to any remaining shadows that were not promoted
        for shadow in self.shadows.list() {
            if shadow.edge_id != new_edge {
                let release_payload = control_envelope::Payload::ShadowRelease(proto::ShadowRelease {
                    session_id: self.session_id.clone(),
                    target_edge_id: shadow.edge_id.clone(),
                    reason: "released post-promotion".to_string(),
                });
                let _ = self.transport.request(&shadow.edge_id, release_payload).await;
            }
        }

        self.shadows.promote_shadow_to_authoritative(new_edge);
        self.shadows.clear();
        self.is_warm_shadow = false;
        self.local_sync_ratio = 0.0;

        let finished = now_ms();
        let latency_ms = self
            .last_handoff_at_ms
            .map(|start| finished.saturating_sub(start))
            .unwrap_or(0);
        let transfer_mode = if reason.contains("warm") {
            "warm"
        } else {
            "reactive"
        };
        self.emit(
            "AuthorityTransferred",
            Some(new_edge),
            &format!("Authority transferred via {reason}"),
            HashMap::from([
                ("from".to_string(), from.clone()),
                ("to".to_string(), new_edge.to_string()),
                ("epoch".to_string(), token.epoch.to_string()),
                ("accepted".to_string(), accepted_by_new_holder.to_string()),
                ("latency_ms".to_string(), latency_ms.to_string()),
                ("transfer_mode".to_string(), transfer_mode.to_string()),
                ("reason".to_string(), reason.to_string()),
            ]),
        );
        self.emit(
            "EdgeDemoted",
            Some(&from),
            "Previous authoritative edge demoted",
            HashMap::new(),
        );

        accepted_by_new_holder
    }

    pub async fn run_speculation_cycle(&mut self) {
        // Only the authoritative edge may prepare shadows; a shadow that
        // speculated onward could create a second writer for the session.
        if !self.is_authoritative() {
            return;
        }
        let enabled = std::env::var("PREVAIL_SPECULATION_ENABLED")
            .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
            .unwrap_or(true);
        if !enabled {
            return;
        }

        if self.predictor_degraded {
            self.emit(
                "SpeculationSkipped",
                None,
                "predictor unavailable — skip speculation",
                HashMap::new(),
            );
            return;
        }
        if !self.config.speculation_enabled || self.config.mode != "prevail" {
            self.emit(
                "SpeculationSkipped",
                None,
                "speculation disabled by feature flag",
                HashMap::new(),
            );
            return;
        }

        let pred = match &self.prediction {
            Some(p) => p.clone(),
            None => {
                self.emit(
                    "SpeculationSkipped",
                    None,
                    "no prediction available",
                    HashMap::new(),
                );
                return;
            }
        };
        let mut cfg = self.config.clone();
        if self.last_requires_image {
            cfg.require_image_capability = true;
            cfg.capability_check_enabled = true;
            let mut ranked: Vec<(String, f64)> = pred
                .probabilities
                .iter()
                .filter(|(id, _)| id.as_str() != self.edge_id)
                .map(|(id, p)| (id.clone(), *p))
                .collect();
            ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            for (edge_id, prob) in ranked {
                if prob < cfg.min_confidence {
                    continue;
                }
                let supports_image = self
                    .capabilities
                    .get(&edge_id)
                    .map(|c| c.supports_image)
                    .unwrap_or(true);
                if !supports_image {
                    self.emit(
                        "ImageCapabilityDenied",
                        Some(&edge_id),
                        "Predicted edge cannot process image workload; choosing next valid edge",
                        HashMap::from([
                            ("workload".into(), "image".into()),
                            ("predicted".into(), edge_id.clone()),
                            ("confidence".into(), format!("{prob:.4}")),
                        ]),
                    );
                }
            }
        }
        let decision = evaluate_speculation(&pred, &self.edge_id, &self.capabilities, &cfg);
        let proto_decision = proto::SpeculationDecision {
            session_id: self.session_id.clone(),
            should_speculate: decision.should_speculate,
            target_edge_ids: decision.target_edge_ids.clone(),
            reason: decision.reason.clone(),
        };
        for peer in self.transport.peers() {
            let _ = self
                .transport
                .request(
                    &peer,
                    control_envelope::Payload::SpeculationDecision(proto_decision.clone()),
                )
                .await;
        }
        if !decision.should_speculate {
            self.emit("SpeculationSkipped", None, &decision.reason, HashMap::new());
            return;
        }

        for target in decision.target_edge_ids.clone() {
            if self.shadows.list().iter().any(|s| s.edge_id == target) {
                continue;
            }
            self.request_shadow_on(&target).await;
        }
    }

    /// Asks `target` to spin up a warm shadow for this session.
    ///
    /// The shadow is only recorded locally once the peer acknowledges, so the
    /// authority never counts a shadow that does not exist.
    async fn request_shadow_on(&mut self, target: &str) {
        if target == self.local_edge_id || target == self.authority.holder() {
            return;
        }
        let savepoint = crate::flink_jobs::wait_for_savepoint(
            &self.local_edge_id,
            Duration::from_secs(2),
        )
        .await
        .unwrap_or_default();
        if savepoint.is_empty() {
            self.emit(
                "ShadowRefused",
                Some(target),
                "No Flink checkpoint available yet; will retry",
                HashMap::new(),
            );
            return;
        }
        let payload = control_envelope::Payload::ShadowCreate(proto::ShadowCreate {
            session_id: self.session_id.clone(),
            source_edge_id: self.local_edge_id.clone(),
            target_edge_id: target.to_string(),
            requested_at_ms: now_ms(),
            savepoint_path: savepoint,
        });

        match self.transport.request(target, payload).await {
            Ok(envelope) => match envelope.payload {
                Some(control_envelope::Payload::ShadowCreateAck(ack)) if ack.accepted => {
                    if self.shadows.create(target).is_ok() {
                        self.emit(
                            "ShadowCreated",
                            Some(target),
                            "Warm shadow created on peer",
                            HashMap::from([("via".to_string(), self.transport.kind().to_string())]),
                        );
                    }
                }
                Some(control_envelope::Payload::ShadowCreateAck(ack)) => self.emit(
                    "ShadowRefused",
                    Some(target),
                    "Peer refused warm shadow",
                    HashMap::from([("reason".to_string(), ack.reason)]),
                ),
                other => self.emit(
                    "ShadowRefused",
                    Some(target),
                    "Unexpected reply to shadow request",
                    HashMap::from([("reply".to_string(), format!("{other:?}"))]),
                ),
            },
            Err(e) => self.emit(
                "ShadowRefused",
                Some(target),
                "Peer unreachable for shadow request",
                HashMap::from([("error".to_string(), e.to_string())]),
            ),
        }
    }

    /// True when this process currently holds authority for the session.
    /// A rejoining node stays non-authoritative until it has adopted peer state.
    pub fn is_authoritative(&self) -> bool {
        self.authority_reconciled && self.authority.holder() == self.local_edge_id
    }

    /// Role of this process, derived from authority so the two cannot disagree.
    pub fn local_role(&self) -> ShadowRole {
        if self.is_authoritative() {
            ShadowRole::Authoritative
        } else if self.is_warm_shadow {
            ShadowRole::WarmShadow
        } else {
            ShadowRole::Idle
        }
    }

    /// ADR-002 single-writer invariant: only the authority may emit output.
    pub fn output_suppressed(&self) -> bool {
        !self.is_authoritative()
    }

    /// Warm-shadow readiness this process reports to the authority.
    pub fn local_sync_ratio(&self) -> f64 {
        self.local_sync_ratio
    }

    // ---- inbound control messages -------------------------------------------

    /// A peer asked us to become a warm shadow for this session.
    pub fn on_shadow_create(&mut self, msg: proto::ShadowCreate) -> proto::ShadowCreateAck {
        if msg.session_id != self.session_id {
            return proto::ShadowCreateAck {
                session_id: msg.session_id,
                target_edge_id: self.local_edge_id.clone(),
                accepted: false,
                reason: "session mismatch".into(),
            };
        }
        if self.authority.holder() == self.local_edge_id {
            return proto::ShadowCreateAck {
                session_id: msg.session_id,
                target_edge_id: self.local_edge_id.clone(),
                accepted: false,
                reason: "cannot warm-shadow the current authority holder".into(),
            };
        }
        if self.is_warm_shadow {
            return proto::ShadowCreateAck {
                session_id: msg.session_id,
                target_edge_id: self.local_edge_id.clone(),
                accepted: true,
                reason: String::new(),
            };
        }

        self.is_warm_shadow = true;
        self.local_sync_ratio = 0.0;
        self.flink_checkpoint_restored = !msg.savepoint_path.is_empty();
        if self.flink_checkpoint_restored {
            self.local_sync_ratio = 0.95;
        }
        self.flink_intent = Some(FlinkIntent::ArmShadow {
            savepoint: msg.savepoint_path.clone(),
        });
        self.emit(
            "ShadowPrepared",
            Some(&self.local_edge_id.clone()),
            "Accepted warm shadow role",
            HashMap::from([
                ("source".to_string(), msg.source_edge_id.clone()),
                ("savepoint".to_string(), msg.savepoint_path.clone()),
            ]),
        );
        self.emit(
            "ShadowFlinkArmed",
            Some(&self.local_edge_id.clone()),
            "Submitting Flink job restored from authority checkpoint",
            HashMap::from([
                ("source".to_string(), msg.source_edge_id.clone()),
                ("savepoint".to_string(), msg.savepoint_path.clone()),
                ("checkpoint_dir".to_string(), checkpoint_dir().display().to_string()),
            ]),
        );

        proto::ShadowCreateAck {
            session_id: msg.session_id,
            target_edge_id: self.local_edge_id.clone(),
            accepted: true,
            reason: String::new(),
        }
    }

    /// The authority no longer needs us warm.
    pub fn on_shadow_release(&mut self, msg: proto::ShadowRelease) {
        if msg.session_id != self.session_id {
            return;
        }
        self.is_warm_shadow = false;
        self.local_sync_ratio = 0.0;
        self.flink_checkpoint_restored = false;
        self.flink_intent = Some(FlinkIntent::Cancel);
        self.emit(
            "ShadowReleased",
            Some(&self.local_edge_id.clone()),
            "Warm shadow released",
            HashMap::from([("reason".to_string(), msg.reason)]),
        );
    }

    /// A warm shadow reported its own readiness. The authority never guesses
    /// this number; it only records what the shadow measured.
    pub fn on_shadow_sync_status(&mut self, msg: proto::ShadowSyncStatus) {
        if msg.session_id != self.session_id {
            return;
        }
        self.shadows.set_sync(&msg.shadow_edge_id, msg.sync_ratio);
        self.shadow_last_report
            .insert(msg.shadow_edge_id.clone(), now_ms());
        let prev = self
            .last_sync_emit
            .get(&msg.shadow_edge_id)
            .copied()
            .unwrap_or(-1.0);
        if (msg.sync_ratio - prev).abs() >= 0.05 || msg.sync_ratio >= 0.95 {
            self.last_sync_emit
                .insert(msg.shadow_edge_id.clone(), msg.sync_ratio);
            self.emit(
                "ShadowSyncUpdate",
                Some(&msg.shadow_edge_id),
                "Shadow synchronization progress",
                HashMap::from([
                    ("sync_ratio".to_string(), format!("{:.3}", msg.sync_ratio)),
                    ("lag_records".to_string(), msg.lag_records.to_string()),
                ]),
            );
        }
    }

    /// Authority is being handed to `token.holder_edge_id`.
    ///
    /// Rejection on epoch regression is what stops a delayed or replayed
    /// transfer from resurrecting a stale holder.
    pub fn on_authority_transfer(&mut self, transfer: proto::AuthorityTransfer) -> proto::PromotionAck {
        let Some(token) = transfer.token else {
            return proto::PromotionAck {
                session_id: self.session_id.clone(),
                accepted: false,
                new_epoch: self.authority.epoch(),
                message: "transfer carried no token".into(),
            };
        };

        let incoming = AuthorityToken {
            session_id: token.session_id.clone(),
            epoch: token.epoch,
            holder_edge_id: token.holder_edge_id.clone(),
            signature: token.signature.clone(),
        };

        match self.authority.accept_transfer(&incoming) {
            Ok(()) => {
                self.mark_authority_reconciled();
                self.last_holder_seen_ms = now_ms();
                let now_holder = incoming.holder_edge_id.clone();

                if now_holder == self.local_edge_id {
                    // Keep the already-restored Flink job; it is now authoritative.
                    self.is_warm_shadow = false;
                    self.local_sync_ratio = 1.0;
                    self.emit(
                        "EdgePromoted",
                        Some(&self.local_edge_id.clone()),
                        "Promoted from warm shadow to authoritative",
                        HashMap::from([("epoch".to_string(), incoming.epoch.to_string())]),
                    );
                } else {
                    self.is_warm_shadow = false;
                    self.local_sync_ratio = 0.0;
                    self.shadows.clear();
                    self.flink_intent = Some(FlinkIntent::Cancel);
                    self.emit(
                        "EdgeDemoted",
                        Some(&self.local_edge_id.clone()),
                        "Authority moved to another edge",
                        HashMap::from([
                            ("holder".to_string(), now_holder),
                            ("epoch".to_string(), incoming.epoch.to_string()),
                        ]),
                    );
                }

                proto::PromotionAck {
                    session_id: incoming.session_id,
                    accepted: true,
                    new_epoch: incoming.epoch,
                    message: String::new(),
                }
            }
            Err(e) => {
                self.emit(
                    "AuthorityTransferRejected",
                    Some(&self.local_edge_id.clone()),
                    &format!("rejected transfer: {e}"),
                    HashMap::from([
                        ("attempted_epoch".to_string(), incoming.epoch.to_string()),
                        ("current_epoch".to_string(), self.authority.epoch().to_string()),
                    ]),
                );
                proto::PromotionAck {
                    session_id: self.session_id.clone(),
                    accepted: false,
                    new_epoch: self.authority.epoch(),
                    message: e.to_string(),
                }
            }
        }
    }

    /// Recomputes warm-shadow readiness from the tee'd stream (ADR-003).
    pub fn tick_warm_shadow(&mut self) {
        if !self.is_warm_shadow {
            return;
        }
        self.recalculate_shadow_sync();
    }

    fn recalculate_shadow_sync(&mut self) {
        if self.stream_latest_sequence == 0 {
            // A restored Flink shadow is already catch-up-ready even before the
            // next tee record arrives. Zeroing here blocked failover after the
            // authority (and its stream) disappeared.
            if self.flink_checkpoint_restored && self.is_warm_shadow {
                self.local_sync_ratio = self.local_sync_ratio.max(0.95);
            } else {
                self.local_sync_ratio = 0.0;
            }
            self.sync_lag_records = 0;
            return;
        }
        self.sync_lag_records =
            (self.stream_latest_sequence.saturating_sub(self.stream_applied)) as i64;
        let tee = (self.stream_applied as f64 / self.stream_latest_sequence as f64).min(1.0);
        self.local_sync_ratio = if self.flink_checkpoint_restored {
            tee.max(0.95)
        } else {
            tee
        };
    }

    pub fn on_multicast_sample(
        &mut self,
        session_id: String,
        sequence: u64,
        sample: TrajectorySample,
    ) {
        if session_id != self.session_id || !self.is_warm_shadow {
            return;
        }
        self.on_state_replicate(proto::StateReplicate {
            session_id,
            sequence,
            sample: Some(sample_to_proto(&sample)),
        });
    }

    async fn replicate_to_shadows(&mut self, sample: &TrajectorySample, sequence: u64) {
        let encoded = serde_json::to_vec(sample).map(|v| v.len() as u64).unwrap_or(64);
        if crate::multicast::enabled() && self.shadows.list().iter().any(|s| s.role == ShadowRole::WarmShadow) {
            let sent = crate::multicast::publish_sample(sample, sequence);
            if sent > 0 {
                self.tee_bytes = self.tee_bytes.saturating_add(sent);
                if self.stream_sequence % 4 == 0 {
                    self.emit(
                        "MulticastFanout",
                        Some(&self.local_edge_id.clone()),
                        "Authoritative stream multicast to shadows",
                        HashMap::from([
                            ("tee_bytes".into(), self.tee_bytes.to_string()),
                            ("sequence".into(), sequence.to_string()),
                        ]),
                    );
                    self.emit(
                        "TeeBytes",
                        Some(&self.local_edge_id.clone()),
                        "Authoritative stream tee volume",
                        HashMap::from([("tee_bytes".into(), self.tee_bytes.to_string())]),
                    );
                }
                return;
            }
            // Multicast send failed; fall through to QUIC so shadows still receive ticks.
        }
        let targets: Vec<(String, bool)> = self
            .shadows
            .list()
            .iter()
            .filter(|s| s.role == ShadowRole::WarmShadow)
            .map(|s| {
                let supports_image = self
                    .capabilities
                    .get(&s.edge_id)
                    .map(|c| c.supports_image)
                    .unwrap_or(true);
                (s.edge_id.clone(), supports_image)
            })
            .collect();

        for (target, supports_image) in targets {
            if has_image_payload(sample) && !supports_image {
                self.emit(
                    "ImageCapabilityDenied",
                    Some(&target),
                    "Skipped image workload; edge does not support image processing",
                    HashMap::from([("workload".into(), "image".into())]),
                );
                continue;
            }
            let payload = control_envelope::Payload::StateReplicate(proto::StateReplicate {
                session_id: self.session_id.clone(),
                sequence,
                sample: Some(sample_to_proto(sample)),
            });
            if let Err(e) = self.transport.request(&target, payload).await {
                tracing::debug!("state replicate to {target} failed: {e}");
            } else {
                self.tee_bytes = self.tee_bytes.saturating_add(encoded);
            }
        }
        if encoded > 0 && self.stream_sequence % 8 == 0 {
            self.emit(
                "TeeBytes",
                Some(&self.local_edge_id.clone()),
                "Authoritative stream tee volume",
                HashMap::from([("tee_bytes".into(), self.tee_bytes.to_string())]),
            );
        }
    }

    /// Applies one tee'd record at a warm shadow. Output remains suppressed.
    pub fn on_state_replicate(&mut self, msg: proto::StateReplicate) {
        if msg.session_id != self.session_id || !self.is_warm_shadow {
            return;
        }
        if let Some(proto_sample) = msg.sample.as_ref() {
            let incoming = sample_from_proto(proto_sample.clone());
            if has_image_payload(&incoming) {
                let ok = self
                    .capabilities
                    .get(&self.local_edge_id)
                    .map(|c| c.supports_image)
                    .unwrap_or(true);
                if !ok {
                    self.emit(
                        "ImageCapabilityDenied",
                        Some(&self.local_edge_id.clone()),
                        "Dropped image payload; this edge does not support image processing",
                        HashMap::from([("workload".into(), "image".into())]),
                    );
                    return;
                }
            }
        }
        self.stream_latest_sequence = self.stream_latest_sequence.max(msg.sequence);
        let Some(proto_sample) = msg.sample else {
            self.recalculate_shadow_sync();
            return;
        };
        let sample = sample_from_proto(proto_sample);
        // Apply state without triggering authority-side speculation/handoff.
        self.edge_id = sample.edge_id.clone();
        self.vehicle_latitude = Some(sample.latitude);
        self.vehicle_longitude = Some(sample.longitude);
        self.vehicle_heading = sample.heading_deg;
        self.vehicle_speed_mps = Some(sample.speed_mps);
        self.vehicle_updated_ms = Some(now_ms());
        self.vehicle_trail.push(crate::types::VehicleTrailPoint {
            latitude: sample.latitude,
            longitude: sample.longitude,
        });
        if self.vehicle_trail.len() > 120 {
            let drain = self.vehicle_trail.len() - 120;
            self.vehicle_trail.drain(0..drain);
        }
        self.keyed_state.apply_sample(&sample);
        self.enqueue_flink_sample(sample);
        self.stream_applied += 1;
        self.recalculate_shadow_sync();
    }

    pub fn on_promotion_request(&mut self, msg: proto::PromotionRequest) -> proto::PromotionAck {
        if msg.session_id != self.session_id {
            return proto::PromotionAck {
                session_id: msg.session_id,
                accepted: false,
                new_epoch: self.authority.epoch(),
                message: "session mismatch".into(),
            };
        }
        let ready = self.is_warm_shadow
            && self.local_sync_ratio >= self.config.promotion_sync_threshold
            && self.keyed_state.sample_count > 0;
        proto::PromotionAck {
            session_id: msg.session_id,
            accepted: ready,
            new_epoch: self.authority.epoch() + 1,
            message: if ready {
                String::new()
            } else {
                format!(
                    "shadow not ready sync={:.3} state_samples={}",
                    self.local_sync_ratio, self.keyed_state.sample_count
                )
            },
        }
    }

    pub fn on_demotion_notice(&mut self, msg: proto::DemotionNotice) {
        if msg.edge_id == self.local_edge_id {
            self.is_warm_shadow = false;
            self.local_sync_ratio = 0.0;
            self.emit(
                "EdgeDemoted",
                Some(&self.local_edge_id.clone()),
                "DemotionNotice applied",
                HashMap::from([("epoch".into(), msg.epoch.to_string())]),
            );
        }
    }

    pub fn on_state_align(&mut self, msg: proto::StateAlign) {
        if msg.session_id != self.session_id || !self.is_warm_shadow {
            return;
        }
        if let Some(state) = msg.keyed_state {
            self.keyed_state = KeyedWorkloadState::from_proto(&state);
            self.stream_latest_sequence = self.stream_latest_sequence.max(msg.sequence);
            self.stream_applied = self.stream_applied.max(msg.sequence);
            self.recalculate_shadow_sync();
            self.emit(
                "FlinkStateAligned",
                Some(&self.local_edge_id.clone()),
                "Applied keyed-state alignment",
                HashMap::from([("version".into(), self.keyed_state.version.to_string())]),
            );
        }
    }

    pub fn on_checkpoint_transfer(&mut self, msg: proto::CheckpointTransfer) -> proto::CheckpointAck {
        let started = now_ms();
        if let Some(state) = msg.state {
            self.keyed_state = KeyedWorkloadState::from_proto(&state);
            let _ = self.keyed_state.write_checkpoint(&checkpoint_dir());
            self.pending_flink_restore = Some(self.keyed_state.clone());
            self.emit(
                "FlinkCheckpointRestoreQueued",
                Some(&self.local_edge_id.clone()),
                "Queued keyed-state restore into local shadow Flink instance",
                HashMap::from([
                    ("version".into(), self.keyed_state.version.to_string()),
                    ("sample_count".into(), self.keyed_state.sample_count.to_string()),
                ]),
            );
        }
        proto::CheckpointAck {
            session_id: msg.session_id,
            restored: true,
            restore_ms: now_ms().saturating_sub(started).max(1),
        }
    }

    pub fn on_capability_advertisement(&mut self, msg: proto::EdgeCapabilityAdvertisement) {
        self.capabilities.insert(
            msg.edge_id.clone(),
            EdgeCapability {
                edge_id: msg.edge_id.clone(),
                supports_stream: msg.supports_stream,
                supports_image: msg.supports_image,
                supports_video: msg.supports_gpu,
                supports_gpu: msg.supports_gpu,
                cpu_available_ratio: msg.cpu_available_ratio,
                memory_available_ratio: msg.memory_available_ratio,
            },
        );
        self.last_peer_seen.insert(msg.edge_id, now_ms());
    }

    pub fn on_migration_fallback_start(&mut self, msg: proto::MigrationFallbackStart) {
        self.emit(
            "MigrationFallbackStart",
            Some(&msg.to_edge_id),
            &msg.reason,
            HashMap::from([("from".into(), msg.from_edge_id)]),
        );
    }

    pub fn on_migration_fallback_complete(&mut self, msg: proto::MigrationFallbackComplete) {
        self.emit(
            "MigrationFallbackComplete",
            Some(&msg.to_edge_id),
            "Peer completed reactive restore",
            HashMap::from([("latency_ms".into(), msg.latency_ms.to_string())]),
        );
    }

    pub fn on_speculation_decision(&mut self, msg: proto::SpeculationDecision) {
        self.emit(
            "SpeculationDecision",
            None,
            &msg.reason,
            HashMap::from([("should_speculate".into(), msg.should_speculate.to_string())]),
        );
    }

    async fn align_shadow_state(&self) {
        let payload = control_envelope::Payload::StateAlign(proto::StateAlign {
            session_id: self.session_id.clone(),
            sequence: self.stream_sequence,
            keyed_state: Some(self.keyed_state.to_proto()),
        });
        for shadow in self.shadows.list() {
            if shadow.role != ShadowRole::WarmShadow {
                continue;
            }
            let _ = self.transport.request(&shadow.edge_id, payload.clone()).await;
        }
    }

    /// Heartbeats, capability gossip, shadow recreate, authority failover.
    pub async fn tick_control_plane(&mut self) {
        self.refresh_local_resources();
        self.gossip_capabilities().await;
        self.probe_holder().await;
        self.maybe_recreate_shadows().await;
        self.maybe_failover().await;
    }

    /// CPU-only control-plane work plus the QUIC messages that must be sent
    /// *after* the runtime write lock is released.
    pub fn drain_control_outbox(&mut self) -> Vec<(String, control_envelope::Payload)> {
        self.refresh_local_resources();
        self.maybe_emit_resources();
        let mut out = Vec::new();
        if let Some(cap) = self.capabilities.get(&self.local_edge_id) {
            let payload = control_envelope::Payload::CapabilityAdvertisement(
                proto::EdgeCapabilityAdvertisement {
                    edge_id: cap.edge_id.clone(),
                    supports_stream: cap.supports_stream,
                    supports_image: cap.supports_image,
                    supports_gpu: cap.supports_gpu,
                    cpu_available_ratio: cap.cpu_available_ratio,
                    memory_available_ratio: cap.memory_available_ratio,
                },
            );
            for peer in self.transport.peers() {
                out.push((peer, payload.clone()));
            }
        }
        let now = now_ms();
        if self.is_authoritative() {
            self.last_holder_seen_ms = now;
        }
        if now - self.last_reconcile_ping_ms >= 1000 {
            self.last_reconcile_ping_ms = now;
            for peer in self.transport.peers() {
                out.push((
                    peer,
                    control_envelope::Payload::PeerPing(proto::PeerPing {
                        edge_id: self.local_edge_id.clone(),
                        sent_at_ms: now,
                    }),
                ));
            }
        }
        for edge in self.take_stale_shadows() {
            let savepoint = crate::flink_jobs::latest_savepoint_for(&self.local_edge_id)
                .unwrap_or_default();
            out.push((
                edge.clone(),
                control_envelope::Payload::ShadowCreate(proto::ShadowCreate {
                    session_id: self.session_id.clone(),
                    source_edge_id: self.local_edge_id.clone(),
                    target_edge_id: edge,
                    requested_at_ms: now_ms(),
                    savepoint_path: savepoint,
                }),
            ));
        }
        if let Some(transfer) = self.take_failover_transfer() {
            for peer in self.transport.peers() {
                out.push((
                    peer,
                    control_envelope::Payload::AuthorityTransfer(transfer.clone()),
                ));
            }
        }
        out
    }

    fn maybe_emit_resources(&mut self) {
        let now = now_ms();
        if now - self.last_resource_emit_ms < 2000 {
            return;
        }
        self.last_resource_emit_ms = now;
        let snap = ResourceSnapshot::sample();
        self.emit(
            "ResourceSnapshot",
            Some(&self.local_edge_id.clone()),
            "Live CPU/RAM snapshot",
            HashMap::from([
                ("cpu_available_ratio".into(), format!("{:.3}", snap.cpu_available_ratio)),
                ("memory_available_ratio".into(), format!("{:.3}", snap.memory_available_ratio)),
                ("rss_bytes".into(), snap.rss_bytes.to_string()),
            ]),
        );
    }

    fn take_stale_shadows(&mut self) -> Vec<String> {
        if !self.is_authoritative() {
            return Vec::new();
        }
        let timeout = heartbeat_timeout_ms();
        let now = now_ms();
        let stale: Vec<String> = self
            .shadows
            .list()
            .iter()
            .filter(|s| {
                self.shadow_last_report
                    .get(&s.edge_id)
                    .map(|t| now - *t > timeout)
                    .unwrap_or(false)
            })
            .map(|s| s.edge_id.clone())
            .collect();
        for edge in &stale {
            let _ = self.shadows.discard(edge);
            self.emit(
                "ShadowRecreated",
                Some(edge),
                "Shadow heartbeat lost; recreating",
                HashMap::new(),
            );
        }
        stale
    }

    /// Crash failover on the live tick: promote locally, queue transfers.
    pub fn take_failover_transfer(&mut self) -> Option<proto::AuthorityTransfer> {
        let token = self.try_failover_promote()?;
        Some(proto::AuthorityTransfer {
            token: Some(proto::AuthorityToken {
                session_id: token.session_id,
                epoch: token.epoch,
                holder_edge_id: token.holder_edge_id,
                signature: token.signature,
            }),
            previous_holder_edge_id: String::new(),
        })
    }

    pub fn apply_shadow_create_ack(&mut self, target: &str, ack: proto::ShadowCreateAck) {
        if ack.accepted {
            if self.shadows.create(target).is_ok() {
                self.emit(
                    "ShadowCreated",
                    Some(target),
                    "Warm shadow created on peer",
                    HashMap::from([("via".to_string(), self.transport.kind().to_string())]),
                );
            }
        } else {
            self.emit(
                "ShadowRefused",
                Some(target),
                "Peer refused warm shadow",
                HashMap::from([("reason".to_string(), ack.reason)]),
            );
        }
    }

    fn refresh_local_resources(&mut self) {
        if let Some(cap) = self.capabilities.get_mut(&self.local_edge_id) {
            apply_live_resources(cap);
        }
    }

    async fn gossip_capabilities(&self) {
        let cap = match self.capabilities.get(&self.local_edge_id) {
            Some(c) => c.clone(),
            None => return,
        };
        let payload = control_envelope::Payload::CapabilityAdvertisement(
            proto::EdgeCapabilityAdvertisement {
                edge_id: cap.edge_id,
                supports_stream: cap.supports_stream,
                supports_image: cap.supports_image,
                supports_gpu: cap.supports_gpu,
                cpu_available_ratio: cap.cpu_available_ratio,
                memory_available_ratio: cap.memory_available_ratio,
            },
        );
        for peer in self.transport.peers() {
            let _ = self.transport.request(&peer, payload.clone()).await;
        }
    }

    async fn probe_holder(&mut self) {
        let holder = self.authority.holder().to_string();
        if holder == self.local_edge_id {
            self.last_holder_seen_ms = now_ms();
            return;
        }
        let ping = control_envelope::Payload::PeerPing(proto::PeerPing {
            edge_id: holder.clone(),
            sent_at_ms: now_ms(),
        });
        match self.transport.request(&holder, ping).await {
            Ok(_) => {
                self.last_holder_seen_ms = now_ms();
                self.last_peer_seen.insert(holder, now_ms());
            }
            Err(_) => {}
        }
    }

    async fn maybe_recreate_shadows(&mut self) {
        if !self.is_authoritative() {
            return;
        }
        let timeout = heartbeat_timeout_ms();
        let now = now_ms();
        let stale: Vec<String> = self
            .shadows
            .list()
            .iter()
            .filter(|s| {
                self.shadow_last_report
                    .get(&s.edge_id)
                    .map(|t| now - *t > timeout)
                    .unwrap_or(false)
            })
            .map(|s| s.edge_id.clone())
            .collect();
        for edge in stale {
            let _ = self.shadows.discard(&edge);
            self.emit(
                "ShadowRecreated",
                Some(&edge),
                "Shadow heartbeat lost; recreating",
                HashMap::new(),
            );
            self.request_shadow_on(&edge).await;
        }
    }

    async fn maybe_failover(&mut self) {
        let Some(token) = self.try_failover_promote() else {
            return;
        };
        let proto_token = proto::AuthorityToken {
            session_id: token.session_id,
            epoch: token.epoch,
            holder_edge_id: token.holder_edge_id,
            signature: token.signature,
        };
        for peer in self.transport.peers() {
            let payload = control_envelope::Payload::AuthorityTransfer(proto::AuthorityTransfer {
                token: Some(proto_token.clone()),
                previous_holder_edge_id: String::new(),
            });
            let _ = self.transport.request(&peer, payload).await;
        }
    }

    /// The readiness report this shadow owes the authority, if any.
    ///
    /// Returns the data rather than sending it so the caller can release the
    /// runtime lock before going to the network; holding it across a QUIC
    /// round trip would stall every HTTP handler for the request timeout.
    pub fn sync_report(&self) -> Option<(String, proto::ShadowSyncStatus)> {
        if !self.is_warm_shadow {
            return None;
        }
        let holder = self.authority.holder().to_string();
        if holder == self.local_edge_id {
            return None;
        }

        Some((
            holder,
            proto::ShadowSyncStatus {
                session_id: self.session_id.clone(),
                shadow_edge_id: self.local_edge_id.clone(),
                sync_ratio: self.local_sync_ratio,
                lag_records: self.sync_lag_records,
                reported_at_ms: now_ms(),
            },
        ))
    }

    /// Transport handle, cloned so callers can send without holding the lock.
    pub fn transport(&self) -> Arc<dyn ControlTransport> {
        self.transport.clone()
    }

    /// Golden demo scenario until Chirag's sim feeds TrajectorySample.
    pub async fn advance_demo(&mut self) {
        self.demo_step += 1;
        match self.demo_step {
            1 => {
                self.emit(
                    "VehicleConnected",
                    Some("edge-a"),
                    "Vehicle connected to Edge A",
                    HashMap::new(),
                );
                self.emit(
                    "AuthorityGranted",
                    Some("edge-a"),
                    "Edge A authoritative",
                    HashMap::new(),
                );
                self.refresh_prediction().await;
            }
            2 => self.run_speculation_cycle().await,
            3..=8 => self.tick_warm_shadow(),
            9 => {
                self.handle_handoff("edge-b").await;
            }
            10 => self.refresh_prediction().await,
            _ => {}
        }
    }

    pub fn snapshot(&self) -> SystemSnapshot {
        let topology: Vec<TopologyNode> = self
            .topology_coords
            .iter()
            .map(|(id, (lat, lon))| {
                let holder = self.authority_holder();
                let role = if !holder.is_empty() && *id == holder && (*id != self.local_edge_id || self.is_authoritative()) {
                    ShadowRole::Authoritative
                } else if *id == self.local_edge_id && self.is_warm_shadow {
                    ShadowRole::WarmShadow
                } else if self
                    .shadows
                    .list()
                    .iter()
                    .any(|s| &s.edge_id == id && s.role == ShadowRole::WarmShadow)
                {
                    ShadowRole::WarmShadow
                } else {
                    ShadowRole::Idle
                };
                let sync_ratio = if *id == self.local_edge_id && self.is_warm_shadow {
                    Some(self.local_sync_ratio)
                } else {
                    self.shadows
                        .list()
                        .iter()
                        .find(|s| &s.edge_id == id)
                        .map(|s| s.sync_ratio)
                };
                TopologyNode {
                    edge_id: id.clone(),
                    latitude: *lat,
                    longitude: *lon,
                    role,
                    sync_ratio,
                }
            })
            .collect();

        SystemSnapshot {
            run_id: self.run_id.clone(),
            session_id: self.session_id.clone(),
            current_edge_id: self.edge_id.clone(),
            authority: {
                let mut token = self.authority.token().clone();
                if !self.authority_reconciled && token.holder_edge_id == self.local_edge_id {
                    token.holder_edge_id.clear();
                    token.signature.clear();
                }
                token
            },
            prediction: self.prediction.clone(),
            shadows: self.shadows.list().to_vec(),
            topology,
            timeline: self.timeline.clone(),
            mode: self.mode.clone(),
            vehicle_latitude: self.vehicle_latitude,
            vehicle_longitude: self.vehicle_longitude,
            vehicle_heading: self.vehicle_heading,
            vehicle_speed_mps: self.vehicle_speed_mps,
            vehicle_updated_ms: self.vehicle_updated_ms,
            vehicle_trail: self.vehicle_trail.clone(),
            traffic_vehicles: self.traffic_vehicles.clone(),
            predictor_degraded: self.predictor_degraded,
            tee_bytes: self.tee_bytes,
            cpu_available_ratio: self
                .capabilities
                .get(&self.local_edge_id)
                .map(|c| c.cpu_available_ratio)
                .unwrap_or(0.0),
            memory_available_ratio: self
                .capabilities
                .get(&self.local_edge_id)
                .map(|c| c.memory_available_ratio)
                .unwrap_or(0.0),
            rss_bytes: ResourceSnapshot::sample().rss_bytes,
            flink_job_id: self.flink_job_id.clone(),
        }
    }

    pub fn sidecar_authority(&self) -> (bool, String, u64) {
        (
            self.is_authoritative(),
            self.authority.holder().to_string(),
            self.authority.epoch(),
        )
    }

    pub async fn peer_health(&self) -> HashMap<String, bool> {
        crate::transport::mesh_health(self.transport.as_ref()).await
    }

    fn failover_holdoff_ms(&self) -> i64 {
        let mut ids = self.transport.peers();
        ids.push(self.local_edge_id.clone());
        ids.sort();
        ids.dedup();
        let idx = ids
            .iter()
            .position(|edge| edge == &self.local_edge_id)
            .unwrap_or(0);
        (idx as i64) * 500
    }

    /// Single-winner claim: only the lexicographically smallest live warm shadow
    /// may mint the next epoch. Same-epoch accept_transfer is the safety net if
    /// two candidates both claim before seeing each other.
    fn can_claim_failover(&self) -> bool {
        if !self.authority_reconciled || !self.is_warm_shadow {
            return false;
        }
        let now = now_ms();
        let timeout = heartbeat_timeout_ms();
        let mut candidates: Vec<String> = self
            .peer_warm_shadows
            .iter()
            .filter(|id| {
                self.last_peer_seen
                    .get(*id)
                    .map(|seen| now - *seen <= timeout)
                    .unwrap_or(false)
            })
            .cloned()
            .collect();
        candidates.push(self.local_edge_id.clone());
        candidates.sort();
        candidates.dedup();
        candidates.first() == Some(&self.local_edge_id)
    }

    fn holder_is_stale(&self) -> bool {
        now_ms() - self.last_holder_seen_ms
            > heartbeat_timeout_ms() + self.failover_holdoff_ms()
    }

    fn any_live_warm_shadow(&self) -> bool {
        if self.is_warm_shadow {
            return true;
        }
        let now = now_ms();
        let timeout = heartbeat_timeout_ms();
        self.peer_warm_shadows.iter().any(|id| {
            self.last_peer_seen
                .get(id)
                .map(|seen| now - *seen <= timeout)
                .unwrap_or(false)
        })
    }

    fn holder_peer_is_dead(&self) -> bool {
        let holder = self.authority.holder();
        if holder.is_empty() || holder == self.local_edge_id {
            return false;
        }
        let now = now_ms();
        let timeout = heartbeat_timeout_ms() * 3;
        match self.last_peer_seen.get(holder) {
            Some(seen) => now - *seen > timeout,
            None => now - self.last_holder_seen_ms > timeout,
        }
    }

    /// When the holder dies with no warm shadow, the smallest remaining live
    /// edge mints the next epoch so the mesh never stays at zero authorities.
    fn can_claim_empty_cluster_recovery(&self) -> bool {
        if !self.authority_reconciled || self.any_live_warm_shadow() || !self.holder_peer_is_dead() {
            return false;
        }
        let now = now_ms();
        let timeout = heartbeat_timeout_ms();
        let holder = self.authority.holder();
        let mut live: Vec<String> = self
            .last_peer_seen
            .iter()
            .filter(|(id, seen)| *id != &holder && now - **seen <= timeout)
            .map(|(id, _)| id.clone())
            .collect();
        live.push(self.local_edge_id.clone());
        live.sort();
        live.dedup();
        // Need another healthy peer so an isolated node cannot steal authority.
        live.len() >= 2 && live.first() == Some(&self.local_edge_id)
    }

    fn try_failover_promote(&mut self) -> Option<crate::types::AuthorityToken> {
        if self.is_authoritative() {
            return None;
        }
        let warm_claim = self.holder_is_stale()
            && self.is_warm_shadow
            && self.can_claim_failover()
            && self.local_sync_ratio >= self.config.promotion_sync_threshold;
        let recovery_claim = self.can_claim_empty_cluster_recovery();
        if !warm_claim && !recovery_claim {
            return None;
        }
        let reason = if warm_claim {
            "Promoted after authoritative timeout"
        } else {
            "Recovered authority after holder loss with no warm shadow"
        };
        match self.authority.failover_promote(&self.local_edge_id.clone()) {
            Ok(token) => {
                self.is_warm_shadow = false;
                self.last_holder_seen_ms = now_ms();
                self.mark_authority_reconciled();
                self.emit(
                    "AuthorityFailover",
                    Some(&self.local_edge_id.clone()),
                    reason,
                    HashMap::from([
                        ("epoch".into(), token.epoch.to_string()),
                        (
                            "mode".into(),
                            if warm_claim {
                                "warm".into()
                            } else {
                                "empty-cluster".into()
                            },
                        ),
                    ]),
                );
                Some(token)
            }
            Err(e) => {
                self.emit(
                    "AuthorityFailoverFailed",
                    Some(&self.local_edge_id.clone()),
                    &e.to_string(),
                    HashMap::new(),
                );
                None
            }
        }
    }
}

pub type SharedRuntime = Arc<RwLock<PrevailRuntime>>;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn heartbeat_timeout_ms() -> i64 {
    std::env::var("PREVAIL_AUTHORITY_TIMEOUT_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(3000)
}

fn default_capabilities() -> HashMap<String, EdgeCapability> {
    let edges = ["edge-a", "edge-b", "edge-c", "edge-d"];
    edges
        .iter()
        .map(|id| {
            (
                id.to_string(),
                EdgeCapability {
                    edge_id: id.to_string(),
                    supports_stream: true,
                    supports_image: *id != "edge-d",
                    supports_video: *id == "edge-b",
                    supports_gpu: *id == "edge-b",
                    cpu_available_ratio: 0.7,
                    memory_available_ratio: 0.65,
                },
            )
        })
        .collect()
}

/// Mock until Chirag ships `deploy/config/edge-regions.json`.
fn default_topology() -> HashMap<String, (f64, f64)> {
    HashMap::from([
        ("edge-a".into(), (12.9716, 77.5946)),
        ("edge-b".into(), (12.9750, 77.6050)),
        ("edge-c".into(), (12.9650, 77.6100)),
        ("edge-d".into(), (12.9800, 77.5850)),
    ])
}

#[allow(dead_code)]
fn _shadow_err_display(e: ShadowError) -> String {
    e.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn promotion_request_rejects_cold_shadow() {
        let mut rt = PrevailRuntime::new_lab("run", "sess", "lab-secret", "http://127.0.0.1:9");
        let ack = rt.on_promotion_request(proto::PromotionRequest {
            session_id: "sess".into(),
            from_edge_id: "edge-a".into(),
            to_edge_id: "edge-b".into(),
            expected_epoch: 0,
        });
        assert!(!ack.accepted);
    }

    #[test]
    fn checkpoint_restore_applies_keyed_state() {
        let mut rt = PrevailRuntime::new_lab("run", "sess", "lab-secret", "http://127.0.0.1:9");
        let mut state = KeyedWorkloadState::new("sess");
        state.sample_count = 12;
        state.speed_sum = 120.0;
        state.version = 4;
        let ack = rt.on_checkpoint_transfer(proto::CheckpointTransfer {
            session_id: "sess".into(),
            from_edge_id: "edge-a".into(),
            to_edge_id: "edge-b".into(),
            state: Some(state.to_proto()),
        });
        assert!(ack.restored);
        assert_eq!(rt.keyed_state().sample_count, 12);
        assert!(rt.take_pending_flink_restore().is_some());
    }

    #[tokio::test]
    async fn trajectory_enqueues_flink_ingress() {
        let mut rt = PrevailRuntime::new_lab("run", "sess", "lab-secret", "http://127.0.0.1:9");
        rt.on_trajectory(TrajectorySample {
            session_id: "sess".into(),
            timestamp_ms: 1,
            latitude: 12.92,
            longitude: 77.66,
            speed_mps: 8.0,
            edge_id: "edge-a".into(),
            heading_deg: Some(90.0),
            sensor_tuple: None,
            image_event_id: None,
            workload_class: Some("stream".into()),
            image_jpeg_b64: None,
        })
        .await;
        let drained = rt.drain_flink_ingress(8);
        assert_eq!(drained.len(), 1);
        assert_eq!(drained[0].edge_id, "edge-a");
    }
}
