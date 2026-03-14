# AI and Backtesting Integration Analysis

## Summary

World Monitor combines live intelligence collection, AI-assisted reasoning, investment idea generation, and historical replay into one pipeline.

The main integration points are:

- `data-loader.ts`: orchestrates snapshot creation and high-level refresh
- `data-qa.ts`: evidence-first Q&A, retrieval, prompt composition, and fallback answers
- `investment-intelligence.ts`: event-to-asset mapping, conviction, false-positive risk, sizing, tracking, and learning priors
- `historical-intelligence.ts`: replay, walk-forward backtesting, warm-up handling, and learning-state carryover
- `source-credibility.ts`: source reliability scoring and posterior updates
- `event-market-transmission.ts`: event-to-market linkage and regime-aware transmission scoring

## AI Layer

The AI layer is not a single chat model call. It is a stack:

1. evidence collection from current news, clusters, market context, and ontology state
2. retrieval and ranking of context based on question intent
3. multi-provider summarization / deduction path with local-first fallbacks
4. deterministic fallback summaries when higher-order reasoning is unavailable or low confidence

This keeps the system grounded in observable data rather than free-form model output.

## Investment Decision Layer

`investment-intelligence.ts` converts events into decision-support objects:

- candidate assets and ETFs
- direction (`long`, `short`, `hedge`, `watch`)
- conviction score
- false-positive risk
- suggested position size
- tracked and closed idea lifecycle

Recent additions also allow the model to adapt over time:

- mapping posterior updates
- EMA realized-return tracking
- bandit-driven allocation signals
- regime-aware weighting
- uncertainty surfaces for UI rendering

## Backtesting Layer

`historical-intelligence.ts` provides two main modes:

- historical replay: re-run the pipeline over time-ordered frames
- walk-forward: split data into train/validate/test windows and carry state forward

The replay engine now supports:

- point-in-time knowledge boundaries
- warm-up / burn-in frames
- learning-state persistence
- optional cold-archive storage

## Current Strengths

- evidence-first AI integration instead of pure chat veneer
- unified runtime for live monitoring and replay/backtesting
- variant-aware investment and intelligence surfaces
- explicit handling of uncertainty, priors, and regime signals
- strong path toward server-backed historical evaluation

## Current Limits

- some probabilistic layers are still practical approximations rather than full institutional-scale models
- historical importer coverage depends on provider shape and dataset quality
- market sizing still mixes learned priors with heuristic guardrails
- backtest quality remains bounded by point-in-time data completeness
