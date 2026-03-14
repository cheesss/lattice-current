# API Key Gating & Registration — Deployment Guide

## Overview

Desktop cloud fallback is gated on a `WORLDMONITOR_API_KEY`. Without a valid key, the desktop app operates local-only (sidecar). A registration form collects emails via Convex DB for future key distribution.

## Architecture

```
Desktop App                          Cloud (Vercel)
┌──────────────────┐                ┌──────────────────────┐
│ fetch('/api/...')│                │ api/[domain]/v1/[rpc]│
│        │         │                │        │              │
│ ┌──────▼───────┐ │                │ ┌──────▼───────┐      │
│ │ sidecar try  │ │                │ │ validateApiKey│      │
│ │ (local-first)│ │                │ │ (origin-aware)│      │
│ └──────┬───────┘ │                │ └──────┬───────┘      │
│   fail │         │                │   401 if invalid      │
│ ┌──────▼───────┐ │   fallback    │                       │
│ │ WM key check │─┼──────────────►│ ┌──────────────┐      │
│ │ (gate)       │ │  +header      │ │ route handler │      │
│ └──────────────┘ │               │ └──────────────┘      │
└──────────────────┘               └──────────────────────┘
```

## Required Environment Variables

### Vercel

| Variable | Description | Example |
|----------|-------------|---------|
| `WORLDMONITOR_VALID_KEYS` | Comma-separated list of valid API keys | `wm_abc123def456,wm_xyz789` |
| `CONVEX_URL` | Convex deployment URL (from `npx convex deploy`) | `https://xyz-123.convex.cloud` |

### Generating API keys

Keys must be at least 16 characters (validated client-side). Recommended format:

```bash
# Generate a key
openssl rand -hex 24 | sed 's/^/wm_/'
# Example output: wm_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6
```

Add to `WORLDMONITOR_VALID_KEYS` in Vercel dashboard (comma-separated, no spaces).

## Convex Setup

### First-time deployment

```bash
# 1. Install (already in package.json)
npm install

# 2. Login to Convex
npx convex login

# 3. Initialize project (creates .env.local with CONVEX_URL)
npx convex init

# 4. Deploy schema and functions
npx convex deploy

# 5. Copy the deployment URL to Vercel env vars
# The URL is printed by `npx convex deploy` and saved in .env.local
```

### Verify Convex deployment

```bash
# Typecheck Convex functions
npx convex dev --typecheck

# Open Convex dashboard to see registrations
npx convex dashboard
```

### Schema

The `registrations` table stores:

| Field | Type | Description |
|-------|------|-------------|
| `email` | string | Original email (for display) |
| `normalizedEmail` | string | Lowercased email (for dedup) |
| `registeredAt` | number | Unix timestamp |
| `source` | string? | Where the registration came from |
| `appVersion` | string? | Desktop app version |

Indexed by `normalizedEmail` for duplicate detection.

## Security Model

### Client-side (desktop app)

- `installRuntimeFetchPatch()` checks `WORLDMONITOR_API_KEY` before allowing cloud fallback
- Key must be present AND valid (min 16 chars)
- `secretsReady` promise ensures secrets are loaded before first fetch (2s timeout)
- Fail-closed: any error in key check blocks cloud fallback

### Server-side (Vercel edge)

- `api/_api-key.js` validates `X-WorldMonitor-Key` header on sebuf routes
- **Origin-aware**: desktop origins (`tauri.localhost`, `tauri://`, `asset://`) require a key
- Web origins (`worldmonitor.app`) pass through without a key
- Non-desktop origin with key header: key is still validated
- Invalid key returns `401 { error: "Invalid API key" }`

### CORS

`X-WorldMonitor-Key` is allowed in both `server/cors.ts` and `api/_cors.js`.

## Verification Checklist

After deployment:

- [ ] Set `WORLDMONITOR_VALID_KEYS` in Vercel
- [ ] Set `CONVEX_URL` in Vercel
- [ ] Run `npx convex deploy` to push schema
- [ ] Desktop without key: cloud fallback blocked (console shows `cloud fallback blocked`)
- [ ] Desktop with invalid key: sebuf requests get `401`
- [ ] Desktop with valid key: cloud fallback works as before
- [ ] Web access: no key required, works normally
- [ ] Registration form: submit email, check Convex dashboard
- [ ] Duplicate email: shows "already registered"
- [ ] Existing settings tabs (LLMs, API Keys, Debug) unchanged

## Files Reference

| File | Role |
|------|------|
| `src/services/runtime.ts` | Client-side key gate + header attachment |
| `src/services/runtime-config.ts` | `WORLDMONITOR_API_KEY` type, validation, `secretsReady` |
| `api/_api-key.js` | Server-side key validation (origin-aware) |
| `api/[domain]/v1/[rpc].ts` | Sebuf gateway — calls `validateApiKey` |
| `api/register-interest.js` | Registration endpoint → Convex |
| `server/cors.ts` / `api/_cors.js` | CORS headers with `X-WorldMonitor-Key` |
| `src/components/WorldMonitorTab.ts` | Settings UI for key + registration |
| `convex/schema.ts` | Convex DB schema |
| `convex/registerInterest.ts` | Convex mutation |

---

## Applied Integration Addendum (2026-03-04)

This section documents the newly applied integrations discussed during implementation.

### 1) PortWatch (IMF ArcGIS) Integration

