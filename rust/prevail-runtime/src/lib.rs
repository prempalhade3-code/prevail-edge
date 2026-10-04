pub mod api;
pub mod authority;
pub mod config;
pub mod flink_jobs;
pub mod flink_state;
pub mod mesh;
pub mod multicast;
pub mod observability;
pub mod predictor;
pub mod quic;
pub mod resources;
pub mod regions;
pub mod runtime;
pub mod sample_codec;
pub mod shadow;
pub mod sidecar_grpc;
pub mod speculation;
pub mod transport;
pub mod types;

/// Generated Protobuf types for the shared control-plane contract.
pub mod proto {
    tonic::include_proto!("prevail.v0");
}

pub use runtime::{PrevailRuntime, SharedRuntime};
