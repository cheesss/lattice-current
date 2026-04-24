# Live vs Backfill Data Boundary Plan

> **Status**: partial — Phase 0 API-contract shipped; Phase 1+ ownership transferred to the Nowcast track. Last reviewed 2026-04-23.
> 
> **현재 책임 분리:**
> - Phase 0 (API freshness contract, `meta.mode`/`dataUpdatedAt`/`staleReason`/trust chips) — ✅ shipped on main, 본 문서 §"Implementation Progress" 참조
> - Phase 1+ (signal-quality classification: observed/mirrored/proxy/composite/imputed/estimated) — → [NOWCAST_HANDOFF_2026-04-18.md](./NOWCAST_HANDOFF_2026-04-18.md) §0 semantic contract + §2 `signal_history` origin tagging
> - Nowcast model activation gates — → NOWCAST_HANDOFF §3 commit map + §5 production checklist
> 
> 이 문서는 Phase 0의 구현 기록으로만 유지. 새로운 freshness/trust 정책은 NOWCAST_HANDOFF에서 관리.

Date: 2026-04-16 KST

## Implementation Progress

### 2026-04-16 KST: Phase 0 API Freshness Contract

Implemented the first freshness contract pass.

- `scripts/event-dashboard-api.mjs`
  - Added a shared response metadata derivation path.
  - `meta.generatedAt` now means API wrapper generation time.
  - `meta.dataUpdatedAt` and `meta.updatedAt` now represent inferred data freshness time instead of wrapper time.
  - Nested payload timestamps are scanned into `meta.latestInternalUpdatedAt`.
  - Fallback responses are marked with `mode=fallback`, `stale=true`, and `staleReason`.
  - Cache fallback responses are marked with `mode=cache`, `cacheHit=true`, and `stale=true`.
  - `/api/kpi-summary` and `/api/signals` now also use the shared metadata contract.

- `scripts/_shared/trend-dashboard-queries.mjs`
  - Daily digest payloads now emit explicit freshness metadata instead of relying only on nested article timestamps.
  - Digest fallback paths are marked `mode=fallback` and `stale=true`.

- `scripts/_shared/theme-shell-snapshot-builders.mjs`
  - Macro snapshot `meta.stale` now reflects filtered/aged macro signals, not only upstream source flags.

- `event-dashboard.html`
  - Regime Strip now renders a trust-row freshness chip.
  - Geo Pressure, Macro, and Transmission snapshot cards now use the shared freshness badge path.
  - Today and Daily Digest sections now render the shared trust-row when freshness metadata is available.

Verification:

- `/api/today` with a `7d-fallback` window returned `mode=fallback`, `stale=true`, and `dataUpdatedAt=2026-04-10T16:03:23.000Z`.
- `/api/daily-digest?date=today` returned `mode=fallback`, `stale=true`, `window=72h-fallback`, and explicit null `dataUpdatedAt` when no digest items passed filters.
- KPI Strip now displays freshness from `dataUpdatedAt`, while the wrapper generation time stays separate in the explanation text.
- Tests passed:
  - `node --test tests/event-dashboard-freshness-contract.test.mjs`
  - `node --test tests/event-dashboard-trend-routes.test.mjs`
  - `node --test tests/theme-shell-snapshot-builders.test.mjs`
  - `npx playwright test e2e/inbox-actions.spec.ts --reporter=list`

Remaining follow-up after Phase 0:

- Live/backfill surface separation still needs a broader UI pass beyond these freshness chips.

### 2026-04-16 KST: Phase 1 Signal Quality Classification

Implemented the first signal-quality pass for KPI and live-status payloads.

- `scripts/event-dashboard-api.mjs`
  - Added per-channel signal quality classification for `observed`, `mirrored`, and `stale` signal rows.
  - Detects copied-forward rows when the latest 6+ samples repeat the same value.
  - Applies source-specific freshness thresholds, so daily/weekly macro signals are not judged like hourly market data.
  - `/api/kpi-summary` now emits `signalQuality` and marks the wrapper `mode=delayed`, `stale=true` when KPI-critical channels are mirrored or stale.
  - `/api/live-status` now includes `signalQuality` and propagates signal-quality degradation into response metadata.

- `event-dashboard.html`
  - Regime Strip trust row now treats server-side `meta.stale=true` as authoritative, even when `dataUpdatedAt` is recent.
  - This prevents mirrored rows from displaying as simply `Fresh`.
  - Per-signal tooltips expose quality status and reason for VIX, spread, oil, and dollar.

Verification:

