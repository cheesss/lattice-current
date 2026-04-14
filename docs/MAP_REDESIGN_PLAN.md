# Map Redesign Plan

## Goal

Turn the current 2D geo lens into the primary spatial surface for the theme shell without bringing back the heavy globe runtime.

## Priorities

### 1. Map size expansion + collapsible overlays

Status: implemented

- Increase the parent `iframe` height from `72vh` to `85vh`.
- Keep mobile height smaller but still larger than the current baseline.
- Add an overlay collapse button so operators can quickly reclaim the map canvas.
- Persist overlay collapsed state in `localStorage`.

Files:
- `/Users/chohj/Documents/Playground/lattice-current-fix/event-dashboard.html`
- `/Users/chohj/Documents/Playground/lattice-current-fix/event-map-lens.html`
- `/Users/chohj/Documents/Playground/lattice-current-fix/src/theme-map-lens.ts`

### 2. Layer LOD (zoom-aware automatic ON/OFF)

Status: implemented

- Apply zoom thresholds to the expensive infrastructure, finance, protest, AIS, military, climate, and trade-route layers.
- Keep global zoom focused on broad risk context.
- Delay dense point and path layers until regional/local zoom.
- Preserve manual toggles while making the render path cheaper.

Expected effect:
- noticeably lower layer count at world zoom
- lower GPU/CPU pressure
- less visual clutter

Primary file:
- `/Users/chohj/Documents/Playground/lattice-current-fix/src/components/DeckGLMap.ts`

### 3. Event hotspots + E2 signal markers

Status: implemented

- Add a dashboard API payload dedicated to map overlays.
- Surface recent canonical events as map hotspots.
- Surface `E2` uplift rows as distinct signal markers.
- Feed both into the map lens as visible overlays instead of leaving them only in cards and tables.

Files:
- `/Users/chohj/Documents/Playground/lattice-current-fix/scripts/event-dashboard-api.mjs`
- `/Users/chohj/Documents/Playground/lattice-current-fix/src/theme-map-lens.ts`
- `/Users/chohj/Documents/Playground/lattice-current-fix/src/components/DeckGLMap.ts`

### 4. Theme filter bar + time slider

Status: implemented

- Add quick filters for `All / Conflict / Macro / Tech / Energy / Climate`.
- Add a time window slider for `Week / Month / Quarter / Year`.
- Make filter state local to the lens so the operator can narrow the map without disturbing the full briefing page state.

Files:
- `/Users/chohj/Documents/Playground/lattice-current-fix/event-map-lens.html`
- `/Users/chohj/Documents/Playground/lattice-current-fix/src/theme-map-lens.ts`

### 5. Transmission arcs + relationship mode

Status: implemented

- Add a relationship mode toggle in the lens toolbar.
- When enabled, emphasize:
  - country interaction arcs
  - transmission overlay arcs
  - supporting trade/waterway/economic context layers
- Keep the default mode simpler for everyday scanning.

Files:
- `/Users/chohj/Documents/Playground/lattice-current-fix/src/theme-map-lens.ts`
- `/Users/chohj/Documents/Playground/lattice-current-fix/src/components/DeckGLMap.ts`
- `/Users/chohj/Documents/Playground/lattice-current-fix/scripts/event-dashboard-api.mjs`

## Implementation notes

- The redesign intentionally keeps the globe removed.
- The redesign uses the existing `DeckGLMap` engine instead of introducing a parallel map stack.
- Transmission arcs currently use cached event-market transmission data plus spatial anchor inference, which is lighter and safer than rebuilding a new geocoding pipeline in the UI path.
- Event hotspot and `E2` marker overlays are cached API payloads so the map does not depend on heavy live recomputation on every interaction.

## Remaining follow-up

- tighten anchor inference for event-to-location mapping
- replace inferred transmission targets with asset- or venue-level coordinates when those connectors are available
- add focused visual regression tests for the lens toolbar and collapsed overlay state
