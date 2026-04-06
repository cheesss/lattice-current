# Test Operations Runbook

This file explains which command to run for which problem. It is intended to
reduce token waste during debugging.

## Primary commands

- Type safety
  - `npm run typecheck`
- CI core contract subset
  - `npm run test:ci:core`
- CI data-integrity contract subset
  - `npm run test:ci:data-integrity`
- Focused coverage run for CI
  - `npm run test:ci:coverage`
- Full data and source-inspection test suite
  - `npm run test:data`
- Math models only
  - `npm run test:math`
- Security/config guardrails
  - `npm run security:csp:check`
  - `npm run security:headers:check`
  - `npm run lint:cors`
  - `npm run version:check:all`
- Production build
  - `npm run build`
  - `npm run build:check-console`

## When to run which subset

- Changed `src/services/math-models/*`
  - run `npm run test:math`
- Changed live/replay decision wiring, `buildIdeaCards`, `meta-admission`, or `idea-generation/runtime-context.ts`
  - run `npm run typecheck`
  - run `node --import tsx --test tests/idea-runtime-context.test.mjs`
  - then run `npm run build`
- Changed core signal scoring or candidate generation logic
  - run `npm run test:ci:core`
  - then run `npm run typecheck`
  - then run `npm run build`
- Changed NAS ingestion, `raw_items`, Postgres replay loading, or backtest bridge scripts
  - run `npm run typecheck`
  - run `npm run verify:nas:e2e -- --walk-start 2023-06-01T00:00:00Z --walk-end 2025-12-31T23:59:59Z --folds 1`
- Changed NAS event clustering or article-backed replay inputs
  - run `node --import tsx --test tests/postgres-event-resolver.test.mjs`
  - run `node --import tsx --test tests/event-admission-priors.test.mjs`
  - run `npm run verify:nas:e2e -- --skip-walk-forward`
  - if the full walk-forward check is too slow, record bounded replay smoke metrics:
    - frame count
    - cluster count
    - multi-source cluster %
    - alert cluster %
    - idea run count
- Changed `server/_shared/redis.ts` or cache keys
  - run `npm run test:data`
  - focus on `tests/bootstrap.test.mjs`, `tests/redis-caching.test.mjs`
- Changed `vercel.json`, `vite.config.ts`, CSP, headers
  - run `tests/deploy-config.test.mjs`
  - run `npm run security:csp:check`
  - run `npm run security:headers:check`
- Changed polling/runtime scheduler logic
  - run `tests/flush-stale-refreshes.test.mjs`
  - run `tests/smart-poll-loop.test.mjs`
  - run `tests/windows-spawn-guardrails.test.mjs`
- Changed `scripts/fast-keyword-extractor.mjs`, `scripts/ollama-article-analyzer.mjs`, or article-analysis schema
  - run `node --import tsx --test tests/fast-keyword-extractor.test.mjs`
  - run the bounded data refresh commands:
    - `node --import tsx scripts/fast-keyword-extractor.mjs --limit 1000`
    - `node --import tsx scripts/ollama-article-analyzer.mjs --mode ambiguous --confidence-threshold 0.45 --limit 10`
  - verify persistent row counts in `article_analysis` and `auto_trend_keywords`
- Changed `scripts/auto-pipeline.mjs` or theme-symbol quality scoring
  - run `node --import tsx --test tests/auto-pipeline-dryrun.test.mjs`
  - run `node --import tsx --test tests/auto-pipeline.test.mjs`
  - run `node --import tsx scripts/auto-pipeline.mjs --step 2 --limit 5000`
  - verify both:
    - `auto_theme_symbol_candidates` row count > 0
    - `auto_theme_symbols` accepted row count > 0
- Changed `scripts/event-engine-full-build.mjs`
  - run `node --import tsx --test tests/event-engine-schema.test.mjs`
  - run `node --import tsx scripts/event-engine-full-build.mjs`
  - verify `regime_conditional_impact.anomaly_rate` exists and updates
