# Intelligence Automation Runbook

## Purpose

Run historical fetch, import, replay, walk-forward, source acceptance, candidate expansion, theme discovery, guarded dataset registration, self-tuning, and top-down risk control without daily operator intervention.

## Pilot default

The repository is now pre-wired for a small unattended pilot.

Default datasets are enabled:

- `coingecko-btc-core`
- `fred-core-cpi`
- `gdelt-middle-east`
- `acled-middle-east`

This means the scheduler will try to fetch and replay them as soon as the required provider keys exist.

Provider requirement summary:

- `coingecko-btc-core`: no key required
- `gdelt-middle-east`: no key required
- `fred-core-cpi`: requires `FRED_API_KEY`
- `acled-middle-east`: requires `ACLED_ACCESS_TOKEN`

## Codex activation checklist

Codex-driven source, theme, and dataset automation only fires when all of the following are true:

1. Codex CLI is available and logged in.
2. At least one dataset is enabled in `config/intelligence-datasets.json`.
3. At least one enabled dataset has already produced replay frames.
4. Protected providers are not blocked by auth errors.
5. Theme or dataset pressure is high enough to clear the guarded thresholds.

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
26. Generate or refresh evidence-first report artifacts when scheduled report cadence is due
27. Drain report-generated backfill/source-query tasks through bounded review-gated execution
28. Recompute report quality caps after new provider data lands
29. Release lock
30. Apply retention to artifacts, scheduler history, and experiment snapshots

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

Run through the Windows wrapper that loads `.env.local` and writes logs:

```bash
npm run intelligence:scheduler:service:once
npm run intelligence:scheduler:service:run
```

Install or remove the Windows scheduled task:

```bash
npm run intelligence:scheduler:service:install
npm run intelligence:scheduler:service:remove
```

The task name is `WorldMonitor-Intelligence-Scheduler`.
It tries to install as `SYSTEM` on startup first.
If that fails, it falls back to a current-user logon task.
If task registration is blocked by policy, it writes a Startup-folder fallback command file for the current user instead.
The wrapper reloads `.env.local` on each cycle, so newly added provider keys are picked up without changing the registry again.

Run a DB-backed deep report manually:

```bash
node scripts/generate-intelligence-report.mjs --db --depth deep --type theme_report --subject "AI / Machine Learning"
```

Run free external provider backfill for a monitored report universe:

```bash
node scripts/collect-free-external-data.mjs --theme ai-ml --label "AI / Machine Learning" --providers fmp --symbols MSFT,AMD,NVDA,META,GOOGL --force --throttle-hours 0
```

Plan a provider-specific evidence contract backfill cycle from the latest report artifact:

```bash
node scripts/run-evidence-contract-backfill-cycle.mjs --latest --limit 25
```

Apply the closure cycle for a specific report artifact, execute only report-created source queries, compute local market validation, refresh the dashboard summary, and regenerate the report:

```bash
node scripts/run-evidence-contract-backfill-cycle.mjs --report-dir data/reports/universal-contract-cross-theme-16776-check-v3 --apply --auto-report-source-query --market-validation --dashboard-summary --regenerate --subject "solid rocket motor capacity" --type cross_theme_bottleneck_report
```

Run bounded closure across the latest report artifacts:

```bash
node scripts/run-evidence-contract-backfill-cycle.mjs --all-reports --apply --auto-report-source-query --market-validation --dashboard-summary --report-limit 5 --limit 40
```

Provider backfill is now ontology-aware:

- `collect-free-external-data.mjs` resolves issuer symbols from explicit CLI symbols, `theme_entity_exposure`, `regime_conditional_impact`, `tracked_targets`, report backfill metadata, approval payloads, and recent provider runs.
- Universal Evidence Contract route plans now carry `desiredEvidenceClass`, executable collectors, source-provider families, query variants, issuer universe, and negative-control intent from report tasks into approvals and private research bundles.
- `run-evidence-contract-backfill-cycle.mjs` keeps a terminal-state file at `data/runtime/evidence-contract-backfill-cycle-state.json` in apply mode so exhausted class/query/provider combinations are not retried in a tight loop.
- Cross-theme reports expose a separate evidence-state diagnostic so "not an investment call" is not confused with "bad investment." The states are `More evidence needed`, `Targeted backfill needed`, `Market validation pending`, `Search exhausted, not validated`, `Negative-control reject`, and `Decision review ready`.
- Continue class-specific backfill only when the diagnostic is `More evidence needed`, `Targeted backfill needed`, or `Market validation pending`. Stop broad automated backfill when the diagnostic says `Search exhausted, not validated` or `Negative-control reject`; use manual expert research only for named unresolved classes.
- `market_validation` is closed from local controlled market data first (`event_uplift`, matched controls, market returns/quotes). Source-query results can explain the mechanism, but they do not satisfy decision-grade market validation.
- The dashboard API exposes `/api/reports/backfill-closure` and the dashboard has a `Report Backfill` panel with `pending`, `running`, `blocked`, `review-ready`, and `rejected` filters. The modern cockpit view renders a class-level closure matrix (`Class`, `State`, `Provider`, `Tier`, `Latest run`, `Closure reason`, `Next action`) and keeps raw provider/query details inside the audit drawer. This panel is an operations surface; canonical proposals/RSS/source registration still use the approval queue.
- ETF, macro, policy, unit, and acronym tokens such as `ITA`, `UUP`, `SMH`, `BDRY`, `ICLN`, `NATO`, `EU`, `DOD`, `MW`, and `LLM` are excluded from issuer transcript/fundamental collection.
- SEC collection auto-seeds missing or stale issuer `companyfacts` and recent `10-K`/`10-Q`/`8-K` filing metadata before extracting management-commentary evidence. It also opens SEC accession `index.json` directories and prioritizes EX-99.1 earnings releases and investor-presentation exhibits, so issuer commentary and operating KPI language can be collected when the primary filing is sparse.
- USAspending contract awards are collected without a paid key for defense issuer universes and stored as official award/procurement evidence. These rows can strengthen contract-award and procurement evidence, but they are explicitly not treated as issuer `book-to-bill`, guidance, or transcript evidence.
- Report-created source-query evidence is attributed back to the requested data pack, but a critical ontology KPI is satisfied only when the evidence text matches that specific KPI. Pack presence alone does not clear investment-readiness blockers.
- FMP/Polygon/SEC provider attempts write `external_provider_backfill_runs`. `deferred_provider` and `retry_wait` runs are throttled like successful runs so a rate limit does not create a tight retry loop.
- For defense, official War.gov contract RSS fills contract awards, procurement funds, missile/air-defense demand, and shipyard-throughput evidence without a paid key. Issuer-level `book-to-bill` is only cleared by direct filing/transcript/provider wording such as `book to bill` or a ratio-style observation; generic `bookings` alone remains insufficient.

Run the full coverage-closure loop:

```bash
npm run research:coverage -- --report-subject-limit 3 --provider-limit 50
```

The loop is intentionally bounded but recursive inside each run. It discovers subjects from sources, approvals, report gaps, tracking targets, and research signals; executes provider backfill; materializes ontology/generic KPI observations; drains report-created gaps into source-query approvals; executes approved source queries; re-enters provider/KPI collection for new targets; and regenerates reports when same-loop evidence or collection work lands. Use `UNIVERSAL_RESEARCH_COVERAGE_PASSES`, `UNIVERSAL_RESEARCH_CLOSURE_PASSES`, `UNIVERSAL_RESEARCH_PROVIDERS`, and `UNIVERSAL_RESEARCH_PROVIDER_THROTTLE_HOURS` to tune daemon behavior without code changes.

Drain report-created backfill tasks:

```bash
node scripts/drain-report-backfill-tasks.mjs --limit 10
```

## Locking

- lock scope is per dataset and per theme queue item
- lock files live under `data/automation/locks`
- stale locks expire by TTL and are reclaimed automatically

## Retry

- failures are retried automatically
- backoff grows exponentially from 5 minutes
- the dataset state carries `nextEligibleAt` after repeated failure
- the scheduled task itself is configured to restart repeatedly after failure

## Retention

- scheduler run history is trimmed by age
- old fetch artifacts are pruned per dataset
- old non-open queue items are pruned by retention window
- wrapper logs are written under `data/automation/logs`

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

## Why the queue can stay empty

An empty queue usually means one of these, not that the worker is broken:

- too few enabled datasets are actually producing replay frames
- protected datasets are blocked by missing provider keys
- recent motifs do not clear guarded thresholds for score, samples, source diversity, and overlap
- dataset discovery sees no repeated uncovered theme pressure worth registering
- Codex-driven source discovery has not produced candidates strong enough to pass guarded auto-accept

Use the in-app `Codex Ops` panel to inspect these conditions directly.

## Important limitation

