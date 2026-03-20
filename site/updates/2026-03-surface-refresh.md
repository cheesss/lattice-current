---
title: "2026-03: Product surface refresh, Replay Studio, and shared intelligence fabric"
summary: Lattice Current now presents itself as a workspace product with dedicated hubs, browser-runnable replay controls, and shared persistence for collected intelligence.
status: stable
variants:
  - full
  - tech
  - finance
updated: 2026-03-20
owner: core
---

# 2026-03: Product surface refresh, Replay Studio, and shared intelligence fabric

## What changed

- Reframed the app around workspace modes instead of forcing every panel to compete on the same screen
- Promoted dedicated hubs for:
  - `Briefing Desk`
  - `Research Desk`
  - `Replay Studio`
  - `Graph Studio`
- Added browser-runnable replay and scheduler controls through the local web runtime
- Added `Data Flow Ops` and automation governance surfaces to make pipeline health, blockers, lag, and retention visible
- Added a shared intelligence fabric so collected news, category feeds, clusters, and analysis artifacts can persist and be reused across hubs
- Reworked Replay Studio to interpret results, data health, and current posture instead of acting like a thin log viewer

## Why it matters

The older product shape still looked too much like a classic monitor wall. It made powerful capabilities available, but it hid intent. The new direction makes the app read as a structured signal workspace: collect, inspect, replay, compare, and decide.

At the same time, the app is less wasteful. Data gathered for snapshots, research, and backtesting is now persisted more deliberately and reused across multiple surfaces instead of acting like disposable session state.

## User impact

- The first read of the product is now closer to an analyst or investor workflow than a raw feed wall
- Replay and scheduler actions can be triggered from the browser path, not only the desktop runtime
- Collected intelligence survives better across sessions and can feed briefing, graph, and replay surfaces together
- Operations status is easier to interpret because the app exposes active stage, lag, blockers, and data readiness more clearly
- GitHub-facing docs now describe the current product direction instead of the inherited monitor identity

## Ongoing boundary

- External data quality and provider rate limits can still block a clean replay cycle
- Some deep implementation identifiers still reflect inherited lineage
- The short GitHub repository description still requires authenticated GitHub-side editing beyond repository files