- Changed `scripts/master-daemon.mjs`
  - run `node --import tsx --test tests/master-daemon-guardrails.test.mjs`
  - run `node --import tsx scripts/master-daemon.mjs --once --task pending-check`
  - run `node --import tsx scripts/master-daemon.mjs --once --task dashboard-health`
  - run `node --import tsx scripts/master-daemon.mjs --once --task db-health`
  - run `node --import tsx scripts/master-daemon.mjs --once --task daily-backup`
  - run `node --import tsx scripts/master-daemon.mjs --once --task duckdb-sync`
  - run `node --import tsx scripts/master-daemon.mjs --once --task data-quality`
  - inspect `data/daemon-state.json`
- Changed `scripts/_shared/structured-logger.mjs`, `scripts/event-dashboard-api.mjs`, pipeline metrics exposure, or Codex/data-quality endpoints
  - run `npm run test:ci:data-integrity`
  - confirm both:
    - `GET /api/health` returns `compositeScore` and `status`
    - `GET /api/calibration` returns `ece`, `brierScore`, and `buckets`
  - confirm both:
    - `GET /api/data-quality` returns `overall` plus freshness/completeness fields
    - `GET /api/codex-quality` returns call counts, parse stats, and warnings
  - call `GET /api/metrics` and confirm request counters increment
  - confirm daemon stderr emits JSONL instead of free-form text
- Changed `src-tauri/sidecar/local-api-server.mjs` or runtime secret loading
  - run `node --import tsx --test tests/runtime-secrets-mirror-cache.test.mjs`
  - run `node --import tsx --test tests/local-runtime-observability-route.test.mjs`
  - confirm `runtime secrets mirror synced` appears once at startup or after actual mirror-file changes, not on every request
- Changed live news channels or YouTube embed logic
  - run `tests/live-news-hls.test.mjs`
- Changed replay/backtest logic
  - run `npm run test:data`
  - if needed, inspect [src/services/historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)

## Failure grouping

- Source-inspection failures
  - test checks string patterns in source files
  - changing implementation style can fail tests without changing behavior
- Behavioral cache failures
  - usually involve `server/_shared/redis.ts`
  - watch for extra writes caused by metadata, coalescing, or negative caching
- Runtime build failures
  - often `typecheck` issues or env/runtime imports that Node test mode cannot resolve

## Good debugging order

1. Run the narrowest relevant test file first
2. Fix source-inspection mismatches if they describe the intended contract
3. Then run `npm run test:data`
4. Then run `npm run build`

## Completion Criteria for Historical Data Changes

Do not mark a NAS or backtest data change complete unless all of these are true:

1. The source data exists in NAS.
2. The Postgres loader can read the affected period.
3. The loader produces frames for the affected period.
4. A replay or walk-forward smoke run generates nonzero ideas and forward returns.
5. Coverage output shows the intended years contain both news frames and market frames.

If any one of those five checks is missing, the change is still partial.

## Completion Criteria for Signal-Workspace Changes

Do not mark a signal-side runtime change complete unless all of these are true:

1. the runtime surface actually renders
2. source data reaches its canonical table
3. at least one operator-visible panel or endpoint consumes that data
4. background jobs report durable health or failure state
5. the relevant doc or runbook reflects the new contract

## Event-layer guardrail

Do not treat article archives as if they were already corroborated events.

## Sidecar guardrail

Do not perform per-request file reads or per-request logging for runtime secret mirror state.
The sidecar must cache secret mirror state and only resync when the mirror file actually changes.

- `guardian`, `nyt`, `rss-feed`, and `gdelt-doc` are article-style sources.
- They must pass through canonical event resolution before candidate generation.
- Grouping by source name or naive title fingerprint is not sufficient and can collapse idea generation even when NAS coverage looks correct.
- Do not judge a clustering/admission change by accepted-rate alone. Record accepted/watch/rejected forward returns and portfolio metrics, because evidence priors can raise acceptance while still degrading precision.

## Runtime-context guardrail

Do not let live and replay build idea cards through different input contracts.

- `buildIdeaCards()` and admission scoring must receive `IdeaGenerationRuntimeContext`.
- New signal inputs must be added in `idea-generation/runtime-context.ts` and then consumed from that shared contract.
- If replay receives a field that live does not, treat that as an integration defect until the shared runtime-context builder is updated or the field is explicitly deprecated.

