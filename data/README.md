# Runtime Data Area

This folder holds mutable local runtime artifacts. It is not source code.

## Main subfolders

- `automation/`
  - scheduler state and run metadata
- `historical/`
  - imported/fetched historical artifacts used by replay and analysis
- `persistent-cache/`
  - local cache state

## Important rule

Do not treat files here as authoritative source code. They are runtime outputs, operator artifacts, or cache/state snapshots.

For historical backtesting:

- NAS PostgreSQL is the structured source of truth once sync exists.
- local DuckDB files in this folder are execution caches and recovery artifacts
- snapshot files here do not prove replay can actually load or use the underlying data

## Common use cases

- inspect the last scheduler run
- inspect fetched historical artifacts
- debug replay/archive state

## Common mistake

Developers often read this folder, assume a behavior is coded, and patch around stale runtime state. Always confirm the corresponding logic in `src/services/` or `scripts/` first.

Another common mistake is to assume "the data is here, so backtests can use it". That is false until loader and E2E replay checks pass.
