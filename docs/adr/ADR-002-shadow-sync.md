# ADR-002: Warm shadow state synchronization

**Status:** Accepted  
**Date:** 2026-09-23

## Decision

**Stream tee + periodic keyed-state alignment** from authoritative Flink subtask to shadow. Checkpoint deltas as Phase 4 optimization.

## Sync metric (ADR-003 linked)

`sync_ratio = 1 - (lag_records / max(authoritative_records, 1))`, clamped to [0, 1].

## Consequences

Shadow manager tracks `ShadowSyncStatus` until `sync_ratio >= 0.95` for promotion eligibility.
