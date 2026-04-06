# Dataflow And Cache Quick Reference

This is a compressed map of where data enters, how it is transformed, and where
it is cached.

## Data entry points

- Browser/desktop app collection
  - [src/app/data-loader.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\data-loader.ts)
- Local control plane
  - [src-tauri/sidecar/local-api-server.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\src-tauri\sidecar\local-api-server.mjs)
- Server/RPC handlers
  - [server/worldmonitor](C:\Users\chohj\Documents\Playground\lattice-current-fix\server\worldmonitor)
- Edge functions
  - [api](C:\Users\chohj\Documents\Playground\lattice-current-fix\api)

## Cache layers

### 1. Bootstrap hydration

- Source:
  - [api/bootstrap.js](C:\Users\chohj\Documents\Playground\lattice-current-fix\api\bootstrap.js)
- Consumer:
  - [src/services/bootstrap.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\bootstrap.ts)
- Pattern:
  - fetch once at startup
  - `getHydratedData('<key>')` is consume-once

### 2. Browser persistent cache

- File:
  - [src/services/persistent-cache.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\persistent-cache.ts)
- Use:
  - IndexedDB/local persistent client cache
  - good for fast reuse between reloads

### 3. Circuit breaker cache

- File:
  - [src/utils/circuit-breaker.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\utils\circuit-breaker.ts)
- Use:
  - per-provider failure isolation
  - stale reuse under cooldown

### 4. Redis/server cache

- File:
  - [server/_shared/redis.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\server\_shared\redis.ts)
- Important behaviors:
  - in-flight request coalescing
  - negative sentinel cache
  - `seed-meta` tracking only for eligible seeded namespaces

### 5. Historical archive / replay storage

- Files:
  - [src/services/historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)
  - [src-tauri/sidecar/local-api-server.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\src-tauri\sidecar\local-api-server.mjs)
- Use:
  - imported historical corpus
  - replay runs
  - walk-forward runs
  - replay memory

## If data appears wrong

- Missing on first paint
  - check bootstrap producer and `getHydratedData` consumer
- Present but stale
  - check persistent cache or circuit breaker cooldown state
- Missing only in replay
  - check archive import, sidecar route, and historical corpus composition
- Duplicate or inconsistent across contexts
  - check Redis key construction and context hash logic

