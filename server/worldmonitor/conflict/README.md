# Conflict Server Domain

This domain serves conflict-event and humanitarian summary endpoints.

## Main responsibilities

- ACLED event retrieval
- Iran/UCDP event paths
- humanitarian summary construction

## Important files

- `v1/list-acled-events.ts`
- `v1/list-iran-events.ts`
- `v1/list-ucdp-events.ts`
- `v1/get-humanitarian-summary.ts`
- `v1/_shared.ts`

## Common risks

- ACLED auth expiry vs coverage-thin confusion
- mixed timestamp semantics between conflict sources
- humanitarian summaries drifting from raw source availability
