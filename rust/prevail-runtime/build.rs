use std::path::PathBuf;

/// Compiles the shared control-plane contract in `proto/v0` into Rust types.
///
/// The protos live at the repository root because the Flink and Python sides
/// consume the same files; generating from that one copy is what keeps the
/// wire format from forking per language.
fn main() {
    let proto_root = resolve_proto_root();
    let control = proto_root.join("v0").join("prevail_control.proto");

    println!("cargo:rerun-if-changed={}", control.display());
    println!("cargo:rerun-if-changed={}", proto_root.display());

    prost_build::Config::new()
        .compile_protos(&[control], &[proto_root])
        .expect("failed to compile prevail control protos");
}

/// Walks up from the crate directory to find `proto/v0`, so the build works
/// from the crate, the workspace, or the repository root.
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
