# Intelligence Automation Runbook

## Purpose

Run historical fetch, import, replay, walk-forward, source acceptance, candidate expansion, theme discovery, guarded dataset registration, self-tuning, and top-down risk control without daily operator intervention.

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
16. Score replay-driven theme gaps for missing historical coverage and propose new datasets
17. Ask Codex for dataset templates only when provider family, PiT safety, overlap, and cost checks allow it
18. Guard-register only replay-safe dataset proposals into `config/intelligence-datasets.json`
19. Re-run replay if new accepted candidates changed the active universe
20. Run self-tuning against recent replay and walk-forward outcomes
21. Promote or roll back weight profiles only when the experiment registry clears the configured thresholds
22. Apply cross-corroboration, recency decay, graph-propagation support, and execution-reality constraints inside the investment snapshot
23. Apply macro kill-switch and hedge overlay before any idea can remain in `deploy`
24. Downgrade ideas into `shadow`, `watch`, or `abstain` if calibrated confidence is not strong enough
25. Keep rollback armed if the recent shadow book deteriorates
26. Release lock
27. Apply retention to artifacts, scheduler history, and experiment snapshots

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

## Dataset discovery and guarded registration

The worker can now discover missing historical coverage from live replay outputs.

It scores candidate datasets using:

- theme pressure from repeated coverage gaps
- provider family support
- estimated historical replay utility
- overlap against the current registry
- point-in-time safety expectations
- expected storage and fetch cost

Codex can propose dataset templates, but registration remains guarded. A proposal is auto-registered only when:

- provider family is already supported
- overlap with the current registry is low enough
- estimated cost stays below the policy ceiling
- the proposal looks replay-safe for bitemporal import
- the daily registration budget is not exhausted

Auto-registration updates the registry, not the currently running replay pass. The new dataset only participates after a later scheduler cycle fetches and imports it.

## Self-tuning and experiment registry

The unattended loop now also keeps a small experiment registry for weight profiles.

That registry stores:

- the active weight profile
- recent candidate profiles
- replay and walk-forward performance snapshots
- promote / observe / rollback decisions
- reasons behind each decision

Self-tuning is still policy-gated. The worker does not blindly optimize every coefficient on every run. It only promotes a new profile when:

- enough recent replay or walk-forward samples exist
- the candidate profile beats the active one on the configured composite score
- drawdown and hit-rate floors still hold
- the cooldown window since the last promotion has elapsed

This keeps the system closer to constrained autonomy than unconstrained self-modification.

## Macro risk overlay, kill switch, and hedge bias

Replay and live snapshots now compute a top-down macro overlay before idea deployment.

The overlay combines:

- VIX stress
- credit or liquidity proxies
- growth and inflation regime pressure
- yield-curve inversion pressure
- recent drawdown behavior inside the tracked idea book

The overlay can:

- cap net exposure
- cap gross exposure
- bias the book toward defensive hedges
- force non-hedge ideas into `shadow`, `watch`, or `abstain`
- arm a kill switch when macro stress becomes too asymmetric

## Explainable attribution

Idea cards and direct mappings now carry a structured attribution breakdown.

The breakdown separates:

- cross-corroboration contribution
- graph-propagation contribution
- market beta and regime contribution
- reality penalties such as spread, slippage, liquidity, and session state
- time-decay and stale-prior penalties
- macro overlay pressure

This means the operator can inspect not only the final action, but why the engine believed the action or why it refused to deploy.

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