## Windows background-process guardrail

Do not accept a Windows runtime/process change as complete unless both are true:

1. background helper processes start without transient `cmd.exe` / PowerShell windows
2. the same path still surfaces failures through logs, HTTP responses, or test output

For launchers and sidecar job runners:

- prefer direct executable invocation over `shell: true`
- set `windowsHide: true` for background jobs
- verify with `tests/windows-spawn-guardrails.test.mjs`

## Script import guardrail

Do not let reusable script helpers require secrets or start database work at import time.

- if a script exports pure helpers used by tests, resolve env-backed config lazily inside runtime functions such as `main()` or connection factories
- if a script is also a CLI entry point, it must not execute `main()` when imported under `node --test`
- verify with the smallest import-only contract test before running the full script

## Signal-first regression contract

Run these before calling a signal-runtime or automation change complete:

```bash
npm run typecheck
npm run build
npm run test:ci:signal-runtime
npm run test:ci:ops-observability
```

Do not substitute row counts or a one-off smoke command for this contract.

## Resilience and quality contract

Run these before calling resilience or automation hardening complete:

```bash
npm run typecheck
npm run build
npm run test:ci:core
npm run test:ci:data-integrity
```

Then run at least these task and endpoint checks:

```bash
node --import tsx scripts/master-daemon.mjs --once --task db-health
node --import tsx scripts/master-daemon.mjs --once --task daily-backup
node --import tsx scripts/master-daemon.mjs --once --task data-quality
curl http://127.0.0.1:46200/api/data-quality
curl http://127.0.0.1:46200/api/codex-quality
```

Do not mark the work complete until:

1. daemon state records the new task outputs durably
2. alerts are written to `data/alerts.json` on forced failure paths
3. proposal retries are written to `data/failed-proposals.json`
4. dead-letter proposals are written to `data/dead-proposals.json`
5. constraint application results are reviewed instead of assumed

## CI contract

These subsets are the canonical fast gates for this branch:

1. `npm run typecheck`
2. `npm run build`
3. `npm run test:ci:core`
4. `npm run test:ci:data-integrity`

Coverage is advisory, not a release gate yet:

- `npm run test:ci:coverage`
- raw V8 coverage artifacts are written to `.coverage/`

If a new test belongs to the signal-first core or observability contract, add it
to one of the two CI subsets. Do not leave it stranded in `test:data` only.

## Runtime observability

Canonical local endpoint:

- `/api/local-runtime-observability`

What it must cover together:

- daemon task cadence and failures from `data/daemon-state.json`
- dashboard health
- local service status
- route coverage degradation
- operator-facing blocker reasons

Do not add a second ad-hoc health summary with different thresholds. Extend the canonical observability payload instead.

## Proposal execution guardrail

`scripts/proposal-executor.mjs` is now a durable queue processor, not a one-off helper.

- failed items must flow through `data/failed-proposals.json`
- permanently failed items must flow through `data/dead-proposals.json`
- do not add alternate ad-hoc retry files in other scripts
- do not mark executor behavior complete unless retry, dead-letter, and DB status
  transitions have all been observed

## Schema hardening guardrail

Constraint application is best-effort by design.

- if a constraint step fails, record and inspect the failure
- do not work around a failed constraint by silently deleting or mutating data
- do not call the schema hardening complete until the failed steps are reviewed
  against the live data shape

When testing the sidecar health surface in isolation, disable background automation children. Otherwise the test process can start scheduler/accumulator timers and leave open handles.

- use `backgroundAutomationEnabled: false` in `createLocalApiServer(...)` tests
- or set `LOCAL_API_BACKGROUND_AUTOMATION=false` for isolated route smoke runs

## Persistent-cache maintenance guardrail

`src/services/persistent-cache.ts` must not start background maintenance at import
time.

- cache vacuum/tidy loops are application lifecycle work, not module side effects
- start them explicitly from startup entry points such as `src/main.ts`
- verify with `tests/persistent-cache-maintenance.test.mjs`
