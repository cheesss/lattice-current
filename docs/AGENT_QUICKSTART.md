# Agent Quickstart

This file is for agents and new engineers who need the fastest path into the
repo with minimal token usage.

## Read this order

1. [AGENT_ARCHITECTURE_MAP.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\AGENT_ARCHITECTURE_MAP.md)
2. [src/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\README.md)
3. [src/app/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\README.md)
4. [src/services/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\README.md)
5. [docs/DATAFLOW_AND_CACHE_QUICKREF.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\DATAFLOW_AND_CACHE_QUICKREF.md)
6. [docs/TEST_OPERATIONS_RUNBOOK.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\TEST_OPERATIONS_RUNBOOK.md)
7. [docs/TROUBLESHOOTING_INDEX.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\TROUBLESHOOTING_INDEX.md)
8. Then read the nearest directory README for the subsystem you will edit:
   - [server/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\server\README.md)
   - [api/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\api\README.md)
   - [scripts/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\README.md)
   - [tests/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\tests\README.md)
   - [src/config/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\config\README.md)
   - [src/utils/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\utils\README.md)
   - [src/styles/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\styles\README.md)
   - [src/workers/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\workers\README.md)

## If the request is about...

- Replay, walk-forward, backtest hub
  - read [src/services/historical-intelligence.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.md)
  - then read [docs/BACKTEST_SIGNAL_ENGINE_ROADMAP_2026-03-31.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\BACKTEST_SIGNAL_ENGINE_ROADMAP_2026-03-31.md)
- Investment ideas, current brief, ranking
  - read [src/services/investment-intelligence.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment-intelligence.md)
- Local API routes, replay-now, scheduler-now, runtime secrets
  - read [src-tauri/sidecar/local-api-server.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src-tauri\sidecar\local-api-server.md)
- Cache, stale data, Redis behavior
  - read [docs/DATAFLOW_AND_CACHE_QUICKREF.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\DATAFLOW_AND_CACHE_QUICKREF.md)
- Failing tests
  - read [docs/TEST_OPERATIONS_RUNBOOK.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\TEST_OPERATIONS_RUNBOOK.md)

## Standard commands

- Typecheck: `npm run typecheck`
- Full data tests: `npm run test:data`
- Math tests only: `npm run test:math`
- Build: `npm run build`
- Runtime fetch e2e: `npm run test:e2e:runtime`
- NAS replay coverage + smoke walk-forward: `npm run verify:nas:e2e -- --walk-start 2023-06-01T00:00:00Z --walk-end 2025-12-31T23:59:59Z --folds 1`

## Guardrails for Data / NAS work

- Do not report an ingest or backfill change as complete just because counts exist in NAS.
- For historical/backtest work, "done" means all five stages are verified:
  - collect
  - store
  - load
  - frame
  - signal
- If you changed NAS ingestion, replay loaders, or bridge scripts, run:
  - `npm run typecheck`
  - `npm run verify:nas:e2e -- --walk-start 2023-06-01T00:00:00Z --walk-end 2025-12-31T23:59:59Z --folds 1`
- Treat NAS PostgreSQL as the analytical source of truth.
- Treat local DuckDB as a compatibility cache and recovery aid, not the authoritative dataset once NAS sync exists.
- Never add hardcoded PostgreSQL passwords or default Ollama localhost endpoints to scripts or runtime modules.

## High-value code locations

- App orchestration
  - [src/app/data-loader.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\data-loader.ts)
  - [src/app/event-handlers.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\event-handlers.ts)
  - [src/app/panel-layout.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\panel-layout.ts)
- Services
  - [src/services/runtime.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\runtime.ts)
  - [src/services/runtime-config.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\runtime-config.ts)
  - [src/services/persistent-cache.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\persistent-cache.ts)
- Server and edge
  - [server/gateway.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\server\gateway.ts)
  - [server/_shared/redis.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\server\_shared\redis.ts)
  - [api/bootstrap.js](C:\Users\chohj\Documents\Playground\lattice-current-fix\api\bootstrap.js)
