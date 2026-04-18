# Nowcast / Estimation Architecture Plan

> **Status**: superseded by [NOWCAST_HANDOFF_2026-04-18.md](./NOWCAST_HANDOFF_2026-04-18.md) — original design doc; Phase 0–5 implementation landed across commits `62825c96` / `746a0e58` / `8bce577b` / `87c21b6d`. See the handoff for current state, known gaps (§6), and production activation checklist (§5).

Date: 2026-04-17 KST  
Scope: live/latest data sparsity, backfill-trained inference, observed vs estimated separation, API/UI/storage/modeling contract

## 1. Executive Summary

This repository should not solve sparse latest data by silently replacing missing live observations with values inferred from other sources.

That approach would collapse the trust boundary that the project is already trying to restore in [LIVE_BACKFILL_DATA_BOUNDARY_PLAN_2026-04-16.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\LIVE_BACKFILL_DATA_BOUNDARY_PLAN_2026-04-16.md).

The correct direction is:

```text
keep observed data as observed
add a separate estimated / nowcast layer
show and evaluate that layer explicitly
never present estimation as live truth
```

This means:

- backfill data may still be used for training
- latest data from other sources may still be used as features
- but the result must be treated as `estimated`, not `observed`
- the UI, API, storage, and evaluation loop must reflect that distinction

The repository already has part of the required semantics:

- `mode`
- `dataUpdatedAt`
- `generatedAt`
- `staleReason`
- `signalQuality`
- `mirrored`
- `fallback`
- `cache`

These appear in [event-dashboard-api.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\event-dashboard-api.mjs) and the live/backfill boundary document.

What is still missing is a first-class `estimated / nowcast` contract.

## 2. Problem Statement

The project currently has three real conditions at once:

1. Some live/latest inputs are sparse, delayed, or unavailable.
2. Historical and backfill datasets are large enough to train useful predictive relationships.
3. Storage and presentation boundaries between live, delayed, backfill, replay, fallback, and mirrored values are still incomplete.

The danger is not "using backfill for training" by itself.

The danger is:

- using revised or future-aware data as if it were available in real time
- using mismatched source domains without explicit source gating
- using inferred values as if they were directly observed
- allowing estimated values to bleed into live KPI or alert surfaces without provenance

If that happens, the product becomes harder to trust, not more useful.

## 3. Current Repository State

### 3.1 Already implemented

The repository already distinguishes several operational states:

- `live`
- `delayed`
- `backfill`
- `replay`
- `fallback`
- `mirrored`
- `cache`

Relevant references:

- [LIVE_BACKFILL_DATA_BOUNDARY_PLAN_2026-04-16.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\LIVE_BACKFILL_DATA_BOUNDARY_PLAN_2026-04-16.md)
- [event-dashboard-api.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\event-dashboard-api.mjs)
- [audit-data-freshness.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\audit-data-freshness.mjs)

Concrete examples already present:

- `classifySignalQuality()` marks rows as `observed`, `mirrored`, or `stale`
- `/api/kpi-summary` and `/api/live-status` already emit `mode`, `stale`, and `staleReason`
- missing live quote path is explicitly surfaced through `quoteFeed`
- digest and today endpoints already mark `fallback`

### 3.2 Still mixed

The repository still shares some NAS surfaces between latest/live and backfill workflows.

Confirmed shared or mixed surfaces:

- `articles`
- `signal_history`
- `event_uplift`

More separated surfaces already exist:

- historical replay DuckDB corpus
- historical automation artifacts under `data/historical/**`
- dashboard cache / persistent cache

This means the project already needs semantic separation even before adding nowcast.

## 4. Core Decision

The repository should adopt a three-layer value model:

```text
Layer 1: observed truth
Layer 2: estimated nowcast
Layer 3: research / replay / backfill evidence
```

### 4.1 Layer 1: observed truth

Allowed types:

- `observed-live`
- `observed-delayed`

Characteristics:

- actual source observation
- timestamp corresponds to real observation or provider publication time
- usable in first-viewport operator surfaces

### 4.2 Layer 2: estimated nowcast

Allowed types:

- `estimated-nowcast`
- `estimated-imputed`
- `estimated-composite`

Characteristics:

- derived from models or source fusion
- based on past training and currently available features
- never equal to direct observation
- must show uncertainty and lineage

### 4.3 Layer 3: research / replay / backfill evidence

Allowed types:

- `backfill`
- `replay`
- `fallback`
- `cache`
- `mirrored`

Characteristics:

- valuable for analysis
- may support training or context
- not allowed to masquerade as live operational truth

## 5. Design Principles

### 5.1 Estimated is allowed, hidden estimation is not

The product may display an estimated value.

The product must not:

- label that value as live observation
- use the same badge and visual grammar as live truth
- hide the model path that created it

### 5.2 Abstain is a first-class outcome

If the domain match is weak, source overlap is poor, or uncertainty is too high, the system should return:

```text
estimate unavailable
```

not a forced number.

### 5.3 Training and inference must be vintage-aware

The model may only use what would actually have been available at time `t`.

No training or validation run may assume:

- future revisions
- later source availability
- mirrored placeholders as true labels
- backfill-created rows as if they existed live at the time

### 5.4 The system of record remains Lattice

OpenClaw or any agent system may read, summarize, or orchestrate.

Observed/estimated truth and reconciliation remain inside Lattice-owned data contracts and services.

## 6. Proposed Semantic Contract

Every time-series point, snapshot card, or KPI payload that can appear on an operator surface should adopt the following fields.

### 6.1 Required shared fields

- `valueOrigin: observed | estimated`
- `valueMode: live | delayed | nowcast | imputed | backfill | replay | fallback | mirrored | cache`
- `observedAt`
- `generatedAt`
- `dataUpdatedAt`
- `validAsOf`
- `stale`
- `staleReason`

### 6.2 Required lineage fields for estimated values

- `estimateMethod`
- `estimateConfidence`
- `estimateIntervalLow`
- `estimateIntervalHigh`
- `derivedFromSources`
- `featureVintageAt`
- `modelVersion`
- `lastObservedAt`
- `replacedByObservationAt`

### 6.3 Recommended diagnostic fields

- `regime`
- `sourceFamily`
- `sourceLagHours`
- `oodScore`
- `abstainReason`
- `calibrationBucket`

### 6.4 Example payload

```json
{
  "signalName": "vix",
  "value": 18.7,
  "valueOrigin": "estimated",
  "valueMode": "nowcast",
  "observedAt": null,
  "generatedAt": "2026-04-17T07:58:00Z",
  "dataUpdatedAt": "2026-04-17T07:58:00Z",
  "validAsOf": "2026-04-17T08:00:00Z",
  "estimateMethod": "tier1_direct_nowcast_v1",
  "estimateConfidence": 0.74,
  "estimateIntervalLow": 17.9,
  "estimateIntervalHigh": 19.6,
  "derivedFromSources": ["fred:vix-daily", "market:spy", "news:risk-events"],
  "featureVintageAt": "2026-04-17T07:57:30Z",
  "modelVersion": "vix-nowcast-2026-04-17-r3",
  "lastObservedAt": "2026-04-16T21:00:00Z",
  "replacedByObservationAt": null,
  "stale": false,
  "staleReason": null
}
```

## 7. Storage Design

### 7.1 Immediate storage rule

Do not write estimated values into the same physical rows that represent observed history.

In practice, this means:

- do not silently overwrite `signal_history` latest rows with estimates
- do not let estimated values become the same class of truth as observed market or macro series

### 7.2 Proposed tables

#### `observed_signal_history`

Purpose:

- clean long-term target table for observed and provider-delayed values only

Core fields:

- `signal_name`
- `ts`
- `value`
- `source_id`
- `source_family`
- `observed_at`
- `ingested_at`
- `value_mode`
- `is_mirrored`
- `quality_status`

#### `estimated_signal_nowcasts`

Purpose:

- store current or near-current estimated values

Core fields:

- `signal_name`
- `target_ts`
- `estimated_value`
- `estimate_method`
- `estimate_confidence`
- `interval_low`
- `interval_high`
- `feature_vintage_at`
- `model_version`
- `regime`
- `derived_from_sources`
- `last_observed_at`
- `created_at`
- `expires_at`
- `status`

#### `nowcast_reconciliation`

Purpose:

- compare an estimate with the later real observation

Core fields:

- `signal_name`
- `target_ts`
- `model_version`
- `predicted_value`
- `observed_value`
- `observed_at`
- `abs_error`
- `pct_error`
- `calibration_bucket`
- `reconciled_at`

#### `source_availability_snapshots`

Purpose:

- preserve what was actually available at each inference timestamp

Core fields:

- `snapshot_ts`
- `source_id`
- `source_family`
- `latest_available_ts`
- `availability_status`
- `freshness_hours`

#### `model_registry`

Purpose:

- version and promote nowcast models safely

Core fields:

- `model_key`
- `model_version`
- `target_signal`
- `feature_set_hash`
- `train_window_start`
- `train_window_end`
- `promotion_state`
- `eval_summary`
- `created_at`

### 7.3 Transitional compatibility

If the repository is not ready to add all tables immediately:

- keep `signal_history` for observed values
- add only `estimated_signal_nowcasts` and `nowcast_reconciliation` first
- expose estimated values through API joins rather than blending them into legacy rows

