# Code Rigor And Investment-Grade Upgrade Plan

Date: 2026-04-02

## Scope

This plan responds to the latest robustness audit and separates the work into:

1. immediate code-hardening,
2. backtest integrity repair,
3. risk / sizing / execution infrastructure,
4. live deployment gating.

The goal is not to chase isolated metrics. The goal is to stop promoting weak signals produced by a fragile evaluation stack.

## Current Validation Against The Audit

### Findings confirmed in current code

Confirmed after code inspection:

- `idea-generator.ts`
  - RAG functions are imported but effectively disabled.
  - `ragBoost` is hardcoded to `0`.
  - `_metaWeights` is loaded asynchronously at module init.
  - weight file path is relative: `./data/learned_meta_weights.json`.
- `rag-retriever.ts`
  - database host/port/database/user/password have inline defaults.
  - pool is global and there is no explicit lifecycle shutdown path.
- `historical-intelligence.ts`
  - walk-forward currently uses a single expanding split, not a rolling retrain schedule.
- `weight-learner.ts`
  - there is no explicit NaN / non-finite sanitization on trained coefficient outputs.

### Audit item that needs correction

The audit says `weight-learner.ts` silently catches singular matrix failures.

Current code does **not** silently catch singular matrices in that file.

- `invertMatrix()` throws:
  - `"[weight-learner] ridge regression matrix is singular"`

The real weakness is different:

- the error handling boundary is incomplete,
- there is no structured fallback policy,
- there is no coefficient sanity validation before promotion.

So the plan treats this as a caller-boundary and model-promotion problem, not a literal silent catch in the file itself.

## Design Principles

1. Fix root causes, not symptoms.
- no more theme-by-theme patching as the main strategy.

2. Make training and evaluation boundaries explicit.
- if a component sees future information, it does not qualify as a production-quality signal.

3. Promote by evidence, not by backtest cosmetics.
- every strategy change must survive robustness checks before it can influence live decisions.

4. Separate signal quality from portfolio quality.
- good signal generation cannot compensate for missing risk controls.

## Workstream A: Immediate Code Hardening

### A1. Remove or activate dead RAG path

Files:

- `src/services/investment/idea-generator.ts`
- `src/services/investment/rag-retriever.ts`

Current issue:

- RAG imports exist, but `ragBoost = 0`.
- This creates false confidence because the code looks integrated but is operationally inert.

Action:

Option 1:
- remove the dead boost path entirely until article embeddings and labeled outcomes are real.

Option 2:
- gate RAG behind an explicit runtime capability flag:
  - embeddings available,
  - labeled outcomes available,
  - retrieval latency budget available.

Recommendation:

- use Option 2 with `feature-off by default`.
- no hidden dead code paths.

Acceptance criteria:

- no dead boost constants,
- explainable enable/disable state in logs and snapshot output,
- tests cover both disabled and enabled modes.

### A2. Make meta-weight loading deterministic

Files:

- `src/services/investment/idea-generator.ts`
- `src/services/investment/adaptive-params/weight-learner.ts`

Current issue:

- `_metaWeights` is loaded asynchronously at module initialization,
- for early calls it may be `null`,
- file path depends on process CWD.

Action:

- replace ad-hoc module-global async load with a dedicated loader service:
  - absolute path resolution from project root or configured data root,
  - cached load state,
  - explicit fallback policy,
  - structured status:
    - `ready`
    - `missing`
    - `invalid`
    - `loading`

Acceptance criteria:

- no CWD-dependent path behavior,
- no startup race influencing decision path,
- status appears in diagnostics and snapshots.

### A3. Harden weight training and promotion

Files:

- `src/services/investment/adaptive-params/weight-learner.ts`
- future caller / promotion wrapper

Current issue:

- coefficient vectors can become non-finite,
- singular / unstable fit outcomes are not governed by a promotion policy.

Action:

- add non-finite guards to:
  - inputs,
  - intermediate matrix ops,
  - final coefficients,
  - bias,
  - prediction outputs.
