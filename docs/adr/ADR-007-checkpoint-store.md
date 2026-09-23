# ADR-007: Checkpoint store for baseline migration

**Status:** Accepted  
**Date:** 2026-09-23

## Decision

Container-local volume `/var/prevail/checkpoints` per edge. Ram's baseline job reads/writes via documented path convention.

MinIO deferred unless multi-host demos require it.
