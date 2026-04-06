# Troubleshooting Index

This file maps common symptoms to the first files and commands to inspect.

## 1. Backtest Hub shows no runs

Check:
- [src/components/BacktestLabPanel.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components\BacktestLabPanel.ts)
- [src/backtest-hub-window.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\backtest-hub-window.ts)
- [src/services/historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)
- [src-tauri/sidecar/local-api-server.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\src-tauri\sidecar\local-api-server.mjs)

Run:
- `npm run test:data`

## 2. Data loads in UI but not in tests

Check:
- env/runtime-only imports
- `src/services/runtime.ts`
- `src/services/analytics.ts`
- `src/services/ml-worker.ts`

Run:
- `npm run typecheck`
- the narrow failing test file with `node --import tsx --test ...`

## 3. Cache looks duplicated or too many Redis writes happen

Check:
- [server/_shared/redis.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\server\_shared\redis.ts)

Look for:
- extra `setCachedJson` calls
- `seed-meta` side writes
- inflight coalescing bypass

Run:
- `node --import tsx --test tests/redis-caching.test.mjs`

## 4. Live channels or YouTube embed fail

Check:
- [src/components/LiveNewsPanel.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components\LiveNewsPanel.ts)
- [src/services/live-news.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\live-news.ts)
- [api/youtube/live.js](C:\Users\chohj\Documents\Playground\lattice-current-fix\api\youtube\live.js)
- [src-tauri/sidecar/local-api-server.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\src-tauri\sidecar\local-api-server.mjs)

Run:
- `node --import tsx --test tests/live-news-hls.test.mjs`

## 5. Globe/dayNight regressions

Check:
- [src/components/GlobeMap.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components\GlobeMap.ts)
- [src/components/MapContainer.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components\MapContainer.ts)

Run:
- `node --import tsx --test tests/globe-2d-3d-parity.test.mjs`

## 6. Security or deploy tests fail

Check:
- [vercel.json](C:\Users\chohj\Documents\Playground\lattice-current-fix\vercel.json)
- [vite.config.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\vite.config.ts)
- [src/config/security-headers.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\config\security-headers.ts)

Run:
- `node --import tsx --test tests/deploy-config.test.mjs`
- `npm run security:csp:check`
- `npm run security:headers:check`

