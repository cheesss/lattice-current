# Resilience & Quality Upgrade

Date: 2026-04-06  
Product identity: signal-first decision-support workspace

This document no longer describes a proposed plan only. It records what was
implemented, how it was validated, and what still remains open.

## Scope

This upgrade focused on four weak areas that were repeatedly causing partial,
hard-to-verify progress:

1. operational resilience around NAS PostgreSQL and daemon recovery
2. data-quality visibility and schema hardening
3. Codex and LLM quality controls
4. durable failure handling for proposal execution

## Implemented

### Phase 1: resilience

Implemented modules:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\_shared\pg-backup.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/_shared/pg-backup.mjs)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\_shared\alert-notifier.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/_shared/alert-notifier.mjs)

Implemented runtime upgrades:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\master-daemon.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/master-daemon.mjs)
  - added `db-health`
  - added `daily-backup`
  - added `duckdb-sync`
  - added `data-quality`
  - added exponential circuit-breaker backoff
  - added alert emission for breaker trips, DB failures, and degraded quality
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\article-ingestor.ts](/C:/Users/chohj/Documents/Playground/lattice-current-fix/src/services/article-ingestor.ts)
  - database pool circuit breaker
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\signal-history-updater.ts](/C:/Users/chohj/Documents/Playground/lattice-current-fix/src/services/signal-history-updater.ts)
  - database pool circuit breaker

### Phase 2: data quality

Implemented modules:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\_shared\schema-constraints.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/_shared/schema-constraints.mjs)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\_shared\data-quality-check.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/_shared/data-quality-check.mjs)

Implemented runtime/API upgrades:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\event-dashboard-api.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/event-dashboard-api.mjs)
  - added `/api/data-quality`
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\master-daemon.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/master-daemon.mjs)
  - now records `state.health.dataQuality`

Constraint behavior is intentionally best-effort. Existing data violations are
reported as failed steps instead of being silently mutated or deleted.

### Phase 3: Codex and LLM quality

Implemented runtime upgrades:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\intelligence-automation.ts](/C:/Users/chohj/Documents/Playground/lattice-current-fix/src/services/server/intelligence-automation.ts)
  - added `maxCodexCallsPerCycle`
  - enforced per-cycle Codex call budgeting
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\codex-theme-proposer.ts](/C:/Users/chohj/Documents/Playground/lattice-current-fix/src/services/server/codex-theme-proposer.ts)
  - added persistent Codex quality metrics
  - added validation warnings on normalized proposals
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\event-dashboard-api.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/event-dashboard-api.mjs)
  - added `/api/codex-quality`

Metrics are persisted to:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\data\codex-quality.json](/C:/Users/chohj/Documents/Playground/lattice-current-fix/data/codex-quality.json)

### Phase 4: durable execution

Implemented runtime upgrade:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\proposal-executor.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/proposal-executor.mjs)
  - retry queue
  - dead-letter queue
  - retry merge on next run
  - DB status updates for `failed` and `dead`

Queue files:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\data\failed-proposals.json](/C:/Users/chohj/Documents/Playground/lattice-current-fix/data/failed-proposals.json)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\data\dead-proposals.json](/C:/Users/chohj/Documents/Playground/lattice-current-fix/data/dead-proposals.json)

## Validation executed

The following were run successfully after implementation:

```bash
npm run typecheck
npm run build
npm run test:ci:core
npm run test:ci:data-integrity
npm run test:ci:coverage
node --import tsx --test tests/data-quality-check.test.mjs tests/schema-constraints.test.mjs tests/alert-notifier.test.mjs tests/proposal-executor-guardrails.test.mjs tests/master-daemon-guardrails.test.mjs tests/event-dashboard-health-calibration.test.mjs
```

Coverage from the focused CI subset after this upgrade:

- lines: `48.51%`
- branches: `56.46%`
- functions: `35.15%`

## Operational checks

Use these commands when validating the upgrade on a live environment:

```bash
node --import tsx scripts/master-daemon.mjs --once --task db-health
node --import tsx scripts/master-daemon.mjs --once --task daily-backup
node --import tsx scripts/master-daemon.mjs --once --task duckdb-sync
node --import tsx scripts/master-daemon.mjs --once --task data-quality
```

Dashboard API checks:

```bash
curl http://127.0.0.1:46200/api/health
curl http://127.0.0.1:46200/api/calibration
curl http://127.0.0.1:46200/api/data-quality
curl http://127.0.0.1:46200/api/codex-quality
```

## Guardrails

- Do not call this upgrade complete because row counts exist.
- Do not call schema hardening complete until failed constraint steps are reviewed.
- Do not treat local file alerts as optional noise. They are the fallback durability
  layer when no webhook is configured.
- Do not bypass retry and dead-letter queues by writing direct one-off executor
  loops elsewhere.
- Do not add a second Codex quality summary endpoint. Extend
  `/api/codex-quality`.
- Do not add a second data-quality summary with different thresholds. Extend
  `/api/data-quality`.

## Remaining gaps

This upgrade closed the core implementation gap, but these are still open:

1. webhook-backed alerting needs real deployment configuration
2. daemon burn-in under PM2 or equivalent long-running process manager is still
   required
3. schema constraints should be exercised against production-like data snapshots
   before tightening further
4. broader coverage and longer operational tests are still needed to move from
   guarded correctness to high confidence

## Related docs

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\TEST_OPERATIONS_RUNBOOK.md](/C:/Users/chohj/Documents/Playground/lattice-current-fix/docs/TEST_OPERATIONS_RUNBOOK.md)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\MATURITY_UPGRADE_PLAN_2026-04-06.md](/C:/Users/chohj/Documents/Playground/lattice-current-fix/docs/MATURITY_UPGRADE_PLAN_2026-04-06.md)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\README.md](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/README.md)
