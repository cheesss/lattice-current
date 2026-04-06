# `src/services/importer` Guide

This directory turns raw historical artifacts into replay-ready frames.

## Primary responsibilities

- parse provider-specific raw payloads
- normalize valid time, transaction time, and knowledge boundary
- write or load historical raw items
- build replay frames from raw items
- preserve warm-up versus evaluation boundaries

## Why this directory is high risk

Small mistakes here invalidate the whole backtest chain.

The failure pattern is usually:

1. data exists
2. loader drops it
3. frames look sparse
4. signals disappear
5. the issue is misdiagnosed as a weak model

## Guardrails

- Never treat "data stored successfully" as completion.
- Completion requires all five stages to work:
  - collect
  - store
  - load
  - frame
  - signal
- If a source can have `transaction_time` or `knowledge_boundary` as null, loader filters must coalesce from `valid_time_start`.
- If you change NAS or DuckDB frame loading, run:
  - `npm run typecheck`
  - `npm run verify:nas:e2e -- --walk-start 2023-06-01T00:00:00Z --walk-end 2025-12-31T23:59:59Z --folds 1`
- Do not silently change bucket size, warm-up policy, or timestamp semantics without recording that change in docs and validation output.

## Current architectural rule

- NAS PostgreSQL is the structured source of truth for historical backtesting.
- DuckDB is a compatibility cache and recovery aid.
- Bridge scripts that copy NAS data into DuckDB are transitional and should not become the long-term ingestion design.
- Article archives are not event-ready inputs by themselves.
- `guardian`, `nyt`, `rss-feed`, `gdelt-doc`, `acled`, and `gdelt-agg` must be resolved into canonical event clusters before candidate generation.
- Do not group NAS news by source name or naive title fingerprint and call that "event clustering". That recreates the exact failure mode where coverage looks good but ideas disappear.
- `clusterConfidence` measures event validity and corroboration quality. It is not a replacement for transmission-derived market stress and must stay separate from `transmissionStress`.

## Typical failure modes

- filtering on nullable `transaction_time`
- using `knowledge_boundary` as if it is always present
- counting rows in NAS and assuming replay can see them
- changing source/provider mappings without rebuilding coverage verification
- treating article rows as if they already encode corroborated events
- using per-source or first-N-word grouping instead of cross-source event resolution
- validating only row counts, instead of checking whether multi-source clusters and replay ideas were created

## Event-layer verification

After changing NAS clustering or article ingestion, confirm all of the following:

- yearly coverage is present
- multi-source cluster ratio is non-trivial
- alert-capable clusters exist
- replay produces ideas on the same path

Minimum checks:

- `npm run typecheck`
- `node --import tsx --test tests/postgres-event-resolver.test.mjs`
- `npm run verify:nas:e2e -- --skip-walk-forward`

## When editing here

Read first:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\NAS_BACKTEST_STORAGE_PLAN_2026-04-01.md](C:/Users/chohj/Documents/Playground/lattice-current-fix/docs/NAS_BACKTEST_STORAGE_PLAN_2026-04-01.md)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\TEST_OPERATIONS_RUNBOOK.md](C:/Users/chohj/Documents/Playground/lattice-current-fix/docs/TEST_OPERATIONS_RUNBOOK.md)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\README.md](C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/README.md)