Implemented:

- New service: `src/services/portwatch.ts`
  - Pulls public ArcGIS datasets:
    - `portwatch_disruptions_database`
    - `Daily_Chokepoints_Data`
    - `Daily_Trade_Data_REG`
  - Normalizes responses into:
    - `PortWatchDisruption[]`
    - `PortWatchChokepointSnapshot[]`
    - `PortWatchRegionalTradeSnapshot[]`
  - Exposes `fetchPortWatchSnapshot()`
  - Exposes `toPortWatchAisOverlays()` to convert PortWatch data into map-ready AIS overlay types.

- Data loader wiring: `src/app/data-loader.ts`
  - `loadSupplyChain()` now fetches PortWatch alongside supply-chain feeds.
  - PortWatch overlays are merged into AIS map rendering path.
  - If AIS layer is enabled, AIS rendering is refreshed after PortWatch ingestion.

- Status/Freshness:
  - Status API list includes `PortWatch`: `src/components/StatusPanel.ts`
  - Data freshness source added: `portwatch` in `src/services/data-freshness.ts`
  - AIS layer-to-source mapping now includes PortWatch: `src/config/panels.ts`

Operational notes:

- PortWatch currently uses public endpoints (no API key required in this implementation).
- If upstream is unavailable, existing overlays can continue from cache and status is set to warning/error accordingly.

### 2) Military Flight De-clutter Policy (Globe + SVG)

Problem addressed:

- Rendering every tracked aircraft at once causes visual overload and reduced usability.

Implemented:

- DeckGL map de-clutter in `src/components/DeckGLMap.ts`
- SVG fallback de-clutter in `src/components/Map.ts`

Policy:

- Dynamic marker budget by zoom:
  - low zoom: strict cap (focus on most relevant flights)
  - medium zoom: baseline cap
  - high zoom: expanded cap
- Ranking prioritizes:
  - `isInteresting`
  - confidence (`high` / `medium`)
  - strategic aircraft types (`bomber`, `reconnaissance`, `awacs`)
  - speed/altitude contribution

Config:

- Optional env knob:
  - `VITE_MILITARY_FLIGHTS_MAX_MARKERS`
  - default fallback is applied when unset.

### 3) Existing Source Coverage Alignment

Current coverage after this update:

- AIS vessel activity: already integrated (relay + snapshot pipeline)
- OpenSky military flights: already integrated
- GDELT document intelligence: already integrated (RPC-backed)
- PortWatch maritime disruptions/chokepoints: now integrated and visualized via AIS overlay path

### 4) Deployment/Runtime Impact

- No new mandatory secret for PortWatch.
- Existing secret requirements for AIS/OpenSky remain unchanged.
- If desktop runs with missing upstream credentials:
  - system continues with fallback behavior
  - status panels and freshness indicators reflect degraded source health.

### 5) CII Security Scoring Upgrade (AIS/PortWatch)

Implemented:

- New ingest path in `src/services/country-instability.ts`:
  - `ingestAisForCII(disruptions, density)`
  - Consumes merged AIS disruptions + density zones (including PortWatch overlays)
  - Maps events to countries by coordinates + title/entity hints
  - Applies dedupe TTL to avoid repeated polling over-count

- Security score formula update:
  - Added maritime factors:
    - `maritimeDisruptions`
    - `maritimeDensityStress`
  - Added cross-domain boost when maritime anomalies and military activity co-occur

- Data loader integration:
  - `loadAisSignals()` now calls `ingestAisForCII(...)`
  - CII panel refresh is debounced after new maritime ingest

Operational effect:

- CII now reacts to shipping chokepoint congestion, dark-ship-like anomaly bursts, and maritime density stress signals, not only land/air conflict feeds.

### 6) News Relationship + Air/Sea Correlation Layer

Implemented:

- New service: `src/services/news-event-relations.ts`
  - Maintains latest event snapshot:
    - military flights
    - military vessels
    - AIS disruptions
    - AIS density zones
  - Uses rolling memory windows (not single latest tick only):
    - flights: 12h
    - vessels: 18h
    - disruptions: 24h
    - density: 8h
  - `annotateClustersWithRelations(clusters)` enriches each news cluster with:
    - related-news links (cluster-to-cluster similarity graph)
    - air-event match count
    - maritime-event match count
    - confidence score + evidence strings
  - Uses dynamic thresholds/radii:
    - adaptive cluster-link threshold by source count, alert flag, country overlap, and recency
    - adaptive geo radius by domain keyword match (`air`/`sea`) and source count
  - Adds normalized entity matching:
    - chokepoint aliases (e.g. Hormuz/Suez/Bab el-Mandeb)
    - domain/entity aliases (`air:*`, `sea:*`)
    - country normalization to ISO2 where possible

- Loader wiring:
  - Event snapshots updated in:
    - `loadMilitary()`
    - `loadAisSignals()`
  - Global clusters are relation-annotated in:
    - `loadNews()`
    - `runCorrelationAnalysis()` fallback clustering path

- UI rendering:
  - `src/components/NewsPanel.ts` now displays relation chips:
    - `NEWS n`
    - `AIR n`
    - `SEA n`
    - `CONF n`
  - Top evidence hint is shown inline per cluster card

Operational effect:

- Analysts can see not only headline content but also whether the story is corroborated by other stories and by concurrent maritime/air operational signals.
