# Unrest Server Domain

This domain serves protest and civil-unrest event feeds.

## Main responsibilities

- unrest event listing
- protest-source normalization
- reuse of shared conflict/unrest helpers

## Important files

- `v1/list-unrest-events.ts`
- `v1/_shared.ts`

## Common risks

- overlap with conflict scoring pipelines
- severity normalization drift
- duplicate event semantics between unrest and conflict domains
