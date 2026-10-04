//! gRPC PrevailSidecar (ADR-004) served next to the HTTP sidecar.

use crate::flink_state::KeyedWorkloadState;
use crate::proto::prevail_sidecar_server::{PrevailSidecar, PrevailSidecarServer};
use crate::proto::{
    AuthorityQuery, AuthorityState, FlinkKeyedState, IngressBatch, IngressQuery, LocationAck,
    PromotionNotice, PromotionSidecarAck, RestoreQuery, StateAck,
    TrajectorySample as ProtoSample,
};
use crate::runtime::SharedRuntime;
use tonic::{Request, Response, Status};

pub struct SidecarService {
    runtime: SharedRuntime,
}

impl SidecarService {
    pub fn new(runtime: SharedRuntime) -> Self {
        Self { runtime }
    }

    pub fn into_server(self) -> PrevailSidecarServer<Self> {
        PrevailSidecarServer::new(self)
    }
}

#[tonic::async_trait]
impl PrevailSidecar for SidecarService {
    async fn report_location(
        &self,
        request: Request<ProtoSample>,
    ) -> Result<Response<LocationAck>, Status> {
        let msg = request.into_inner();
        let sample = crate::sample_codec::sample_from_proto(msg);
        let mut rt = self.runtime.write().await;
        rt.on_trajectory(sample).await;
        let holder = rt.snapshot().authority.holder_edge_id;
        Ok(Response::new(LocationAck {
            accepted: true,
            current_authoritative_edge: holder,
        }))
    }

    async fn get_authority(
        &self,
        request: Request<AuthorityQuery>,
    ) -> Result<Response<AuthorityState>, Status> {
        let session = request.into_inner().session_id;
        let rt = self.runtime.read().await;
        let (is_auth, holder, epoch) = rt.sidecar_authority();
        Ok(Response::new(AuthorityState {
            session_id: if session.is_empty() {
                rt.session_id.clone()
            } else {
                session
            },
            is_authoritative: is_auth,
            holder_edge_id: holder,
            epoch,
            output_enabled: is_auth,
        }))
    }

    async fn on_promotion(
        &self,
        request: Request<PromotionNotice>,
    ) -> Result<Response<PromotionSidecarAck>, Status> {
        let notice = request.into_inner();
        let mut rt = self.runtime.write().await;
        rt.on_flink_promotion(&notice.session_id, &notice.new_holder_edge_id, notice.epoch);
        Ok(Response::new(PromotionSidecarAck {
            output_gate_updated: true,
        }))
    }

    async fn report_state(
        &self,
        request: Request<FlinkKeyedState>,
    ) -> Result<Response<StateAck>, Status> {
        let msg = request.into_inner();
        let mut rt = self.runtime.write().await;
        rt.apply_flink_state(KeyedWorkloadState::from_proto(&msg));
        Ok(Response::new(StateAck { accepted: true }))
    }

    async fn pull_ingress(
        &self,
        request: Request<IngressQuery>,
    ) -> Result<Response<IngressBatch>, Status> {
        let limit = request.into_inner().limit.max(1) as usize;
        let mut rt = self.runtime.write().await;
        let samples = rt.drain_flink_ingress(limit);
        let proto_samples = samples
            .into_iter()
            .map(|s| crate::sample_codec::sample_to_proto(&s))
            .collect();
        Ok(Response::new(IngressBatch {
            samples: proto_samples,
        }))
    }

    async fn restore_state(
        &self,
        request: Request<RestoreQuery>,
    ) -> Result<Response<FlinkKeyedState>, Status> {
        let _ = request.into_inner();
        let mut rt = self.runtime.write().await;
        let state = rt
            .take_pending_flink_restore()
            .unwrap_or_else(|| rt.flink_restore_state());
        Ok(Response::new(state.to_proto()))
    }
}

pub async fn serve_sidecar(
    addr: std::net::SocketAddr,
    runtime: SharedRuntime,
) -> Result<(), tonic::transport::Error> {
    let service = SidecarService::new(runtime);
    tracing::info!(%addr, "gRPC sidecar listening");
    tonic::transport::Server::builder()
        .add_service(service.into_server())
        .serve(addr)
        .await
}
