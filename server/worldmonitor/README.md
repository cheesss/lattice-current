# WorldMonitor Route Handlers

This folder groups request handlers by domain.

## Structure

Each subfolder represents a domain such as:

- `economic`
- `news`
- `military`
- `maritime`
- `trade`
- `supply-chain`
- `conflict`

Under each domain, handlers usually follow a `v1/...` pattern and expose one route family.

## Design philosophy

- Domain folders should contain domain-specific request assembly and response shaping.
- Cross-domain primitives belong in `server/_shared/`.
- Heavy analytics should usually live in `src/services/` and be imported, not reimplemented here.

## Reading order

1. Find the domain folder
2. Read the route entry file
3. Find which `src/services/...` module provides the computation
4. Check `server/_shared/` for cache/auth/freshness behavior

## Common pitfalls

- Returning empty arrays for upstream failures without attaching enough diagnostics
- Letting route-specific TTL drift away from `src/config/cache-tiers.ts`
- Mixing seed payload shapes and live payload shapes without normalization
