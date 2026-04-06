# Utilities

This folder holds reusable low-level helpers that are not domain-specific enough for `src/services/`.

## Major clusters

- rendering helpers
  - `sparkline.ts`, `d3-*`
- runtime infrastructure
  - `circuit-breaker.ts`
  - `error-boundary.ts`
  - `worker-pool.ts`
- browser/platform helpers
  - `urlState.ts`
  - `settings-persistence.ts`
  - `user-location.ts`
  - `wasm-bridge.ts`
- text and safety helpers
  - `sanitize.ts`
  - `summary-cache-key.ts`
  - `news-context.ts`

## Design philosophy

- Utilities should be small, portable, and side-effect-light.
- If a helper starts encoding business rules for a specific panel or domain, move it to `src/services/`.
- If a helper becomes stateful or needs persistent storage, it probably no longer belongs here.

## High-risk files

- `circuit-breaker.ts`
  - affects many fetch paths and cache behavior
- `error-boundary.ts`
  - affects resilience and degraded-mode UX
- `urlState.ts`
  - easy to regress deep-linking and panel view sync
