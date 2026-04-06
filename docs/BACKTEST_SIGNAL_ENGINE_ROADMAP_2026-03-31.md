# Backtest Signal Engine Roadmap — 2026-03-31

This document turns the current backtest diagnosis into a three-block upgrade plan.

It is anchored to the current code structure, not written as a generic quant wishlist.

Implementation detail companion:

- [NEXT_GEN_BACKTEST_IMPLEMENTATION_PLAN_2026-03-31.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\NEXT_GEN_BACKTEST_IMPLEMENTATION_PLAN_2026-03-31.md)

## Why this exists

The current replay stack is no longer obviously broken. It is more likely realistic and underpowered:

- raw directional hit rate is roughly in the low 40% range
- average raw return per trade is near zero
- turnover is high enough that execution friction dominates
- earlier stronger results are likely inflated by looser time-boundary handling

That means the next gains should come from better **signal formation**, **trade selection**, and **allocation/execution**, not from more aggressive sizing.

## Current bottleneck map

### Mapping bottleneck

Current code:

- [src/services/investment/idea-generator.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment\idea-generator.ts)
- [src/services/investment-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment-intelligence.ts)
- [src/services/event-market-transmission.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\event-market-transmission.ts)

Problem:

- keyword-theme-asset mapping is still largely rules + priors
- this is explainable, but brittle for new narratives and second-order effects

### Trade/no-trade bottleneck

Current code:

- [src/services/investment/idea-generator.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment\idea-generator.ts)
- [src/services/investment/constants.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment\constants.ts)
- [src/services/autonomy-constraints.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\autonomy-constraints.ts)

Problem:

- trade admission is still mostly threshold-based
- conviction and false-positive gates exist, but they do not explicitly model abstention as a learned decision

### Allocation bottleneck

Current code:

- [src/services/portfolio-accounting.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\portfolio-accounting.ts)
- [src/services/investment/constants.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment\constants.ts)

Problem:

- sizing is still multiplicative heuristic sizing
- highly correlated bets are not budgeted by cluster, graph, or portfolio structure first

### Validation bottleneck

Current code:

- [src/services/historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)
- [src/services/evaluation/](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\evaluation)

Problem:

- replay metrics exist, but overfitting-aware strategy selection is still weak
- current output is better than before, but still lacks stronger anti-snooping selection criteria

## Three-block plan

## Block 1 — Signal Formation and Information Integrity

Goal:

- improve the quality of the latent event signal before it reaches the idea generator
- reduce false positives caused by copy-amplified news, brittle keyword themes, and static contagion assumptions

### 1A. Dynamic truth discovery

Attach points:

- [src/services/source-credibility.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\source-credibility.ts)
- [src/services/math-models/truth-discovery.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\math-models\truth-discovery.ts)

Upgrade path:

- move from mostly static corroboration weighting toward dynamic/dependent truth inference
- represent source dependence over time rather than treating corroboration count as independent evidence
- add temporal decay and source-copy structure into source credibility updates

Expected effect:

- lower false corroboration
- lower false-positive risk
- more reliable source-weighted event scores

Practicality:

- medium

Academic weight:

- high

### 1B. Temporal attentive contagion graph

Attach points:

- [src/services/event-market-transmission.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\event-market-transmission.ts)
- [src/services/graph-timeslice.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\graph-timeslice.ts)
- [src/services/multi-hop-inference.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\multi-hop-inference.ts)

Upgrade path:

- replace purely rule-driven event propagation with a time-varying graph
- keep current hand-built rules as priors
- let learned attention weights estimate which nodes actually transmit stress

Expected effect:

- better second-order beneficiary detection
- better lag-aware propagation
- less reliance on static supplier/customer heuristics

Practicality:

- medium

Academic weight:

- very high

### 1C. Hawkes / temporal point process for decay and duplication control

Attach points:

- [src/services/math-models/hawkes-process.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\math-models\hawkes-process.ts)
- [src/services/investment/idea-generator.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment\idea-generator.ts)
- [src/services/historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)

Upgrade path:

- replace fixed dedup windows with learned event half-life and aftershock logic
- distinguish new shocks from echo/amplification events
- use decay structure to inform horizon selection

Expected effect:

- fewer duplicate trades
- better timing of re-entry
- better match between event life and holding period

Practicality:

- medium

Academic weight:

- high

### 1D. Learned narrative factors

Attach points:

- [src/services/investment/idea-generator.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment\idea-generator.ts)
- [src/services/theme-discovery.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\theme-discovery.ts)
- [src/services/keyword-registry.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\keyword-registry.ts)

Upgrade path:

- keep the current handcrafted themes as explicit priors
- add learned topic/narrative factors on top
- let latent narratives propose new theme posteriors instead of forcing a hard keyword match

Expected effect:

- less information loss in theme assignment
- better generalization to new narratives

Practicality:

- medium

Academic weight:

- very high

## Block 2 — Decision Layer and Trade Admission

Goal:

- improve whether the engine should trade at all
- reduce turnover and remove low-quality trades before they reach sizing

### 2A. Meta-labeling + selective abstention

Attach points:

- feature assembly in:
  - [src/services/investment-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment-intelligence.ts)
  - [src/services/investment/idea-generator.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment\idea-generator.ts)
