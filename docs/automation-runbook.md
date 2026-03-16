# Intelligence Automation Runbook

## Purpose

Run historical fetch, import, replay, walk-forward, source acceptance, candidate expansion, and theme discovery without daily operator intervention.

## Files

- registry: `config/intelligence-datasets.json`
- state: `data/automation/intelligence-scheduler-state.json`
- locks: `data/automation/locks/*.lock.json`
- scheduler entrypoint: `scripts/intelligence-scheduler.mjs`
- automation service: `src/services/server/intelligence-automation.ts`

## Core loop

1. Load dataset registry
2. Acquire dataset lock
3. Fetch historical payload
4. Write artifact to `data/historical/automation/<dataset-id>/`
5. Import into DuckDB archive
6. Run replay when cadence is due
7. Run nightly walk-forward when local hour threshold is met
8. Sweep discovered sources and API sources through guarded score-based auto-accept / auto-activate policy
9. Run keyword lifecycle review so low-signal and stale autonomous keywords are retired automatically
10. Refresh theme discovery queue
11. Auto-reject low-signal, over-overlapping, or stale low-score queue items
12. Ask Codex for theme proposals only for top queue items
13. Auto-promote only if promotion score, overlap, and policy thresholds pass
14. Ask Codex for candidate expansion on top coverage gaps after scoring, diversity caps, and cooldown checks
15. Auto-accept only if universe policy score, sector caps, and asset-kind caps pass
16. Re-run replay if new accepted candidates changed the active universe
17. Apply cross-corroboration, recency decay, and execution-reality constraints inside the investment snapshot
18. Downgrade ideas into `shadow`, `watch`, or `abstain` if calibrated confidence is not strong enough
19. Keep rollback armed if the recent shadow book deteriorates
20. Release lock
21. Apply retention to artifacts and scheduler history

## Commands

Run one cycle:

```bash
npm run intelligence:scheduler:once
```

Run worker loop:

```bash
npm run intelligence:scheduler
```

Inspect registry and state:

```bash
node --import tsx scripts/intelligence-scheduler.mjs status
```

## Locking

- lock scope is per dataset and per theme queue item
- lock files live under `data/automation/locks`
- stale locks expire by TTL and are reclaimed automatically

## Retry

- failures are retried automatically
- backoff grows exponentially from 5 minutes
- the dataset state carries `nextEligibleAt` after repeated failure

## Retention

- scheduler run history is trimmed by age
- old fetch artifacts are pruned per dataset
- old non-open queue items are pruned by retention window

## Theme discovery and Codex

### Theme discovery

The discovery queue is built from replay-frame motifs that repeat across:

- samples
- sources
- regions

and do not overlap too much with the current theme catalog.

The queue is also auto-cleaned now. The scheduler can reject:

- low-signal motifs that look like weak keywords rather than reusable themes
- motifs whose overlap with the current theme catalog is too high
- stale low-score motifs that age without gaining enough signal

### Codex theme proposer

Codex can now propose reusable backtest themes from queue items.

Codex proposal output is expected to include:

- theme id and label
- trigger set
- sectors and commodities
- thesis and invalidation
- liquid candidate assets

### Promotion policy

Default mode is `guarded-auto`.

A theme is auto-promoted only when:

- discovery score clears the threshold
- sample count is sufficient
- source diversity is sufficient
- Codex confidence clears the threshold
- at least the minimum number of liquid assets is proposed
- overlap with the existing theme catalog stays below the configured ceiling
- promotion score clears the configured floor
- daily promotion budget is not exhausted

## Important limitation

Codex can propose backtest themes and candidate assets, but it is still not the final execution engine. The scheduler policy and universe policy remain the deterministic gates.

## Source automation

The scheduler now also runs a source registry sweep.

Default mode is `guarded-auto`.

It can:

- auto-approve discovered feed candidates using a composite score, not only raw confidence
- auto-activate approved feed candidates while enforcing category and domain caps
- refresh API source health in batches
- auto-approve and auto-activate API sources using health/schema/ToS/rate-limit signals plus category and base-url caps

This does not remove manual override. It removes the need to click through routine approvals.

## Candidate expansion automation

The scheduler now looks at coverage gaps after replay and theme promotion.

When the gap policy allows it, the worker:

- ranks gap themes by severity, missing asset kinds, missing sectors, open review pressure, and current mapping depth
- asks Codex for additional liquid symbols
- ingests proposals into the candidate review store
- applies the current universe policy immediately using score, sector balance, and asset-kind balance
- replays again if any newly inserted candidate is auto-accepted

This means investment idea coverage can widen without waiting for a human to press `Ask Codex`.

## Idea triage

The investment snapshot now auto-triages idea cards before the operator view is rendered.

Weak cards can be suppressed when they combine:

- low conviction
- high false-positive risk
- weak evidence or trigger count
- weak transmission support
- weak analog or backtest support

This reduces the need for manual idea filtering in the dashboard.

## Constrained autonomy guardrails

The unattended loop now also depends on live-decision guardrails, not only discovery loops.

Those guardrails include:

- cross-source contradiction penalties
- rumor / hedge-language penalties
- time-decay on old mapping priors
- recent-evidence floors before live deployment
- execution-reality penalties for spread, slippage, liquidity, and market session state
- calibrated confidence bands
- action gating into `deploy`, `shadow`, `watch`, or `abstain`
- shadow-book rollback when recent tracked samples deteriorate

This means the unattended loop can still widen or discover ideas, but it is more willing to stand down or remain in shadow mode when recent evidence is weak.
