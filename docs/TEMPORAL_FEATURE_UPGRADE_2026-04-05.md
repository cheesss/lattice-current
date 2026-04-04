# Temporal Feature Upgrade Status

Date: 2026-04-05

## Purpose

This note records what survived from the temporal-feature and external-data upgrade after the main branch was simplified away from the backtest-ML stack.

## Current interpretation

The main branch is no longer centered on supervised backtest optimization.

The retained temporal and external-signal work now exists to improve:

- event interpretation
- transmission context
- evidence quality
- operator decision support

It should not be read as a promise that the removed backtest-ML training stack is still active on this branch.

## Retained on main

These modules remain relevant on the current branch:

- `src/services/investment/adaptive-params/feature-engineer.ts`
- `src/services/investment/adaptive-params/signal-history-buffer.ts`
- `src/services/investment/adaptive-params/transmission-proxy.ts`
- `src/services/investment/adaptive-params/gpr-proxy.ts`
- `src/services/investment/adaptive-params/embedding-knn.ts`
- `src/services/math-models/hawkes-process.ts`
- supporting ingest scripts for external signals and historical enrichment

These are still useful because they improve temporal context and evidence handling even without the heavier ML training stack.

## Removed from main and preserved on `legacy/backtest`

The following no longer define the main branch:

- `elastic-net`
- `gradient-boosting`
- `bayesian-logistic`
- `ensemble-predictor`
- `cma-es`
- `isotonic-calibrator`
- `ml-walk-forward`
- `cpcv`

If a task depends on those modules, use `legacy/backtest` rather than the main branch.

## Practical guidance

- Keep temporal features if they help signal interpretation and evidence scoring.
- Do not document removed model-training modules as active main-branch dependencies.
- Do not treat old "ML upgrade" notes as proof that those training paths still ship in the current product.

## Documentation rule

When this branch changes again:

1. update this file
2. update [C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\DOCUMENTATION.md](C:/Users/chohj/Documents/Playground/lattice-current-fix/docs/DOCUMENTATION.md)
3. update [C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\ALGORITHMS.md](C:/Users/chohj/Documents/Playground/lattice-current-fix/docs/ALGORITHMS.md)

Do not leave removed training modules described as active.
