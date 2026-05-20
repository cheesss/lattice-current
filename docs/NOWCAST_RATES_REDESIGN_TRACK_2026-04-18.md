# Rates Nowcast Model — Redesign Track

Opened: 2026-04-18 KST
Status: **open — not this session**
Predecessor: [NOWCAST_HANDOFF_2026-04-18.md §5.2](./NOWCAST_HANDOFF_2026-04-18.md)

## Why this is a separate track

The 2026-04-18 Phase C first-run validation returned **0/6 models passing
the acceptance gate**. Rather than "training needs more data", the
evidence points at a **structural mismatch** between the current model
architecture and the target series. Patching data (longer window) or
calibration (empirical p90 vs Gaussian 1.645σ) did not move the needle.
This deserves a design pass, not a tuning pass.

This doc is a scoping note, not a plan. Pick it up as its own track once
the surrounding nowcast infrastructure (gate, fuse filter, daemon) has
stabilised in production.

## What failed and why (evidence)

Phase C validate 2026-04-18, --window 180:

| target | MAE | baseline | improvement | cov90 | N |
|---|---|---|---|---|---|
| hy_credit_spread | 0.0820 | 0.0100 | **-720%** | 1.00 | 144 |
| treasury10y | 0.0119 | 0.0003 | **-3627%** | 1.00 | 150 |
| yieldSpread | 0.1465 | 0.0256 | **-472%** | 0.06 | 107 |
| ig_credit_spread | 0.0059 | 0.0019 | **-210%** | 1.00 | 144 |
| oilPrice | 1.7176 | 3.5175 | **+51%** | 0.62 | 112 |
| dollarIndex | 1.1301 | 0.9015 | -25% | 0.96 | — |

FRED rate targets (HY, treasury10y, yieldSpread, IG) all move in tight
~1–3 bp/day bands. The naive carry-forward baseline (predict today =
yesterday) achieves MAE of order `1e-4`–`1e-2`. Ridge on ETF proxy features
(HYG, TLT, LQD, ^TNX, ^IRX) introduces daily ETF price noise that swamps
the slow-moving rate signal — holdout MAE lands 2×–360× above baseline.

oilPrice is the only target with a positive MAE improvement (+51%), but
its holdout-residual variance materially exceeds train-residual variance,
so no in-sample interval calibration (Gaussian 1.645σ: cov=0.62;
empirical p90: cov=0.44) reaches the 0.80 coverage target. N=112 at 180d
also fails the gate's 120-row floor; --window 365 brings N up but erases
the MAE win (regime mix hurts ridge).

## The mismatch, summarised

1. **Scale mismatch.** ETF prices move in dollars per share per day;
   target rates move in basis points. Ridge scales features into a shared
   linear combination — but the coefficient magnitude it needs to hit
   1-bp-level accuracy is so small that the L2 regulariser effectively
   zeroes the feature. What's left is the lag_1 target, which is just
   the naive baseline with extra noise.
2. **Signal-to-noise.** The predictive content in daily HYG returns for
   next-day HY credit spread movements is small and episodic (widens
   during risk-off windows, near-zero otherwise). A linear model with a
   single α treats every day the same.
3. **Residual distribution.** Not all targets are Gaussian-residual.
   oilPrice residuals are heavy-tailed and regime-dependent; a single
   σ-based or single-quantile-based interval cannot cover 80% of
   holdout without peeking at holdout.
4. **Baseline is already tight.** These targets are slow-moving by
   construction. "Today ≈ yesterday" is a strong prior that any
   engineered model has to clear by 15%. Many modelling approaches
   simply won't beat this bar on daily-bar data.

## Directions worth trying (not prescriptive)

These are candidate directions, not a ranked roadmap.

- **Change the regression target from level to change.** Fit models to
  predict `Δtarget`, not `target`. Reduces the role of lag_1 as a
  predictor, makes ridge coefficients non-trivial, and frames the
  baseline comparison on what actually matters (daily move direction +
  magnitude).
- **Regime-conditional training.** Split train window by VIX regime or
  yield-curve regime and fit separate coefficients. Aligns with the
  existing `regime_conditional_impact` table and `detectRegime()` in
  `nowcast-source-gate.mjs`.
- **Conformal prediction for intervals.** Split holdout into calibration
  and test, set the interval halfwidth from calibration residuals, measure
  coverage on test. Eliminates the train/holdout variance mismatch issue
  in a principled way.
- **Non-linear models.** LightGBM / small MLP. The project already has
  `train-meta-model.py` (PyTorch) and `compare-models.py` (LGB vs MLP
  vs logistic) infra; reuse.
- **Intraday features.** ETF price at 3pm and VIX at 3:30pm are
  informative about 4pm FRED treasury release. Current pipeline uses
  daily bars; hourly bars might be where the edge lives.
- **Drop targets that can't be beaten.** If treasury10y genuinely moves
  by ~0.3 bp/day in this window, no amount of feature engineering will
  reliably beat a naive baseline at daily cadence. Acknowledging this
  prevents over-engineering and keeps the gate meaningful.

## What must stay true through the redesign

- **Acceptance gate is enforced, not advisory.** `nowcast_acceptance_gate.py`
  is the source of truth; trainers must continue to refuse save on fail.
- **`.pkl` → `estimated_signal_nowcasts` → fuse filter.** A retrained
  model reaches the dashboard only after manual promotion via
  `promote-nowcast-model.mjs` moves it to `shadow` / `active` in
  `model_registry`. The filter in `event-dashboard-api.mjs` is what
  keeps the pipeline honest — don't bypass.
- **Data coverage audit is first.** Any new trainer must call
  `market_quote_coverage.abort_if_missing()` before training. Bootstrap
  existing symbols via `bootstrap-market-quotes-history.mjs` and
  introduce new symbols by adding to `_shared/market-quote-symbols.json`.

## When to pick this up

After the three active tasks (composite, event-intensity, reconcile) have
run in production for long enough to expose any real-world gate / fuse /
reconciliation issues. Probably 2–4 weeks. Until then, rates redesign
competes with operational stabilisation — don't mix the two tracks.