- label generation from:
  - [src/services/historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)
- adaptation memory from:
  - [src/services/replay-adaptation.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\replay-adaptation.ts)

Implementation shape:

- base model still proposes direction and candidate assets
- second-stage model predicts:
  - `P(hit | x, direction)`
  - `E[cost-adjusted return | x, direction)`
  - optional `P(stop-first | x, direction)`
- trade only when:
  - hit probability exceeds threshold
  - lower-tail expected return is not negative

Expected effect:

- lower turnover
- better cost-adjusted hit rate
- lower drawdown

Practicality:

- very high

Academic weight:

- high

### 2B. Replace linear conviction with learned decision scoring

Attach points:

- [src/services/investment-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment-intelligence.ts)
- [src/services/decision-attribution.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\decision-attribution.ts)
- [src/services/math-models/contextual-bandit.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\math-models\contextual-bandit.ts)

Upgrade path:

- use current features as inputs, not as final manually weighted outputs
- preserve explainability by decomposing model output back into feature contributions
- keep bandit and replay priors as adaptive features, not the only adaptation mechanism

Expected effect:

- better ranking consistency
- lower sensitivity to arbitrary weight tweaks

Practicality:

- high

Academic weight:

- medium-high

### 2C. Explicit no-trade and cooldown policy

Attach points:

- [src/services/investment/idea-generator.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment\idea-generator.ts)
- [src/services/autonomy-constraints.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\autonomy-constraints.ts)
- [src/services/historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)

Upgrade path:

- theme-symbol cooldown
- duplicate suppression across adjacent frames
- stronger minimum-hold and re-entry spacing
- regime confirmation before standard and conviction buckets open

Expected effect:

- far fewer trades
- much lower execution drag

Practicality:

- very high

Academic weight:

- low-medium

## Block 3 — Allocation, Exit, and Validation

Goal:

- make surviving trades larger only when justified
- shape exits to volatility and regime
- choose model versions with stronger overfitting protection

### 3A. Regime-aware volatility-managed allocation

Attach points:

- [src/services/math-models/regime-model.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\math-models\regime-model.ts)
- [src/services/math-models/hmm-regime.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\math-models\hmm-regime.ts)
- [src/services/macro-risk-overlay.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\macro-risk-overlay.ts)
- [src/services/investment/idea-generator.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment\idea-generator.ts)

Upgrade path:

- scale gross exposure and hold horizon by regime and volatility state
- use a stricter policy in high-volatility or unstable regimes

Expected effect:

- better risk-adjusted returns
- better regime mismatch control

Practicality:

- high

Academic weight:

- high

### 3B. HRP + fractional Kelly allocator

Attach points:

- new module likely under:
  - `src/services/investment/allocator.ts`
  - or `src/services/portfolio-allocation.ts`
- consumers:
  - [src/services/portfolio-accounting.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\portfolio-accounting.ts)
  - [src/services/investment/idea-generator.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment\idea-generator.ts)

Implementation order:

1. cluster candidate positions by correlation, theme, and graph overlap
2. allocate cluster risk budgets via HRP
3. apply fractional Kelly inside cluster on cost-adjusted edge

Expected effect:

- lower concentration
- lower drawdown
- better capital efficiency on high-conviction ideas

Practicality:

- high

Academic weight:

- high

### 3C. Dynamic exits with GARCH/state-space logic

Attach points:

- [src/services/historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)
- [src/services/math-models/kalman-filter.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\math-models\kalman-filter.ts)
- potential new modules under:
  - `src/services/math-models/garch-*.ts`
  - `src/services/exits/`

Upgrade path:

- move away from only fixed stop/take percentages
- add volatility-aware stop widths and regime-aware exit tightening
- use state estimates to distinguish structural break from temporary noise

Expected effect:

- fewer whip exits
- cleaner risk-adjusted path behavior

Practicality:

- medium

Academic weight:

- high

### 3D. CPCV / DSR / PBO / SPA evaluation layer

Attach points:

- new evaluation/reporting module under:
  - `src/services/evaluation/selection-statistics.ts`
  - or equivalent
- consumed from:
  - [src/services/historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)
  - replay reporting and backtest UI surfaces

Expected effect:

- less backtest overfitting
- stronger strategy version selection discipline

Practicality:

- medium

Academic weight:

- very high

## Practical vs research-heavy summary

### Immediately attachable

- meta-labeling / abstain
- duplicate suppression and cooldowns
- regime-aware volatility scaling
- HRP + fractional Kelly allocation
- stronger replay diagnostics

### Structurally valuable but heavier

- learned narrative factors
- temporal attentive contagion graph
- Hawkes / TPP decay and horizon logic
- dynamic exits with GARCH/state-space logic

### Validation and governance upgrades

- CPCV / DSR / PBO / SPA
- dynamic/dependent truth discovery extensions

## Minimum next implementation set

If only one sprint is available, do this:

1. Meta-labeling / abstain gate
2. Cooldown + duplicate suppression
3. Theme / symbol / horizon diagnostics
4. HRP + fractional Kelly allocator prototype

This is the best sequence because it improves:

- cost-adjusted performance
- drawdown control
- interpretability

without requiring a full rewrite of theme discovery or graph propagation first.
