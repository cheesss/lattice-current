# Supply Chain Server Domain

This domain serves chokepoint status, shipping rates, and critical minerals data.

## Main responsibilities

- chokepoint disruption summaries
- shipping rate time series
- critical minerals concentration/risk payloads

## Important files

- `v1/get-chokepoint-status.ts`
- `v1/get-shipping-rates.ts`
- `v1/get-critical-minerals.ts`
- `v1/_minerals-data.ts`
- `v1/_scoring.mjs`

## Common risks

- cache version drift after payload changes
- static minerals data and scoring changes getting out of sync
- FRED dependency affecting shipping-only paths
