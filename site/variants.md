---
title: Variants
summary: Product variants served from one repository and shared runtime.
status: stable
variants:
  - full
  - tech
  - finance
updated: 2026-03-15
owner: core
---

# Variants

World Monitor is one repository with multiple product surfaces.

| Variant | Focus | Typical user |
| --- | --- | --- |
| `full` | geopolitics, conflict, infrastructure, intelligence | analyst, operator, OSINT monitor |
| `tech` | AI, cloud, startup, cyber, ecosystem mapping | tech strategy, venture, platform research |
| `finance` | macro, cross-asset, market transmission, replay, ideas | macro and event-driven research |

## Shared foundations

All variants use the same core for:

- data collection and normalization
- AI-assisted summaries and Q&A
- ontology and graph services
- event transmission modeling
- replay and backtesting primitives

## Variant-aware docs

When a page applies to only some variants, the frontmatter and content should state that explicitly.
