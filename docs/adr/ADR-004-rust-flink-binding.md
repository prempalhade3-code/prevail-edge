# ADR-004: Rust ↔ Flink integration

**Status:** Accepted  
**Date:** 2026-09-23

## Decision

**Sidecar gRPC** in the same edge container (`proto/v0/prevail_sidecar.proto`).

Flink `MobilityProcessFunction` calls `GetAuthority` before enabling sinks.

## Mock until integrated

Ram's job uses stub returning `is_authoritative=true`; Prem's runtime provides real responses on port `50051`.

**v1 demo update (ADR-012):** the thesis demo uses HTTP `GET /v1/sidecar/authority` and `PREVAIL_EDGE_URLS`. gRPC on `:50051` is deferred.
