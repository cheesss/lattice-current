# Shared Server Primitives

This folder is the shared substrate for server handlers.

## Core files

- `redis.ts`
  - hot cache read/write path
  - envelope wrapping/unwrapping
  - negative sentinel handling
- `cache-keys.ts`
  - canonical key names used by bootstrap and handlers
- `rate-limit.ts`
  - shared request throttling utilities
- `response-headers.ts`
  - cache/security response header helpers
- `hash.ts`
  - stable hashing utilities used in cache and identity paths
- `acled.ts`
  - shared ACLED fetch/auth wrapper

## Design rules

- If multiple handlers need the same remote source, put the common fetch/caching logic here.
- Do not invent ad-hoc Redis formats in feature handlers.
- Keep key naming deterministic. Bootstrap tests assume parity.

## Why this matters

Most server regressions are not in the domain handler itself. They happen because a handler:

- bypasses Redis conventions
- uses a different cache key than bootstrap expects
- changes TTL/header behavior without updating central config

## First files to inspect for cache bugs

1. `redis.ts`
2. `cache-keys.ts`
3. `response-headers.ts`
4. the handler under `server/worldmonitor/...`