- add promotion wrapper:
  - reject if coefficients contain non-finite values,
  - reject if norm exceeds bound,
  - reject if feature count mismatch,
  - reject if sample size below minimum.
- emit structured training report:
  - sample count,
  - condition proxy,
  - rejected reason,
  - promoted or not.

Acceptance criteria:

- no non-finite coefficients written to disk,
- singular fit does not silently degrade runtime behavior,
- training report is persisted.

### A4. Remove inline secrets and add explicit connection lifecycle

Files:

- `src/services/investment/rag-retriever.ts`

Current issue:

- inline database defaults are present,
- global pool has no lifecycle contract.

Action:

- move all connection config to env-based resolver,
- require explicit configuration in non-local environments,
- export:
  - `getRagPool()`
  - `closeRagPool()`
- add idle timeout and pool max settings explicitly.

Acceptance criteria:

- no hardcoded password in source,
- tests can inject fake connection config,
- long-lived process can close pool cleanly.

## Workstream B: Backtest Integrity Repair

This is the highest-leverage structural work. Without this, later optimization is mostly noise.

### B1. Replace single-split walk-forward with rolling retrain windows

Files:

- `src/services/historical-intelligence.ts`

Current issue:

- current walk-forward is a single train/validate/test segmentation,
- not a rolling retrain process.

Action:

- implement rolling or anchored walk-forward:
  - train up to T,
  - validate on next block,
  - test on next block,
  - roll forward and retrain.

Modes:

- anchored expanding
- rolling fixed-length

Acceptance criteria:

- every test block is produced only from parameters trained up to that point,
- replay reports expose window-by-window performance dispersion.

### B2. Add pure OOS holdout and promotion boundary

Current issue:

- model tuning and evaluation are too close.

Action:

- reserve a final untouched OOS block,
- no threshold tuning or weight promotion may use that block.

Acceptance criteria:

- reports distinguish:
  - train
  - validation
  - test
  - locked OOS

### B3. Add slippage, liquidity, and execution realism into backtest path

Files:

- `src/services/portfolio-accounting.ts`
- `src/services/historical-intelligence.ts`
- `src/services/investment/portfolio-optimizer.ts`

Current issue:

- current execution realism is not sufficient for investment-grade interpretation.

Action:

- add symbol-level slippage model,
- add spread + liquidity stress model,
- add volume participation cap,
- add partial-fill / no-fill path for illiquid names.

Acceptance criteria:

- every run reports gross vs execution-adjusted results,
- strategy cannot hide behind idealized fills.

### B4. Add survivorship-bias controls

Current issue:

- universe is heavily present-day based.

Action:

- tag datasets by symbol availability period,
- mark missing delisted data explicitly,
- introduce a bias warning badge when replay uses present-day universe only.

Acceptance criteria:

- backtest report includes survivorship-bias confidence level.

## Workstream C: Risk, Sizing, And Portfolio Controls

### C1. Replace fixed sizing templates with constrained allocator

Files:

- `src/services/investment/constants.ts`
- `src/services/investment/portfolio-optimizer.ts`

Current issue:

- fixed `12/20/30%` style position templates are too coarse.

Action:

- move to constrained sizing stack:
  - base score from signal quality,
  - volatility scaling,
  - concentration limits,
  - cluster/theme budget,
  - fractional Kelly cap,
  - minimum cash reserve.

Initial constraints:

- per symbol cap
- per sector cap
- per theme cap
- minimum cash floor
- gross exposure cap

Acceptance criteria:

- no single signal can bypass portfolio-level concentration limits,
- sizing reacts to volatility and correlation.

### C2. Add portfolio risk engine

Current issue:

- no portfolio CVaR / VaR / drawdown governor.

Action:

- compute:
  - rolling volatility,
  - portfolio VaR / CVaR proxy,
  - peak-to-trough drawdown,
  - thematic concentration,
  - hedge concentration.
