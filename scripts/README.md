# Scripts

This folder is the operational toolbox for the project.

## Script families

- `seed-*.mjs`
  - fetch external data and populate Redis or local caches
- `fetch-*.mjs`
  - one-off data acquisition or source hydration
- `check-*.mjs`
  - validation and CI guardrails
- `sync-*.mjs`
  - keep generated/config/deploy artifacts aligned
- `dev-*.mjs`
  - local runtime launchers
- `intelligence-*.mjs`
  - automation and scheduler entry points
- `report-*.mjs`
  - evidence-bound report bundle, validation, rendering, export, and storage helpers
- `collect-*.mjs`
  - provider and research data collection entry points

## Important scripts

- `seed-bootstrap.mjs`
  - cold-start helper for first deploys
- `fast-keyword-extractor.mjs`
  - durable fast article analysis and trend-keyword backfill
- `ollama-article-analyzer.mjs`
  - ambiguity-driven LLM article analysis into canonical `article_analysis`
- `auto-pipeline.mjs`
  - multi-step article/theme/symbol refresh pipeline
- `fetch-hackernews-archive.mjs`
  - broad Hacker News archive ingestion for emerging-tech discovery
- `fetch-arxiv-archive.mjs`
  - broad arXiv archive ingestion for research-heavy emerging-tech discovery
- `discover-emerging-tech.mjs`
  - embedding-based discovery of topics outside current main-theme anchors
- `label-discovery-topics.mjs`
  - Codex-driven labeling of pending discovery topics
- `generate-tech-report.mjs`
  - operator-facing report generation into canonical `tech_reports`
- `generate-intelligence-report.mjs`
  - evidence-first intelligence report generator for DB-backed or sample reports
- `build-report-bundle.mjs`
  - builds report evidence bundles without rendering final artifacts
- `validate-intelligence-report.mjs`
  - validates generated reports for unsupported claims, stale disclosure, numeric consistency, duplicate sections, and investment-language violations
- `render-intelligence-report.mjs`
  - renders an existing bundle/analysis pair into report artifacts
- `export-intelligence-report.mjs`
  - exports report artifacts such as HTML, Markdown, and presentation files
- `schedule-intelligence-reports.mjs`
  - generates scheduled report artifacts into the local registry
- `collect-free-external-data.mjs`
  - collects external provider data such as fundamentals, valuations, peers, estimates, call transcripts, SEC filing/exhibit commentary, official War.gov defense contract announcements, and public USAspending contract awards; maps provider excerpts into theme-ontology KPI observations so reports can clear or narrow specific readiness blockers
  - reads evidence contract route metadata from report backfill tasks and source-query approvals, then narrows provider execution by class; for example procurement routes prefer War.gov/USAspending while market validation routes prefer Polygon/FMP and power constraints prefer EIA/utility-style collection
  - resolves issuer symbols generically from theme exposure tables, regime impacts, tracked targets, report backfill task metadata, approval payloads, and recent provider runs before deciding whether SEC/FMP/Polygon are safe to execute; ETF/acronym/unit tokens such as `ICLN`, `MW`, and `LLM` are filtered out of issuer-only provider calls
  - auto-seeds missing/stale SEC companyfacts and recent 10-K/10-Q/8-K filing metadata for issuer symbols before SEC management-commentary extraction, then inspects SEC accession `index.json` attachments to pull EX-99.1 earnings releases and investor-presentation exhibits when primary filings are too sparse
  - treats `deferred_provider` and `retry_wait` runs as throttle-eligible attempts, so provider rate limits do not create tight retry loops
- `drain-report-backfill-tasks.mjs`
  - drains report-created backfill/source-query tasks through a bounded execution path
- `run-evidence-contract-backfill-cycle.mjs`
  - turns Universal Evidence Contract gaps into provider-specific route plans, drains/enqueues source-query approvals, runs matching free providers, optionally executes source-query approvals, and can regenerate the report; default mode is dry-run, use `--apply` for DB/state mutation
  - `--auto-report-source-query` only approves report-created `source-query` work; canonical cross-theme proposals, RSS/source registration, and generic backfill approvals remain review-gated
  - `--market-validation` computes report-scoped `market_validation` from local controlled market data (`event_uplift`, matched controls, market returns/quotes) and stores the resulting tier as private report evidence
  - provider wrapper timeouts are disabled by default for long closure runs; set `EVIDENCE_BACKFILL_PROVIDER_STEP_TIMEOUT_MS` to a positive millisecond value to re-enable a cap. Step start/finish entries are written to `data/runtime/evidence-contract-backfill-cycle.steps.jsonl`
  - direct CLI stdout is compact by design: full child step JSON, provider rows, source-query bundles, and regenerated artifact details are stored under `data/runtime/evidence-contract-backfill-cycle-results/*.json`, while stdout keeps only counts, status, artifact path, and unblock deltas
  - `--all-reports --dashboard-summary` builds the report closure ledger used by the dashboard `Report Backfill` panel
  - cross-theme regenerated reports include an evidence-state diagnostic that separates insufficient validation from a negative-control rejection; keep collecting only for `More evidence needed`, `Targeted backfill needed`, or `Market validation pending`, and stop broad automation for `Search exhausted, not validated` or `Negative-control reject`