- `/api/kpi-summary` returned `mode=delayed`, `stale=true`, and `staleReason="Dollar, HY Credit, Market Stress, VIX, Yield Spread signal history appears mirrored"`.
- `signalQuality.vix.status` returned `mirrored` with `repeatedCount=12`.
- `signalQuality.oilPrice.status` returned `stale` with age above its threshold.
- Screenshot verification saved to `test-results/phase1-freshness-home-fixed.png`.
- The first-viewport Regime Strip displayed `Delayed (2h old)` plus the mirrored-signal reason.
- Console verification found no browser console errors during the screenshot pass.
- Tests passed:
  - `node --test tests/event-dashboard-freshness-contract.test.mjs tests/event-dashboard-trend-routes.test.mjs`
  - `node --test tests/theme-shell-snapshot-builders.test.mjs`
  - `npx playwright test e2e/inbox-actions.spec.ts --reporter=list`

Remaining follow-up after Phase 1:

- Split first-viewport Live Monitor semantics from backfill/replay research semantics.
- Restore a real quote source or explicitly disable the live quote path instead of relying on mirrored `signal_history`.

### 2026-04-16 KST: Phase 3 Data Freshness Audit

Implemented the first automated audit artifact.

- `scripts/audit-data-freshness.mjs`
  - Scans NAS `articles`, `signal_history`, `event_uplift`, and `theme_evolution`.
  - Detects mirrored signal runs from recent `signal_history` samples.
  - Detects empty article 24h/72h windows.
  - Scans `data/historical/automation/**` and known backfill state files.
  - Scans `data/event-dashboard-cache/**` for stale false positives and wrapper/data timestamp mismatches.
  - Writes a KST-dated report under `data/audits/data-freshness-YYYY-MM-DD.json`.

- `package.json`
  - Added `npm run audit:freshness` as the operator command for the audit.

- `scripts/event-dashboard-api.mjs`
  - Added `/api/data-freshness-audit` to expose the latest audit artifact.
  - The route returns the latest KST-dated audit summary, findings, NAS checks, backfill checks, and top cache issues.

- `event-dashboard.html`
  - Added an Ops surface `Freshness Audit` card.
  - The card shows finding count, mirrored-signal count, cache issue count, article 24h/72h counts, and top P0/P1 findings.

Verification:

- Command:

```text
npm run audit:freshness
```

- Output artifact:

```text
data/audits/data-freshness-2026-04-16.json
```

- Current audit summary:

```text
findings: 11
mirroredSignals: vix, yieldSpread, dollarIndex, hy_credit_spread, marketStress
articleCount24h: 0
articleCount72h: 0
cacheIssues: 34
```

- Acceptance criteria status:
  - VIX repeated value detected: yes, latest value repeats 43 sampled rows.
  - Article 24h and 72h zero state detected: yes.
  - Historical automation stale run detected: yes, latest artifact about 167h old.
  - Theme/cache stale false positives detected: yes, 34 cache artifacts flagged.
- `/api/data-freshness-audit` returned the latest artifact and the Ops card rendered the audit summary.
- Ops screenshot verification saved to `test-results/phase3-ops-freshness-audit-fixed.png`.
- Tests passed:
  - `node --test tests/event-dashboard-freshness-contract.test.mjs tests/event-dashboard-trend-routes.test.mjs`
  - `npx playwright test e2e/inbox-actions.spec.ts --reporter=list`
  - `npm run build`

Remaining follow-up after Phase 3:

- Add a recurring job or existing scheduler step for `scripts/audit-data-freshness.mjs`.
- Decide whether stale cache artifacts should be purged, rebuilt, or retained with explicit `BACKFILL/CACHE` labels.

### 2026-04-16 KST: Phase 4 Quote Feed Boundary Guard

Implemented the first runtime guard for missing live market quotes.

- `scripts/event-dashboard-api.mjs`
  - Added `detectLiveQuoteFeed()` to check whether the `market_quotes` table exists.
  - `/api/kpi-summary` and `/api/live-status` now include `meta.quoteFeed`.
  - If `market_quotes` is missing, the response stays `stale=true` and appends `market_quotes table not found; KPI strip is using signal_history, not a live quote feed` to `staleReason`.

- `event-dashboard.html`
  - The existing Regime Strip trust row now displays the quote-feed boundary reason.

Verification:

- `/api/kpi-summary` returned `meta.quoteFeed.configured=false` and `status=unavailable`.
- First-viewport screenshot verification saved to `test-results/phase4-live-quote-unavailable.png`.
- The Regime Strip displayed `Delayed (2h old)` and explicitly stated that `signal_history` is being used instead of a live quote feed.

Remaining follow-up after Phase 4:

