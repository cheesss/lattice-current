# HMM / TE-NMI / RMT / KG / MPC-lite Upgrade Report

Date: 2026-03-18

## Scope

This report summarizes the implementation and test results for the following upgrade layers:

- HMM-based regime posterior and persistence
- TE/NMI-based information-flow scoring
- RMT-based crowding and correlation denoising
- Knowledge-graph support scoring
- MPC-lite execution control

## Core Implementation Files

- `src/services/math-models/hmm-regime.ts`
- `src/services/math-models/regime-model.ts`
- `src/services/math-models/normalized-mutual-information.ts`
- `src/services/information-flow.ts`
- `src/services/source-credibility.ts`
- `src/services/event-market-transmission.ts`
- `src/services/math-models/rmt-correlation.ts`
- `src/services/knowledge-graph.ts`
- `src/services/execution-mpc.ts`
- `src/services/investment-intelligence.ts`
- `src/services/historical-intelligence.ts`

## Functional Outcome

The system now uses:

- posterior-weighted regime inference instead of heuristic-only regime selection
- directional information-flow support for source credibility and theme-to-asset transmission
- RMT crowding penalties before portfolio sizing
- knowledge-graph relation support in mapping and candidate expansion
- MPC-lite execution control before idea deployment

Replay now skips cards that are reduced to zero deployable size after execution controls.

The MPC minimum trade threshold was changed from a fixed value to an adaptive value based on the current target-weight distribution, which prevented all trades from being zeroed out in recent-regime tests.

## Test Outputs

Baseline files:

- `C:\Users\chohj\AppData\Local\Temp\wm-freefirst-upgrade-20260318\expanded-replay-full-stable-final.json`
- `C:\Users\chohj\AppData\Local\Temp\wm-freefirst-upgrade-20260318\expanded-walk-forward-stable-final.json`
- `C:\Users\chohj\AppData\Local\Temp\wm-freefirst-upgrade-20260318\current-like-replay-2200-stable-final-v2.json`

Final files:

- `C:\Users\chohj\AppData\Local\Temp\wm-freefirst-upgrade-20260318\expanded-replay-hmm-te-rmt-kg-mpc-final-v2.json`
- `C:\Users\chohj\AppData\Local\Temp\wm-freefirst-upgrade-20260318\expanded-walk-forward-hmm-te-rmt-kg-mpc-final-v2.json`
- `C:\Users\chohj\AppData\Local\Temp\wm-freefirst-upgrade-20260318\current-like-replay-hmm-te-rmt-kg-mpc-final-v2.json`

## Metric Comparison

| Test | Baseline Avg | Final Avg | Baseline Hit | Final Hit | Baseline Runs | Final Runs |
|---|---:|---:|---:|---:|---:|---:|
| Full Replay | 1.04% | 0.46% | 58% | 60% | 1284 | 446 |
| Walk-Forward | 1.42% | 1.20% | 64% | 64% | 297 | 55 |
| Current-Like | -1.20% | -0.24% | 49% | 54% | 43 | 30 |

All final runs maintained `nonTradableRate = 0`.

## Current-Like Theme Breakdown

Final current-like replay:

- `semiconductor-export-risk`: 27 idea runs, 152 forward returns, average net return `+0.54%`
- `defense-escalation`: 3 idea runs, 18 forward returns, average net return `-2.40%`

Interpretation:

- the new stack materially suppressed the weak defense/geopolitical theme in the recent regime
- semiconductors survived as the dominant current-regime trade family
- recent-regime performance improved substantially, but defense remains a negative contributor

## Main Trade-Off

The upgrade made the engine much more selective.

- historical breadth fell sharply
- current-regime robustness improved sharply
- walk-forward stayed positive

This means the new stack behaves more like a guarded allocator than a broad idea generator.

## Remaining Risks

- `defense-escalation` still loses money in the current-like window, even after suppression
- full replay average return dropped because the execution controller is conservative
- KG support is still frequently tentative, which limits how much it can help mapping quality

## Recommended Next Step

The highest-value next step is not another new model family.

It is to calibrate the execution controller so that:

- recent negative themes are suppressed even faster
- historically good themes are not over-pruned
- horizon and execution size react jointly to current-vs-replay drift
