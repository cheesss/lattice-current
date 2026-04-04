---
title: Signal Evaluation
summary: How signal interpretation, decision support, and replay validation fit together.
status: beta
variants:
  - full
  - tech
  - finance
updated: 2026-04-05
owner: core
---

# Signal Evaluation

This section groups the documents that explain how AI, signal interpretation, decision support, and replay validation fit together on the current branch.

## Core artifacts

- [Documentation index](https://github.com/cheesss/lattice-current/blob/main/docs/DOCUMENTATION.md)
- [Algorithms](https://github.com/cheesss/lattice-current/blob/main/docs/ALGORITHMS.md)
- [AI intelligence](https://github.com/cheesss/lattice-current/blob/main/docs/AI_INTELLIGENCE.md)
- [Decision support playbook](https://github.com/cheesss/lattice-current/blob/main/docs/investment-usage-playbook.md)
- [Temporal feature upgrade status](https://github.com/cheesss/lattice-current/blob/main/docs/TEMPORAL_FEATURE_UPGRADE_2026-04-05.md)

## Integrated flow

1. live feeds and structured services create a current snapshot
2. AI, event resolution, and graph layers build evidence-grounded context
3. decision-support logic maps signals into structured candidates
4. replay and historical validation test whether those candidates are coherent
5. validation results refine evidence and admission quality over time

## Public mock workbench

The public docs include a click-through mock replay workbench. It is not connected to private feeds, but it mirrors the product structure.

- point-in-time datasets
- replay and scenario comparison
- operator decision posture
- hot / warm / cold storage lifecycle

<ReplayScenarioWorkbench locale="en" />

## Current limits

- some probabilistic layers remain practical approximations
- replay quality depends on point-in-time data completeness
- the main branch is not a full autonomous trading stack

## Read next

- [Algorithms](/algorithms)
- [Architecture](/architecture)
- [Features / Investment & Replay](/features/investment-replay)
- [Operations Console](/playground)
