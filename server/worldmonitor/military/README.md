# Military Server Domain

This domain handles military flights, bases, fleet posture, and aircraft enrichment.

## Main responsibilities

- flight list and aircraft detail endpoints
- theater posture summaries
- Wingbits/USNI-derived enrichment
- military base listings

## Important files

- `v1/list-military-flights.ts`
- `v1/get-aircraft-details*.ts`
- `v1/get-theater-posture.ts`
- `v1/get-wingbits-status.ts`
- `v1/get-usni-fleet-report.ts`
- `v1/_shared.ts`

## Common risks

- OpenSky auth/rate-limit behavior
- enrichment provider outages
- classification logic drift between server and client overlays
