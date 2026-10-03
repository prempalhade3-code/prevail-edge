# ADR-012: HTTP sidecar is the v1 Rust ↔ Flink binding

**Status:** Accepted  
**Date:** 2026-10-03  
**Supersedes in practice:** ADR-004 gRPC-on-:50051 for the thesis demo

## Decision

v1 uses `GET /v1/sidecar/authority` over HTTP. Flink resolves the edge from `PREVAIL_EDGE_URLS` (`edge-a=http://127.0.0.1:8090,...`) and queries that process. `is_authoritative` is true only when **this process** holds the token (`local_edge_id`).

gRPC (`proto/v0/prevail_sidecar.proto`) remains the future contract. It is not required for handoff correctness.

## Consequences

- Demo exports `PREVAIL_EDGE_URLS` into the Flink JVM.
- Sidecar errors fail-closed (`outputEnabled = false`).
- Handoff latency is **not** reported by Flink env constants; it comes from `AuthorityTransferred.latency_ms`.
