# PREVAIL Protobuf schemas

**Owner:** Prem (primary). Propose changes via PR to `develop`.

| File | Purpose |
|------|---------|
| `v0/prevail_control.proto` | Inter-edge control plane + timeline events |
| `v0/prevail_sidecar.proto` | Flink ↔ Rust sidecar gRPC (ADR-04) |

Generate code:

- Rust: `tonic-build` compiles both protos in `rust/prevail-runtime/build.rs` (gRPC sidecar server included).
- Java: message names live in `flink/prevail-coordinator/.../PrevailControlMessages.java`; Flink talks to the sidecar over HTTP + the generated RPC surface.

JSON equivalents for early integration: `docs/contracts/*.schema.json`
