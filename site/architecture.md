---
title: Architecture
summary: Operator shell, canonical event layer, TypeScript/Python runtime boundary, and storage flows.
status: stable
variants:
  - full
  - tech
  - finance
updated: 2026-04-12
owner: core
---

# Architecture

<p class="lc-section-caption">
The architecture stack below is interactive. Click a layer to inspect its runtime boundary, owned nodes, responsibilities, state boundary, and security boundary.
</p>

<ScrollSignalStory locale="en" />

<SystemTopology locale="en" />

## Main subsystems

- operator shell and panel system around `event-dashboard.html`
- ingestion and normalization services for feeds, macro, market, and event sources
- canonical event layer that resolves raw article rows into reusable signal objects
- interpretation and decision-support services for briefs, proposals, approvals, and diagnostics
- Python batch compute lane for clustering, return analytics, and model training
- historical replay and archive services for downstream calibration
- desktop sidecar and local APIs for desktop-aware execution
- storage envelope, schema registry, and retention pipeline across NAS PostgreSQL, snapshots, DuckDB, and local cache

## Runtime boundary

The current runtime split is workload-driven:

### TypeScript owns

- browser UI and workspace shell
- API handlers and edge/server surfaces
- feed orchestration, scheduling, and ingestion
- desktop orchestration and local sidecar wiring

### Python owns

- canonical-event clustering
- abnormal-return analytics
- model training and comparison
- future CPU-bound finance, clustering, and simulation ports

### Rust owns

- Tauri runtime and native desktop lifecycle only

This keeps product surfaces in TypeScript while moving heavy batch compute to the toolchain that fits it.

## Current data-to-decision flow

1. raw feeds and structured sources are collected and normalized
2. canonical event resolution groups related evidence before scoring
3. interpretation services build theme briefs, proposals, and operator context
4. Python batch compute writes reusable results back to PostgreSQL
5. replay and historical validation evaluate whether the live logic stays calibrated

The important design change is that raw rows are no longer treated as final signal objects, and heavy compute is no longer forced through handwritten Node loops.

## Reference docs

- [Architecture deep dive](https://github.com/cheesss/lattice-current/blob/main/docs/ARCHITECTURE.md)
- [Compute language migration plan](https://github.com/cheesss/lattice-current/blob/main/docs/COMPUTE_LANGUAGE_MIGRATION_PLAN_2026-04-11.md)
- [Desktop runtime](https://github.com/cheesss/lattice-current/blob/main/docs/DESKTOP_APP.md)
- [Historical data sources](https://github.com/cheesss/lattice-current/blob/main/docs/historical-data-sources.md)
- [Phase 7 implementation notes](https://github.com/cheesss/lattice-current/blob/main/docs/PHASE7_IMPLEMENTATION_NOTES.md)
- [Intelligence server schema](https://github.com/cheesss/lattice-current/blob/main/docs/intelligence-server-schema.sql)
- [Service server plan](https://github.com/cheesss/lattice-current/blob/main/docs/service-server-plan.md)

## Public boundary

This site documents architecture decisions and major flows while omitting private operations, secrets, and sensitive deployment details.
