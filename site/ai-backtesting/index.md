---
title: AI & Backtesting
summary: How the AI layer, investment logic, and replay engine fit together.
status: beta
variants:
  - full
  - tech
  - finance
updated: 2026-03-15
owner: core
---

# AI & Backtesting

This section groups the project documents that explain how AI, investment logic, and replay are integrated.

## Core artifacts

- [AI and backtesting integration analysis](https://github.com/cheesss/worldmonitor/blob/main/docs/ai_backtest_analysis.md)
- [Improvement plan: 60 concrete areas](https://github.com/cheesss/worldmonitor/blob/main/docs/improvement_plan_60_points.md)
- [UX and visualization improvements](https://github.com/cheesss/worldmonitor/blob/main/docs/ux_visualization_improvements.md)
- [Investment usage playbook](https://github.com/cheesss/worldmonitor/blob/main/docs/investment-usage-playbook.md)

## Integrated flow

1. live feeds and structured services create a current snapshot
2. AI and graph layers build evidence-grounded context
3. investment logic maps themes to assets and creates idea candidates
4. replay and walk-forward backtesting evaluate those ideas over time
5. learned priors flow back into live decision support

## Current limits

- some probabilistic layers remain practical approximations
- replay quality depends on point-in-time data completeness
- learned sizing still mixes adaptive priors with hard guardrails

## Read next

- [Algorithms](/algorithms)
- [Architecture](/architecture)
- [Features / Investment & Replay](/features/investment-replay)
