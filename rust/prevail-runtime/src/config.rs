use crate::types::EdgeCapability;
use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Deserialize)]
struct RegionsFile {
    regions: Vec<RegionEntry>,
}

#[derive(Debug, Deserialize)]
struct RegionEntry {
    edge_id: String,
    latitude: f64,
    longitude: f64,
}

#[derive(Debug, Deserialize)]
struct CapabilitiesFile {
    capabilities: HashMap<String, EdgeCapability>,
}

/// Canonical session identity, shared with the Python simulators and the Flink
/// sidecar. Must match `deploy/config/session.json` or the predictor accumulates
/// history under a key the runtime never queries.
#[derive(Debug, Clone, Deserialize)]
pub struct SessionConfig {
    pub session_id: String,
    pub run_id: String,
    #[serde(default = "default_bootstrap_edge")]
    pub bootstrap_edge_id: String,
    #[serde(default = "default_authority_secret")]
    pub authority_secret: String,
}

fn default_bootstrap_edge() -> String {
    "edge-a".to_string()
}

fn default_authority_secret() -> String {
    "lab-secret".to_string()
}

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            session_id: "sim-vehicle-01".to_string(),
            run_id: "run-demo-1".to_string(),
            bootstrap_edge_id: default_bootstrap_edge(),
            authority_secret: default_authority_secret(),
        }
    }
}

/// Loads session config from `PREVAIL_SESSION_CONFIG_PATH` or the default deploy
/// path, then applies `PREVAIL_SESSION_ID` / `PREVAIL_RUN_ID` overrides used by
/// experiment sweeps.
pub fn load_session_config() -> SessionConfig {
    let path = std::env::var("PREVAIL_SESSION_CONFIG_PATH")
        .unwrap_or_else(|_| "deploy/config/session.json".to_string());

    let mut cfg = fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<SessionConfig>(&raw).ok())
        .unwrap_or_default();

    if let Ok(session_id) = std::env::var("PREVAIL_SESSION_ID") {
        cfg.session_id = session_id;
    }
    if let Ok(run_id) = std::env::var("PREVAIL_RUN_ID") {
        cfg.run_id = run_id;
    }
    cfg
}

pub fn load_topology_from_file(path: &Path) -> Option<HashMap<String, (f64, f64)>> {
    let raw = fs::read_to_string(path).ok()?;
    let parsed: RegionsFile = serde_json::from_str(&raw).ok()?;
    Some(
        parsed
            .regions
            .into_iter()
            .map(|r| (r.edge_id, (r.latitude, r.longitude)))
            .collect(),
    )
}

pub fn load_capabilities_from_file(path: &Path) -> Option<HashMap<String, EdgeCapability>> {
    let raw = fs::read_to_string(path).ok()?;
    let parsed: CapabilitiesFile = serde_json::from_str(&raw).ok()?;
    Some(parsed.capabilities)
}

pub fn resolve_config_paths() -> (Option<std::path::PathBuf>, Option<std::path::PathBuf>) {
    let regions = std::env::var("PREVAIL_EDGE_REGIONS_PATH")
        .ok()
        .map(std::path::PathBuf::from);
    let capabilities = std::env::var("PREVAIL_EDGE_CAPABILITIES_PATH")
        .ok()
        .map(std::path::PathBuf::from);
    (regions, capabilities)
}
