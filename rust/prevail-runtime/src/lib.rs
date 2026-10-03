pub mod api;
pub mod authority;
pub mod config;
pub mod predictor;
pub mod quic;
pub mod runtime;
pub mod shadow;
pub mod speculation;
pub mod transport;
pub mod types;

/// Generated Protobuf types for the shared control-plane contract.
pub mod proto {
    include!(concat!(env!("OUT_DIR"), "/prevail.v0.rs"));
}

pub use runtime::{PrevailRuntime, SharedRuntime};
