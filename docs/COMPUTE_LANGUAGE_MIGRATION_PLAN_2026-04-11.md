# Compute Language Migration Plan

## Goal

Split the codebase by workload type instead of keeping all heavy compute inside
TypeScript. The near-term target architecture is:

- TypeScript: browser UI, API routes, ingestion orchestration, desktop shell
- Python: financial compute, clustering, embedding post-processing, model
  training, offline backtests
- Rust: Tauri runtime only, with optional future hot-loop acceleration

## Why

The repository already uses Python successfully for model training, but several
CPU-bound scripts still live in Node:

- `scripts/event-engine-full-build.mjs`
- `scripts/build-canonical-events-fast.mjs`
- `scripts/generate-embeddings.mjs`
- `scripts/compute-abnormal-returns.mjs`
- `scripts/compute-trend-aggregates.mjs`
- `src/services/investment/portfolio-optimizer.ts`
- `src/services/math-models/*.ts`
- `src/services/backtest/replay-workflow.ts`
- `src/services/replay-adaptation.ts`

These parts are dominated by matrix operations, clustering, optimization, or
simulation loops. They are a poor fit for handwritten JavaScript loops and are
better served by `numpy`, `scipy`, `scikit-learn`, and related Python tooling.

## Recommended execution boundary

### Keep in TypeScript

- `src/components/**`
- `src/views/**`
- `src/App.ts`
- `server/**`
- `api/**`
- ingestion/orchestration scripts that are mostly I/O-bound

### Move to Python

- canonical-event clustering
- embedding post-processing and vector similarity workflows
- abnormal return / trend aggregate compute
- regime, Hawkes, and what-if analytics
- portfolio optimization and math-model utilities
- replay/backtest engines once the data contract is stabilized

## Phase plan

### Phase 1: establish Python compute lane

- Add a shared Python dependency file.
- Add Python runtime helpers for NAS/PostgreSQL config.
- Move `build-canonical-events-fast` to Python first.
- Keep the current Node entrypoint name and use it as a wrapper so existing
  workflows do not break.
- Preserve the current JavaScript implementation as a fallback.

### Phase 2: move adjacent vector workloads

- `generate-embeddings.mjs`
- `_clustering.mjs` replacements for offline use
- `compute-abnormal-returns.mjs`
- `compute-trend-aggregates.mjs`

These should write results back to PostgreSQL/NAS so UI and API code stay
unchanged.

### Phase 3: migrate finance and simulation engines

- `scripts/event-engine-full-build.mjs`
- `src/services/investment/portfolio-optimizer.ts`
- `src/services/math-models/*.ts`
- `src/services/backtest/replay-workflow.ts`
- `src/services/replay-adaptation.ts`

Start with Python ports behind file or DB interfaces. Only consider Rust for
the hottest loops after Python profiling shows a real bottleneck.

## What changed in this pass

- `scripts/build-canonical-events-fast.mjs` is now intended to become a wrapper.
- `scripts/build_canonical_events.py` is the new Python-first implementation.
- `scripts/build-canonical-events-fast.legacy.mjs` preserves the old Node
  implementation.
- `scripts/compute-abnormal-returns.mjs` is now intended to become a wrapper.
- `scripts/compute_abnormal_returns.py` is the new Python-first implementation.
- `scripts/compute-abnormal-returns.legacy.mjs` preserves the old Node
  implementation.
- `scripts/requirements-compute.txt` defines the Python compute dependency
  baseline.

## Operational rule

TypeScript remains the system-of-record for product surfaces and orchestration.
Python owns batch compute and writes results to PostgreSQL. Consumers should
read computed outputs from the database instead of importing Python directly
into frontend code.
