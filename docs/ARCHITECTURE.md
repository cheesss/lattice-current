# Architecture

This document describes the current main-branch architecture of Lattice Current.

## System identity

The repository is now a theme-led signal intelligence workspace.

It is not organized around a single autonomous trading engine or a standalone
globe application. Replay, walk-forward evaluation, portfolio accounting,
theme tracking, and live intake remain in the codebase, but they are arranged
around one operator shell and one decision loop.

## Operator shell

The canonical root surface is now `event-dashboard.html`, and `/` redirects
there. The old main page is retired from the user entry flow.

The theme shell absorbs these operator surfaces in one place:

- live signal intake and first-pass interpretation
- evidence-backed theme briefs
- followed themes and structural alerts
- proposal inbox and approval execution
- compact validation and market snapshots
- runtime, source health, and diagnostics

The map remains part of the product, but the globe is no longer the default
identity. The active path is now a flat 2D map lens (`event-map-lens.html`
backed by `src/theme-map-lens.ts`) that keeps legacy risk-region,
infrastructure, and event overlays available inside the shell without reviving
the globe-first UI.

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

The embedded theme workspace is synchronized with the shell through a
`postMessage` bridge so that selected theme, period, and workspace context stay
aligned without URL polling or full iframe churn.

The same theme shell also acts as the operator review surface for:

- Codex proposals that can now be accepted or rejected in place
- human approval queue items that can execute once accepted
- compact risk, macro, investment, and validation snapshots served through a shared API payload
- system health, data quality, and Codex quality diagnostics that used to live outside the main operator path

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

- web app for operator-facing surfaces
- desktop app with a lazy-started sidecar for local services and storage-aware workflows
- docs site as public product and technical reference surface

Hidden workspaces are expected to stay cheap. Panel refreshes should be gated
by active workspace visibility rather than by whether a panel object has been
constructed.

## Practical architectural rules

- Raw rows are not event-ready by default.
- Canonical event resolution sits between ingestion and candidate generation.
- "Stored in NAS" does not mean "usable in replay".
- Signal generation must be verified end to end: collect -> store -> load -> frame -> signal.
- Replay and walk-forward are downstream validation tools, not the product identity of the branch.
- Source bundles belong in the source drawer unless they directly support the operator loop.
- Desktop startup should not eagerly spawn heavy background automation.

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
