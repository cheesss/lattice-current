# Infrastructure Server Domain

This domain covers outages, service status, cables, and temporal anomaly surfaces.

## Main responsibilities

- service status summaries
- internet outages
- cable health
- temporal baseline and anomaly endpoints

## Important files

- `v1/list-service-statuses.ts`
- `v1/list-internet-outages.ts`
- `v1/get-cable-health.ts`
- `v1/get-temporal-baseline.ts`
- `v1/list-temporal-anomalies.ts`
- `v1/record-baseline-snapshot.ts`

## Design note

This folder mixes live status and baseline-driven anomaly detection. Be careful not to collapse those into one freshness model.
