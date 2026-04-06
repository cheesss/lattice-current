# Cache Policy Matrix

> Single source of truth: `src/config/cache-tiers.ts`
> Auto-generated reference. Do not edit manually — update cache-tiers.ts instead.

## Tier TTL Values

| Tier | CDN (s-maxage) | CDN SWR | CDN SIE | Redis TTL | Client (IDB) TTL |
|------|---------------|---------|---------|-----------|-----------------|
| fast | 120s (2m) | 60s | 600s | 180s (3m) | 300,000ms (5m) |
| medium | 300s (5m) | 120s | 900s | 600s (10m) | 900,000ms (15m) |
| slow | 900s (15m) | 300s | 3,600s | 1,800s (30m) | 3,600,000ms (1h) |
| static | 3,600s (1h) | 600s | 14,400s | 21,600s (6h) | 86,400,000ms (24h) |
| daily | 21,600s (6h) | 7,200s | 172,800s | 86,400s (24h) | 172,800,000ms (48h) |
| no-store | 0 | 0 | 0 | 0 | 0 |

## Endpoint → Tier Mapping

See `server/gateway.ts` `RPC_CACHE_TIER` for the authoritative mapping.

### fast (realtime-ish)
- `/api/aviation/v1/get-flight-status`

### medium (near-realtime)
- `/api/market/v1/list-market-quotes`
- `/api/market/v1/list-crypto-quotes`
- `/api/market/v1/list-commodity-quotes`
- `/api/market/v1/list-stablecoin-markets`
- `/api/market/v1/get-sector-summary`
- `/api/market/v1/list-gulf-quotes`
- `/api/economic/v1/get-macro-signals`
- `/api/prediction/v1/list-prediction-markets`
- `/api/supply-chain/v1/get-chokepoint-status`
- `/api/aviation/v1/search-flight-prices`

### slow (periodic)
- `/api/infrastructure/v1/list-service-statuses`
- `/api/seismology/v1/list-earthquakes`
- `/api/infrastructure/v1/list-internet-outages`
- `/api/unrest/v1/list-unrest-events`
- `/api/cyber/v1/list-cyber-threats`
- `/api/conflict/v1/list-acled-events`
- `/api/military/v1/get-theater-posture`
- `/api/military/v1/list-military-flights`
- `/api/market/v1/list-etf-flows`
- `/api/news/v1/list-feed-digest`
- (and more — see gateway.ts)

### static (rarely changing)
- `/api/aviation/v1/list-airport-delays`
- `/api/research/v1/list-arxiv-papers`
- `/api/military/v1/list-military-bases`
- `/api/economic/v1/get-fred-series`
- (and more — see gateway.ts)

### daily
- `/api/supply-chain/v1/get-critical-minerals`

### no-store (never cached)
- `/api/maritime/v1/get-vessel-snapshot`
- `/api/aviation/v1/track-aircraft`

## Special Behaviors

### CircuitBreaker TTL Extension (Phase 4.3)
When a CircuitBreaker enters cooldown, the associated data source's client cache TTL is automatically extended by 3× to keep stale data available during the outage. TTL reverts to normal upon recovery.

### Memory Pressure Scaling (Phase 4.2)
Under memory pressure, poll intervals are scaled: 2× at warning level (60-80% heap), 4× at critical level (>80% heap).

### IndexedDB Quota (Phase 4.4)
Total client cache is limited to 50MB. Entries older than 24h are removed on vacuum. LRU eviction triggers when quota exceeds 80%.
