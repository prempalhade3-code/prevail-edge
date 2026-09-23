use crate::types::{EdgeCapability, PredictionResult, SpeculationConfig};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpeculationDecision {
    pub should_speculate: bool,
    pub target_edge_ids: Vec<String>,
    pub reason: String,
}

/// Resource-bounded speculation with capability filter and ETA lead-time gate.
pub fn evaluate_speculation(
    prediction: &PredictionResult,
    current_edge: &str,
    capabilities: &HashMap<String, EdgeCapability>,
    config: &SpeculationConfig,
) -> SpeculationDecision {
    let eta = prediction.eta_sec.unwrap_or(0.0);
    let min_time = config.estimated_sync_sec + config.promotion_margin_sec;
    if eta > 0.0 && eta < min_time {
        return SpeculationDecision {
            should_speculate: false,
            target_edge_ids: vec![],
            reason: format!(
                "ETA {:.1}s < required {:.1}s for sync+margin",
                eta, min_time
            ),
        };
    }

    let mut ranked: Vec<(String, f64)> = prediction
        .probabilities
        .iter()
        .filter(|(id, _)| id.as_str() != current_edge)
        .map(|(id, p)| (id.clone(), *p))
        .collect();
    ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let mut targets = Vec::new();
    for (edge_id, prob) in ranked {
        if prob < config.min_confidence {
            continue;
        }
        if let Some(cap) = capabilities.get(&edge_id) {
            if config.require_image_capability && !cap.supports_image {
                continue;
            }
            if cap.cpu_available_ratio < 0.05 || cap.memory_available_ratio < 0.05 {
                continue;
            }
        }
        targets.push(edge_id);
        if targets.len() >= config.max_shadows {
            break;
        }
    }

    if targets.is_empty() {
        SpeculationDecision {
            should_speculate: false,
            target_edge_ids: vec![],
            reason: "No candidate passed confidence, capability, or resource gates".into(),
        }
    } else {
        SpeculationDecision {
            should_speculate: true,
            target_edge_ids: targets,
            reason: "Speculation approved".into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn pred(probs: &[(&str, f64)], eta: f64) -> PredictionResult {
        PredictionResult {
            session_id: "s".into(),
            model_version: "test".into(),
            probabilities: probs.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
            eta_sec: Some(eta),
            computed_at_ms: 0,
        }
    }

    #[test]
    fn eta_gate_blocks_short_lead_time() {
        let caps = HashMap::new();
        let d = evaluate_speculation(
            &pred(&[("edge-b", 0.9)], 3.0),
            "edge-a",
            &caps,
            &SpeculationConfig::default(),
        );
        assert!(!d.should_speculate);
    }

    #[test]
    fn selects_top_confident_edge() {
        let mut caps = HashMap::new();
        caps.insert(
            "edge-b".into(),
            EdgeCapability {
                edge_id: "edge-b".into(),
                supports_stream: true,
                supports_image: true,
                supports_gpu: false,
                cpu_available_ratio: 0.5,
                memory_available_ratio: 0.5,
            },
        );
        let d = evaluate_speculation(
            &pred(&[("edge-b", 0.82), ("edge-c", 0.13)], 20.0),
            "edge-a",
            &caps,
            &SpeculationConfig::default(),
        );
        assert!(d.should_speculate);
        assert_eq!(d.target_edge_ids, vec!["edge-b"]);
    }
}
