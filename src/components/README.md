# Components Guide

This folder contains the visible UI surfaces of the product.

## Component categories

### 1. Core shell and panel primitives

- `Panel.ts`
  - shared panel chrome and interaction contract
- `MapContainer.ts`, `Map.ts`, `MapPopup.ts`
  - map container surfaces and popup plumbing
- `SearchModal.ts`, `StoryModal.ts`, `SignalModal.ts`
  - modal surfaces

### 2. Main dashboard panels

These are the grid-mounted surfaces that make up the primary workspace.

Examples:

- `DataFlowOpsPanel.ts`
- `RuntimeConfigPanel.ts`
- `MarketPanel.ts`
- `EconomicPanel.ts`
- `SupplyChainPanel.ts`
- `ServiceStatusPanel.ts`

### 3. Hub and workspace pages

These are full overlay or workspace-style surfaces rather than small dashboard tiles.

Examples:

- `AnalysisHubPage.ts`
- `CodexHubPage.ts`
- `OntologyGraphPage.ts`
- `BacktestLabPanel.ts` together with `src/backtest-hub-window.ts`

### 4. Map-heavy surfaces

Examples:

- `DeckGLMap.ts`
- `GlobeMap.ts`
- `CountryDeepDivePanel.ts`
- `CountryTimeline.ts`

These components tend to be state-heavy and visually expensive.

## Highest-value files

- `DeckGLMap.ts`
  - 2D map rendering, interactions, overlays, arcs, and layer orchestration
- `GlobeMap.ts`
  - globe-specific rendering and 2D/3D parity behavior
- `BacktestLabPanel.ts`
  - replay/import controls and embedded replay review surface
- `DataFlowOpsPanel.ts`
  - operator-facing pipeline, coverage, and blocker view
- `UnifiedSettings.ts`
  - settings workspace

## Design philosophy

- Panels should stay presentation-oriented.
- Heavy computation belongs in `src/services/`.
- Shared chrome or interaction logic belongs in common panel/map/modal primitives.
- If a component starts owning long-lived business state, move that state to a service or orchestration layer.

## Common failure modes

- A panel looks empty because upstream service state is empty, not because the panel is broken.
- A hub works in desktop mode but not browser mode due to local sidecar/runtime differences.
- Map bugs often come from interaction state or layer wiring, not CSS.

## Before editing a component

Check:

1. which service feeds it
2. whether the panel is embedded or hub-only
3. whether browser mode and desktop mode differ for that surface
