# Architecture

This document describes the current main-branch architecture of Lattice Current.

## System identity

The repository is now a signal-first decision-support workspace.

It is not organized around a single autonomous trading engine. Replay, walk-forward evaluation, and portfolio accounting remain in the codebase, but they serve as validation and calibration layers for signal quality rather than as the primary product surface.

## Major planes

### 1. Signal intake

Inputs arrive from:

- live RSS and curated news feeds
- structured event sources such as GDELT and ACLED
- macro and market series
- infrastructure and risk-oriented datasets

These enter the app and sidecar through service modules, schedulers, and historical import paths.

### 2. Canonical event layer

The main architectural shift is away from treating raw article rows as final signal objects.

The main branch now resolves article-style and event-style inputs into canonical event clusters before candidate generation. This layer is responsible for:

- cross-source event grouping
- evidence quality
- source dependence and corroboration handling
- cluster confidence
- event intensity priors

This is the boundary between "data exists" and "signal is usable".

### 3. Interpretation and decision-support layer

Above the canonical event layer, the system builds:

- narrative and theme interpretation
- transmission and relation analysis
- evidence-weighted candidate generation
- operator-facing idea cards and brief surfaces

This layer is intended to support human judgment, not replace it.

### 4. Validation layer

Replay, walk-forward, historical storage, and portfolio accounting live here.

Their job is to answer:

- did a signal family work historically
- did admission logic become too loose or too strict
- did a storage or loader change silently break coverage
- did new evidence priors improve or degrade precision

Validation is still important, but it is downstream of the signal and interpretation stack.

### 5. Storage and runtime layer

The storage model is now:

- NAS PostgreSQL: structured source of truth for historical backtesting and replay inputs
- NAS snapshots: recovery mirror
- local DuckDB: compatibility cache and execution cache
- local persistent cache: desktop/runtime state

The runtime model is:

- web app for public and operator-facing surfaces
- desktop app with sidecar for local services and storage-aware workflows
- docs site as public product and technical reference surface

## Practical architectural rules

- Raw rows are not event-ready by default.
- Canonical event resolution sits between ingestion and candidate generation.
- "Stored in NAS" does not mean "usable in replay".
- Signal generation must be verified end to end: collect -> store -> load -> frame -> signal.
- Replay and walk-forward are downstream validation tools, not the product identity of the branch.

## What was removed from the main branch

Main-branch architecture no longer includes the prior backtest-ML stack as active product code.

Those modules were moved to `legacy/backtest`, including:

- elastic-net
- gradient-boosting
- bayesian-logistic
- ensemble-predictor
- cma-es
- isotonic-calibrator
- ml-walk-forward
- cpcv

The retained main-branch analysis layer keeps temporal features, event resolution, transmission proxies, and operator support surfaces.

## Where to read next

- [./ALGORITHMS.md](./ALGORITHMS.md)
- [./AI_INTELLIGENCE.md](./AI_INTELLIGENCE.md)
- [./investment-usage-playbook.md](./investment-usage-playbook.md)
- [./NAS_BACKTEST_STORAGE_PLAN_2026-04-01.md](./NAS_BACKTEST_STORAGE_PLAN_2026-04-01.md)
- [./TEST_OPERATIONS_RUNBOOK.md](./TEST_OPERATIONS_RUNBOOK.md)
