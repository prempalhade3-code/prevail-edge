use crate::authority::AuthorityManager;
use crate::config::{load_capabilities_from_file, load_topology_from_file, resolve_config_paths};
use crate::predictor::PredictorClient;
use crate::proto::{self, control_envelope};
use crate::shadow::{ShadowError, ShadowManager};
use crate::speculation::evaluate_speculation;
use crate::transport::{ControlTransport, InMemoryTransport};
use crate::types::{
    AuthorityToken, EdgeCapability, PredictionResult, ShadowRole, SpeculationConfig,
    SystemSnapshot, TimelineEvent, TopologyNode, TrajectorySample,
};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct PrevailRuntime {
    pub run_id: String,
    pub session_id: String,
    /// Fixed identity of this edge process.
    local_edge_id: String,
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
}

impl PrevailRuntime {
    pub fn new_lab(run_id: &str, session_id: &str, secret: &str, predictor_url: &str) -> Self {
        Self::new_for_edge(run_id, session_id, secret, predictor_url, "edge-a", "edge-a")
    }

    /// Builds a runtime that identifies as `local_edge_id`. Each edge process in
    /// the mesh owns exactly one of these; `local_edge_id` is fixed for the
    /// lifetime of the process, while `edge_id` tracks where the vehicle is.
    pub fn new_for_edge(
        run_id: &str,
        session_id: &str,
        secret: &str,
        predictor_url: &str,
        local_edge_id: &str,
        bootstrap_edge_id: &str,
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
        let peers: Vec<String> = capabilities
            .keys()
            .filter(|id| id.as_str() != local_edge_id)
            .cloned()
            .collect();
        Self {
            run_id: run_id.to_string(),
            session_id: session_id.to_string(),
            local_edge_id: local_edge_id.to_string(),
            edge_id: bootstrap_edge_id.to_string(),
            authority: AuthorityManager::new(session_id, bootstrap_edge_id, secret),
            shadows: ShadowManager::default(),
            config: SpeculationConfig::default(),
            capabilities,
            topology_coords,
            prediction: None,
            timeline: Vec::new(),
            mode: "prevail".into(),
            transport: Arc::new(InMemoryTransport::new(local_edge_id, peers)),
            predictor_url: predictor_url.to_string(),
            demo_step: 0,
            vehicle_latitude: None,
            vehicle_longitude: None,
            vehicle_heading: None,
            vehicle_speed_mps: None,
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
        }
    }

    pub fn local_edge_id(&self) -> &str {
        &self.local_edge_id
    }

