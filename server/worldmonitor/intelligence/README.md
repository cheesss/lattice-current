# Intelligence Server Domain

This domain serves higher-level inference and risk endpoints.

## Main responsibilities

- country intelligence briefs
- risk score endpoints
- event classification and situation deduction
- GDELT-backed search surfaces

## Important files

- `v1/get-country-intel-brief.ts`
- `v1/get-risk-scores.ts`
- `v1/classify-event.ts`
- `v1/deduct-situation.ts`
- `v1/search-gdelt-documents.ts`
- `v1/_batch-classify.ts`

## Design note

This folder should stay close to orchestration and response shaping. Heavy inference logic belongs in `src/services/intelligence/` or related shared services.
