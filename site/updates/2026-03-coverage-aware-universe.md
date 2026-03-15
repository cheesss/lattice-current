---
title: "2026-03: Coverage-aware universe and candidate expansion review"
summary: Investment Workflow now exposes universe gaps, approved dynamic candidates, and a reviewed Codex-assisted expansion queue.
status: beta
variants:
  - finance
  - tech
updated: 2026-03-16
owner: core
---

# 2026-03: Coverage-aware universe and candidate expansion review

## What changed

- Added a coverage-aware universe summary to `Investment Workflow`
- Added coverage gaps by theme and region
- Added a candidate expansion review queue with approve / reject / reopen actions
- Added an optional Codex-assisted candidate expansion action
- Added universe policy modes: `manual`, `guarded-auto`, `full-auto`
- Added probation and auto-demotion for auto-approved candidates

## Why it matters

The engine no longer depends only on the static core universe. Approved candidates become part of the next intelligence refresh, then flow into direct mappings, idea cards, tracked ideas, and replay/backtest evaluation.

## User impact

- Operators can see where a theme is under-covered
- Dynamic candidates are reviewed explicitly instead of entering the hot path automatically
- Approved candidates become backtestable on the next refresh cycle
- Codex can now auto-add candidates under guarded policy rules without requiring manual approval every time

## Migration or config changes

- No manual migration is required for browser-local use
- Server-side deployments should add the documented `security_master`, `asset_exposures`, `candidate_reviews`, and `coverage_gaps` tables if they want persistent storage outside the browser cache