    /// Swaps the in-memory placeholder for the real QUIC mesh.
    ///
    /// `main` calls this at startup and logs loudly if it fails, so a runtime
    /// that never reached the mesh is visible instead of quietly pretending
    /// its peers are healthy.
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
        self.timeline.push(TimelineEvent {
            run_id: self.run_id.clone(),
            timestamp_ms: ts,
            event_type: event_type.to_string(),
            edge_id: edge_id.map(str::to_string),
            message: message.to_string(),
            payload,
        });
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
            pred.probabilities
                .iter()
                .map(|(k, v)| (k.clone(), format!("{:.2}", v)))
                .collect(),
        );
    }

    pub async fn on_trajectory(&mut self, sample: TrajectorySample) {
        if self.is_authoritative() {
            self.stream_sequence += 1;
            self.trajectory_ticks += 1;
            let client = PredictorClient::new(&self.predictor_url);
            client.post_trajectory(&sample).await;
            self.replicate_to_shadows(&sample, self.stream_sequence).await;

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
            let mut payload = HashMap::new();
            payload.insert("from_edge".into(), self.edge_id.clone());
            payload.insert("to_edge".into(), sample.edge_id.clone());
            self.emit(
                "HandoffDetected",
                Some(&sample.edge_id),
                "Vehicle crossed edge boundary",
                payload,
            );
            if self.is_authoritative() {
                self.handle_handoff(&sample.edge_id).await;
            }
        }
        self.edge_id = sample.edge_id;
        self.vehicle_latitude = Some(sample.latitude);
        self.vehicle_longitude = Some(sample.longitude);
        self.vehicle_heading = sample.heading_deg;
        self.vehicle_speed_mps = Some(sample.speed_mps);
        self.vehicle_trail.push(crate::types::VehicleTrailPoint {
            latitude: sample.latitude,
            longitude: sample.longitude,
        });
        if self.vehicle_trail.len() > 120 {
            let drain = self.vehicle_trail.len() - 120;
            self.vehicle_trail.drain(0..drain);
        }
    }

    async fn handle_handoff(&mut self, new_edge: &str) {
        // Only the current holder can hand authority on.
        if !self.is_authoritative() {
            return;
        }
        if new_edge == self.local_edge_id {
            return;
        }

        let threshold = self.config.promotion_sync_threshold;
        if self.shadows.ready_for_promotion(new_edge, threshold).is_ok() {
            if self.transfer_authority_to(new_edge, "warm shadow promotion").await {
                return;
            }
        }

        // No ready shadow: fall back to reactive migration, which is the
        // baseline PREVAIL is measured against.
        if self.shadows.list().iter().any(|s| s.edge_id == new_edge) {
            let _ = self.shadows.discard(new_edge);
            self.emit(
                "ShadowDiscarded",
                Some(new_edge),
                "Shadow discarded; sync not ready",
                HashMap::new(),
            );
        }

        self.emit(
            "MigrationFallback",
            Some(new_edge),
            "Reactive migration fallback: no warm shadow ready",
            HashMap::new(),
        );
        self.transfer_authority_to(new_edge, "reactive migration").await;
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

        self.shadows.promote_shadow_to_authoritative(new_edge);
        self.shadows.clear();
        self.is_warm_shadow = false;
        self.local_sync_ratio = 0.0;

        self.emit(
            "AuthorityTransferred",
            Some(new_edge),
            &format!("Authority transferred via {reason}"),
            HashMap::from([
                ("from".to_string(), from.clone()),
                ("to".to_string(), new_edge.to_string()),
                ("epoch".to_string(), token.epoch.to_string()),
                ("accepted".to_string(), accepted_by_new_holder.to_string()),
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
        let decision = evaluate_speculation(&pred, &self.edge_id, &self.capabilities, &self.config);
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
        let payload = control_envelope::Payload::ShadowCreate(proto::ShadowCreate {
            session_id: self.session_id.clone(),
            source_edge_id: self.local_edge_id.clone(),
            target_edge_id: target.to_string(),
            requested_at_ms: now_ms(),
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
    pub fn is_authoritative(&self) -> bool {
        self.authority.holder() == self.local_edge_id
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
        self.emit(
            "ShadowPrepared",
            Some(&self.local_edge_id.clone()),
            "Accepted warm shadow role",
            HashMap::from([("source".to_string(), msg.source_edge_id.clone())]),
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
        if msg.session_id != self.session_id || !self.is_warm_shadow {
            return;
        }
        self.is_warm_shadow = false;
        self.local_sync_ratio = 0.0;
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
                let now_holder = incoming.holder_edge_id.clone();

                if now_holder == self.local_edge_id {
                    // We were the warm shadow; take over and start emitting.
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
            self.local_sync_ratio = 0.0;
            self.sync_lag_records = 0;
            return;
        }
        self.sync_lag_records =
            (self.stream_latest_sequence.saturating_sub(self.stream_applied)) as i64;
        self.local_sync_ratio =
            (self.stream_applied as f64 / self.stream_latest_sequence as f64).min(1.0);
    }

    async fn replicate_to_shadows(&self, sample: &TrajectorySample, sequence: u64) {
        let proto_sample = proto::TrajectorySample {
            session_id: sample.session_id.clone(),
            timestamp_ms: sample.timestamp_ms,
            latitude: sample.latitude,
            longitude: sample.longitude,
            speed_mps: sample.speed_mps,
            edge_id: sample.edge_id.clone(),
            heading_deg: sample.heading_deg,
        };
        let payload = control_envelope::Payload::StateReplicate(proto::StateReplicate {
            session_id: self.session_id.clone(),
            sequence,
            sample: Some(proto_sample),
        });

        for shadow in self.shadows.list() {
            if shadow.role != ShadowRole::WarmShadow {
                continue;
            }
            let target = shadow.edge_id.clone();
            if let Err(e) = self.transport.request(&target, payload.clone()).await {
                tracing::debug!("state replicate to {target} failed: {e}");
            }
        }
    }

    /// Applies one tee'd record at a warm shadow. Output remains suppressed.
    pub fn on_state_replicate(&mut self, msg: proto::StateReplicate) {
        if msg.session_id != self.session_id || !self.is_warm_shadow {
            return;
        }
        self.stream_latest_sequence = self.stream_latest_sequence.max(msg.sequence);
        let Some(proto_sample) = msg.sample else {
            self.recalculate_shadow_sync();
            return;
        };
        let sample = TrajectorySample {
            session_id: proto_sample.session_id,
            timestamp_ms: proto_sample.timestamp_ms,
            latitude: proto_sample.latitude,
            longitude: proto_sample.longitude,
            speed_mps: proto_sample.speed_mps,
            edge_id: proto_sample.edge_id.clone(),
            heading_deg: proto_sample.heading_deg,
        };
        // Apply state without triggering authority-side speculation/handoff.
        self.edge_id = sample.edge_id;
        self.vehicle_latitude = Some(sample.latitude);
        self.vehicle_longitude = Some(sample.longitude);
        self.vehicle_heading = sample.heading_deg;
        self.vehicle_trail.push(crate::types::VehicleTrailPoint {
            latitude: sample.latitude,
            longitude: sample.longitude,
        });
        if self.vehicle_trail.len() > 120 {
            let drain = self.vehicle_trail.len() - 120;
            self.vehicle_trail.drain(0..drain);
        }
        self.stream_applied += 1;
        self.recalculate_shadow_sync();
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
                let role = if *id == self.authority.holder() {
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
            authority: self.authority.token().clone(),
            prediction: self.prediction.clone(),
            shadows: self.shadows.list().to_vec(),
            topology,
            timeline: self.timeline.clone(),
            mode: self.mode.clone(),
            vehicle_latitude: self.vehicle_latitude,
            vehicle_longitude: self.vehicle_longitude,
            vehicle_heading: self.vehicle_heading,
            vehicle_speed_mps: self.vehicle_speed_mps,
            vehicle_trail: self.vehicle_trail.clone(),
            traffic_vehicles: self.traffic_vehicles.clone(),
            predictor_degraded: self.predictor_degraded,
        }
    }

    pub fn sidecar_authority(&self) -> (bool, String, u64) {
        (
            self.authority.holder() == self.edge_id,
            self.authority.holder().to_string(),
            self.authority.epoch(),
        )
    }

    pub async fn peer_health(&self) -> HashMap<String, bool> {
        crate::transport::mesh_health(self.transport.as_ref()).await
    }
}

pub type SharedRuntime = Arc<RwLock<PrevailRuntime>>;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
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
