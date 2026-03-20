# Portfolio Accounting Backtest Report

Date: 2026-03-18

## Scope

This report covers the new portfolio-accounting backtest layer added on top of the historical replay engine.

It introduces:

- equal-weight replay return as a secondary signal-quality metric
- size-weighted return
- portfolio NAV curve
- CAGR
- max drawdown
- Sharpe ratio

## Core Implementation

- `src/services/portfolio-accounting.ts`
- `src/services/historical-intelligence.ts`
- `src/services/replay-adaptation.ts`
- `src/components/BacktestLabPanel.ts`
- `src/services/experiment-registry.ts`
- `src/services/server/intelligence-automation.ts`

## Validation

- `npm run typecheck` passed
- current-like replay persisted successfully and now surfaces portfolio metrics through `getBacktestOpsSnapshot()`

## Output Files

- `C:\Users\chohj\AppData\Local\Temp\wm-portfolio-backtest-20260318\expanded-replay-portfolio.json`
- `C:\Users\chohj\AppData\Local\Temp\wm-portfolio-backtest-20260318\expanded-walk-forward-portfolio.json`
- `C:\Users\chohj\AppData\Local\Temp\wm-portfolio-backtest-20260318\current-like-replay-portfolio.json`
- `C:\Users\chohj\AppData\Local\Temp\wm-portfolio-backtest-20260318\current-like-replay-portfolio-persisted.json`

## Result Summary

| Test | Equal-Weight Avg | Size-Weighted Avg | NAV Return | CAGR | Max DD | Sharpe | Avg Gross Exposure |
|---|---:|---:|---:|---:|---:|---:|---:|
| Full Replay | `+0.19%` | `-0.04%` | `+0.02%` | `0.00%` | `-0.42%` | `0.02` | `0.35%` |
| Walk-Forward | `+1.92%` | `+3.43%` | `+0.03%` | `0.01%` | `-0.01%` | `0.35` | `0.04%` |
| Current-Like | `-0.17%` | `+0.78%` | `+0.00%` | `0.00%` | `-0.02%` | `0.00` | `0.07%` |

Persisted current-like verification run:

- size-weighted return: `+1.37%`
- NAV return: `+0.01%`
- CAGR: `+0.03%`
- max drawdown: `-0.03%`
- Sharpe: `0.38`

## Interpretation

The new layer shows that the old replay average-return metric and actual strategy-level portfolio return are not the same thing.

- equal-weight replay returns are mostly measuring per-idea quality
- portfolio NAV is measuring what the system would actually have done with its deployed size

The main bottleneck is now very clear:

- the engine is deploying extremely small weights
- average gross exposure is below `0.4%` even in the full replay
- this keeps NAV almost flat even when weighted trade quality is positive

This means the current system is more constrained by sizing and execution control than by pure hit-rate.

## Practical Takeaway

The portfolio-accounting layer is working and the metrics are materially more honest than the old equal-weight average.

The next high-value improvement is not another return metric. It is to revisit sizing policy and MPC constraints so that:

- strong confirmed ideas can scale beyond tiny residual weights
- current-like positive weighted returns can translate into visible NAV growth
- weak themes remain suppressed without flattening the whole portfolio
