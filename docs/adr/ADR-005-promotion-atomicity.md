# ADR-005: Promotion atomicity

**Status:** Accepted  
**Date:** 2026-09-23

## Decision

Two-phase promotion: `PromotionRequest` → old holder `PromotionAck` → epoch increment → `AuthorityTransfer`.

Old holder must ack before new holder enables official output.
