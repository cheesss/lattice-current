---
title: "2026-03: Replay hardening, storage lifecycle, and public mock workbench"
summary: Cold-start resilience, storage retention, replay hardening, and a public mock replay workbench were added to the docs surface.
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

- documented a hot / warm / cold storage strategy
- added storage envelopes and schema-aware persistence
- added bootstrap cold-start fallback and a seed bootstrap script
- hardened replay evaluation with max-hold exits, gap markers, and non-tradable hit-rate exclusions
- added merge conflict visibility for replay frames
- added stale DuckDB lock cleanup
- added a public mock replay workbench to the docs site

## Why it matters

The system now explains and demonstrates how collected data survives long enough to support replay and review, instead of acting like disposable panel state.

## Boundary

- the public workbench uses mock data
- cold archival still depends on deployment environment wiring
- online retraining and centralized provider quota control remain follow-up work
