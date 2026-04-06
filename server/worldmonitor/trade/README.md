# Trade Server Domain

This domain exposes WTO-style trade restriction, tariff, barrier, and flow endpoints.

## Main responsibilities

- tariff trend summaries
- trade restriction listings
- barrier and flow endpoints

## Important files

- `v1/get-trade-restrictions.ts`
- `v1/get-trade-barriers.ts`
- `v1/get-trade-flows.ts`
- `v1/get-tariff-trends.ts`
- `v1/_shared.ts`

## Common risks

- WTO auth availability
- payload drift between similar trade endpoints
- region/country normalization inconsistencies
