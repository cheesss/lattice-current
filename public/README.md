# Public Static Assets

This folder contains files served directly without bundling logic.

## Typical contents

- icons and browser metadata
- robots/sitemap
- offline fallback pages
- static fallback payloads used for resilience

## Important current asset

- `data/bootstrap-fallback.json`
  - cold-start resilience payload used when Redis/bootstrap is empty or unavailable

## Rule

Only put assets here if they must be fetchable as-is at runtime. If an asset should be versioned with the app bundle, consider `src/data/` instead.
