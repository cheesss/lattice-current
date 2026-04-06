# Bootstrap / Import / Storage Upgrades

Date: 2026-03-24

Target workspace: `lattice-current-fix`

## Applied changes

### Bootstrap

Files:

- `src/services/bootstrap.ts`
- `src/App.ts`
- `scripts/seed-bootstrap.mjs`
- `public/data/bootstrap-fallback.json`

Changes:

- Added per-key hydration state tracking: `hydrated`, `missing`, `fallback`, `unknown`.
- Added missing key name tracking to bootstrap status.
- Added partial fallback fill for keys still missing after tier fetches, instead of only using fallback when bootstrap is fully empty.
- Added fallback snapshot metadata exposure via `fallbackGeneratedAt`.
- Updated app warmup message to list missing bootstrap keys and fallback snapshot timestamp.
- Updated `seed-bootstrap.mjs` so a successful seed run refreshes `public/data/bootstrap-fallback.json` from live Redis values.

Effect:

- Operators can see which bootstrap keys are still missing.
- Fallback is no longer static-only; it can be refreshed from the latest seed output.

### Storage envelope

Files:

- `src/services/storage/storage-envelope.ts`
- `tests/storage-envelope.test.mjs`

Changes:

- Added provenance field `origin` with values `seed`, `live`, or `unknown`.
- Added checksum verification during decode.
- Added expiry enforcement during decode.
- Removed silent migration fallback; migration failures now return `data: null` with an error.
- Added tests for checksum mismatch and expiry rejection.

Effect:

- Corrupted payloads are rejected instead of flowing through silently.
- Expired envelopes are treated as invalid.
- Seed vs live provenance is now explicit in the envelope.

### Historical importer / bitemporal validation

Files:

- `src/services/importer/historical-stream-worker.ts`

Changes:

- Reduced DuckDB lock TTL from 180 minutes to 45 minutes.
- Added temporal validation for imported raw records:
  - invalid timestamps are rejected
  - future valid time is rejected
  - `validTimeStart > transactionTime` is rejected
  - `knowledgeBoundary < transactionTime` is rejected
- Added `raw-complete` checkpoint file support:
  - if raw ingestion finished but later frame materialization failed, rerun can reuse the imported raw corpus
- Added merge conflict counting for market records inside a frame.
- Added `mergedSourcesJson` to frame metadata.
- Added `timeSkewWarningCount` to frame metadata for same-headline timestamps that diverge materially across sources.
- Improved market conflict resolution:
  - prefer higher `knowledgeBoundary`
  - then higher `transactionTime`
  - then newer `validTimeStart`
- Added invalid record counters to dataset summary metadata.

Effect:

- Invalid temporal data is filtered earlier.
- Frame metadata now carries useful diagnostics for merge and skew issues.
- Re-import after a frame-building failure no longer has to redo raw ingestion if the raw stage already completed.

## Validation

Commands run:

```powershell
npm.cmd run typecheck
node --import tsx --test tests/storage-envelope.test.mjs tests/bootstrap.test.mjs
```

Result:

- Passed.

## Remaining gaps

Still not fully implemented:

- Full mid-stream resume for partially ingested NDJSON/JSON arrays
- Automatic deploy-hook execution of bootstrap seeding on hosting platforms
- Price gap interpolation for sparse markets
- Weighted merge selection using source credibility in frame materialization