- `data-accumulator.mjs`
  - continuous Yahoo/FRED/GDELT raw collection daemon. Raw files can be written while the local sidecar is down, but import/replay coverage is counted only after sidecar import and replay succeed
  - records sidecar import failures in `data/historical/accumulator-state.json` as `pendingImports[]`, drains a bounded slice at the start of each cycle, and writes explicit replay statuses such as `replay_skipped_sidecar_unreachable` instead of ambiguous `no result`
  - stores retryable GDELT fetch failures in `gdeltRetryQueue[]`; `200` responses with empty `articles` remain normal no-hit windows and are not retried
  - deletes imported raw JSON only after NAS PostgreSQL sync was requested and confirmed by `postgresSyncResult`; cleanup writes an audit row to `data/historical/import-cleanup-ledger.jsonl`
- `repair-accumulator-import-replay.mjs`
  - dry-run-first catch-up tool for raw files whose sidecar import/replay was missed during a sidecar outage
  - `--apply` imports bounded candidates through the sidecar API only; `--replay` triggers one replay after import. It does not write NAS/canonical graph directly
  - use `--postgres-sync --cleanup-imported-raw` to import to NAS and delete only confirmed local raw files; use `--keep-imported-raw` to retain payloads for importer debugging
- `run-seed-bias-backfill-orchestrator.mjs`
  - diagnoses autonomous mechanism seed class concentration, provider/source sensitivity, holdout confirmation, negative-control survival, and evidence scarcity before any report promotion
  - default mode is dry-run and writes runtime artifacts only; raw collected evidence remains separate from accepted evidence and does not satisfy report readiness unless the Evidence Contract Matrix accepts it
  - creates class-specific backfill plans and review-gated adapter proposals for missing provider routes; it never activates providers or writes canonical graph/source registry state
- `run-universal-research-orchestrator.mjs`
  - generic research collection loop that plans subject-specific data needs across themes, symbols, sources, policies, research, and industry indicators
  - scans recent report artifacts for no-seed adjacent theme candidates before subject selection; Space/SRM/Defense reports can create evidence-seeking lanes such as launch fueling/cryogenic infrastructure, range operations/ground systems support, propulsion input materials, and qualification testing without a user-provided company or keyword seed
  - adjacent candidates are persisted to `adjacent_theme_candidates`; only candidates that meet the evidence/confidence threshold become universal research subjects, while weaker candidates stay in `needs_evidence` with a root-cause reason such as `source_coverage_gap` or `vocabulary_gap`
  - runs bounded coverage-closure passes: provider backfill, ontology/generic KPI materialization, Research OS, report-gap drain, report-only source-query execution, market validation, provider/KPI re-entry, and report regeneration until no same-loop evidence or collection work lands
  - provider backfill wrapper timeouts are disabled by default; set `UNIVERSAL_RESEARCH_PROVIDER_STEP_TIMEOUT_MS` or `UNIVERSAL_RESEARCH_TIMEOUT_MS` to a positive millisecond value to restore caps. Step logs are written to `data/runtime/universal-research-orchestrator.steps.jsonl`
  - adjacent expansion is enabled by default; use `--no-adjacent-expansion` to disable it, `--adjacent-limit` to cap scanned reports, and `--auto-report-mode` to record the scheduler mode for operator review
  - use `npm run research:coverage -- --report-subject-limit 3` for an operator-safe multi-theme loop; provider rate limits are recorded as deferred work and throttled instead of retried in a tight loop
- `generate-weekly-digest.mjs`
  - weekly digest synthesis over reports and top topics
- `fetch-gdelt-articles.mjs`
  - canonical GDELT article wrapper for automation-safe article backfill
- `fetch-keyword-news-backfill.mjs`
  - targeted Guardian/NYT keyword backfill for approved operator workflows
- `codex-curate-proposals.mjs`
  - JSON-producing Codex curation planner for whitelist-safe backfill proposals
- `auto-curate.mjs`
  - autonomous proposal creation loop writing pending actions into `codex_proposals`
- `analyze-coverage-gaps.mjs`
  - identifies `signal_history` channels that are ready but unused in `conditional_sensitivity`
- `self-heal-sources.mjs`
  - server-safe self-healing loop that validates and activates approved feed candidates
- `verify-emerging-tech-runtime.mjs`
  - runtime smoke verification for emerging-tech dashboard/API surfaces
- `fetch-historical-data.mjs`
  - main historical dataset acquisition path for replay/backtest
- `verify-nas-backtest-e2e.mjs`
  - verifies NAS-backed historical data through load, frame, and walk-forward smoke stages
- `verify-e2e.mjs`
  - verifies active signal-side ingestion and storage flow
- `intelligence-scheduler.mjs`
  - automation loop entry point
- `master-daemon.mjs`
  - background automation loop with circuit-breaker state and health checks
- `event-dashboard-api.mjs`
  - signal dashboard API with structured request logging and `/api/metrics`
- `proposal-executor.mjs`
  - durable proposal worker with retry and dead-letter queues
- `check-schema-versions.mjs`
  - schema migration sanity checks
- `sync-security-headers.mjs`
  - deployment header sync

## Shared helper modules

Shared operational helpers live in [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\_shared](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/_shared).

Important shared modules:

- `nas-runtime.mjs`
  - canonical runtime/env resolution
- `structured-logger.mjs`
  - common JSONL logger for long-running scripts
- `pg-backup.mjs`
  - NAS PostgreSQL backup and retention
- `schema-constraints.mjs`
  - best-effort schema hardening helpers
- `data-quality-check.mjs`
  - freshness, completeness, and outlier reporting
- `alert-notifier.mjs`
  - local alert persistence plus optional webhook fan-out
- `schema-emerging-tech.mjs`
  - canonical schema for discovery topics, memberships, reports, and backfill state
