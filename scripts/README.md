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
  - `--all-reports --dashboard-summary` builds the report closure ledger used by the dashboard `Report Backfill` panel
  - cross-theme regenerated reports include an evidence-state diagnostic that separates insufficient validation from a negative-control rejection; keep collecting only for `More evidence needed`, `Targeted backfill needed`, or `Market validation pending`, and stop broad automation for `Search exhausted, not validated` or `Negative-control reject`
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
