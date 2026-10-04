use std::path::PathBuf;

/// Compiles the shared control-plane and sidecar contracts in `proto/v0`.
fn main() {
    let proto_root = resolve_proto_root();
    let control = proto_root.join("v0").join("prevail_control.proto");
    let sidecar = proto_root.join("v0").join("prevail_sidecar.proto");

    println!("cargo:rerun-if-changed={}", control.display());
    println!("cargo:rerun-if-changed={}", sidecar.display());
    println!("cargo:rerun-if-changed={}", proto_root.display());

    tonic_build::configure()
        .build_server(true)
        .build_client(false)
        .compile_protos(&[control, sidecar], &[proto_root])
        .expect("failed to compile prevail protos");
}

fn resolve_proto_root() -> PathBuf {
    if let Ok(explicit) = std::env::var("PREVAIL_PROTO_ROOT") {
        return PathBuf::from(explicit);
    }

    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR always set by cargo"),
    );

    let mut dir = manifest_dir.as_path();
    loop {
        let candidate = dir.join("proto");
        if candidate.join("v0").join("prevail_control.proto").exists() {
            return candidate;
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => panic!(
                "could not locate proto/v0/prevail_control.proto above {}",
                manifest_dir.display()
            ),
        }
    }
}
