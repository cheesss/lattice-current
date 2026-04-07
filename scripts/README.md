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
