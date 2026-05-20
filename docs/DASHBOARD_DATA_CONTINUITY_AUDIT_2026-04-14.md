# Dashboard Data Continuity Audit (2026-04-14)

> **Status**: P0 resolved · P1 resolved (structural alerts, transmission freshness) · P1 partial (today fallback label, digest empty state, stale badges) · P2 open  
> **Last updated**: 2026-04-15

This audit documents dashboard-level data continuity issues found while inspecting the active theme shell and its backing APIs on 2026-04-14.

The goal is to separate three cases:

1. Data is genuinely missing.
2. Data exists, but the dashboard surface is reading an older or different corpus.
3. Data exists and is current, but the UI does not disclose fallback/stale mode clearly enough.

---

## Resolution Summary (as of 2026-04-15)

| # | Issue | Priority | Status |
|---|-------|----------|--------|
| 1 | Emerging topic article binding stuck in 2025 | P0 | **Resolved** — P0 article binding shipped |
| 2 | `today` fallback hidden as normal mode | P1 | **Partially resolved** — stale/fallback badges added; label wording still generic |
| 3 | `Articles today = 0` vs non-empty fallback feed | P1 | **Partially resolved** — fallback badge present; KPI/feed source alignment still in progress |
| 4 | Daily digest shows no items despite large article volume | P1 | **Partially resolved** — empty state distinguishes fallback vs unavailable |
| 5 | Structural alerts empty in one surface, present in another | P1 | **Resolved** — verified via local API: structural 8 items and risk highlights 4 items use same period/theme ordering. No longer contradictory. |
| 6 | Investment snapshot wrapper fresh, internals null/old | P1 | **Partially resolved** — `buildFreshnessFields()` propagates oldest internal timestamp; stale badge shown when internals lag |
| 7 | Validation snapshot old, not shown as old | P1 | **Resolved** — stale badge shown when `updatedAt` older than SLA threshold |
| 8 | Transmission freshness inconsistent across layers | P1 | **Resolved** — verified: `transmission.fresh=true`, `geoPressure.transmissionFresh=true`, both `freshnessHours=20.1`, `stale: false`. Tests pass. |
| 9 | Source Ops and Codex quality materially older | P2 | Open — strong stale badge on Source Ops card is in place; Codex quality cadence still slow |

---

## What Was Confirmed Healthy

The following surfaces show 2026 data and are not globally broken:

- `reports/latest` — generation timestamps reach 2026-04-14
- `emerging-tech` — topic `updatedAt` values reach 2026-04-13
- `today` — events present with `publishedAt` in 2026-04-10
- `theme-brief/climate-change` — article evidence from 2026-04-06 to 2026-04-07
- `theme-brief/materials-science` — article evidence from 2026-04-07
- `signals/history` — VIX history reaches 2026-04-14
- `heatmap` — `updatedAt` reaches 2026-04-14
- `whatif` — `updatedAt` reaches 2026-04-14
- `map-lens-overlays` — `updatedAt` reaches 2026-04-14

---

## Issue Detail

### 1. Emerging topic article binding (P0) — RESOLVED

**Original symptom**: `topic.updatedAt` = 2026-04-13, but `articles[]` top out at 2025-12.

**Resolution**: Article binding rebuilt so recent linked articles surface correctly. UI shows "Latest linked article" separately from "recent" corpus when gap exists.

---

### 2. `today` feed fallback visibility (P1) — PARTIALLY RESOLVED

**Original symptom**: `meta.window = "7d-fallback"`, overwhelmingly arxiv, `theme: unknown` — presented like a live-events feed.

**Current state**: Fallback badge added. Feed label still says "Today's Events" even in fallback mode.

**Remaining**: Change label to "Recent Events (7d fallback)" or similar when `meta.window !== "24h"`.

---

### 3. `Articles today = 0` vs non-empty fallback (P1) — PARTIALLY RESOLVED

**Current state**: Fallback mode badge shown. KPI counts and feed source still draw from slightly different corpora.

**Remaining**: Align KPI count source with the same ingestion class the `today` feed uses.

---

### 4. Daily digest empty state (P1) — PARTIALLY RESOLVED

**Current state**: Empty state now distinguishes `no digest items` vs `fallback mode` vs `unavailable`.

**Remaining**: Surface `source = "article_fallback_72h"` explicitly in the digest header.

---

### 5. Structural alerts source-of-truth (P1) — RESOLVED

**Original symptom**: `/api/structural-alerts?period=quarter` returned `items: []` while `risk.highlights` had multiple alerts.

**Resolution**: Both surfaces now use the same `period` parameter. Structural alert computation and risk snapshot highlight selection share the same underlying alert set — risk shows top 4 from the same ordered list. Verified via local API comparison: structural 8 items, risk highlights 4 items, same leading themes, no contradictions.

---

### 6. Investment snapshot partial hydration (P1) — PARTIALLY RESOLVED

**Original symptom**: `investment.generatedAt` fresh but `signalRuntime = null`, `experimentRegistry = null`.

**Resolution**: `buildFreshnessFields()` added to all 7 snapshot builders — exposes `oldestInternalUpdatedAt` so UI prefers internal timestamp over wrapper `generatedAt`. Stale badge shown when internal lag exceeds SLA.

**Remaining**: `signalRuntime` and `experimentRegistry` hydration depends on runtime pipeline frequency. Not a UI fix.

---

### 7. Validation snapshot age (P1) — RESOLVED

**Original symptom**: `validation.updatedAt = 2026-04-05`, card rendered as active.

**Resolution**: Stale badge appears when `updatedAt` older than 48h threshold. `snapshotStaleBadge()` now prefers `oldestInternalUpdatedAt` over wrapper timestamp.

---

### 8. Transmission freshness inconsistency (P1) — RESOLVED

**Original symptom**: `fresh = false`, `freshnessHours ≈ 365`, source `updatedAt = 2026-03-30`, but nested source meta still `stale: false`.

**Resolution**: Verified via local API (2026-04-15): `transmission.fresh = true`, `geoPressure.transmissionFresh = true`, both `freshnessHours = 20.1`, `stale: false` at all layers. `edgeEventIdentity()` composite key replaced title-only deduplication. Transmission freshness tests pass.

---

### 9. Source Ops and Codex quality lag (P2) — OPEN

**Current state**: Strong stale badge on Source Ops card when `generatedAt` > 48h old. Codex quality cadence still produces updates ~every 4–7 days.

**Remaining**: Accelerate Codex quality refresh interval in daemon schedule, or add explicit "last updated N days ago" label to the Codex panel.

---

## Root Cause Patterns (historical reference)

### Pattern A: Fresh wrapper, stale body

Examples: Selected Topic, validation wrapper, source ops wrapper.  
**Fix applied**: `buildFreshnessFields()` propagates oldest internal timestamp to all snapshot builders.

### Pattern B: Fallback mode hidden as normal mode

Examples: `today`, `daily-digest`.  
**Fix applied**: Stale/fallback badges added. Explicit label updates pending.

### Pattern C: Parallel surfaces disagree

Examples: structural alerts vs risk.highlights, transmission freshness flags.  
**Fix applied**: Unified period parameter, `edgeEventIdentity()` for transmission deduplication. Both verified resolved.

---

## Remaining Acceptance Criteria

The following are not yet fully met:

- [ ] `today` label clearly says "7-day fallback" (not just badge) when `meta.window !== "24h"`
- [ ] `daily-digest` header shows source name (`"article_fallback_72h"`) in fallback mode
- [ ] KPI `Articles today` count aligned with `today` feed ingestion class
- [ ] Codex quality refresh cadence increased or lag label added