- Build or restore actual `market_quotes` ingestion for VIX and key symbols.
- Once a quote table exists, extend `detectLiveQuoteFeed()` to report latest quote timestamp, provider, and symbol coverage.

### 2026-04-16 KST: Structural Alerts Canonicalization

Resolved the alert-schema drift between the dashboard query layer and the workbench generator.

- `scripts/_shared/trend-dashboard-queries.mjs`
  - Structural-alert reads now accept both `active` and `open` rows.
  - The query now tolerates either `signal_score` or `alert_score` as the score source.
  - Returned alert payloads expose both `signalScore` and `alertScore` so downstream consumers do not need to guess the canonical field.

- `tests/trend-dashboard-queries-structural-alerts.test.mjs`
  - Added coverage for the compatibility path.

Verification:

- `node --test tests/trend-dashboard-queries-structural-alerts.test.mjs tests/trend-workbench-structural-alerts.test.mjs`

Remaining follow-up:

- Transmission freshness thresholds are still unified through the snapshot builder path, but the live feed restoration work remains blocked until a real `market_quotes` source is available.

## Executive Summary

The current dashboard refreshes frequently, but several values are not live in the operational sense. The main issue is not that every backfilled value is wrong. The issue is that live data, delayed market data, backfill artifacts, replay outputs, fallback windows, mirrored signal rows, and regenerated API wrappers are presented through the same UI grammar.

This creates a trust problem:

- A value can look fresh because the API wrapper was regenerated.
- A value can have a recent `ts` because an old value was mirrored into a new time bucket.
- A "Today" or "Recent" card can actually be a 7-day or 72-hour fallback.
- Backfilled datasets can be analytically valid, but they should not be shown as live operating signals.

The system should move toward explicit data-mode separation:

- `live`: current operational inputs, allowed in first-viewport monitor surfaces.
- `delayed`: current-ish but provider-delayed inputs, allowed with an `as of` label.
- `backfill`: historical reconstruction, never shown as current without a backfill badge.
- `replay`: model validation or historical scenario outputs.
- `fallback`: substitute window or cached response used because the primary live window is empty.
- `mirrored`: a copied-forward value used to keep a time series shaped, not a newly observed value.

## Confirmed NAS Findings

NAS PostgreSQL connection succeeded using the project runtime config:

```text
host: 192.168.0.2
port: 5433
database: lattice
ssl: false
server_time: 2026-04-15T17:04:13Z
```

Available checked tables:

```text
articles
canonical_events
event_uplift
signal_history
theme_evolution
```

Not present in the checked table set:

```text
market_quotes
fred_observations
```

This matters because `master-daemon` can only use a live `^VIX` quote path if `market_quotes` exists. Without it, the system falls back to `signal_history` and FRED/backfill behavior.

### Signal History

Current NAS `signal_history` sample:

```text
vix latest_ts: 2026-04-15T16:00:00Z
vix latest value: 19.23
oilPrice latest_ts: 2026-04-06T00:00:00Z
marketStress latest_ts: 2025-12-31T00:00:00Z
transmissionStrength latest_ts: 2025-12-31T00:00:00Z
```

The latest VIX tail contains repeated values:

```text
2026-04-15 16:00Z  19.23
2026-04-15 15:00Z  19.23
2026-04-15 14:00Z  19.23
2026-04-15 13:00Z  19.23
...
2026-04-15 05:00Z  19.23
```

This is consistent with the `master-daemon` signal freshness mirror that copies the latest known values into `date_trunc('hour', NOW())`. It keeps the series fresh-looking, but it is not a new market observation.

### Articles

Initial NAS article freshness before the GDELT restore:

```text
latest published_at: 2026-04-10T16:03:23Z
last 24h: 0
last 72h: 0
last 7d: 1002
total: 68479
```

This was the reason "Today" and "Recent" surfaces needed explicit fallback labeling. The later restoration step below rehydrated the current article window and the audit now verifies non-zero 24h/72h article coverage.

## Initial Backfill Findings

The initial backfill and accumulator state showed real continuity gaps:

- `data/historical/accumulator-state.json` last run: `2026-04-08T13:06:37.818Z`.
- `data/historical/automation/fred-vixcls/cycle-121.json` fetched at `2026-04-08T07:04:26.637Z`.
- `fred-vixcls` latest observation in that file: `2026-04-06`, value `24.17`.
- Yahoo automation files mostly stop around `2026-04-07` or `2026-04-08`.
- RSS/GDELT archive files inspected are also historical or empty in several paths.

This means backfill artifacts are not necessarily wrong, but they are not a reliable live data source. The later restoration step below refreshed current automation artifacts and patched the audit so it checks the newest files by modification time instead of stopping early in a large directory walk.