## 8. Model Architecture

### 8.1 Model tiers

#### Tier 1: direct nowcast

Use when:

- the target signal has past observations
- the current observation is delayed or missing
- there are strong same-signal or closely related features

Examples:

- delayed macro series
- delayed market spread-like signals

#### Tier 2: cross-source nowcast

Use when:

- direct target observations are sparse
- other latest sources have historically overlapped with the target
- source relationship is empirically stable

Examples:

- target source lagged, related market/news/flow sources current

#### Tier 3: composite state estimate

Use when:

- the quantity is already derived by nature
- the surface is a composite score, not a raw fact

Examples:

- risk composite
- transmission intensity
- theme pressure score

### 8.2 Recommended model classes

Start simple:

- Kalman filter / dynamic linear model
- elastic net
- gradient boosting
- source-gated mixture of experts

Do not begin with a black-box deep model.

The first requirement here is not maximal performance.

It is:

- vintage-safe training
- interpretability
- calibration
- abstention

## 9. Source Selection and Domain Gate

This is the most important control layer.

The model must not use every available latest source just because it exists.

### 9.1 Per-target eligible source set

Each target signal needs an explicit candidate source policy:

- minimum overlap length
- minimum recent holdout performance
- semantic family compatibility
- acceptable publication lag structure
- acceptable drift score

### 9.2 Runtime gate

At inference time:

1. gather current candidate sources
2. score source eligibility
3. reject weak or mismatched sources
4. only run inference if the remaining eligible set is strong enough

If not, return:

```text
estimate unavailable
```

### 9.3 Negative transfer control

Add at least these checks:

- source similarity threshold
- recent calibration degradation threshold
- regime mismatch threshold
- OOD score threshold

If any fail, abstain.

## 10. Training Data Construction

### 10.1 Vintage-aware training

The model must train on information sets that replicate what the system would have known at time `t`.

For each training timestamp:

- only include rows published by that time
- respect source-specific release lag
- respect current source availability
- exclude later corrected or revised values unless the model is explicitly revision-aware

### 10.2 Forbidden training shortcuts

Do not:

- train on final revised values as if they were initial releases
- use mirrored rows as labels
- use fallback windows as true current observation
- use future aggregate features for earlier prediction timestamps

### 10.3 Recommended training surface

Use the existing historical/replay infrastructure as the base:

- [historical-stream-worker.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\importer\historical-stream-worker.ts)
- [intelligence-automation.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\intelligence-automation.ts)

The nowcast layer should be evaluated through pseudo-real-time replay, not ad hoc notebook scoring.

## 11. Evaluation and Promotion

### 11.1 Evaluation methods

Required:

- walk-forward validation
- pseudo-real-time replay
- per-regime evaluation
- delayed observation reconciliation

### 11.2 Metrics

Core metrics:

- MAE
- MAPE or SMAPE
- RMSE
- calibration error
- abstain rate
- coverage
- replacement error after actual observation arrives

### 11.3 Promotion gate

A model should only be promoted if:

- it beats a baseline over recent walk-forward windows
- confidence is calibrated
- abstention is rational rather than random
- recent drift is within threshold

### 11.4 Reconciliation loop

When the actual observed value arrives:

1. mark the estimate as superseded
2. write reconciliation row
3. update calibration summary
4. expose the error to ops and model registry

## 12. API Design

### 12.1 Existing endpoints to extend

Highest-priority endpoints:

- `/api/kpi-summary`
- `/api/live-status`
- `/api/theme-shell-snapshots`
- `/api/theme-brief/*`
- `/api/data-freshness-audit`

### 12.2 Response pattern

Use this general structure:

```json
{
  "value": 18.7,
  "observed": null,
  "estimate": {
    "value": 18.7,
    "confidence": 0.74,
    "method": "tier1_direct_nowcast_v1",
    "intervalLow": 17.9,
    "intervalHigh": 19.6
  },
  "valueOrigin": "estimated",
  "valueMode": "nowcast"
}
```

### 12.3 UI-safe rules

- if `observed-live` exists, prefer it
- if only `observed-delayed` exists, show delayed
- if neither exists and estimate quality is high, show `NOWCAST`
- if quality is weak, show unavailable

## 13. UI and Product Rules

### 13.1 Badge grammar

The UI should support at least:

- `LIVE`
- `DELAYED`
- `NOWCAST`
- `BACKFILL`
- `REPLAY`
- `FALLBACK`
- `MIRRORED`
- `CACHE`

### 13.2 First viewport rules

Allowed:

- `observed-live`
- `observed-delayed`
- `estimated-nowcast`, but only with explicit estimate badge and confidence

Not allowed:

- `backfill`
- `replay`
- `fallback`
- `mirrored`

### 13.3 Tooltip / evidence requirements for estimates

Every estimated value should show:

- last observed timestamp
- feature source count
- estimate confidence
- uncertainty interval
- method name
- whether replacement by later observation is pending

### 13.4 Research surfaces

Theme Brief and Replay surfaces may show estimated and backfill evidence more prominently, but they must still remain labeled as research, not live truth.

## 14. Operational Pipeline

### 14.1 Scheduler duties

The scheduler should eventually run:

- source availability snapshot capture
- estimate generation
- abstain / gate decision
- reconciliation when new observations arrive
- calibration drift audit

### 14.2 Ops audit additions

Extend the freshness audit to include:

- estimate count by surface
- estimate replacement lag
- calibration drift
- source gate reject rate
- abstain rate
- estimates currently shown on first viewport

### 14.3 Alerting

Create operator-visible alerts for:

- estimate shown where observation should exist
- estimate still active after observation arrival
- drift threshold breach
- OOD reject spike

## 15. Allowed and Forbidden Use Cases

### 15.1 Allowed

- delayed macro signal nowcast
- composite risk or transmission nowcast
- theme intensity estimation
- sparse latest feeds where historical overlap is strong

### 15.2 Forbidden or tightly restricted

- article existence or count presented as observed if inferred
- approval queue facts
- source registry state
- canonical entity facts
- legal or operational truth fields
- any silent replacement of observed values in KPI strip

## 16. Implementation Roadmap

### Phase 0: semantic contract

Add:

- `valueOrigin`
- `estimateConfidence`
- `validAsOf`
- `derivedFromSources`

to API payloads before building models.

Success criteria:

- no estimate can be rendered without explicit estimate semantics

### Phase 1: storage split

Add:

- `estimated_signal_nowcasts`
- `nowcast_reconciliation`

Success criteria:

- estimated rows no longer need to masquerade as `signal_history`

### Phase 2: baseline model

Start with one or two safe targets:

- delayed macro
- composite transmission or risk layer

Success criteria:

- walk-forward score beats baseline
- estimate badge visible in UI

### Phase 3: UI and ops integration

Add:

- NOWCAST badge
- estimate tooltip
- estimate audit summary

Success criteria:

- operator can distinguish observed vs estimated without reading documentation

### Phase 4: source gate and abstain

Add:

- per-target source eligibility policy
- OOD and negative-transfer gate
- abstain outcomes

Success criteria:

- weak source combinations no longer force estimates

### Phase 5: promotion and reconciliation

Add:

- model registry
- promotion state
- reconciliation and calibration tracking

Success criteria:

- late observed values automatically score and replace estimates

## 17. What Not To Do

Do not:

- overwrite observed tables with estimates
- present estimate as live without a badge
- mix backfill and nowcast into the same meaning bucket
- claim freshness using wrapper timestamps alone
- score models using future-aware data
- use mirrored or fallback rows as real labels

## 18. Recommended Direction

The repository should move toward:

```text
observed truth remains strict
estimated nowcast becomes explicit
backfill stays valuable for training and research
replay remains validation
UI never conflates them
```

This is the only path that preserves both:

- analytical usefulness from the large backfill corpus
- operational trust in the live product surface

## 19. External Research References

- Giannone, Reichlin, Small. *Nowcasting: The real-time informational content of macroeconomic data*. Journal of Monetary Economics, 2008.  
  [ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0304393208000652)
- IMF Working Paper 26/32. *Nowcasting and the role of data releases as news*, 2026.  
  [IMF PDF](https://www.imf.org/-/media/files/publications/wp/2026/english/wpiea2026032-source-pdf.pdf)
- Zhao et al. *A Survey of Deep Multi-source Domain Adaptation*, 2020.  
  [arXiv](https://arxiv.org/abs/2002.12169)
- Guo, Shah, Barzilay, Jaakkola. *Multi-Source Domain Adaptation with Mixture of Experts*, EMNLP 2018.  
  [ACL Anthology](https://aclanthology.org/D18-1498/)
- Wang et al. *Negative Transfer in Machine Learning: A Survey*, 2022.  
  [IEEE/CAA JAS](https://www.ieee-jas.net/article/doi/10.1109/JAS.2022.106004)
- Kaufman et al. *Leakage in Data Mining: Formulation, Detection, and Avoidance*.  
  [ACM](https://dl.acm.org/doi/10.1145/2382577.2382579)
- de Hond et al. *Guidance for updating clinical prediction models: a systematic review and critical appraisal*, 2020.  
  [Diagnostic and Prognostic Research](https://diagnprognres.biomedcentral.com/articles/10.1186/s41512-020-00090-3)

