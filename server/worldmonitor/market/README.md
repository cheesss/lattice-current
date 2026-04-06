# Market Server Domain

This domain exposes quote, sector, ETF flow, and country-market endpoints.

## Main responsibilities

- serve normalized market quote lists
- provide sector summaries and country index views
- expose ETF flow and stablecoin market snapshots

## Important files

- `v1/list-market-quotes.ts`
- `v1/list-commodity-quotes.ts`
- `v1/list-crypto-quotes.ts`
- `v1/list-etf-flows.ts`
- `v1/get-sector-summary.ts`
- `v1/get-country-stock-index.ts`

## Common risks

- Yahoo/Finnhub provider rate limits
- symbol normalization drift
- stale seed/live mismatch across quote families
