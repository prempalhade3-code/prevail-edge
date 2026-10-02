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