## Current Vulnerability Map

| Priority | Area | Problem | Impact |
|---|---|---|---|
| P0 | API metadata | `meta.updatedAt` often means wrapper generation time, not data freshness | UI can show stale data as fresh |
| P0 | `signal_history` | Mirrored hourly rows can repeat old values with new timestamps | VIX/Risk can look live while value is copied forward |
| P0 | Today/Daily Digest | 24h empty window falls back to 7d/72h while `stale=false` can remain | "Today" can show non-today data |
| P0 | Backfill artifacts | Backfill files and accumulator stopped around 2026-04-08 | Historical reconstruction can be mistaken for active feed |
| P1 | KPI Strip | Mixed freshness within one strip: VIX/Dollar fresh-ish, Oil stale, stress very stale | Operator cannot tell which values are actionable |
| P1 | Theme Shell snapshots | Internal source dates vary widely under a fresh wrapper | Snapshot cards look uniformly live |
| P1 | Investment/Validation | Internal data around 2026-04-05 can still show `meta.stale=false` | Strategy/replay conclusions can look current |
| P1 | Source Ops | Registry, credibility, and ops logs have different timestamps | Operational health looks cleaner than it is |
| P2 | E2 Signals | Endpoint has `liveSignalWindowDays` but lacks explicit source/data timestamps | Empty/zero state is hard to interpret |
| P2 | Theme Evolution | Current period buckets can show 0% while prior period contains real shares | Users read missing/current bucket as true zero |

## Required Data Contract

All API responses used by the dashboard should carry a normalized `meta` contract. `updatedAt` should no longer mean wrapper generation time.

```ts
type DataMode = 'live' | 'delayed' | 'backfill' | 'replay' | 'fallback' | 'mirrored' | 'cache';

interface DashboardMeta {
  mode: DataMode;
  generatedAt: string;          // When this API response or artifact was built.
  dataUpdatedAt: string | null; // Latest actual data observation used by the payload.
  sourceUpdatedAt: string | null; // Provider/source timestamp when available.
  ingestedAt: string | null;    // When the system stored the data.
  observedAt: string | null;    // Actual market/event observation timestamp when singular.
  asOf: string | null;          // User-facing timestamp.
  stale: boolean;
  staleReason: string | null;
  freshnessClass: 'live' | 'fresh' | 'delayed' | 'stale' | 'backfill' | 'fallback' | 'unknown';
  window: string | null;        // 24h, 72h-fallback, 7d-fallback, quarter, replay-window, etc.
  sourceSystem: string | null;  // FRED, Yahoo, GDELT, OpenAlex, SEC, replay, cache, NAS, etc.
  sourceCadence: string | null; // intraday, daily, weekly, monthly, archive, manual, replay.
  confidencePenalty: number;    // 0..1 penalty applied because of staleness/fallback.
}
```

For time-series values, each row should distinguish observed time from ingestion time:

```ts
interface TimedValue {
  name: string;
  value: number;
  observedAt: string;
  sourceUpdatedAt?: string;
  ingestedAt?: string;
  mode: DataMode;
  isMirrored?: boolean;
}
```

## Surface Boundary

### Live Monitor Surface

Allowed modes:

- `live`
- `delayed`, if clearly labeled

Blocked or downgraded modes:

- `backfill`
- `replay`
- `fallback`
- `mirrored`
- `cache`

Examples:

- Current Regime Strip.
- Top E2 signal queue.
- Dashboard State.
- Source/data health strip.
- Pending decisions that require current action.

Rule: if a card cannot produce `dataUpdatedAt` and `mode`, it should not appear as a live card.

### Backfill and Replay Surface

Allowed modes:

- `backfill`
- `replay`
- `fallback`
- `cache`

Examples:

- Replay validation.
- Historical alpha decay.
- Regime timeline.
- Research theme brief evidence.
- Archive-based emerging-topic reports.

Rule: these surfaces can be prominent, but they must use a research/replay visual grammar, not a live alert grammar.

### Mixed Surfaces

Some cards combine live and historical evidence. These should show split badges:

```text
Signal: LIVE / DELAYED
Evidence: BACKFILL
Validation: REPLAY
Sources: FALLBACK 7d
```

## Endpoint Classification

