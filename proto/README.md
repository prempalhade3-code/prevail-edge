# PREVAIL Protobuf schemas

**Owner:** Prem (primary). Propose changes via PR to `develop`.

| File | Purpose |
|------|---------|
| `v0/prevail_control.proto` | Inter-edge control plane + timeline events |
| `v0/prevail_sidecar.proto` | Flink ↔ Rust sidecar gRPC (ADR-04) |

Generate code:

- Rust: `tonic-build` / `prost` (see `rust/prevail-runtime/build.rs`)
- Java: Flink module Maven protobuf plugin

JSON equivalents for early integration: `docs/contracts/*.schema.json`