- `schema-automation.mjs`
  - canonical schema for automation budget logs, action audit, and approval queue
- `schema-proposals.mjs`
  - shared `codex_proposals` schema used by executor and auto-curate
- `emerging-tech-discovery.mjs`
  - pure helpers for tokenization, clustering, momentum, and topic IDs
- `codex-json.mjs`
  - shared Codex JSON prompt runner for script-side automation
- `automation-budget.mjs`
  - daily/hourly/weekly budget checks plus kill switch state
- `automation-audit.mjs`
  - durable automation action log helpers
- `feed-trust.mjs`
  - canonical trusted-domain helper used by RSS registration and self-healing
- `approval-queue.mjs`
  - approval queue for higher-risk autonomous actions
- `backfill-whitelist.mjs`
  - executable whitelist and argument validation for autonomous backfills
- `report-evidence-bundle.mjs`
  - claim/evidence/metric/caveat bundle construction for report generation
- `report-deep-research-pack.mjs`
  - market, fundamental, filing, transcript, industry, research, policy, causal, historical, and feedback evidence lanes
- `report-adjacent-expansion.mjs`
  - converts report evidence gaps, ontology hints, source-query drafts, and watch vocabulary into no-seed adjacent theme candidates with status, confidence, root-cause failure reason, source terms, class-specific query variants, and unverified issuer candidates
- `report-signal-cards.mjs`
  - attention/fundamental/market/constraint/causal/research signal-card synthesis
- `report-analyst-synthesis.mjs`
  - evidence-bound thesis, counter-thesis, scenario, market implication, and research action synthesis
- `report-narrative-plan.mjs`
  - semantic blueprint and long-form memo renderer
- `report-chart-planner.mjs`
  - claim-bound figure specs and exhibit takeaways
- `report-compiler.mjs`
  - client memo and audit appendix renderer
- `report-validator.mjs`
  - report safety and quality gates
- `report-quality.mjs`
  - artifact, triage, analyst memo, and investment-readiness scoring
- `external-data/fmp.mjs`
  - FMP adapter for fundamentals, valuations, estimates, peers, calendar, and earnings call transcripts; HTTP 429s are retryable/deferred provider failures, not successful backfills
- `collect-free-external-data.mjs --providers dod-contracts`
  - no-key official War.gov contract announcement ingestion for defense ontology KPI evidence such as contract awards, procurement funds, missile/air-defense demand, and shipyard throughput
- `theme-ontology.mjs`
  - deterministic archetype registry and readiness gate; pack evidence must match the specific required KPI, so a generic source-query hit cannot clear `book-to-bill`, direct commentary, or other investment-critical gaps by pack name alone
- `evidence-provider-router.mjs`
  - maps `desiredEvidenceClass` plus subject, ontology, and issuer universe into executable collectors, source-provider families, and query variants. It preserves negative-control separation and filters ETF/macro proxies out of issuer-only routes.
- `report-backfill-closure.mjs`
  - normalizes report task, approval, evidence, market-validation, and artifact state into per-class closure ledgers for reports and dashboard summaries.
- `report-market-validation.mjs`
  - derives decision/screening/weak/missing market-validation tiers from local controlled event/uplift rows and persists report-scoped market evidence without creating canonical promotion rows. It now resolves a report-scoped issuer universe before querying controlled market rows and records missing reasons such as `no_issuer_universe`, `no_event_candidates`, `no_event_uplift_rows`, `weak_controls`, and `below_tstat`.
- `report-issuer-universe.mjs`
  - resolves the issuer universe for report closure from artifact symbols, ontology supplier symbols, report pack rows, source-query evidence metadata, and legacy issuer aliases such as `AJRD -> LHX`; issuer-only providers are blocked with `blocked_missing_issuer_universe` instead of falling back to broad source-query when no investable issuer can be resolved.
- `seed-bias-diagnostics.mjs`
  - computes class distribution, provider ablation sensitivity, backfill elasticity, holdout confirmation, negative-control survival, known-narrative overlap, and diversity warnings for autonomous mechanism seed batches. Its verdict is advisory; `visualStatus` plus accepted Evidence Contract Matrix coverage remains the readiness source of truth.
- `operator-seed-bias-storage.mjs`
  - idempotently creates the seed-bias run/task/raw-evidence/accepted-evidence/holdout/negative-control ledger tables. It is the only storage path used by `run-seed-bias-backfill-orchestrator.mjs --apply`; it does not touch approvals, canonical graph, source registry, provider activation, or report promotion state.
- `seed-evidence-acceptance.mjs`
  - evaluates raw seed-bias evidence against source independence, class relevance, acceptance criteria, duplicate/stale checks, target-theme compatibility, negative-control separation, and local controlled market-validation rules. Raw evidence never changes readiness until this lane produces accepted evidence.

## Design intent

- Scripts are operational entry points, not reusable libraries.
- Shared code should be moved into `src/services/` or `server/_shared/` when reused.
- A script should either seed, validate, sync, or orchestrate. Avoid mixing all four.

## Guardrails