| Endpoint | Current role | Target mode | Required changes |
|---|---|---|---|
| `/api/kpi-summary` | Regime Strip market signals | `live` or `delayed` per signal | Add per-signal `mode`, `observedAt`, `isMirrored`, `staleReason`; split mirrored rows from observed rows |
| `/api/signals` | KPI fallback | Same as `/api/kpi-summary` | Reuse same contract |
| `/api/event-uplift-grades` | E2 actionable signal queue | `live` if recent outcomes exist, otherwise `empty-live` with data timestamp | Add `generatedAt`, `dataUpdatedAt`, `sourceUpdatedAt`, `window`, `emptyReason` |
| `/api/today` | Today events | `live` only if 24h; otherwise `fallback` | If 7d fallback, set `stale=true`, `mode=fallback`, `window=7d-fallback` |
| `/api/daily-digest` | Curated digest | `live` or `fallback` based on window | Expose 24h vs 72h fallback in card header |
| `/api/live-status` | System snapshot | mixed | Separate `pipelineGeneratedAt` from `dataUpdatedAt`; source-level freshness |
| `/api/theme-shell-snapshots` | Snapshot cards | mixed | Enforce source max-age; bubble worst stale source to card header |
| `/api/theme-brief/*` | Research brief | `backfill` or `research` | Show evidence windows and source dates; never label as live |
| `/api/theme-evolution/*` | Structural trend | `backfill`/`aggregate` | Show latest observed non-empty period separately from current missing period |
| `/api/heatmap` | Historical/aggregate signal | `backfill` or `replay` | Add `asOf` and source window |
| `/api/whatif` | Scenario result | `replay` | Add replay run id and source observation window |
| `/api/calibration` | Model quality | `replay`/`validation` | Add run timestamp and sample window |
| `/api/source-ops` or snapshot source ops | Operational health | `live` for ops log, `delayed`/`stale` for registry/credibility | Split source-level timestamps |

## UI Rules

### First Viewport

The first viewport should only show current operational state if it is genuinely current.

Required badges:

- `LIVE`
- `DELAYED`
- `AS OF <timestamp>`
- `STALE`
- `FALLBACK 7D`
- `BACKFILL`
- `REPLAY`
- `MIRRORED`

### Regime Strip

Current strip should change from:

```text
VIX 19.2 | Risk 44 | Regime BALANCED | Oil 114.0
```

to:

```text
VIX 19.2  MIRRORED  as of 2026-04-15 16:00Z
Risk 44   derived from VIX
Oil 114.0 STALE     as of 2026-04-06
```

If a value is mirrored, the UI should not call it live.

### Today and Recent Cards

If `count_24h = 0`, do not show fallback items under "Today" without an explicit fallback label.

Recommended copy:

```text
No live articles in the last 24h.
Showing 7d fallback archive for continuity.
```

### Theme Brief

Theme Brief should be a research dossier, not a live card. It should display:

- `evidenceWindow`
- `latestArticleAt`
- `latestResearchAt`
- `generatedAt`
- `mode=backfill|research`

## Implementation Plan

### Phase 0: Stop Freshness Mislabeling

Goal: prevent stale data from looking live.

Tasks:

- Replace wrapper-level `meta.updatedAt` with `meta.generatedAt`.
- Add `dataUpdatedAt` to `resolveWithCache` payloads where extractable.
- Make fallback responses set `mode=fallback` and `stale=true`.
- Add a helper to scan payload timestamps and compute `latestInternalUpdatedAt`.
- Add a `staleReason` when `dataUpdatedAt` exceeds mode-specific thresholds.

Acceptance criteria:

- `today` with `7d-fallback` returns `stale=true`.
- Cache hits return `mode=cache` or include `cacheHit=true`.
- API response generation time is not confused with data time.

### Phase 1: Fix KPI and Signal History Semantics

Goal: distinguish observed market values from mirrored values.

Tasks:

- Add a `signal_history_quality` view or API-side classifier.
- Classify rows as mirrored if repeated hourly values are copied forward without source table support.
- Add `market_quotes` ingestion or a `market_quote_latest` table for actual intraday quotes.
- If no quote table exists, mark VIX as `delayed` or `mirrored`, not live.
- Add per-signal staleness thresholds:
  - VIX: live intraday threshold 30 minutes if quote-fed, delayed daily threshold 36 hours if FRED-fed.
  - Oil: daily threshold 48 hours for business days, stale beyond 5 calendar days.
  - Dollar/spread/credit: daily threshold 48 hours.
  - marketStress/transmissionStrength: stale beyond 48 hours unless explicitly replay mode.

Acceptance criteria:

- Current VIX repeated value is labeled `MIRRORED`.
- Oil `2026-04-06` is labeled `STALE`.
- Risk displays "derived from VIX" and inherits VIX freshness.

### Phase 2: Split Live and Backfill Surfaces

Goal: keep historical/research data useful without allowing it to masquerade as live.

Tasks:

- First viewport: only live/delayed operational state.
- Move backfill-heavy research sections into Research/Replay surfaces.
- Add a global data mode filter:
  - `Live`
  - `Delayed`
  - `Backfill`
  - `Replay`
  - `Fallback`
- Add section-level mode summaries:
  - `Live inputs: 3`
  - `Delayed inputs: 2`
  - `Backfill evidence: 14`
  - `Stale sources: 4`

Acceptance criteria:

- A user can see whether a card is live before reading the numbers.
- No backfill-only card appears as a live alert.

### Phase 3: Backfill Audit and Guardrails

Goal: prove whether backfill artifacts are complete, stale, or partial.

Tasks:

- Build `scripts/audit-data-freshness.mjs`.
- Audit:
  - `data/historical/automation/**`
  - `data/event-dashboard-cache/**`
  - NAS tables: `signal_history`, `articles`, `event_uplift`, `theme_evolution`
- Output:
  - latest observation timestamp
  - latest ingestion timestamp
  - row count
  - data mode
  - gaps by day
  - repeated-value runs
  - cache wrapper/data timestamp mismatch
- Store report under `data/audits/data-freshness-YYYY-MM-DD.json`.

Acceptance criteria:

- VIX repeated 19.23 hourly run is detected.
- Article 24h and 72h zero state is detected.
- `accumulator-state` stale run is detected.
- Theme/cache stale false positives are detected.

### Phase 4: Source-Specific Runtime Restoration

Goal: restore actual live or delayed data feeds where the product needs them.

Tasks:

- Add or restore `market_quotes` ingestion for:
  - `^VIX`
  - major ETFs/symbols used by signal cards
  - oil proxy if direct WTI is delayed
- Keep FRED as delayed macro source, not intraday live source.
- Keep Yahoo chart as delayed market history, not primary live quote source unless explicitly labeled.
- Add article ingestion health:
  - 24h count
  - 72h count
  - latest article
  - source distribution
  - ingestion job last success
- Add pipeline alert if article 24h count is zero.

Acceptance criteria:

- `market_quotes` exists and has recent rows, or UI shows "no live quote feed configured".
- Article health tells the user why "Today" is empty.

## Backfill Problem Checklist

Use this checklist for each dataset before exposing it in the live dashboard.

- Does the dataset have `observedAt`?
- Does it have `ingestedAt`?
- Does it have `sourceUpdatedAt`?
- Is `generatedAt` separate from data freshness?
- Is the provider cadence documented?
- Are fallback windows labeled?
- Are repeated copied-forward values detected?
- Are 24h/72h/7d counts visible?
- Does the UI display `BACKFILL` or `REPLAY` when appropriate?
- Does the value affect risk/decision scoring? If yes, is a staleness penalty applied?

## Immediate Next Actions

1. Patch API meta contract:
   - `withMeta`
   - `resolveWithCache`
   - `today`
   - `daily-digest`
   - `kpi-summary`
   - `event-uplift-grades`

2. Patch UI status display:
   - Regime Strip per-signal `as of` labels.
   - Global freshness strip.
   - Fallback banners for Today/Digest.

3. Add audit script:
   - Detect stale cache meta.
   - Detect mirrored signal rows.
   - Detect stopped accumulator.

4. Restore or explicitly disable live quote path:
   - If no `market_quotes`, show "live quote feed unavailable".
   - Do not silently mirror values into live surface.

## Decision Inbox Test and Route Contract Notes

This section records the follow-up investigation into the review finding about `e2e/inbox-actions.spec.ts`.

### Current Finding Status

The reported issue said the Playwright spec only mocked `/api/approval-inbox-payload` while the app actually fetches `/api/proposal-inbox` and `/api/discovery-triage`.

Current workspace status:

- The app path is `refreshDecisionInbox()`.
- It fetches `/api/proposal-inbox?limit=50`.
- It fetches `/api/discovery-triage?limit=30`.
- The spec currently mocks `/api/proposal-inbox`.
- The spec currently mocks `/api/discovery-triage`.
- Triage actions post to `/api/discovery-triage/review`.
- The server handles `POST /api/discovery-triage/review`.

Therefore the original finding is no longer accurate for the current file state. The stale reference remains in a test comment, not in the actual mock implementation.

Verified command:

```text
npx playwright test e2e/inbox-actions.spec.ts --reporter=line
```

Result:

```text
13 passed
```

### Remaining Test Quality Risks

The finding is functionally resolved, but the test should still be refactored.