Codex can propose backtest themes and candidate assets, but it is still not the final execution engine. The scheduler policy and universe policy remain the deterministic gates.

Report generation follows the same rule. Codex/LLM layers may write analyst
interpretation, alternative explanations, watch triggers, and source-query
drafts, but they may not directly clear validation gates or promote a report to
investment readiness.

Direct call transcript coverage, controlled market validation, and causal
mechanism support are deterministic quality gates. If provider backfill is rate
limited, the report should keep the blocker visible and queue the collection
task rather than hiding the gap.

## Windows unattended startup

For the current Windows-first pilot setup, the unattended path is:

1. Put provider keys into `.env.local`
2. Run `npm run intelligence:scheduler:service:install`
3. Confirm status with `npm run intelligence:scheduler:status`
4. Inspect logs under `data/automation/logs`

This is enough to keep the unattended research loop alive without manually reopening a console after each restart.

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

## Auto-curate backfill criteria

The emerging-tech auto-curate path is:

1. `scripts/auto-curate.mjs`
2. `scripts/_shared/auto-curate-support.mjs`
3. `src/services/server/codex-dataset-proposer.ts`
4. `scripts/proposal-executor.mjs`

The intent is to separate three different operator actions:

- `backfill-source` when history is missing
- `add-rss` when a new direct or adjacent feed is missing
- `add-theme` when repeated evidence suggests the taxonomy itself is missing

### Weak-area thresholds

`collectAutoCurateContext()` marks a weak area when any of these conditions are true:

- `corpus-volume`: total `articles` rows are below `10,000`
- `source-diversity`: distinct article `source` count is below `4`
- `theme-classification`: 30-day `auto_article_themes.auto_theme='unknown'` rate is above `0.20`
- `topic-discovery`: 30-day `discovery_topics.created_at` count is below `5`
- `category:<name>`: summed `discovery_topics.article_count` for a category is below `50`
- `emerging-tech-coverage`: no category coverage is present at all

The supporting inputs come from:

- `articles` grouped by `source`
- `discovery_topics` total and 30-day recent counts
- `auto_article_themes` 30-day unknown-theme rate

### Action selection rule

`proposeBackfillActions()` must keep proposals narrow and concrete:

- maximum `3` actions per curation pass
- prefer `backfill-source` when the gap is historical depth or corpus breadth
- use `add-rss` for a missing direct feed or a credible adjacent evidence lane
- use `add-theme` only when a structurally distinct recurring theme keeps appearing
- every action must include `reason`, `expectedImpact`, and a short transmission explanation
- do not exceed the active budget snapshot

### Default fallback mapping

If Codex is unavailable or returns unusable output, the fallback planner maps weak areas like this:

- `source-diversity` or `corpus-volume`
  - `backfill-source`
  - source: `hackernews`
  - args: `limit=10000`, `minScore=50`
  - priority: `high`
- `topic-discovery` or any `category:*`
  - `backfill-source`
  - source: `arxiv`
  - args: `categories=['cs.AI','cs.LG','q-bio.QM']`, `from='2024-01-01'`, `limit=8000`
  - priority: `high`
- `emerging-tech-coverage`
  - `backfill-source`
  - source: `gdelt-articles`
  - args: `keywords=['emerging technology','robotics','semiconductor']`, `from='2024-01-01'`, `limit=12000`
  - priority: `medium`

If daily `backfillCalls.remaining <= 0`, the fallback planner proposes no automated backfill.

### Guardrails before execution

`backfill-source` proposals are not executable just because they were queued.

They must still pass:

- whitelist validation from `scripts/_shared/backfill-whitelist.mjs`
- source-specific `minIntervalHours`
- hourly, daily, and weekly automation budget checks
- approval checks for sources marked `requiresApproval`

Current whitelisted sources:

- `hackernews`
  - min interval: `24h`
  - args: `since?`, `limit<=50000`, `minScore<=1000`
- `arxiv`
  - min interval: `24h`
  - args: `categories` required, `from` required, `limit<=30000`
- `gdelt-articles`
  - min interval: `48h`
  - args: `keywords?`, `from` required, `limit<=100000`
- `guardian-keyword`
  - min interval: `24h`
  - args: `query` required, `from` required, `limit<=5000`
  - approval required: `true`

Current shared automation budget defaults:

- hourly: `backfillCalls=2`, `codexCalls=40`
- daily: `backfillCalls=5`, `backfillItems=100000`, `codexCalls=300`
- weekly: `backfillCalls=20`, `backfillItems=500000`

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
