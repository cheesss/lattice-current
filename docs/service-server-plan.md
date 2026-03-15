# Service Server Plan

## Goal
Open World Monitor as a service without losing point-in-time integrity, operational safety, or evidence traceability.

## Deployment phases

### Phase 1: private single-node service
- one API process
- one worker process for importer/replay/backtest jobs
- one Postgres instance
- local DuckDB retained for cold replay archive and offline validation
- restricted to trusted operators

### Phase 2: split workers and shared storage
- API and long-running workers separated
- Postgres / Timescale becomes canonical shared persistence
- object storage added for raw HTML, JSON, STIX bundles, and report snapshots
- job queue introduced for importer, replay, and walk-forward runs

### Phase 3: production-grade multi-worker service
- dedicated worker pools for ingest, normalization, analytics, and replay
- bounded job concurrency and quotas
- alerting, backups, and restore drills
- operator RBAC and audit logging

## Storage plan

### Canonical shared storage
Use Postgres or Timescale for:
- normalized_events
- entity_nodes
- graph_edges
- source_scores
- mapping_stats
- idea_runs
- forward_returns
- backtest_runs
- replay_frame_metadata

### Cold archive
Use DuckDB for:
- local historical replay datasets
- offline walk-forward runs
- large immutable frame batches
- operator-side research exports

### Raw object storage
Use object storage for:
- raw feed payloads
- raw HTML snapshots
- STIX exports
- generated reports
- sanitized public media assets

## Point-in-time integrity rules
- every imported record must carry valid time and transaction time
- replay uses transaction time ceiling and knowledge boundary ceiling
- no revised prices, ontology merges, or later corrections may leak into older replay windows
- warm-up windows must be excluded from evaluation metrics

## Security plan

### Secrets and credentials
- keep provider keys, DB URLs, and service tokens in environment variables or a secret manager
- never expose credentials to browser code or public docs
- rotate keys and document ownership for each credential

### API protection
- require authentication on importer, replay, walk-forward, and archive endpoints
- apply rate limits and per-user job quotas
- separate admin-only operations from analyst read-only operations

### Network boundary
- run API behind TLS
- restrict CORS to approved origins
- egress allow-list external feeds where possible
- keep sidecar-only endpoints unavailable on public web builds

### Data protection
- sanitize screenshots and docs before publication
- avoid storing more news body text than necessary for legal reasons
- define retention for raw payloads, replay frames, and generated reports

## Operational readiness
- metrics: queue depth, job duration, memory, CPU, DB size, source health, replay failure rate
- alerts: importer stalls, replay failures, storage pressure, backup failures, source outage spikes
- backups: daily Postgres backup, periodic DuckDB archive snapshot, object storage lifecycle policy
- restore drills: test DB restore and replay rehydration before opening the service
- migrations: use explicit schema migration steps before deploy

## Recommended first production shape
- API service: auth, queries, dashboards, operator actions
- worker service: import, replay, walk-forward, archive sync
- Postgres: shared persistence and run history
- DuckDB: cold local research archive
- object store: raw payloads and report artifacts

## Open before launch checklist
- [ ] Postgres schema migrations are versioned
- [ ] backup and restore procedure is tested
- [ ] importer and replay endpoints require auth
- [ ] CORS and TLS are configured
- [ ] resource telemetry and alerts are live
- [ ] PiT validation is tested on replay samples
- [ ] retention policy is documented
- [ ] public docs and screenshots are sanitized
- [ ] operator roles and quotas are defined

## Current gaps to close
- full Postgres-backed service path for shared production use
- authenticated replay/backtest API for multi-user service access
- production job queue with retry and dead-letter handling
- backup automation and restore verification
- formal operator RBAC and audit log review flow
