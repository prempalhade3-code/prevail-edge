# ADR-001: Flink deployment topology

**Status:** Accepted  
**Date:** 2026-09-23

## Decision

Central Flink JobManager with **edge-labeled TaskManagers** in Docker (one TM affinity label per edge container).

## Rationale

Balances operational simplicity with edge-local slot assignment. PREVAIL authority is enforced in Rust, not by Flink placement alone.

## Consequences

- Ram implements operators in `flink/prevail-job/`.
- Prem implements coordinator hooks in `flink/prevail-coordinator/`.
- Chirag wires JM/TM services in Compose when ready.