- Do not hardcode PostgreSQL passwords in scripts.
- Do not hardcode Ollama endpoints such as `localhost:11434` in scripts. Use env-based config.
- On Windows, background launchers must not rely on `shell: true` when a direct executable path will work. That pattern causes transient `cmd.exe` windows and makes runtime behavior noisier than the actual product.
- If a script intentionally spawns a long-lived background process on Windows, set `windowsHide: true` and preserve logs through stdout/stderr capture or files instead of visible console windows.
- Reuse helpers in `scripts/_shared/` for runtime config and shared constants.
- Shared constants such as GDELT CAMEO filters must live in one place. Do not duplicate them across backfill and inject scripts.
- `inject-*` scripts are bridge tools. If they become permanent dependencies, the schema boundary is wrong and needs to be redesigned.
- A data-ingest script is not complete when it prints a row count. It is complete only after the data is proven usable by the downstream loader and replay smoke.
- An AI-analysis script is not complete when it writes rows. It is complete only after those rows are grounded, queryable, and consumable by the intended runtime surface.
- An emerging-tech discovery script is not complete when it finds keywords only. It is complete when topic membership is durable and operator-visible.
- An emerging-tech reporting script is not complete when it writes text only. It is complete when the report is attached to canonical topic membership, includes source-quality context, and is exposed through API or dashboard surfaces.
- An intelligence report script is not complete when it writes `report.html`. It is complete only when the client memo is free of raw pipeline language, the audit appendix preserves provenance, quality caps reflect real data readiness, and any missing evidence becomes a source-query or backfill task.
- A provider backfill script is not complete when an HTTP request succeeds. It is complete only when inserted rows are usable by the deep research pack and can change report quality or blockers.
- A resilience script is not complete when it catches an error. It is complete only when the failure is durable in state, logs, or an alert sink.
- Structured logging for long-lived scripts must use `scripts/_shared/structured-logger.mjs`.
  Do not add a second ad-hoc logger format for daemon or dashboard scripts.
- If a script exports helper functions that are imported by tests, do not resolve env-only secrets or open DB connections at module load time.
  Resolve config lazily inside `main()`, `run*()`, or explicit connection helpers.
- If a script is both importable and executable, guard the CLI entry point so `node --test` imports do not run `main()` implicitly.
- Constraint-application helpers must stay best-effort. If live data violates a new rule, record the failed step and stop treating the constraint as fully landed.
- Proposal execution must use the shared retry and dead-letter files instead of script-specific fallback queues.
- Autonomous actions must consume budget before launch and emit durable audit state on skip, queue, dry-run, and success.
- Read-only dashboard routes must not create schema as a side effect. Observability surfaces should degrade to empty state instead of mutating storage.

## If a script breaks

Check:

1. `.env` / runtime secrets
2. external provider quotas
3. whether the script is duplicating logic that already moved into `src/services/`
4. whether `npm run verify:nas:e2e -- --walk-start 2023-06-01T00:00:00Z --walk-end 2025-12-31T23:59:59Z --folds 1` still passes
## Daemon and observability contract

- Daemon cadence is defined centrally in:
  - [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\_shared\daemon-contract.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/_shared/daemon-contract.mjs)
- Runtime health severity is derived centrally in:
  - [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\_shared\runtime-observability.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/_shared/runtime-observability.mjs)

Do not duplicate daemon intervals or invent a second health scoring model in standalone scripts. Reuse the shared contract so the sidecar, tests, and docs stay aligned.

## CI subsets

Fast branch gates:

- `npm run test:ci:core`
- `npm run test:ci:data-integrity`

Focused coverage:

- `npm run test:ci:coverage`
- writes raw V8 coverage artifacts into `.coverage/`

If a script change affects structured logging, request metrics, or daemon health
reporting, the change is not complete until it passes `test:ci:data-integrity`.

## Report generation contract

Report scripts must preserve the client memo / audit appendix boundary:

- `report.html` and `report.md` are for human-readable analyst narrative.
- `audit_appendix.html`, `audit_appendix.json`, `evidence_table.csv`, `bundle.json`, and `manifest.json` hold provenance and raw ledger detail.
- The client memo must not expose `refs`, claim IDs, metric IDs, query manifests, pack names, or source queue internals.
- Missing evidence must become source-query/backfill tasks rather than nicer prose.
- Direct transcript coverage is a hard investment-readiness gate for company/thematic operating claims.

Focused verification:

```powershell
node --import tsx --test .\tests\report-*.test.mjs .\tests\universal-research-orchestrator.test.mjs .\tests\external-provider-backfill-targets.test.mjs
node .\scripts\generate-intelligence-report.mjs --db --depth deep --type theme_report --subject "AI / Machine Learning"
```

## Emerging-tech discovery contract

Canonical durable tables:

- `discovery_topics`
- `discovery_topic_articles`
- `tech_reports`
- `backfill_state`

Do not build sidecar files or one-off JSON caches as the primary source of truth
for topic membership. Use the database tables above and let API/report scripts
read from them.

For weekly digests:

- the canonical long-lived source remains `discovery_topics` plus `tech_reports`
- `weekly-digest-YYYY-MM-DD.json` is a generated operator artifact, not the source of truth

Emerging-tech runtime verification:

- run `npm run verify:emerging-tech:runtime`
- do not mark the feature complete unless the runtime verification passes or the failure is explicitly recorded and triaged

## Proposal executor contract

`proposal-executor.mjs` now owns durable retry state:

- retry queue:
  - [C:\Users\chohj\Documents\Playground\lattice-current-fix\data\failed-proposals.json](/C:/Users/chohj/Documents/Playground/lattice-current-fix/data/failed-proposals.json)
- dead-letter queue:
  - [C:\Users\chohj\Documents\Playground\lattice-current-fix\data\dead-proposals.json](/C:/Users/chohj/Documents/Playground/lattice-current-fix/data/dead-proposals.json)

Do not add a second retry path in another script unless the queue contract is
being replaced everywhere.

Autonomous backfill execution contract:

- allowed sources are declared only in `scripts/_shared/backfill-whitelist.mjs`
- `backfill-source` actions must pass whitelist validation, min-interval checks, budget checks, and approval checks
- weak-area defaults come from `scripts/_shared/auto-curate-support.mjs`:
  - `corpus-volume`: total articles `< 10000`
  - `source-diversity`: distinct sources `< 4`
  - `theme-classification`: 30-day unknown-theme rate `> 0.20`
  - `topic-discovery`: 30-day discovery topics `< 5`
  - `category:<name>`: category article sum `< 50`
  - `emerging-tech-coverage`: no category coverage
- default action split comes from `src/services/server/codex-dataset-proposer.ts`:
  - prefer `backfill-source` for historical depth and corpus breadth gaps
  - use `add-rss` for missing direct or adjacent feed coverage
  - use `add-theme` only for repeated structurally distinct themes
- default budget ceilings come from `scripts/_shared/automation-budget.mjs`:
  - hourly `backfillCalls=2`
  - daily `backfillCalls=5`, `backfillItems=100000`
  - weekly `backfillCalls=20`, `backfillItems=500000`
- `add-rss` actions must pass trusted-domain and quality checks before registration
- background backfills must write stdout/stderr to `data/backfill-logs/`
- `proposal-executor.mjs --dry-run` must validate the same path without launching child processes

## Dashboard API contract

`event-dashboard-api.mjs` is now expected to expose:

- `/api/health`
- `/api/calibration`
- `/api/data-quality`
- `/api/codex-quality`
- `/api/metrics`
- `/api/automation-budget`
- `/api/automation-log`
- `/api/approval-queue`

If one of those is broken, observability is incomplete even if the server starts.

## Mechanism seed generation Phase A/B/C

`run-mechanism-seed-generation.mjs` is the read-only first slice of the
mechanism-based research seed system. It converts existing Research OS,
adjacent-lane, ontology, and report-artifact signals into structured seed
objects shaped as:

```text
Theme -> Growth Driver -> Real Activity -> Physical Process -> Required Input
-> Bottleneck -> Supplier Category -> Evidence Query -> Counter-Evidence Query
```

Phase A boundaries are strict:

- default mode is dry-run
- no `approval_queue` writes
- no canonical graph, source registry, or provider activation writes
- bias/source-gap audit is included from the first run
- provider gap labels are diagnostic only; adapter generation is a later,
  review-gated phase

Phase B adds DB-backed seed storage and review lifecycle:

- `--apply` writes only `operator_research_seeds` and
  `operator_research_seed_runs`
- repeated `--apply` runs dedupe by stable `seedId`
- reviewed terminal statuses are preserved on generator re-runs
- no evidence queue, report backfill task, universal research subject,
  canonical graph, source registry, or provider activation writes
- evidence enqueue remains a later explicit phase

Phase C adds route-aware evidence planning:

- `--plan-evidence` adds evidence class provider routes, source-query drafts,
  negative-control drafts, market-validation plan, and blocked-route reasons to
  the runtime artifact
- stored `operator_research_seeds.evidence_plan` is route-aware by default
- `--enqueue-evidence` requires `--apply` and writes only seed-scoped
  `approval_queue` rows with `action_type='source-query'`
- `--enqueue-evidence` never creates canonical proposals, `add-rss`,
  `backfill-source`, report backfill tasks, universal research subjects, source
  registry rows, or provider activation state
- `market_validation` source-query drafts are context-only; controlled local
  market data remains the promotion path
- `negative_control` drafts are always non-promotion evidence

Phase C.5 adds seed-scoped evidence execution closure:

- `execute-source-query-approvals.mjs --operator-seed-created-only` approves
  and executes only source-query approvals created by operator mechanism seeds
- `--operator-seed-ids <csv>` narrows execution to specific seed ids
- source-query execution appends class/tier/failure outcomes to
  `operator_research_seeds.evidence_plan.outcomeLedger`
- seed status is updated from execution outcome: collected promotion/context/
  negative-control evidence moves the seed to `review_ready`; empty or failed
  searches return it to `needs_evidence`
- report-created approvals, canonical proposals, `add-rss`, `backfill-source`,
  report backfill tasks, source registry, and provider activation state remain
  out of scope

Phase C.6 adds closure-aware provider escalation:

- `negative_control` outcomes are classified as `invalidator`,
  `supported_constraint`, `checked_no_direct`, or `unchecked`
- negative-control evidence remains non-promotion even when it is useful
- source-query weak/no-hit outcomes now point to direct provider backfill instead
  of repeatedly widening broad search
- `run-mechanism-seed-provider-backfill.mjs` plans and optionally runs only
  seed-scoped official/provider collectors for open evidence classes
- provider results are persisted as operator seed-scoped
  `research_evidence_bundles` and appended to the seed outcome ledger
- provider no-hit/deferred results are also recorded as class outcomes so the
  same failure is visible and does not look like unattempted work
- canonical graph, source registry, report backfill tasks, approval queue, and
  provider activation state remain out of scope

Phase C.7 adds provider/source coverage gap closure:

- `provider_gap_*` labels become explicit review-gated provider gap proposals
  with blocked evidence classes, example queries, and suggested adapter scope
- no adapter is activated automatically; provider gap proposals are audit
  metadata plus seed-scoped source-query drafts only
- `run-mechanism-seed-gap-closure.mjs` creates reviewed `source-query`
  approvals for provider/source gaps after dry-run review
- terminal attempt state is written to
  `data/runtime/operator-seed-gap-closure-state.json` so the same
  seed/class/provider/query failure is not queued repeatedly
