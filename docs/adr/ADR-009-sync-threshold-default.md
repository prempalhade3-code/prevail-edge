# ADR-009: Default sync threshold

**Status:** Accepted  
**Date:** 2026-09-23

## Decision

`promotion_sync_threshold = 0.95`  
`promotion_margin_sec = 2.0` (added to ETA gate)  
`min_confidence = 0.60` for single-shadow speculation

Configurable via runtime env `PREVAIL_SPECULATION_*`.
