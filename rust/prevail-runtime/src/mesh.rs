//! Inbound side of the control mesh: routes QUIC control messages into the
//! local runtime.
//!
//! Outbound operations live on [`crate::runtime::PrevailRuntime`] because they
//! are driven by its own state machine; this module only handles what arrives.

use crate::proto::{control_envelope, ControlEnvelope, PeerPong};
use crate::quic::{reply_envelope, ControlHandler};
use crate::runtime::SharedRuntime;
use async_trait::async_trait;

/// Applies control messages to the runtime this edge owns.
pub struct MeshControlHandler {
    local_edge_id: String,
    runtime: SharedRuntime,
}

impl MeshControlHandler {
    pub fn new(local_edge_id: impl Into<String>, runtime: SharedRuntime) -> Self {
        Self {
            local_edge_id: local_edge_id.into(),
            runtime,
        }
    }
}

#[async_trait]
impl ControlHandler for MeshControlHandler {
    async fn handle(&self, envelope: ControlEnvelope) -> ControlEnvelope {
        let correlation_id = envelope.correlation_id;

        let payload = match envelope.payload {
            Some(control_envelope::Payload::PeerPing(ping)) => {
                let rt = self.runtime.read().await;
                let token = rt.authority_token();
                Some(control_envelope::Payload::PeerPong(PeerPong {
                    edge_id: self.local_edge_id.clone(),
                    received_at_ms: ping.sent_at_ms,
                    session_id: token.session_id,
                    epoch: token.epoch,
                    holder_edge_id: token.holder_edge_id,
                    signature: token.signature,
                    is_warm_shadow: rt.local_role() == crate::types::ShadowRole::WarmShadow,
                    is_authoritative: rt.is_authoritative(),
                }))
            }

            Some(control_envelope::Payload::ShadowCreate(msg)) => {
                let (ack, intent) = {
                    let mut rt = self.runtime.write().await;
                    let ack = rt.on_shadow_create(msg);
                    (ack, rt.take_flink_intent())
                };
                if let Some(intent) = intent {
                    let rt = self.runtime.clone();
                    tokio::spawn(async move {
                        crate::flink_jobs::apply_intent(rt, intent).await;
                    });
                }
                Some(control_envelope::Payload::ShadowCreateAck(ack))
            }

            Some(control_envelope::Payload::ShadowRelease(msg)) => {
                let intent = {
                    let mut rt = self.runtime.write().await;
                    rt.on_shadow_release(msg);
                    rt.take_flink_intent()
                };
                if let Some(intent) = intent {
                    let rt = self.runtime.clone();
                    tokio::spawn(async move {
                        crate::flink_jobs::apply_intent(rt, intent).await;
                    });
                }
                None
            }

            Some(control_envelope::Payload::ShadowSyncStatus(msg)) => {
                self.runtime.write().await.on_shadow_sync_status(msg);
                None
            }

            Some(control_envelope::Payload::AuthorityTransfer(msg)) => {
                let (ack, intent) = {
                    let mut rt = self.runtime.write().await;
                    let ack = rt.on_authority_transfer(msg);
                    (ack, rt.take_flink_intent())
                };
                if let Some(intent) = intent {
                    let rt = self.runtime.clone();
                    tokio::spawn(async move {
                        crate::flink_jobs::apply_intent(rt, intent).await;
                    });
                }
                Some(control_envelope::Payload::PromotionAck(ack))
            }

            Some(control_envelope::Payload::StateReplicate(msg)) => {
                let mut rt = self.runtime.write().await;
                if rt.is_authoritative() {
                    if let Some(proto_sample) = msg.sample {
                        rt.on_trajectory(crate::sample_codec::sample_from_proto(proto_sample))
                        .await;
                    }
                } else {
                    rt.on_state_replicate(msg);
                }
                None
            }

            Some(control_envelope::Payload::PromotionRequest(msg)) => {
                let ack = self.runtime.write().await.on_promotion_request(msg);
                Some(control_envelope::Payload::PromotionAck(ack))
            }

            Some(control_envelope::Payload::DemotionNotice(msg)) => {
                self.runtime.write().await.on_demotion_notice(msg);
                None
            }

            Some(control_envelope::Payload::StateAlign(msg)) => {
                self.runtime.write().await.on_state_align(msg);
                None
            }

            Some(control_envelope::Payload::CheckpointTransfer(msg)) => {
                let ack = self.runtime.write().await.on_checkpoint_transfer(msg);
                Some(control_envelope::Payload::CheckpointAck(ack))
            }

            Some(control_envelope::Payload::CapabilityAdvertisement(msg)) => {
                self.runtime.write().await.on_capability_advertisement(msg);
                None
            }

            Some(control_envelope::Payload::MigrationFallbackStart(msg)) => {
                self.runtime.write().await.on_migration_fallback_start(msg);
                None
            }

            Some(control_envelope::Payload::MigrationFallbackComplete(msg)) => {
                self.runtime.write().await.on_migration_fallback_complete(msg);
                None
            }

            Some(control_envelope::Payload::SpeculationDecision(msg)) => {
                self.runtime.write().await.on_speculation_decision(msg);
                None
            }

            Some(control_envelope::Payload::TimelineEvent(_)) => None,

            other => {
                tracing::debug!("unhandled control message: {other:?}");
                None
            }
        };

        reply_envelope(&self.local_edge_id, correlation_id, payload)
    }
}
