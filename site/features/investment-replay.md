---
title: Investment & Replay
summary: Event-to-asset mapping, idea support, replay, and walk-forward evaluation.
status: beta
variants:
  - finance
  - tech
updated: 2026-03-15
owner: core
---

# Investment & Replay

## What it does

Connects live events to assets, produces decision-support objects, and validates them with replay and backtesting.

## Why it exists

To turn narrative monitoring into testable, reviewable decision workflows.

## Inputs

- events, themes, and transmission outputs
- market time series
- source and mapping priors
- historical replay frames

## Outputs

- investment idea cards
- sizing and false-positive guardrails
- replay and walk-forward run summaries
- backtest lab visuals and decision comparisons

## Key UI surfaces

- Investment Workflow
- Auto Investment Ideas
- Backtest Lab
- Transmission Sankey / Network

## Algorithms involved

- event-to-market transmission
- regime weighting
- Kalman-style adaptive weighting
- Hawkes intensity, transfer entropy, bandits
- historical replay and warm-up handling

## Limits

The public site documents the system behavior but not private operational data or sensitive market configurations.

## Variant coverage

Primary: `finance`. Extended and shared support also exists in `tech`.
