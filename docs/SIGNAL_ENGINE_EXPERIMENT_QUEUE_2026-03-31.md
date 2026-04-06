# Signal Engine Experiment Queue — 2026-03-31

This file is the tactical companion to `BACKTEST_SIGNAL_ENGINE_ROADMAP_2026-03-31.md`.

It mirrors the three-block structure so engineers can move from strategy to implementation without re-deriving priorities.

## Block 1 — Signal Formation

### Experiment 1

Name:
- Dynamic corroboration / truth weighting probe

Change:
- add time-weighted and dependency-aware corroboration diagnostics before replacing the full source model

Success criteria:
- lower false-positive clusters
- measurable reduction in contradictory-source acceptance

### Experiment 2

Name:
- Event half-life and dedup probe

Change:
- test learned or semi-learned cooldown windows instead of fixed dedup windows

Success criteria:
- duplicate trade count down
- same-theme re-entry count down

### Experiment 3

Name:
- Narrative factor shadow model

Change:
- run a learned topic/narrative scorer in shadow mode beside keyword themes

Success criteria:
- detect themes earlier or with fewer false assignments than the keyword baseline

## Block 2 — Decision and Admission

### Experiment 4

Name:
- Meta gate v1

Change:
- add a second-stage trade/no-trade classifier using existing replay-derived labels

Success criteria:
- trade count down at least 40%
- cost-adjusted hit rate up at least 5 percentage points
- no worse max drawdown

### Experiment 5

Name:
- Cooldown + duplicate suppression

Change:
- prevent same-theme / same-symbol rapid re-entry across adjacent frames

Success criteria:
- trade count down at least 50%
- average execution drag materially reduced

### Experiment 6

Name:
- Theme / symbol / horizon diagnostics

Change:
- export per-theme, per-symbol, and per-horizon performance buckets directly in replay results

Success criteria:
- enough resolution to identify where the 41-42% hit-rate failure is concentrated

## Block 3 — Allocation, Exit, Validation

### Experiment 7

Name:
- HRP allocator prototype

Change:
- allocate cluster risk budgets before per-idea sizing

Success criteria:
- lower concentration
- better Sharpe / drawdown even if CAGR is only modestly better

### Experiment 8

Name:
- Regime-aware vol scaling

Change:
- modulate gross exposure and hold policies by regime state and realized volatility

Success criteria:
- lower drawdown in unstable regimes
- less exposure during high-noise periods

### Experiment 9

Name:
- Dynamic exit prototype

Change:
- replace fixed stop/take widths with volatility-aware and regime-aware exit distances

Success criteria:
- lower whip exits
- better path-level risk-adjusted return

### Experiment 10

Name:
- Overfitting guardrail pack

Change:
- add CPCV / DSR / PBO / SPA style selection statistics to replay reports

Success criteria:
- strategy comparison no longer relies on single-run CAGR/Sharpe only

## Important rule

Do not run broad parameter sweeps before Experiments 4 and 6 exist.

Without those, the system will keep optimizing around noise and execution friction instead of fixing the selection layer.
