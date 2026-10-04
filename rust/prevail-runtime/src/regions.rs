//! GPS → edge mapping using the same polygons/centroids as Python RegionMapper.

use serde::Deserialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
pub struct Region {
    pub edge_id: String,
    pub latitude: f64,
    pub longitude: f64,
    #[serde(default)]
    pub coverage_radius_m: Option<f64>,
    #[serde(default)]
    pub polygon: Vec<[f64; 2]>,
}

#[derive(Debug, Deserialize)]
struct RegionsFile {
    regions: Vec<Region>,
}

pub fn load_regions(path: &Path) -> Option<Vec<Region>> {
    let raw = fs::read_to_string(path).ok()?;
    let parsed: RegionsFile = serde_json::from_str(&raw).ok()?;
    Some(parsed.regions)
}

pub fn map_edge_id(lat: f64, lon: f64, regions: &[Region]) -> String {
    if regions.is_empty() {
        return "edge-a".into();
    }
    let mut contained: Vec<(&str, f64)> = Vec::new();
    let mut nearest = regions[0].edge_id.as_str();
    let mut nearest_d = f64::MAX;
    for region in regions {
        let d = haversine_m(lat, lon, region.latitude, region.longitude);
        if d < nearest_d {
            nearest_d = d;
            nearest = region.edge_id.as_str();
        }
        if region.polygon.len() >= 3 && point_in_polygon(lat, lon, &region.polygon) {
            contained.push((region.edge_id.as_str(), d));
        }
    }
    if !contained.is_empty() {
        contained.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
        return contained[0].0.to_string();
    }
    nearest.to_string()
}

fn haversine_m(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    const R: f64 = 6_371_000.0;
    let p1 = lat1.to_radians();
    let p2 = lat2.to_radians();
    let dp = (lat2 - lat1).to_radians();
    let dl = (lon2 - lon1).to_radians();
    let a = (dp / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
    R * 2.0 * a.sqrt().atan2((1.0 - a).sqrt())
}

fn point_in_polygon(lat: f64, lon: f64, polygon: &[[f64; 2]]) -> bool {
    let mut inside = false;
    let n = polygon.len();
    let mut j = n - 1;
    for i in 0..n {
        let (yi, xi) = (polygon[i][0], polygon[i][1]);
        let (yj, xj) = (polygon[j][0], polygon[j][1]);
        let intersects = ((xi > lon) != (xj > lon))
            && (lat < (yj - yi) * (lon - xi) / ((xj - xi).abs().max(1e-12)) + yi);
        if intersects {
            inside = !inside;
        }
        j = i;
    }
    inside
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn centroid_maps_to_edge_a() {
        let regions = vec![Region {
            edge_id: "edge-a".into(),
            latitude: 12.920709,
            longitude: 77.663605,
            coverage_radius_m: Some(1341.0),
            polygon: vec![
                [12.9087, 77.6513],
                [12.9327, 77.6513],
                [12.9327, 77.6759],
                [12.9087, 77.6759],
            ],
        }];
        assert_eq!(map_edge_id(12.920709, 77.663605, &regions), "edge-a");
    }
}
