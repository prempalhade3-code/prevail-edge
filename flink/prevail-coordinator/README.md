# PREVAIL Flink Coordinator (Prem)

Mobility `ProcessFunction` and sidecar authority gating per ADR-004.

- **Owner:** Prem — do not modify from `flink/prevail-job/` (Ram).
- **Sidecar:** Rust runtime `GET /v1/sidecar/authority`
- **Build:** `mvn -q compile` (Java 17, Flink 1.18)
