---
title: Investment & Replay
summary: Event-to-asset mapping, idea support, replay, and walk-forward evaluation.
status: beta
variants:
  - finance
  - tech
updated: 2026-03-16
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
- coverage-aware universe summary, review queue, and gap tracking
- approved dynamic candidates that join the next refresh and subsequent backtests
- universe policy modes for manual, guarded auto-approval, and full auto-approval
- scheduler-driven replay and nightly walk-forward when the automation worker is enabled
- theme discovery queue items that can become reusable backtest themes after Codex proposal and guarded promotion
- source registry candidates that can now auto-approve and auto-activate under guarded score and diversity policy
- coverage-gap candidate expansion that can now be requested by the scheduler instead of only by button clicks
- candidate auto-approval that now uses composite scoring plus sector and asset-kind caps
- repeated uncovered theme pressure that can now propose and guard-register missing historical datasets
- weak theme motifs and low-signal autonomous keywords that can now be auto-retired or auto-rejected
- weak idea cards that can now be auto-suppressed before the operator view
- cross-corroboration scoring that penalizes rumor-heavy or contradictory source clusters
- calibrated confidence and constrained autonomy actions: `deploy`, `shadow`, `watch`, `abstain`
- time-decay and recent-evidence floors so stale mapping priors cannot dominate current recommendations
- reality-aware execution checks for spread, slippage, liquidity, and session state
- shadow-book rollback signals that can force the engine back into shadow mode after weak recent performance
- macro kill-switch and hedge overlay that can override attractive micro themes
- hidden graph-propagated candidates that can surface second-order transmission plays
- explainable attribution that splits corroboration, graph, beta, macro, and reality penalties
- self-tuning experiment history and active weight profile summaries
- cost-adjusted replay summaries in Backtest Lab, not only raw signed returns

## Key UI surfaces

- Investment Workflow
- Auto Investment Ideas
- Backtest Lab
- Transmission Sankey / Network
- Coverage-aware universe review queue

## Algorithms involved

- event-to-market transmission
- regime weighting
- Kalman-style adaptive weighting
- Hawkes intensity, transfer entropy, bandits
- historical replay and warm-up handling
- coverage-aware candidate retrieval
- deterministic ranking over core plus approved expansion assets
- Codex-assisted candidate expansion as a reviewed queue, not an execution path
- guarded auto-approval with probation and auto-demotion
- composite auto-approval scoring with source, role, supporting signals, and crowding penalties
- dataset registry plus scheduler worker for unattended replay cadence
- theme discovery queue built from repeated unmapped motifs in replay frames
- Codex theme proposer automation with guarded auto-promotion, novelty overlap limits, and promotion scores
- source automation sweep for discovered feed and API registry acceptance using score, health, and diversity caps
- scheduler-driven candidate expansion and replay refresh after accepted universe changes, with cooldown and per-region balancing
- autonomous keyword lifecycle review and theme-queue hygiene
- pre-render idea-card triage and suppression
- cross-corroboration and contradiction penalties over clustered sources
- confidence calibration, no-trade gating, and shadow-only fallback
- execution-reality penalties for session state, spread, slippage, and liquidity
- recency weighting and stale-prior decay inside deterministic ranking
- shadow-book rollback and constrained autonomy state carried into the operator workflow
- guarded dataset discovery and auto-registration for replay-safe historical coverage expansion
- experiment registry and self-tuning weight promotion / rollback
- graph-driven hidden candidate propagation beyond direct trigger keywords
- macro risk overlay with kill-switch, hedge bias, and exposure caps
- explainable attribution over corroboration, graph support, beta, macro pressure, and penalties

## Limits

The public site documents the system behavior but not private operational data or sensitive market configurations.

The engine is now closer to constrained autonomy, but it is still not a blind live auto-trader. It remains:

- a decision-support and paper-trade research surface first
- a cost-aware replay engine second
- a human-reviewed or policy-gated execution candidate generator, not an unconstrained execution bot

## What changed in practice

The replay stack no longer behaves like a static "theme scorecard" only.

It can now:

- widen its historical dataset registry when the current research surface is too narrow
- tune its own weight profile through guarded experiments
- discover hidden candidates through graph propagation
- apply top-down macro kill-switch logic before attractive micro trades survive
- explain whether an idea was driven by corroborated event evidence, graph support, generic beta, or penalty-heavy noise

This means the system is still constrained, but it is noticeably less dependent on manual queue curation than earlier versions.

## Variant coverage

Primary: `finance`. Extended and shared support also exists in `tech`.