- canonical graph, source registry, provider activation, report backfill tasks,
  universal research subjects, and `research_evidence_bundles` remain out of
  scope for this lane

Phase C.8 adds direct-provider terminal closure:

- operator seed provider backfill now reads the seed outcome ledger before
  planning another direct provider run
- class-level no-hit, weak-noise-only, or acceptance-failed provider outcomes
  become `provider_backfill_exhausted` after `--max-provider-attempts`
- retry-window/provider-rate-limit outcomes remain
  `provider_backfill_deferred` and are kept separate from exhausted work
- exhausted direct-provider routes are not rerun automatically; the next action
  becomes provider gap proposal review or missing read-only adapter/source
  coverage
- routes with provider-collected promotion/context evidence are shown as
  `provider_backfill_complete` instead of being confused with missing routes
- this does not relax promotion gates: weak/no-hit provider rows do not become
  promotion evidence

Phase C.9 adds provider gap review visibility:

- `review-provider-gap-proposals.mjs` reads stored operator seeds and builds a
  compact review artifact for seeds whose direct provider backfill is exhausted
- the artifact groups provider gaps, blocked evidence classes, exhausted direct
  routes, proposed read-only adapter/source scopes, and sample reviewed queries
- default output is
  `data/runtime/operator-seed-provider-gap-review.latest.json`
- the command is read-only except for that runtime artifact: it does not create
  approval queue rows, report backfill tasks, evidence bundles, canonical graph
  rows, source registry rows, or provider activation state
- this review step should run before any adapter factory or dashboard seed inbox
  work, because it distinguishes "rerun provider backfill" from "missing source
  coverage or adapter required"

Phase C.10 exposes provider gap review in the dashboard/API:

- `/api/research-seeds/provider-gaps` returns the same read-only provider gap
  review summary for dashboard consumers
- query parameters: `statuses`, `provider`, `limit`, `includeComplete`,
  `maxProviderAttempts`
- the endpoint calls the review builder with `writeArtifact=false`, so it does
  not write approval queue rows, report backfill tasks, evidence bundles,
  canonical graph/source registry rows, or provider activation state
- `src/dashboard/surfaces/research-seeds.mjs` renders a compact provider gap
  review section on the Investigate surface
- raw proposals and sample queries stay behind `Audit details`; the card view
  shows only status, provider gaps, blocked classes, and next action
- `src/dashboard/surfaces/status-vocabulary.mjs` owns the Korean labels for
  these statuses, avoiding mojibake in user-facing chips

Phase C.11 adds a Phase C completeness audit before Phase D:

- `audit-mechanism-seed-phase-c.mjs` reads stored operator seeds and validates
  that each seed has a route-aware evidence plan, class routes, source-query
  drafts, negative-control separation, market-validation source-query
  boundaries, issuer-universe blocking, provider gap review readiness, and
  closed mutation boundaries
- default output is
  `data/runtime/operator-seed-phase-c-audit.latest.json`
- the command is read-only except for that runtime artifact: it does not create
  approval queue rows, report backfill tasks, evidence bundles, canonical graph
  rows, source registry rows, or provider activation state
- use `--fail-on-incomplete` in CI or before Phase D work to make incomplete
  Phase C contracts fail the command

Phase D completes the dashboard seed review lifecycle:

- `/api/research-seeds` returns a dashboard-safe seed candidate list with
  mechanism chain, score, evidence state, Phase C status, provider/negative
  closure status, next action, and mutation guardrails
- `/api/research-seeds/<seedId>` returns the detail payload; raw evidence plan,
  source-query drafts, and provider route internals stay in the audit payload
  rather than the list view
- `/api/research-seeds/<seedId>/review` updates only
  `operator_research_seeds.status` and `review_state`
- `/api/research-seeds/<seedId>/evidence` defaults to review-only evidence
  plan inspection; approval queue writes require `enqueue=true` and
  `confirm='seed-scoped-source-query'`
- `/api/research-seeds/<seedId>/report-candidate` marks a complete
  `review_ready` seed as `report_candidate` without creating universal
  research subjects or report backfill tasks
- `src/dashboard/surfaces/research-seeds.mjs` renders the Seed Candidates
  lifecycle table plus the existing Provider Gap Review section on the
  Investigate surface; the list includes Seed, Mechanism, Bottleneck,
  Supplier, State, Score, Bias, Evidence, Next action, and guarded Actions
- the detail drawer renders a structured mechanism/evidence/bias review view;
  raw route/query internals are only available inside the audit payload
- dashboard actions support review-only evidence plan inspection, guarded
  seed-scoped source-query enqueue, `needs_evidence`, `rejected`, and
  `report_candidate` transitions
- Korean chip labels are owned by
  `src/dashboard/surfaces/status-vocabulary.mjs`
- canonical graph, source registry, provider activation, report backfill task,
  and research evidence bundle writes remain closed in Phase D

Phase E adds seed-to-report closure:

- `run-mechanism-seed-report-closure.mjs` converts reviewed operator
  mechanism seeds into report closure candidates
- default mode is dry-run; it writes only
  `data/runtime/mechanism-seed-report-closure.latest.json`
- `--apply` writes only `universal_research_subjects` and
  `operator_research_seeds` report-closure metadata
- `--generate-report` requires `--apply` and writes local report artifacts
  under `data/reports`
- generated report bundles carry `operatorSeedId`, `mechanismSeed`,
  `seedScores`, `biasAudit`, `providerGaps`, `seedEvidencePlan`, and
  `seedReportClosure` metadata
