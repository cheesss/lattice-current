# Archive and Data Lifecycle

This folder contains the retention pipeline that moves data across storage tiers.

## Lifecycle model

- Hot
  - Redis and short-lived cache surfaces
- Warm
  - PostgreSQL retained operational history
- Cold
  - S3/R2 plus Parquet archive targets

## Main files

- `lifecycle-config.ts`
  - category-specific retention rules
- `hot-warm-migrator.ts`
  - logic for moving expiring hot records into warm storage
- `warm-cold-archiver.ts`
  - logic for exporting warm records to cold storage
- `parquet-codec.ts`
  - archive serialization format
- `s3-client.ts`
  - optional object storage wrapper
- `cron-archival.ts`
  - orchestration entry point

## Design philosophy

- Request-time code should not depend on cold archive success.
- Archive code must degrade gracefully when S3/R2 or Parquet support is unavailable.
- Lifecycle policy should be centralized in config, not duplicated in each migrator.

## Important limitation

This layer is implemented and test-covered, but production cron wiring and object-store provisioning are still deployment concerns outside this folder.
