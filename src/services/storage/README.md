# Storage Services

This domain contains versioned storage primitives used across Redis, IndexedDB, and PostgreSQL retention paths.

## Responsibilities

- storage envelope definition
- schema registry and migrations
- version-aware decode/upgrade behavior

## Common neighbors

- `server/_shared/redis.ts`
- `src/services/persistent-cache.ts`
- `src/services/server/intelligence-postgres.ts`
- `server/archive/*`