- report display titles are compacted from the bottleneck label so seed
  scaffolding does not create repeated client memo phrases
- seed quality remains separate from investment readiness: generated reports
  are research subjects until Evidence Contract Closure validates issuer
  exposure, market validation, and negative controls
- `/api/research-seeds/<seedId>/report-closure` previews Phase E closure by
  default; apply requires `confirm='operator-seed-report-closure'`
- Phase E still does not write approval queue rows, report backfill tasks,
  research evidence bundles, canonical graph rows, source registry rows, or
  provider activation state

Bias-aware backfill orchestration adds an advisory loop on top of Phase C-E:

- `run-seed-bias-backfill-orchestrator.mjs` loads the latest autonomous seed
  batch, runs provider/source ablations, diagnoses whether class concentration
  is more consistent with `DATA_LIMITED_BIAS`, `LIKELY_REAL_BOTTLENECK`,
  `INCONCLUSIVE_NEEDS_BACKFILL`, or `KNOWN_NARRATIVE_OVERFIT`, and writes
  runtime artifacts under `data/runtime`
- diversity targets are batch-level generation/backfill priorities, not
  promotion quotas; underrepresented classes are backfilled, not forced into
  `review_ready`
- targeted backfill plans cover `technical_qualification`,
  `permitting_regulatory`, `material_input`, `engineering_process`,
  `test_facility_capacity`, `provider_data_gap`, `negative_control`,
  `issuer_exposure`, and `market_validation`
- raw backfill results stay in the raw result lane. Accepted evidence is stored
  separately and only accepted evidence can affect
  `decisionDiagnostic.coveredEvidenceClasses`
- negative-control survival can block or support continued research, but it
  remains non-promotion evidence
- provider gaps create review-gated adapter proposals with auth, rate-limit,
  fixture, parser-output, health-check, test-command, failure-mode, and
  allowlist metadata. Provider activation remains manual/review-gated
- adjacent-lane seeds are re-normalized to the target theme so incompatible
  evidence classes such as defense `mission_award` on an AI/grid target are
  removed and recorded as contamination warnings
- `/api/research-seeds/bias-diagnostics` and the Research Seeds dashboard show
  only summary metrics, verdict, class distribution, underrepresented classes,
  and recommended tasks. Raw ablation, query, provider, and evidence payloads
  stay inside the audit drawer

Run:

```powershell
node --import tsx scripts/run-mechanism-seed-generation.mjs --dry-run --limit 50
node --import tsx scripts/run-mechanism-seed-generation.mjs --dry-run --source ontology --plan-evidence --limit 50
```

Persist generated seeds after review of dry-run output:

```powershell
node --import tsx scripts/run-mechanism-seed-generation.mjs --apply --source ontology --limit 50
```

Opt-in seed-scoped evidence queueing:

```powershell
node --import tsx scripts/run-mechanism-seed-generation.mjs --apply --source ontology --limit 25 --plan-evidence --enqueue-evidence --source-query-limit 100
```

Approve and execute only operator-seed source-query approvals:

```powershell
node --import tsx scripts/execute-source-query-approvals.mjs --approve-pending --operator-seed-created-only --limit 12 --per-query-limit 5
```

Plan official/provider backfill for seeds that still need evidence:

```powershell
node --import tsx scripts/run-mechanism-seed-provider-backfill.mjs --dry-run --statuses needs_evidence --limit 5
```

Run that provider backfill after reviewing the dry-run target list:

```powershell
node --import tsx scripts/run-mechanism-seed-provider-backfill.mjs --apply --statuses needs_evidence --limit 2 --providers sec,fmp,usaspending,eia,public-planning-source --max-provider-attempts 1
```

Plan provider/source coverage gap closure after provider no-hit results:

```powershell
node --import tsx scripts/run-mechanism-seed-gap-closure.mjs --dry-run --statuses needs_evidence --limit 5
```

Queue reviewed provider-gap source-query approvals only:

```powershell
node --import tsx scripts/run-mechanism-seed-gap-closure.mjs --apply --statuses needs_evidence --limit 5 --query-limit-per-seed 6
```

Then execute only operator seed-created source-query approvals:

```powershell
node --import tsx scripts/execute-source-query-approvals.mjs --approve-pending --operator-seed-created-only --limit 12 --per-query-limit 5
```

Review exhausted direct-provider coverage gaps:

```powershell
node --import tsx scripts/review-provider-gap-proposals.mjs --statuses review_ready --limit 25
node --import tsx scripts/review-provider-gap-proposals.mjs --provider patent_api --limit 25
```

Check the dashboard API version of the same review:

```powershell
Invoke-RestMethod "http://127.0.0.1:46200/api/research-seeds/provider-gaps?statuses=review_ready&limit=8" |
  ConvertTo-Json -Depth 8
```

Check the dashboard API seed lifecycle surface:

```powershell
Invoke-RestMethod "http://127.0.0.1:46200/api/research-seeds?statuses=review_ready&limit=8" |
  ConvertTo-Json -Depth 8
Invoke-RestMethod "http://127.0.0.1:46200/api/research-seeds/<seed-id>" |
  ConvertTo-Json -Depth 8
```

Audit whether stored seeds are ready for the Phase D review surface:

```powershell
node --import tsx scripts/audit-mechanism-seed-phase-c.mjs --statuses review_ready --limit 25
node --import tsx scripts/audit-mechanism-seed-phase-c.mjs --statuses review_ready --limit 25 --fail-on-incomplete
```

Preview Phase E seed-to-report closure:

