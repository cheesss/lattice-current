# Economic Server Domain

This domain exposes macro, BIS, FRED, World Bank, and energy-facing handlers.

## Main responsibilities

- normalize economic data sources into route-friendly payloads
- serve macro signals and indicator batches
- expose energy prices/capacity summaries

## Important files

- `v1/handler.ts`
  - route multiplexer
- `v1/get-fred-series*.ts`
  - FRED time series access
- `v1/list-world-bank-indicators.ts`
  - World Bank ranking/indicator path
- `v1/get-macro-signals.ts`
  - macro summary surface
- `v1/_shared.ts`, `v1/_bis-shared.ts`
  - economic-domain shared helpers

## Common risks

- provider quota/auth drift
- cache TTL mismatch between macro endpoints
- changing payload shape without updating macro panels and bootstrap consumers
