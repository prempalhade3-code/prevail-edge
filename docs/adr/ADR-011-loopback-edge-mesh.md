# ADR-011: Loopback multi-process edge mesh (no Docker on critical path)

**Status:** Accepted  
**Date:** 2026-10-03

## Context

The master plan equates one edge node with one Docker container. Docker is unreliable on the primary development machine, but the research requirement is genuinely separate processes exchanging Protobuf over QUIC — not containerization for its own sake.

## Decision

Run four `prevail-runtime` OS processes on loopback:

| Edge   | HTTP | QUIC |
|--------|------|------|
| edge-a | 8090 | 9101 |
| edge-b | 8092 | 9102 |
| edge-c | 8094 | 9103 |
| edge-d | 8096 | 9104 |

The FastAPI backend aggregates snapshots from all four HTTP endpoints. Trajectory ingest goes to the bootstrap authoritative edge (`edge-a`).

Docker Compose remains available for resource-limit and partition experiments but is not on the thesis-demo critical path.

## Consequences

- `scripts/run-edge-mesh.sh` and `scripts/run-prevail-demo.sh` launch the mesh without Docker.
- `PREVAIL_MESH_PEERS` and `PREVAIL_EDGE_URLS` configure QUIC and HTTP respectively.
- Lab TLS uses self-signed certificates with an accept-any verifier (ADR-010 pattern).
