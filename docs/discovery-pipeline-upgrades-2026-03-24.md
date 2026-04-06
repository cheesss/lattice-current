# Discovery Pipeline Upgrades

Date: 2026-03-24
Workspace: `lattice-current-fix`

## Scope

This change set implements the requested staged upgrades across seed normalization, bootstrap resilience, GDELT topic externalization, keyword-source feedback loops, and Codex-assisted discovery plumbing.

## Stage 1

### 1-A. Earthquake schema normalization

- Updated `scripts/seed-earthquakes.mjs` to emit the live-facing flat schema:
  - `depth`
  - `lat`
  - `lon`
  - `time`
  - `url`
- Kept `src/services/earthquakes.ts` backward-compatible with both old seed payloads and live payloads.

### 1-B. Relay proxy fallback for market seeds

- Added Yahoo relay support in `scripts/_seed-utils.mjs`.
- Wired relay fallback into:
  - `scripts/seed-market-quotes.mjs`
  - `scripts/seed-commodity-quotes.mjs`

### 1-C. Insights circuit breaker and stale signaling

- Added an LLM circuit breaker to `scripts/seed-insights.mjs`.
- Added explicit LKG TTL and stale metadata:
  - `staleWarning`
  - `lkgExpiresAt`
- Surfaced stale bootstrap payloads through:
  - `src/services/bootstrap.ts`
  - `src/App.ts`

### 1-D. Bootstrap sparkline initialization

- `scripts/seed-market-quotes.mjs` now requests `range=5d&interval=1h`.
- Sparkline data is prefilled during bootstrap when Yahoo or relay returns chart data.

## Stage 2

### 2-A. Externalized GDELT topic registry

- Added `config/gdelt-topics.json` as the manual topic seed.
- Added `src/services/gdelt-topic-registry.ts` as the runtime registry layer.
- Reworked `src/services/gdelt-intel.ts` to use JSON-backed topics and runtime registry lookups.

### 2-B. Keyword to GDELT proposal path

- `src/services/gdelt-topic-registry.ts` now proposes auto topics from high-confidence keywords.
- Auto topics are guarded:
  - `confidence >= 92` => enabled
  - otherwise remain disabled

### 2-C. Topic quality feedback

- Added rolling stats per topic:
  - `avgResults`
  - `matchRate`
  - `duplicateRate`
  - `zeroResultStreak`
  - `lastActiveAt`
- Topics auto-disable after 3 consecutive zero-result fetches.

## Stage 3

### 3-A. Keyword to source proposals

- Added `src/services/server/autonomous-discovery.ts`.
- High-confidence recurring keywords now propose draft feed URLs using allowed-domain heuristics.

### 3-B. Source to keyword extraction

- Active discovered feeds are scanned for titles.
- Extracted unigram and bigram candidates are upserted into the keyword registry.

### 3-C. Source health to keyword confidence feedback

- Degraded source registry entries now reduce related keyword confidence through `adjustKeywordConfidence`.

## Stage 4

### 4-A. Feed discovery via Playwright with fallback

- `src/services/server/autonomous-discovery.ts` now attempts RSS/Atom alternate-link discovery with Playwright.
- If Playwright is unavailable or browser launch fails, it falls back to plain HTML fetch scanning.
- Scope remains limited to domains already present in `shared/rss-allowed-domains.json`.

### 4-B. Codex theme proposal output expansion

- `src/services/theme-discovery.ts` and `src/services/server/codex-theme-proposer.ts` now carry:
  - `suggestedSources`
  - `suggestedGdeltKeywords`

### 4-C. Orchestration and registry ingestion

- `src/services/server/intelligence-automation.ts` now:
  - runs the autonomous discovery sweep
  - ingests `suggestedSources` into the discovered source registry
  - ingests `suggestedGdeltKeywords` into the keyword registry
  - triggers GDELT topic proposals after Codex keyword ingestion

## UI integration

- `src/components/GdeltIntelPanel.ts` now hydrates from the runtime GDELT registry after initial render.
- This allows auto-proposed and runtime-managed topics to show up in the panel, while preserving a static fallback topic list.

## Validation

- `npm.cmd run typecheck`
- `node --import tsx --test tests/storage-envelope.test.mjs tests/bootstrap.test.mjs`

Both passed in `lattice-current-fix`.

## Notes

- Topic performance stats are persisted through the app registry/cache layer, not written back into `config/gdelt-topics.json`. The JSON file remains the manual seed source; runtime stats and auto topics are stored dynamically.
- Feed discovery uses Playwright first, but deliberately falls back to HTML parsing so the scheduler does not hard-fail on machines without browser runtime support.
