# Server Layer

This folder contains the server-side data plane for World Monitor / Lattice Current.

## What lives here

- `_shared/`
  - common infrastructure used by many handlers
  - Redis access, cache keys, response headers, hashing, rate limiting
- `worldmonitor/`
  - feature-specific HTTP handlers grouped by domain
  - each domain usually maps to a route family under `/api/...`
- `archive/`
  - hot/warm/cold data lifecycle tooling
  - migration and archival helpers added in the storage strategy phases

## Design intent

- Keep route handlers thin.
- Push shared cache, auth, and transport policy into `_shared/`.
- Keep domain logic close to the route family that owns it.
- Treat `archive/` as operational infrastructure, not request-path business logic.

## How to read this folder

1. Start with `_shared/README.md`
2. Then read `worldmonitor/README.md`
3. Only read `archive/` if you are touching retention, warm storage, or S3/R2 flow

## Common failure modes

- Cache keys changed in one handler but not in `_shared/cache-keys.ts`
- A new handler skips the standard Redis envelope path
- Route behavior differs between seed data and live fetch because freshness rules were copied instead of shared

## If you change this layer

- Re-run `npm run test:data`
- Re-run `npm run build`
- Check `tests/edge-functions.test.mjs`, `tests/route-cache-tier.test.mjs`, and Redis-related tests first