```powershell
node --import tsx scripts/run-mechanism-seed-report-closure.mjs --dry-run --include-review-ready --limit 10
```

Promote a reviewed seed into a universal research subject:

```powershell
node --import tsx scripts/run-mechanism-seed-report-closure.mjs --apply --seed-id <seed-id>
```

Promote and generate the local report artifact:

```powershell
node --import tsx scripts/run-mechanism-seed-report-closure.mjs --apply --seed-id <seed-id> --generate-report
```

Then connect the generated report to the evidence contract backfill cycle:

```powershell
node --import tsx scripts/run-evidence-contract-backfill-cycle.mjs --report-dir <data/reports/RPT-...> --passes 1 --limit 10
```

Run bias-aware seed diagnosis and targeted backfill planning without a manual
subject:

```powershell
node --import tsx scripts/run-seed-bias-backfill-orchestrator.mjs --dry-run --generate-seeds --source all --limit 25
```

Inspect the dashboard API surface:

```powershell
Invoke-RestMethod "http://127.0.0.1:46200/api/research-seeds/bias-diagnostics?generateSeeds=true&limit=25" |
  ConvertTo-Json -Depth 8
```

Review Phase F provider adapter proposals from repeated provider/source gaps:

```powershell
node --import tsx scripts/propose-provider-adapter.mjs --limit 25
node --import tsx scripts/propose-provider-adapter.mjs --provider patent_api --limit 25
```

Write review-only adapter proposal rows after explicit confirmation:

```powershell
node --import tsx scripts/propose-provider-adapter.mjs --apply --confirm provider-adapter-proposal --limit 25
```

`--apply` writes `codex_proposals` rows with `proposal_type='provider-gap'`
and a non-executable review status. It does not create `approval_queue`
rows, source-query approvals, source registry rows, canonical graph rows,
provider credentials, or provider activation state. Adapter scaffolding still
requires a branch, allowlist files, fixtures, health check command, tests, and
human review.

Run Phase G advisory self-improvement detection:

```powershell
node --import tsx scripts/run-mechanism-seed-self-improvement.mjs --limit 100
```

Run the bounded mechanism seed daemon cycle once:

```powershell
node --import tsx scripts/run-mechanism-seed-daemon-cycle.mjs --limit 25
node --import tsx scripts/run-mechanism-seed-daemon-cycle.mjs --skip-storage --limit 25
```

The daemon cycle performs seed generation, Phase C audit, provider gap review,
provider adapter proposal generation, and self-improvement proposal generation.
It uses a lock file and terminal step state and keeps evidence enqueue off.
`master-daemon.mjs` registers this as `mechanism-seed-generation` on a bounded
6-hour cadence; set `MECHANISM_SEED_DAEMON_SKIP_STORAGE=true` to keep the
recurring cycle artifact-only.

Review stored seeds:

```powershell
node --import tsx scripts/review-mechanism-seed.mjs --list --statuses needs_evidence
node --import tsx scripts/review-mechanism-seed.mjs --seed-id <seed-id> --status review_ready --reason "direct evidence checked"
```

Outputs:

- `data/runtime/mechanism-seed-generation.latest.json`
- `data/runtime/seed-bias-diagnostics.latest.json`
- `data/runtime/seed-bias-backfill-plan.latest.json`
- `data/runtime/seed-bias-backfill-results.latest.json`
- `data/runtime/seed-bias-self-improvement.latest.json`
- `data/runtime/operator-seed-phase-c-audit.latest.json`
- `data/runtime/mechanism-seed-report-closure.latest.json`
- `data/runtime/provider-adapter-proposals.latest.json`
- `data/runtime/mechanism-seed-self-improvement.latest.json`
- `data/runtime/mechanism-seed-generation-daemon-state.json`
- `data/runtime/mechanism-seed-generation.steps.jsonl`
- optional `data/operator-seeds/generated-seeds.jsonl` only when
  `--write-jsonl` is passed

Focused tests:

```powershell
node --import tsx --test tests/mechanism-seed-generator.test.mjs tests/operator-seed-prior.test.mjs tests/seed-source-bias-audit.test.mjs
node --import tsx --test tests/operator-research-seeds.test.mjs
node --import tsx --test tests/seed-evidence-plan.test.mjs
node --import tsx --test tests/seed-evidence-execution.test.mjs
node --import tsx --test tests/operator-seed-closure.test.mjs
node --import tsx --test tests/provider-gap-proposals.test.mjs
node --import tsx --test tests/provider-gap-review.test.mjs
node --import tsx --test tests/operator-seed-phase-c-audit.test.mjs
node --import tsx --test tests/operator-seed-review-surface.test.mjs
node --import tsx --test tests/operator-seed-report-closure.test.mjs
node --import tsx --test tests/provider-adapter-factory.test.mjs
node --import tsx --test tests/seed-bias-diagnostics.test.mjs tests/seed-provider-ablation.test.mjs tests/seed-backfill-elasticity.test.mjs tests/seed-holdout-validation.test.mjs tests/seed-negative-control-survival.test.mjs tests/adjacent-lane-contamination.test.mjs tests/autonomous-seed-report-candidate-gate.test.mjs tests/bias-aware-backfill-orchestrator.test.mjs
node --import tsx --test tests/operator-seed-self-improvement.test.mjs
node --import tsx --test tests/mechanism-seed-daemon-cycle.test.mjs
node --import tsx --test tests/event-dashboard-automation.test.mjs
node --import tsx --test tests/master-daemon-guardrails.test.mjs
```
