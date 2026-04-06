# Services Guide

This folder contains the product logic layer.

## Fast path

If you only need the shortest useful entry:

- replay/backtest
  - [historical-intelligence.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.md)
- live investment interpretation
  - [investment-intelligence.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment-intelligence.md)
- pipeline/operator snapshot
  - [data-flow-ops.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\data-flow-ops.md)
- adaptation memory
  - [replay-adaptation.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\replay-adaptation.md)

## Service families

### Collection and normalization

- `rss.ts`
- `gdelt-intel.ts`
- `military-flights.ts`
- domain folders such as `market/`, `economic/`, `conflict/`

These modules fetch or normalize upstream data.

### Aggregation and intelligence

- `event-market-transmission.ts`
- `investment-intelligence.ts`
- `country-instability.ts`
- `geo-convergence.ts`

These modules turn raw data into scores, summaries, idea cards, or risk posture.

### Historical replay and learning

- `historical-intelligence.ts`
- `replay-adaptation.ts`
- `evaluation/`
- `importer/`

These modules build replay corpora, execute replay/walk-forward logic, and store learning artifacts.

### Runtime and infrastructure

- `runtime.ts`
- `runtime-config.ts`
- `persistent-cache.ts`
- `storage/`

These modules control secrets, cache behavior, runtime mode, and storage contracts.

### Automation

- `server/intelligence-automation.ts`
- `data-flow-ops.ts`
- scheduler-facing service logic

These modules coordinate dataset fetch/import/replay/discovery cycles.

### Math and model support

- `math-models/`

This folder contains algorithmic building blocks such as Kalman filters, HMMs, Hawkes processes, RMT correlation, bandits, and truth discovery.

## Design philosophy

- Keep provider-specific fetch logic separate from downstream inference.
- Keep replay persistence separate from UI-only state.
- Prefer explicit service boundaries over hidden cross-imports between panels.
- If a module does storage, fetching, inference, and presentation shaping all at once, it probably needs to be split.

## Highest-risk modules

- `historical-intelligence.ts`
  - replay, forward returns, merge logic, portfolio evaluation
- `investment-intelligence.ts`
  - current operator-facing decisions
- `persistent-cache.ts`
  - shared client persistence
- `runtime-config.ts`
  - secrets/features gating
- `server/intelligence-automation.ts`
  - automation orchestration

## Validation shortcuts

- math only: `npm run test:math`
- all data tests: `npm run test:data`
- runtime browser test: `npm run test:e2e:runtime`
- typecheck: `npm run typecheck`
