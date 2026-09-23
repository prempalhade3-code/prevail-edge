# ADR-006: Incomplete sync at handoff

**Status:** Accepted  
**Date:** 2026-09-23

## Decision

If vehicle enters predicted edge but `sync_ratio < threshold`: **fallback reactive migration** (Ram's baseline path), discard shadow.

Do not promote stale shadows.