| Priority | Area | Issue | Refactor |
|---|---|---|---|
| P2 | Stale comment | The spec still mentions `approval-inbox-payload` in a comment even though the actual mocks use current endpoints | Remove or rewrite the stale comment |
| P2 | Catch-all API mock | `mockAllApis()` returns a generic `{ ok: true, data: null }` for unknown API calls | Make mocks strict by default so unexpected API calls fail tests |
| P2 | Triage failure path | The spec verifies triage success and request body but not triage API failure behavior | Add a triage POST failure test that expects a `FAILED` banner and `runtime-issues` capture |
| P2 | Runtime issue capture | Approval action failure checks the visible failure banner but not the diagnostic POST body | Assert `/api/runtime-issues` receives `surface=decision-inbox`, `classification=api-contract`, route, item id, and error |
| P3 | Route contract drift | App routes and server routes are duplicated as strings in HTML, tests, and API server | Extract route constants or a small route contract fixture for tests |

### Recommended Refactor Scope

Refactor the Decision Inbox test harness before adding more UI actions.

Proposed test harness shape:

```ts
const expectedApiRoutes = new Set([
  '/api/proposal-inbox',
  '/api/discovery-triage',
  '/api/approval-queue/approval-smoke-001/review',
  '/api/codex-proposals/proposal-smoke-001/review',
  '/api/discovery-triage/review',
  '/api/runtime-issues',
]);
```

Rules:

- Route `GET /api/proposal-inbox` with realistic `proposals` and `approvals`.
- Route `GET /api/discovery-triage` with realistic `items`.
- Route `POST /api/discovery-triage/review` explicitly.
- Route `POST /api/runtime-issues` explicitly and assert payloads in failure tests.
- Fail unexpected `POST` requests by default.
- Fulfill unrelated read-only dashboard endpoints with safe empty payloads only if listed in an allowlist.

This makes the test protective against endpoint drift. A wrong future path such as `/api/discovery-triage/{id}/decision` should fail immediately instead of being hidden by a generic catch-all.

### Code Refactoring Notes

The same problem exists at the application layer: route strings and decision mappings are scattered across the dashboard script.

Current areas to consolidate:

- `refreshDecisionInbox()` fetch paths.
- `inboxAction()` POST paths.
- `applyDiscoveryTriageDecision()` legacy triage path.
- server routes in `event-dashboard-api.mjs`.
- Playwright route mocks.

Recommended refactor:

1. Add a lightweight route contract object for the dashboard:

```js
const DASHBOARD_ROUTES = {
  proposalInbox: () => `${API}/proposal-inbox?limit=50`,
  discoveryTriage: () => `${API}/discovery-triage?limit=30`,
  approvalReview: (id) => `${API}/approval-queue/${encodeURIComponent(id)}/review`,
  proposalReview: (id) => `${API}/codex-proposals/${encodeURIComponent(id)}/review`,
  triageReview: () => `${API}/discovery-triage/review`,
  runtimeIssues: () => `${API}/runtime-issues`,
};
```

2. Add a decision mapping helper:

```js
const INBOX_DECISION_MAP = {
  approval: { accept: 'accept', reject: 'reject', simulate: 'accept' },
  proposal: { accept: 'accept', reject: 'reject' },
  triage: { accept: 'canonical', canonical: 'canonical', watch: 'watch', reject: 'suppressed', suppress: 'suppressed' },
  'e2-signal': { snooze: 'snooze' },
};
```

3. Make `inboxAction()` call route helpers and decision helpers only.

4. Make tests assert those actual paths by observing requests.

5. When the project moves more code out of `event-dashboard.html`, promote these helpers into a small shared JS/TS module so Playwright fixtures and app code do not drift.

Acceptance criteria:

- The stale `approval-inbox-payload` comment is gone.
- A wrong triage action URL fails the spec.
- A triage failure shows a visible failed state.
- A triage failure posts one `runtime-issues` diagnostic payload.
- Mixed-type bulk action tests remain passing.
- `npx playwright test e2e/inbox-actions.spec.ts --reporter=line` passes.

## 2026-04-16 KST: Live Signal Restoration Completed

The live KPI path has been moved away from copied-forward `signal_history` rows.

Implemented:

- `scripts/refresh-market-quotes-to-nas.mjs`
  - Creates and writes `market_quotes`.
  - Fetches delayed market quotes from Yahoo chart data.
  - Bridges `^VIX`, `CL=F`, `DX-Y.NYB`, and `^TNX` into `signal_history` as observed values.

- `scripts/refresh-fred-signals-to-nas.mjs`
  - Creates and writes `fred_observations`.
  - Fetches FRED CSV data without requiring `FRED_API_KEY`.
  - Bridges `T10Y2Y`, `BAMLH0A0HYM2`, `BAMLC0A0CM`, and `DGS10` into `signal_history` at their true observation dates.
  - Computes `marketStress` as a derived signal from VIX, HY spread, and yield spread.
  - Deletes recent copied-forward hourly rows for canonical FRED daily signals.
  - Deletes `marketStress` rows newer than the slowest current component observation, preventing a derived value from looking fresher than its inputs.

