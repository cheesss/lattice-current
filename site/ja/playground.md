---
title: Operations Console
summary: Click through a mock map, internal hubs, replay flow, and scenario controls.
status: beta
variants:
  - full
  - tech
  - finance
updated: 2026-03-15
owner: core
---

# Playground

<p class="lc-section-caption">
This page is a hands-on public demo. The controls below use mock data so visitors can test a more product-like interaction model without a live backend.
</p>

<OperationsConsoleDemo locale="ja" />

## Replay and scenario workbench

The console above shows the operator surface. The workbench below shows historical replay, storage tiers, and scenario comparison with mock data shaped like the real replay stack.

<ReplayScenarioWorkbench locale="ja" />

## What this demonstrates

- a 2D theater map with clickable hotspots and layer toggles
- country relations, regional guidance, and recent event cards
- hub switching across analysis, Codex, ontology, backtest, and resources
- replay steps and macro scenario controls for the same region
- mock historical backtests built from ACLED, GDELT, FRED, and market baskets
- hot / warm / cold storage flow that mirrors the current retention design

## Limits

- mock data only
- no external APIs
- no private feeds, secrets, or service endpoints

