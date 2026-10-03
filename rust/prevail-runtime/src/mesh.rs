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
                Some(control_envelope::Payload::PeerPong(PeerPong {
                    edge_id: self.local_edge_id.clone(),
                    received_at_ms: ping.sent_at_ms,
                }))
            }

            Some(control_envelope::Payload::ShadowCreate(msg)) => {
                let ack = self.runtime.write().await.on_shadow_create(msg);
                Some(control_envelope::Payload::ShadowCreateAck(ack))
            }

            Some(control_envelope::Payload::ShadowRelease(msg)) => {
                self.runtime.write().await.on_shadow_release(msg);
                None
            }

            Some(control_envelope::Payload::ShadowSyncStatus(msg)) => {
                self.runtime.write().await.on_shadow_sync_status(msg);
                None
            }

            Some(control_envelope::Payload::AuthorityTransfer(msg)) => {
                let ack = self.runtime.write().await.on_authority_transfer(msg);
                Some(control_envelope::Payload::PromotionAck(ack))
            }

            Some(control_envelope::Payload::StateReplicate(msg)) => {
                self.runtime.write().await.on_state_replicate(msg);
                None
            }

            other => {
                tracing::debug!("unhandled control message: {other:?}");
                None
            }
        };

        reply_envelope(&self.local_edge_id, correlation_id, payload)
    }
}
