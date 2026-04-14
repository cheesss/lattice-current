# Dashboard Data Continuity Audit (2026-04-14)
> **Status**: partial (P0 article binding shipped; P1 fallback/stale badges shipped; P1 structural-alerts source-of-truth and transmission freshness still open)  

This audit documents dashboard-level data continuity issues found while inspecting the active theme shell and its backing APIs on 2026-04-14.

The goal of this audit is to separate three cases that were being conflated in the UI:

1. Data is genuinely missing.
2. Data exists, but the dashboard surface is reading an older or different corpus.
3. Data exists and is current, but the UI does not disclose fallback/stale mode clearly enough.

## Scope

This audit covered the active dashboard surface and its major API dependencies, including:

- `live-status`
- `theme-shell-snapshots`
- `daily-digest`
- `trend-pyramid`
- `theme-evolution`
- `category-trends`
- `insights/quarterly`
- `structural-alerts`
- `discovery-triage`
- `reports/latest`
- `digest/weekly`
- `today`
- `calibration`
- `event-uplift-grades`
- `alpha-decay`
- `signal-correlation`
- `regime-timeline`
- `emerging-tech`
- `emerging-tech/:topicId`
- `theme-brief/:theme`

## Executive Summary

The main finding is not "the system has no 2026 data."

The actual state is:

- 2026 data does exist in several live and refreshed surfaces.
- Some dashboard sections are correctly reading 2026 data.
- Some sections are only updating the summary row or report wrapper, while the underlying evidence/article binding remains stuck on an older corpus.
- Some sections are in fallback mode or effectively empty, but the UI still presents them as if they were current and authoritative.

The largest continuity break is the `Selected Topic` / `Emerging Technology Watchlist` detail surface.

## What Was Confirmed Healthy

The following surfaces do show 2026 data and are not globally broken:

- `reports/latest`
  - report generation timestamps reach `2026-04-14`
- `emerging-tech`
  - topic `updatedAt` values reach `2026-04-13`
- `today`
  - events are present with `publishedAt` in `2026-04-10`
- `theme-brief/climate-change`
  - article evidence from `2026-04-06` to `2026-04-07`
- `theme-brief/materials-science`
  - article evidence from `2026-04-07`
- `signals/history`
  - at least VIX history reaches `2026-04-14`
- `heatmap`
  - `updatedAt` reaches `2026-04-14`
- `whatif`
  - `updatedAt` reaches `2026-04-14`
- `map-lens-overlays`
  - `updatedAt` reaches `2026-04-14`

This is important because it rules out the theory that "all recent data stopped coming in."

## Confirmed Data Continuity Breaks

### 1. Emerging topic detail is updated in 2026, but linked article evidence is stuck in 2025

This is the most important break.

Observed on:

- `/api/emerging-tech/dt-4536ea1f6989`
- `/api/emerging-tech/dt-f84a250cd10b`
- `/api/emerging-tech/dt-6cfaba39920c`

Symptoms:

- `topic.updatedAt` is `2026-04-13`
- `report.generated_at` is `2026-04-13`
- but `articles[]` and `report.top_articles[]` top out in `2025-12`
- `monthlyCounts` also stop at `2025-12`

Interpretation:

- the topic/report row is being refreshed
- but the linked article corpus or report article selection is still using an older article set
- this creates the misleading impression that there are no recent geopolitics/conflict articles

Impact:

- `Recent articles` in the topic detail is currently not trustworthy as a "recent" surface
- the topic summary and metrics may be current, while the displayed article evidence is stale

Priority: `P0`

### 2. `Today` feed is populated, but it is a 7-day fallback dominated by `arxiv` with `theme: unknown`

Observed on:

- `/api/today`

Symptoms:

- response is not empty
- `meta.window = "7d-fallback"`
- current items are overwhelmingly `arxiv`
- current items carry `theme: "unknown"`
- this diverges sharply from the user expectation of "today's key events"

Impact:

- the dashboard looks active but not operator-useful
- a fallback feed is being rendered like a primary live-events feed

Priority: `P1`

### 3. `Articles today = 0` coexists with non-empty fallback event feed

Observed across:

- top KPI strip / `live-status`
- `/api/today`

Symptoms:

- `Articles today` shows `0`
- `/api/today` still returns multiple 2026 events
- this is not necessarily inconsistent at the data-model level, but it is inconsistent at the UX level

Interpretation:

- top KPI is likely counting one ingestion class or one freshness rule
- `today` surface is falling back to a broader or different corpus

Impact:

- users cannot tell whether the system is actually idle or operating in fallback mode

Priority: `P1`

### 4. Daily digest has global article volume but no digest items

Observed on:

- `/api/daily-digest?period=quarter`

Symptoms:

- `source = "article_fallback_72h"`
- `window = "72h-fallback"`
- `items = []`
- `supportingStats.totalArticles = 67302`

Interpretation:

- article volume exists
- digest selection/curation is not producing visible items for the current dashboard surface

Impact:

- the user sees an empty briefing despite the system claiming large corpus availability

Priority: `P1`

### 5. Structural alerts are empty in one surface but present in another

Observed on:

- `/api/structural-alerts?period=quarter&limit=8`
- `/api/theme-shell-snapshots` -> `risk.highlights`

Symptoms:

- direct structural alerts API returns `items: []`
- risk snapshot still contains multiple structural highlights

Interpretation:

- alert presentation is drawing from different source logic or different filtering layers
- users can get contradictory answers depending on which card they read

Impact:

- confidence in the alerting layer drops
- difficult to know which alert surface is canonical

Priority: `P1`

### 6. Investment snapshot wrapper refreshes, but key internal state is null or old

Observed on:

- `/api/theme-shell-snapshots`

Symptoms:

- `investment.generatedAt` updates
- but:
  - `signalRuntime = null`
  - `experimentRegistry = null`
- several persistent investment caches are last updated on `2026-04-05`

Interpretation:

- the shell snapshot is being rebuilt
- but core investment intelligence subcomponents are not fully hydrated into the surface

Impact:

- the card looks current while parts of the underlying decision state are missing

Priority: `P1`

### 7. Validation snapshot is old but not strongly presented as old

Observed on:

- `/api/theme-shell-snapshots` -> `validation`

Symptoms:

- `validation.updatedAt = 2026-04-05`
- the card still renders as a normal active surface

Impact:

- validation may be read as current operator truth when it is actually a stale offline artifact

Priority: `P1`

### 8. Transmission explicitly reports stale age, but internal freshness metadata is inconsistent

Observed on:

- `/api/theme-shell-snapshots` -> `transmission`

Symptoms:

- `fresh = false`
- `freshnessHours ~= 365`
- source `updatedAt = 2026-03-30`
- yet nested source meta still reports `stale: false`

Interpretation:

- freshness is being computed at multiple layers with inconsistent rules

Impact:

- UI may show correct stale messaging in one place and healthy source metadata in another

Priority: `P1`

### 9. Source Ops and Codex quality are significantly older than the rest of the live shell

Observed on:

- `/api/theme-shell-snapshots` -> `sourceOps`
- `/api/codex-quality`
- `/api/codex-latest`

Symptoms:

- `sourceOps.generatedAt = 2026-04-08`
- `source-credibility` updated at `2026-04-05`
- `codex-quality.lastCallAt = 2026-04-08`
- `codex-latest.discoveries.generatedAt = 2026-04-04`

Impact:

- these look like current operational panels but are materially older than the rest of the dashboard

Priority: `P2`

## Important Non-Issues

The following should not be misclassified as continuity failures without more evidence:

### 1. Empty followed-theme briefing

Observed on:

- `/api/followed-theme-briefing?period=week`

Current state:

- `itemCount = 0`
- `persisted = false`

This may simply reflect the current browser workspace having no followed themes. It is not enough on its own to call this a broken data surface.

### 2. Theme briefs are not globally stale

`theme-brief` endpoints for at least `climate-change` and `materials-science` demonstrate that recent 2026 article evidence can appear correctly in the product. This means the evidence layer itself is not uniformly dead.

## Root Cause Pattern

The failures are not random. They cluster into three recurring patterns:

### Pattern A: Fresh wrapper, stale body

Examples:

- `Selected Topic`
- topic `report.top_articles`
- validation wrapper
- source ops wrapper

The outer object shows a recent `updatedAt` or `generatedAt`, but the evidence or sub-artifact inside is old.

### Pattern B: Fallback mode hidden as normal mode

Examples:

- `today`
- `daily-digest`
- top KPI vs fallback feed

The system is degrading gracefully, but the UI does not clearly state that it is operating in fallback mode.

### Pattern C: Parallel surfaces disagree

Examples:

- `structural-alerts` vs `risk.highlights`
- transmission freshness flags

Two surfaces that should describe the same state do not agree on whether something is present or stale.

## Priority Remediation Order

### P0

1. Rebuild `emerging-tech/:topicId` article binding so that:
   - recent linked articles are actually recent
   - old linked articles are explicitly labeled as legacy fallback
   - monthly topic evidence can extend into 2026 where data exists

### P1

2. Surface fallback mode explicitly in `today` and `daily-digest`
3. Unify structural alert source-of-truth across alert surfaces
4. Mark investment and validation cards as partial/stale when subcomponents are null or old
5. Make transmission freshness logic consistent across summary and nested source metadata

### P2

6. Add strong stale badges to Source Ops and Codex quality panels
7. Review whether `today` should exclude `arxiv`-only fallback from the primary operator surface

## Acceptance Criteria For Fixes

The continuity issue should be considered fixed only when all of the following are true:

1. `Selected Topic` can show a 2026 recent linked article when 2026 data exists in the system.
2. If no recent linked article exists, the UI explicitly says:
   - `No recent linked articles`
   - and separately shows `Latest linked article`
3. `today` clearly indicates whether it is:
   - primary 24h live feed
   - 7-day fallback
   - collecting/no live feed
4. `daily-digest` distinguishes:
   - no digest items
   - digest in fallback mode
   - digest unavailable
5. structural alert surfaces agree on the same alert set or clearly document different scopes
6. any card reading data older than its product SLA shows a stale or partial-state indicator

## Current Working Diagnosis

The most accurate current statement is:

> 2026 data is present in the system, but several dashboard surfaces are not bound to the newest evidence layer. The dashboard currently mixes fresh summaries, stale linked evidence, hidden fallback modes, and partially hydrated operator state.

That diagnosis should be used as the baseline for further fixes.
