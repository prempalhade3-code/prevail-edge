use crate::authority::AuthorityManager;
use crate::config::{load_capabilities_from_file, load_topology_from_file, resolve_config_paths};
use crate::predictor::{PredictorClient, mock_prediction};
use crate::shadow::{ShadowError, ShadowManager};
use crate::speculation::evaluate_speculation;
use crate::transport::{ControlTransport, QuicTransportStub};
use crate::types::{
    EdgeCapability, PredictionResult, ShadowRole, SpeculationConfig, SystemSnapshot, TimelineEvent,
    TopologyNode, TrajectorySample,
};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct PrevailRuntime {
    pub run_id: String,
    pub session_id: String,
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
    vehicle_trail: Vec<crate::types::VehicleTrailPoint>,
    traffic_vehicles: Vec<crate::types::TrafficVehicle>,
}

impl PrevailRuntime {
    pub fn new_lab(run_id: &str, session_id: &str, secret: &str, predictor_url: &str) -> Self {
        let (regions_path, caps_path) = resolve_config_paths();
        let capabilities = caps_path
            .as_deref()
            .and_then(load_capabilities_from_file)
            .unwrap_or_else(default_capabilities);
        let topology_coords = regions_path
            .as_deref()
            .and_then(load_topology_from_file)
            .unwrap_or_else(default_topology);
        let peers: Vec<String> = capabilities.keys().cloned().collect();
        Self {
            run_id: run_id.to_string(),
            session_id: session_id.to_string(),
            edge_id: "edge-a".to_string(),
            authority: AuthorityManager::new(session_id, "edge-a", secret),
            shadows: ShadowManager::default(),
            config: SpeculationConfig::default(),
            capabilities,
            topology_coords,
            prediction: None,
            timeline: Vec::new(),
            mode: "prevail".into(),
            transport: Arc::new(QuicTransportStub::new("edge-a", peers)),
            predictor_url: predictor_url.to_string(),
            demo_step: 0,
            vehicle_latitude: None,
            vehicle_longitude: None,
            vehicle_heading: None,
            vehicle_trail: Vec::new(),
            traffic_vehicles: Vec::new(),
        }
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
        let pred = client.predict(&self.session_id).await;
        self.prediction = Some(pred.clone());
        self.emit(
            "PredictionIssued",
            None,
            "Next-edge prediction updated",
            pred.probabilities
                .iter()
                .map(|(k, v)| (k.clone(), format!("{:.2}", v)))
                .collect(),
        );
    }

    pub async fn on_trajectory(&mut self, sample: TrajectorySample) {
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
            self.refresh_prediction().await;
            self.run_speculation_cycle().await;
            self.handle_handoff(&sample.edge_id).await;
        }
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
    }

    async fn handle_handoff(&mut self, new_edge: &str) {
        let threshold = self.config.promotion_sync_threshold;
        if self.shadows.ready_for_promotion(new_edge, threshold).is_ok() {
            let from = self.authority.holder().to_string();
            if self.authority.promote(new_edge, &from).is_ok() {
                self.shadows.promote_shadow_to_authoritative(new_edge);
                self.emit(
                    "AuthorityTransferred",
                    Some(new_edge),
                    "Authority transferred via warm shadow promotion",
                    HashMap::new(),
                );
                self.emit(
                    "EdgePromoted",
                    Some(new_edge),
                    "Shadow promoted to authoritative",
                    HashMap::new(),
                );
                self.emit(
                    "EdgeDemoted",
                    Some(&from),
                    "Previous authoritative edge demoted",
                    HashMap::new(),
                );
                return;
            }
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

        self.emit(
            "MigrationFallback",
            Some(new_edge),
            "Reactive migration fallback (Ram baseline path)",
            HashMap::new(),
        );
        let from = self.authority.holder().to_string();
        let _ = self.authority.promote(new_edge, &from);
        self.shadows.clear();
    }

    pub async fn run_speculation_cycle(&mut self) {
        let pred = match &self.prediction {
            Some(p) => p.clone(),
            None => mock_prediction(&self.session_id),
        };
        let decision = evaluate_speculation(
            &pred,
            &self.edge_id,
            &self.capabilities,
            &self.config,
        );
        if !decision.should_speculate {
            self.emit("SpeculationSkipped", None, &decision.reason, HashMap::new());
            return;
        }
        for target in &decision.target_edge_ids {
            if self.shadows.create(target).is_ok() {
                self.emit(
                    "ShadowCreated",
                    Some(target),
                    "Warm shadow created",
                    HashMap::new(),
                );
            }
        }
    }

    pub fn tick_shadow_sync(&mut self) {
        for s in self.shadows.list().to_vec() {
            if s.role == ShadowRole::WarmShadow && s.sync_ratio < 1.0 {
                self.shadows.tick_sync(&s.edge_id, 0.08);
                if let Some(updated) = self.shadows.list().iter().find(|x| x.edge_id == s.edge_id) {
                    let mut payload = HashMap::new();
                    payload.insert("sync_ratio".into(), format!("{:.2}", updated.sync_ratio));
                    self.emit(
                        "ShadowSyncUpdate",
                        Some(&s.edge_id),
                        "Shadow synchronization progress",
                        payload,
                    );
                }
            }
        }
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
            3..=8 => self.tick_shadow_sync(),
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
                let sync_ratio = self
                    .shadows
                    .list()
                    .iter()
                    .find(|s| &s.edge_id == id)
                    .map(|s| s.sync_ratio);
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
            vehicle_trail: self.vehicle_trail.clone(),
            traffic_vehicles: self.traffic_vehicles.clone(),
        }
    }

    pub fn sidecar_authority(&self) -> (bool, String, u64) {
        (
            self.authority.holder() == self.edge_id,
            self.authority.holder().to_string(),
            self.authority.epoch(),
        )
    }

    pub fn peer_health(&self) -> HashMap<String, bool> {
        crate::transport::mesh_health(self.transport.as_ref())
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
