# Algorithms

This document covers the active signal and decision-support logic on the main branch.

It does not describe the archived backtest-ML stack that now lives on `legacy/backtest`.

## Active algorithm families

### Canonical event resolution

Raw historical and live inputs are normalized into event mentions and event clusters before candidate generation.

Key ideas:

- article-style and event-style sources are resolved into canonical clusters
- cross-source corroboration matters more than raw row count
- source dependence is handled separately from simple source count
- `clusterConfidence` estimates event validity and corroboration quality

`clusterConfidence` is not a substitute for market transmission.

### Source credibility

Source quality blends:

- corroboration quality
- historical accuracy
- feed health
- dependence diagnostics
- false-corroboration discount

The current logic is deliberately more conservative about copied or synchronized reporting than older flat corroboration boosts.

### Event intensity

Event intensity is now evidence-aware rather than keyword-only.

It can depend on:

- cue hits
- alert characteristics
- source breadth
- cluster confidence
- bounded stress priors when full transmission data is missing

The purpose is to keep article-backed NAS replay paths from being structurally suppressed when event grouping is strong but precomputed transmission metadata is absent.

### Transmission and stress

Transmission remains a separate concept from event validity.

Active inputs include:

- relation and mapping context
- transmission-derived stress when available
- bounded fallback priors when transmission is absent

The main architectural rule is:

- `clusterConfidence` supports evidence quality
- `transmissionStress` supports market linkage
- `marketStressPrior` is a fallback prior, not a replacement for transmission

### Narrative layer

Narrative analysis remains in shadow- and disagreement-aware form.

The current branch treats narrative mismatch as a guardrail. It does not rely on large positive narrative boosts to force admission.

### Admission logic

The system uses deterministic and evidence-backed admission gating rather than a full supervised execution stack.

Current gating uses:

- confidence
- confirmation quality
- execution reality
- replay stability
- false-positive risk
- cluster confidence
- transmission stress or fallback stress prior
- narrative disagreement penalties

This branch is optimized for structured operator support, not for unconstrained automated execution.

### Temporal and external features

The main branch retains temporal feature infrastructure and external-signal enrichment where they support interpretation.

Retained examples:

- `feature-engineer`
- `signal-history-buffer`
- `transmission-proxy`
- `embedding-knn`
- `gpr-proxy`

These features enrich evidence and context. They are not currently part of the removed backtest-ML stack.

## Removed from the main branch

The following model families were removed from the main branch and preserved on `legacy/backtest`:

- elastic-net
- gradient-boosting
- bayesian-logistic
- ensemble-predictor
- cma-es
- isotonic-calibrator
- ml-walk-forward
- cpcv

If you need those, read the `legacy/backtest` branch instead of the main-branch docs.

## Validation role

Replay and walk-forward still exist, but they validate:

- coverage
- admission quality
- signal precision drift
- storage / loader correctness

They should not be treated as the defining algorithmic identity of the main branch.