- `scripts/refresh-event-market-transmission.mjs`
  - Computes a bounded `transmissionStrength` value from the refreshed transmission snapshot.
  - Writes `transmissionStrength` back into `signal_history` using the snapshot `generatedAt` timestamp.

- `scripts/master-daemon.mjs`
  - Runs `market-quote-refresh` every 15 minutes.
  - Runs FRED macro `signal-refresh` every 6 hours.
  - Runs `data-freshness-audit` every 6 hours.
  - Stops the previous copy-forward mirroring behavior that wrote old signal values into the current hour.

- `package.json`
  - Adds `market:quotes:nas`.
  - Adds `macro:fred:nas`.
  - Adds `audit:freshness`.

Current verified live KPI state:

```text
/api/kpi-summary
mode: live
stale: false
quoteFeed.status: configured
VIX: 18.18
Yield spread: 0.50
HY credit: 2.84
Oil: 92.14
Dollar: 98.119
Market stress: 0.1342
Transmission strength: 0.9794
```

Current audit state after article/backfill/cache closure:

```text
findings: 0
mirroredSignals: []
articleCount24h: 200
articleCount72h: 200
cacheIssues: 0
```

Resolved from the original audit:

- VIX copied-forward state.
- Dollar copied-forward state.
- Oil stale state.
- Yield spread copied-forward state.
- HY credit copied-forward state.
- Market stress stale/derived-from-stale state.
- Transmission strength stale state.
- Missing `market_quotes` table.
- Missing `fred_observations` table.
- Missing scheduled freshness audit.
- Article 24h/72h empty state.
- Historical automation stale artifact state.
- Cache audit false positives caused by explicit stale cache artifacts and legacy orphan cache keys.

Additional closure work:

- `scripts/fetch-gdelt-articles.mjs`
  - Parses compact GDELT `seendate` values such as `YYYYMMDDHHMMSS`.
  - Rehydrated the current article window with 200 NAS rows from the 2026-04-13+ GDELT pull.

- `scripts/audit-data-freshness.mjs`
  - Checks the newest historical automation artifacts by modification time after scanning the full tree.
  - Treats cache payloads already marked `stale=true` as visible stale states, not hidden freshness defects.
  - Ignores legacy route-inaccessible cache keys such as old `theme-brief--...--since-*` artifacts.

- `data/historical/automation/**`
  - A 10-day global-news refresh wrote current automation artifacts for global election, technology, oil, sanctions, and economy topics before the upstream fetch timed out.

Verified commands:

```text
node scripts/refresh-market-quotes-to-nas.mjs --symbols "^VIX,CL=F,DX-Y.NYB,^GSPC,^IXIC,^DJI,^TNX" --delay-ms 400
node scripts/refresh-fred-signals-to-nas.mjs --from 2026-04-01 --delay-ms 150
node --import tsx scripts/refresh-event-market-transmission.mjs --days 14 --limit 180
node scripts/fetch-gdelt-articles.mjs --from 2026-04-13 --limit 1000 --keywords conflict,economy,energy,tech,politics
node --import tsx scripts/fetch-historical-data.mjs global-news --days 10 --out-dir data/historical/automation
npm run audit:freshness
node --test tests/refresh-fred-signals-to-nas.test.mjs tests/refresh-market-quotes-to-nas.test.mjs tests/refresh-event-market-transmission.test.mjs tests/event-dashboard-freshness-contract.test.mjs tests/event-dashboard-trend-routes.test.mjs tests/theme-shell-snapshot-builders.test.mjs tests/trend-dashboard-queries-structural-alerts.test.mjs tests/fetch-gdelt-articles.test.mjs
npx playwright test e2e/inbox-actions.spec.ts --reporter=list
npm run build
```

Validation result:

```text
unit/route tests: 30 passed
Decision Inbox Playwright: 13 passed
production build: passed
freshness audit: 0 findings
```

## Product Direction Decision

The project should separate live operating data from backfill/research data.

Backfill data remains valuable for:

- replay validation
- research briefs
- structural trend context
- model calibration
- historical evidence

Backfill data should not directly drive:

- first-viewport live alerts
- current risk posture
- current market regime display
- "Today" or "Recent" language
- action queues without an explicit mode label

This is a product trust boundary. The model and data system can be strong, but the UI must tell the operator whether they are looking at current state, delayed data, replay evidence, fallback continuity, or historical reconstruction.
