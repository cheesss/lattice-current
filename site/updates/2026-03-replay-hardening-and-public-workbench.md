---
title: "2026-03: Replay hardening, storage lifecycle, and public mock workbench"
summary: The platform now documents and demonstrates cold-start resilience, storage retention, replay hardening, and scenario review with a public mock workbench.
status: stable
variants:
  - full
  - tech
  - finance
updated: 2026-03-29
owner: core
---

# 2026-03: Replay hardening, storage lifecycle, and public mock workbench

## What changed

- Added a documented hot / warm / cold storage strategy with:
  - Redis hot cache
  - PostgreSQL warm retention
  - Parquet / S3-compatible cold archive scaffolding
- Added storage envelopes and schema-version-aware persistence contracts
- Added bootstrap cold-start fallback data and a seed bootstrap script so first deploys are less empty
- Hardened replay evaluation with:
  - max-hold fallback exits
  - gap markers
  - exclusion of non-tradable rows from hit-rate math
- Added merge conflict visibility to replay frame merging so data loss is no longer silent
- Added stale DuckDB lock cleanup for local replay persistence
- Added a public mock replay workbench to the docs site so visitors can explore the UI/UX with historical-style data without private feeds

## Why it matters

Recent work made the platform less disposable. Data collected for bootstrap, replay, and review is now documented as a lifecycle rather than a short-lived panel convenience.

At the same time, replay results are more honest. When there is no clean exit, the engine now records why. When execution is not tradable, hit-rate math can exclude that row instead of corrupting the score.

The public docs also improved. Instead of only describing replay in text, the site now includes a mock scenario workbench that behaves like a simplified product surface.

## User impact

- better explanation of how storage, replay, and archive layers fit together
- fewer confusing empty-first-deploy moments
- more realistic replay metrics
- a public way to preview scenario and replay UX without a private runtime

## Boundary

- The public workbench uses mock data, not live provider feeds
- Cold archive code is scaffolded and test-covered, but real object-store wiring still depends on deployment environment
- Online model retraining and centralized provider quota management remain follow-up work