- add hard risk stops:
  - risk budget exceeded,
  - drawdown breach,
  - cash floor breach.

Acceptance criteria:

- every replay and live snapshot includes portfolio risk state,
- trade admission can be vetoed by portfolio risk.

### C3. Add enforced exits and portfolio kill conditions

Current issue:

- kill-switch exists, but portfolio-grade forced liquidation logic is incomplete.

Action:

- implement:
  - hard stop per trade,
  - time stop,
  - portfolio drawdown stop,
  - risk-state forced de-risking.

Acceptance criteria:

- no open position can remain unconstrained once portfolio limits are breached.

## Workstream D: Signal System Cleanup

### D1. Reduce heuristic coupling

Current issue:

- signal stack is still dominated by hand-tuned interacting modifiers.

Action:

- isolate decision layers:
  - signal formation,
  - trade/no-trade gate,
  - sizing,
  - risk veto.
- stop using the same recent-return evidence in multiple reinforcing places without orthogonalization.

Acceptance criteria:

- each score has a documented role,
- no hidden positive-feedback loops from duplicated return-derived features.

### D2. Upgrade narrative shadow into a real gate only after integrity work

Current issue:

- shadow layer currently acts mostly as a modifier, not a robust rejection boundary.

Action:

- do not promote narrative gate aggressively until:
  - article warehouse is stable,
  - embeddings exist,
  - outcomes are labeled,
  - OOS evaluation exists.

Acceptance criteria:

- narrative model promotion is tied to replay robustness, not intuition.

## Workstream E: Validation And Promotion Governance

### E1. Add robustness evaluation layer

Implement:

- CPCV
- DSR
- PBO
- optional SPA / Reality Check

Purpose:

- prevent overfit variants from being promoted because one run looks good.

Acceptance criteria:

- strategy promotion report includes:
  - Sharpe
  - DSR
  - PBO
  - CPCV dispersion

### E2. Define promotion policy

No component should be promoted to live influence unless:

- code-hardening checks pass,
- training integrity checks pass,
- OOS validation passes,
- robustness metrics pass,
- risk engine constraints pass.

## Workstream F: Live Deployment Readiness

### F1. Shadow account first

No real-capital activation before:

- shadow live execution,
- expected vs realized slippage tracking,
- live vs replay divergence monitoring,
- automatic halt thresholds.

### F2. Production observability

Need:

- trade decision log,
- feature snapshot log,
- expected vs realized execution report,
- model version tagging,
- state-store versioning,
- incident stop and rollback path.

## Recommended Execution Order

### Phase 1: Hardening sprint

Implement first:

1. remove dead RAG path or gate it explicitly,
2. deterministic meta-weight loader,
3. NaN / non-finite guards in weight learner,
4. env-driven RAG connection config and pool shutdown.

### Phase 2: Backtest integrity sprint

Implement next:

1. rolling walk-forward,
2. locked OOS holdout,
3. slippage and liquidity realism,
4. survivorship-bias diagnostics.

### Phase 3: Risk engine sprint

Implement next:

1. portfolio limits,
2. cash floor,
3. volatility-aware sizing,
4. drawdown and CVaR-style governors,
5. forced exits.

### Phase 4: Governance sprint

Implement next:

1. CPCV / DSR / PBO,
2. promotion report,
3. shadow/live gating.

## Immediate Recommendation

If only one block starts now, start with:

- Workstream A
- then Workstream B

Reason:

- current main failure mode is not lack of modeling sophistication,
- it is unstable code paths combined with insufficiently trustworthy evaluation boundaries.

## Definition Of Done For "Investment-Grade Candidate"

The system is not investment-grade because it has Hawkes, truth discovery, and replay adaptation.

It becomes an investment-grade candidate only when:

- decision code paths are deterministic and auditable,
- historical evaluation is causally clean,
- execution realism is modeled,
- portfolio risk can veto trades,
- promotion is governed by robustness metrics,
- live shadow performance matches replay within defined tolerances.
