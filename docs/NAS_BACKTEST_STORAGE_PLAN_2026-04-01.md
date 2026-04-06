# NAS Backtest Storage Plan

## Goal

Make NAS the system of record for backtest datasets and replay outputs, while keeping local DuckDB as an execution cache.

## Guardrails

- "Stored in NAS" is not the same as "usable in backtest".
- A historical source is only complete after these stages are verified end to end:
  - collect
  - store
  - load
  - frame
  - signal
- All NAS-backed historical changes must pass:
  - `npm run typecheck`
  - `npm run verify:nas:e2e -- --walk-start 2023-06-01T00:00:00Z --walk-end 2025-12-31T23:59:59Z --folds 1`
- If `raw_items.transaction_time` or `knowledge_boundary` can be null, loaders must coalesce from `valid_time_start`. Filtering on nullable transaction columns will silently erase historical news coverage.
- Bridge scripts such as `inject-articles-to-raw-items` and `inject-gdelt-agg-to-raw-items` are transitional. They are not the desired long-term architecture.
- Historical article sources are not directly equivalent to event-style sources.
- `guardian`, `nyt`, `rss-feed`, and `gdelt-doc` must be resolved into canonical event clusters before they can be judged by the investment candidate pipeline.
- Do not treat source-level grouping or naive title fingerprints as a valid long-term clustering layer.

## Storage Roles

### NAS PostgreSQL

Authoritative structured store for:

- `worldmonitor_intel.historical_datasets`
- `worldmonitor_intel.historical_raw_items`
- `worldmonitor_intel.historical_replay_frames`
- `worldmonitor_intel.backtest_runs`
- `worldmonitor_intel.idea_runs`
- `worldmonitor_intel.forward_returns`

Current news archive continues to live in `public.articles`.

### NAS Snapshot Root

Authoritative recovery mirror for:

- local DuckDB files
- replay checkpoint JSON
- replay summary JSON
- scheduler state JSON
- persistent replay cache

Snapshots are not the analytical source of truth. They are disaster-recovery and point-in-time recovery artifacts.

### Local Storage

Execution cache only:

- active DuckDB files
- WAL files
- transient imported artifacts
- persistent-cache state used by the desktop runtime

Do not promote local DuckDB to source-of-truth status once NAS warm storage exists. DuckDB is a compatibility layer and recovery cache.

## Implemented Workflow

### Ingestion Pipeline

Script:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\backtest-nas-pipeline.mjs](C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/backtest-nas-pipeline.mjs)

Responsibilities:

- initialize `worldmonitor_intel` on NAS
- ingest 5-year Yahoo theme symbols
- ingest 5-year core FRED series
- run incremental GDELT backfill windows
- reuse Guardian/NYT NAS archive ingest
- sync recent replay runs from persistent cache into NAS

Key commands:

- `npm run backtest:nas:status`
- `npm run backtest:nas:init`
- `npm run backtest:nas:full`
- `npm run backtest:nas:sync-datasets`
- `npm run backtest:nas:sync-runs`

### Automatic NAS Warm Sync

Sidecar:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\src-tauri\sidecar\local-api-server.mjs](C:/Users/chohj/Documents/Playground/lattice-current-fix/src-tauri/sidecar/local-api-server.mjs)

Behavior:

- when `LOCAL_INTELLIGENCE_AUTO_PG_SYNC=true`, local import/replay/walk-forward requests automatically upsert to NAS Postgres
- explicit request payload can still override with `postgresSync: false`

This closes the gap between manual UI runs and NAS persistence.

### Snapshot Push

Script:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\push-backtest-snapshots-to-nas.mjs](C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/push-backtest-snapshots-to-nas.mjs)

Responsibilities:

- incrementally copy local replay snapshots and DuckDB files to NAS
- write local sync state
- write NAS manifest

Key commands:

- `npm run backtest:nas:snapshot:push -- --root=\\\\NAS\\lattice-current`
- `npm run backtest:nas:snapshot:watch -- --root=\\\\NAS\\lattice-current --interval-minutes=30`

## 5-Year Source Coverage

### Guardian / NYT

Direct-to-NAS archive path already exists:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\fetch-news-archive.mjs](C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/fetch-news-archive.mjs)

### Yahoo

Pulled per theme symbol for 5 years, imported locally, then synced into NAS warm tables.

### FRED

Pulled for core macro series for 5 years, imported locally, then synced into NAS warm tables.

### GDELT

Handled as incremental backfill rather than one monolithic job.

Reason:

- 5-year GDELT via DOC API is too large and too rate-limited for one pass.
- the implemented pipeline tracks progress with a local state cursor and processes bounded windows per run.

Current policy:

- 10-day windows
- bounded windows per execution
- repeated runs advance cursor until the full period is covered

## Difference Resolution Policy

### Problem Classes

1. Local DuckDB newer than NAS PostgreSQL
2. NAS PostgreSQL newer than NAS snapshot mirror
3. Snapshot contains local state that is not yet promoted to warm tables
4. Source artifacts and replay outputs disagree on row counts due to partial imports

### Source of Truth Rules

1. Structured analytics truth is NAS PostgreSQL.
2. Recovery truth is NAS snapshot mirror.
3. Local storage is never authoritative once NAS sync succeeds.
4. Coverage and signal-generation truth is the NAS E2E verifier, not row-count reports.
5. Event readiness truth is cluster quality plus replay idea generation, not archive row counts.

### Reconciliation Keys

For datasets:

- `dataset_id`
- `provider`
- `source_version`
- `raw_record_count`
- `frame_count`
- `imported_at`

For runs:

- `backtest_run_id`
- `completed_at`
- `frame_count`
- `idea_run_count`
- `forward_return_count`

For snapshots:

- relative path
- file size
- modified time
- derived SHA-1 digest of metadata

### Resolution Actions

If local dataset is newer than NAS:

- rerun `postgres-sync-dataset-bulk`

If replay cache is newer than NAS runs:

- rerun `postgres-upsert-run`

If NAS snapshot mirror is behind local:

- rerun snapshot push

If snapshot and warm store disagree:

- prefer NAS PostgreSQL for analytics
- preserve snapshot as recovery artifact
- record mismatch in the pipeline state file and resync the structured dataset

## Environment

Required for NAS Postgres:

- `INTEL_PG_URL`

or:

- `INTEL_PG_HOST`
- `INTEL_PG_PORT`
- `INTEL_PG_USER`
- `INTEL_PG_PASSWORD`
- `INTEL_PG_DATABASE`
- `INTEL_PG_SCHEMA`

Optional:

- `LOCAL_INTELLIGENCE_AUTO_PG_SYNC=true`
- `WM_NAS_SNAPSHOT_ROOT=\\\\NAS\\lattice-current`

## Recommended Rollout

1. Initialize schema on NAS.
2. Enable `LOCAL_INTELLIGENCE_AUTO_PG_SYNC=true`.
3. Run `backtest:nas:sync-datasets` once for existing DuckDB datasets.
4. Run `backtest:nas:sync-runs` once for existing replay cache.
5. Run `backtest:nas:full` on a schedule for source ingestion.
6. Run `backtest:nas:snapshot:watch` on a schedule for recovery mirror.
7. After any ingest or loader change, run `verify:nas:e2e` before reporting completion.
