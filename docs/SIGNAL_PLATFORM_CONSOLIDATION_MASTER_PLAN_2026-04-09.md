# Signal Platform Consolidation Master Plan

Date: 2026-04-09
Status: Active restructuring directive
Scope: Entire product surface, including panels, map/globe, runtime, sidecar behavior, workspaces, and non-core experimental surfaces

## 1. Product decision

Lattice Current should stop behaving like a globe-centric command center with many adjacent dashboards and become a lighter signal analysis platform.

The target product is:

- a signal-first operator workspace
- evidence-first, provenance-first, decision-support oriented
- geo-aware but not globe-centric
- theme-aware but not split into a separate standalone app
- validation-capable without making replay the primary surface

The new primary user loop is:

1. detect the most material live signal
2. explain why it matters
3. connect it to theme, geography, and exposures
4. decide whether to follow, escalate, or validate
5. validate only when the signal is important enough

This means the product center moves away from:

- always-on 3D globe rendering
- dozens of standalone side panels
- source-category news silos as first-class UI
- UI-triggered background automation and collection

And moves toward:

- one canonical signal feed
- one canonical signal brief
- one canonical country/region lens
- one canonical watch and alert flow
- one advanced validation workspace
- one internal operations workspace

## 2. End-state information architecture

The final product should have five surfaces only.

### 2.1 Signals

Primary landing surface.

Contains:

- prioritized live signals
- signal severity and confidence
- top evidence and provenance
- linked theme(s)
- linked geography
- linked market or operational exposure
- direct actions: follow, escalate, validate, dismiss

### 2.2 Brief

Focused explanation surface for the selected signal or theme.

Contains:

- what changed
- why it matters
- transmission path
- affected countries and regions
- affected assets, sectors, or instruments
- source quality and evidence classes
- related historical context

### 2.3 Watch

Persistent operator workspace for saved themes, countries, and alerts.

Contains:

- followed signals
- followed themes
- followed countries/regions
- structural alerts
- watchpoint state changes
- operator notes and ownership

### 2.4 Validate

Advanced workspace only.

Contains:

- replay and backtest tools
- adaptation diagnostics
- candidate review
- validation logs and run history

### 2.5 Operate

Internal service and data health workspace only.

Contains:

- data freshness
- source operations
- runtime configuration
- resource telemetry
- automation and QA

Everything else must either be absorbed into one of these five surfaces, re-homed as an internal page, or archived.

## 3. Current surface inventory

Current top-level product surfaces and runtime shells:

- main React app shell in `src/App.ts`
- heavy map shell via `src/components/MapContainer.ts`, `src/components/DeckGLMap.ts`, `src/components/GlobeMap.ts`
- standalone theme/trend shell in `event-dashboard.html`
- standalone validation hub in `src/backtest-hub-window.ts`
- standalone live channel manager in `src/live-channels-window.ts`
- extra internal pages in `src/app/panel-layout.ts`
  - `AnalysisHubPage`
  - `CodexHubPage`
  - `OntologyGraphPage`

Current product sprawl problems:

- one product identity is split across globe shell and theme shell
- many panels duplicate the same operator intent using different visual languages
- source categories are shown as panels instead of being normalized into signals
- hidden or secondary panels still create runtime and refresh cost
- Tauri desktop startup can launch sidecar and additional child Node processes
- data collection, data serving, and operator UI are coupled too tightly

## 4. Canonical disposition rules

Every current panel or feature must be classified into one of five actions.

- `Absorb-Core`: keep and merge into Signals, Brief, or Watch
- `Absorb-Advanced`: keep but move into Validate or Operate only
- `Re-home-Source`: keep the data/source logic, remove the standalone panel
- `Archive-Pack`: remove from the core product but preserve as optional vertical or legacy package
- `Delete`: remove entirely after dependency check

## 5. Panel-by-panel consolidation plan

This section is the canonical disposition table for the entire current panel inventory.

### 5.1 Core panels to absorb into the new primary product

These survive, but not as standalone tiles.

#### Signals surface

- `live-news` -> `Signals Feed`
  - Role now: top live headline stream
  - Action: `Absorb-Core`
  - New form: ranked signal list with source, severity, confidence, theme, region

- `event-intelligence` -> `Signal Explain`
  - Role now: event grouping and interpretation
  - Action: `Absorb-Core`
  - New form: right-hand explain panel on selected signal

- `insights` -> `Signal Brief Summary`
  - Role now: narrative summarization
  - Action: `Absorb-Core`
  - New form: summary block inside Brief

- `macro-signals` -> `Regime Header`
  - Role now: macro pressure context
  - Action: `Absorb-Core`
  - New form: top-of-screen regime strip

- `gdelt-intel` -> `Signal Intake Enrichment`
  - Role now: live intelligence stream
  - Action: `Absorb-Core`
  - New form: source lane inside Signals Feed, not separate panel

- `cascade` -> `Transmission Section`
  - Role now: infrastructure cascade framing
  - Action: `Absorb-Core`
  - New form: one section inside Brief called `Transmission`

#### Brief and country lens

- `strategic-posture` -> `Country Lens / Pressure`
  - Action: `Absorb-Core`

- `strategic-risk` -> `Country Lens / Risk`
  - Action: `Absorb-Core`

- `cii` -> `Country Lens / Instability`
  - Action: `Absorb-Core`

- `population-exposure` -> `Impact Summary`
  - Action: `Absorb-Core`

- `ucdp-events` -> `Conflict Evidence`
  - Action: `Absorb-Core`

- `displacement` -> `Human Impact Evidence`
  - Action: `Absorb-Core`

- `climate` -> `Climate Impact Evidence`
  - Action: `Absorb-Core`

- `satellite-fires` -> `Operational Risk Evidence`
  - Action: `Absorb-Core`

- `CountryDeepDivePanel` and country brief surfaces -> `Country Drawer`
  - Action: `Absorb-Core`
  - New form: slide-over country lens, not a separate legacy page

#### Watch and action flow

- `monitors` -> `Watchlists`
  - Action: `Absorb-Core`

- `investment-workflow` -> `Operator Actions`
  - Action: `Absorb-Core`

- `investment-ideas` -> `Signal Candidates`
  - Action: `Absorb-Core`

- `transmission-sankey` -> `Advanced Explain`
  - Action: `Absorb-Core`
  - New form: expandable explainability view, not default card

- `signal-ridgeline` -> `Signal History`
  - Action: `Absorb-Core`
  - New form: historical context drawer for a selected signal or theme

### 5.2 Market and exposure panels to absorb into a single market impact module

These remain useful, but must stop existing as separate dashboard tiles.

- `markets`
- `commodities`
- `crypto`
- `economic`
- `heatmap`
- `cross-asset-tape`
- `event-impact-screener`
- `country-exposure-matrix`
- `trade-policy`
- `supply-chain`
- `polymarket`
- `etf-flows`
- `stablecoins`

Action: `Absorb-Core`

New form:

- one `Market Impact` block inside Brief
- one `Exposure` tab inside Brief
- one `Cross-Asset Confirmation` block in Validate

Rules:

- no separate `markets` page on default boot
- no more standalone tiles for narrow data products
- `polymarket`, `etf-flows`, and `stablecoins` become optional enrichment cards, never top-level panels

### 5.3 Source-category panels to collapse into source filters, not standalone UI

These do not represent product objects. They represent feed partitions and source baskets.

Action for all below: `Re-home-Source`

Current panels:

- `politics`
- `intel`
- `glint-feed`
- `events`
- `us`
- `europe`
- `middleeast`
- `africa`
- `latam`
- `asia`
- `energy`
- `gov`
- `thinktanks`
- `tech`
- `finance`
- `ai`
- `startups`
- `vcblogs`
- `regionalStartups`
- `unicorns`
- `accelerators`
- `funding`
- `producthunt`
- `security`
- `policy`
- `hardware`
- `cloud`
- `dev`
- `github`
- `ipo`
- `markets-news`
- `commodities-news`
- `crypto-news`
- `economic-news`
- `forex`
- `bonds`
- `centralbanks`
- `analysis`
- `fintech`
- `regulation`
- `institutional`
- `gccNews`
- `gold-silver`
- `mining-news`
- `critical-minerals`
- `base-metals`
- `mining-companies`
- `commodity-news`

New form:

- source filter chips
- source taxonomy in a `Sources` drawer
- saved source bundles for power users
- source quality and reliability shown inside the signal brief

These must never again be primary dashboard panels in the core product.

### 5.4 Internal operations panels that must survive, but only in Operate

Action: `Absorb-Advanced`

Panels:

- `data-qa`
- `source-ops`
- `codex-ops`
- `dataflow-ops`
- `runtime-config`
- `resource-profiler`
- `service-status`
- `tech-readiness`

Additional internal pages:

- `AnalysisHubPage`
- `CodexHubPage`
- `OntologyGraphPage`

Rules:

- no default visibility in Signals, Brief, or Watch
- no background refresh unless Operate is open
- keep accessible behind explicit internal navigation only

### 5.5 Validation and replay surfaces to preserve as advanced-only

Action: `Absorb-Advanced`

Panels and windows:

- `backtest-lab`
- standalone validation hub in `src/backtest-hub-window.ts`

Rules:

- keep one `Validate` workspace
- remove standalone validation identity from the product narrative
- validation is entered from a selected signal, theme, or watch item
- validation never becomes the home screen

### 5.6 Surfaces to archive into optional packs, not core product

These are real work, but they are not part of the target signal-analysis wedge.

Action: `Archive-Pack`

#### Positive/progress pack

- `positive-feed`
- `progress`
- `counters`
- `spotlight`
- `breakthroughs`
- `digest`
- `species`
- `renewable`
- `giving`

Rationale:

- valuable long-horizon and constructive data
- incompatible with the core signal-intelligence wedge
- should become an optional `Long Horizon` pack or separate branch

#### Vertical or niche packs

- `gcc-investments`
- `gulf-economies` class lineage
- commodity-only editorial clusters
- finance-only editorial clusters
- builder-only editorial clusters

Rationale:

- these are wedge-specific vertical add-ons
- they should become packaged source bundles or paid vertical packs, not core surface area

### 5.7 Panels and utilities to archive or delete after dependency audit

These currently exist in the tree but are not core to the future product.

Default action: `Archive-Pack`, then `Delete` if no active owner remains.

Candidate legacy or experimental panels:

- `GovernanceDashboardPanel`
- `PipelineMonitorPanel`
- `GeoHubsPanel`
- `TechHubsPanel`
- `OrefSirensPanel`
- `MLResourcePanel`
- `DeductionPanel`
- `WorldClockPanel`
- `RegulationPanel` class implementation
- `GulfEconomiesPanel`
- `AirlineIntelPanel`

Rules:

- move them out of the main product export path
- keep only if a named owner and named operator use case exists
- otherwise archive under a legacy or experiments folder and remove from default bundle

### 5.8 Panels to remove from the core signal platform entirely

Action: `Delete`

- `live-webcams`
- standalone live channel management in `src/live-channels-window.ts`

Rationale:

- live video channel management is a different product problem
- it adds surface area without improving signal interpretation quality

## 6. Feature-level consolidation plan

Panels are only one layer. The feature model also needs a disposition plan.

### 6.1 Globe and heavy map rendering

Current:

- `GlobeMap`
- `DeckGLMap`
- `MapContainer`
- dozens of raw geospatial layers

Decision:

- remove globe and deck.gl from default boot path
- keep geospatial reasoning, country geometry, and impact computation
- replace full-screen globe with lightweight geo context

New geo model:

- region chip
- country drawer
- small 2D mini-map
- affected-country list
- impact heat strip
- optional advanced map route for expert users only

### 6.2 Map-layer inventory disposition

#### Keep as structured signal inputs

- `conflicts`
- `hotspots`
- `sanctions`
- `weather`
- `outages`
- `natural`
- `fires`
- `ucdpEvents`
- `displacement`
- `climate`
- `tradeRoutes`
- `gpsJamming`
- `ais`
- `cables`
- `pipelines`
- `waterways`
- `iranAttacks`
- `techEvents`

These become evidence lanes and geo impact enrichments, not persistent toggle-heavy UI layers.

#### Keep only as advanced enrichment

- `bases`
- `nuclear`
- `irradiators`
- `datacenters`
- `protests`
- `flights`
- `military`
- `spaceports`
- `minerals`
- `startupHubs`
- `cloudRegions`
- `accelerators`
- `techHQs`
- `stockExchanges`
- `financialCenters`
- `centralBanks`
- `commodityHubs`
- `gulfInvestments`
- `miningSites`
- `processingPlants`
- `commodityPorts`
- `positiveEvents`
- `kindness`
- `happiness`
- `speciesRecovery`
- `renewableInstallations`
- `ciiChoropleth`
- `dayNight`
- `intelDensity`

These remain available only for expert analysis or packaged verticals.

### 6.3 Theme workspace

Current:

- standalone `event-dashboard.html`
- separate theme-intelligence identity

Decision:

- themes stay
- standalone HTML identity does not

New form:

- theme becomes a first-class object inside Brief and Watch
- the theme brief is opened from selected signals and watch items
- the standalone trend page is migrated into the main shell and then retired

### 6.4 Workspaces

Current workspaces in `src/config/workspaces.ts`:

- `signals`
- `brief`
- `watch`
- `validate`
- `operate`

Legacy aliases still accepted for migration:

- `overview` -> `signals`
- `intelligence` -> `brief`
- `investing` -> `validate`
- `builders` -> `signals`
- `operations` -> `operate`
- `progress` -> `watch`
- `all` -> `signals`

### 6.5 Variants

Current variants:

- `full`
- `tech`
- `finance`
- `happy`
- `commodity`

Decision:

- collapse product identity to one primary platform
- variants become source packs, persona presets, or premium vertical bundles

Target:

- one default signal platform
- optional packs:
  - geopolitical pack
  - tech/builders pack
  - finance pack
  - commodity pack
  - long-horizon/progress pack

## 7. Runtime and Node process separation plan

The UI must stop behaving like a collector daemon launcher.

### 7.1 Current issue

On desktop startup, Tauri launches a Node sidecar. The sidecar can then launch:

- `scripts/intelligence-scheduler.mjs --once`
- `scripts/data-accumulator.mjs`

This makes UI startup heavier than it should be and couples operator usage with background collection.

### 7.2 Required end state

The UI process should only do:

- render the product
- read data
- write operator state
- call APIs

It should not automatically become the system scheduler.

### 7.3 Runtime policy

#### UI runtime keeps

- secrets access
- cache access
- authenticated local proxy
- local read APIs needed by the product

#### UI runtime loses

- automatic intelligence scheduler startup
- automatic accumulator startup
- implicit background collection on desktop open

#### Background services move to dedicated operations runtime

- `master-daemon.mjs`
- `intelligence-scheduler.mjs`
- `data-accumulator.mjs`
- NAS sync and backfill jobs

These should be run by:

- PM2
- Windows Task Scheduler
- system service
- managed backend worker

But not by the UI boot path.

## 8. UI/UX unification rules

This is mandatory. The current system feels like several products because it is visually and structurally fragmented.

### 8.1 Canonical object model

The UI should expose only these top-level objects:

- `Signal`
- `Theme`
- `Country/Region`
- `Evidence`
- `Alert`
- `ValidationResult`

Panels, feed names, and layer names are implementation details, not primary UX objects.

### 8.2 Canonical layout

Default layout:

- top bar: search, time range, region, theme, confidence filter
- left rail: signals list and alert queue
- center: selected signal brief
- right rail: evidence, impact, related themes, actions
- optional lower section: history and validation summary

No more cockpit grid as the default product experience.

### 8.3 Canonical design language

Rules:

- one card system
- one chip system
- one severity system
- one evidence score visual
- one empty state language
- one action language

No surface should look like a separate micro-product.

### 8.4 Source UX

Sources should show up as:

- provenance rows
- evidence classes
- source quality badges
- source filter drawer

Sources should not show up as the main way a user navigates the product.

## 9. Data and service architecture changes

### 9.1 Build a normalized signal API layer

Introduce a service layer that emits:

- `SignalSnapshot`
- `SignalBrief`
- `CountryLens`
- `WatchSummary`
- `ValidationSummary`

This sits between raw loaders and the UI.

### 9.2 Stop binding UI directly to raw panel refresh logic

Current issue:

- many refresh loops are attached to panel existence
- hidden or secondary surfaces still consume resources

Required change:

- refresh based on active workspace and active module only
- lazy-load heavy modules
- suspend non-visible advanced modules completely

### 9.3 Canonical data pipeline split

Layers:

1. Collection
2. Normalization
3. Signal synthesis
4. Brief generation
5. Operator storage
6. Validation

The UI should consume layers 3 to 5, not orchestrate layer 1 directly.

## 10. File-level implementation plan

### 10.1 New primary product shell

Primary files to create or reshape:

- `src/App.ts`
- `src/config/workspaces.ts`
- `src/app/panel-layout.ts`
- `src/app/event-handlers.ts`
- `src/app/data-loader.ts`
- `src/services/operator-context.ts`
- `src/services/intelligence-fabric.ts`

Goal:

- replace the current workspace and grid assumptions with the five-surface signal shell

### 10.2 New normalized service layer

Files to add:

- `src/services/signal-snapshot.ts`
- `src/services/signal-brief.ts`
- `src/services/country-lens.ts`
- `src/services/watch-summary.ts`
- `src/services/validation-summary.ts`

Inputs:

- current event intelligence
- country instability and posture data
- market and exposure data
- theme intelligence APIs

### 10.3 Theme integration

Files to migrate and then retire:

- `event-dashboard.html`
- `scripts/event-dashboard-api.mjs`
- `scripts/_shared/trend-dashboard-queries.mjs`

Goal:

- preserve the theme logic
- remove the separate product shell

### 10.4 Map simplification

Files to demote from primary boot:

- `src/components/MapContainer.ts`
- `src/components/DeckGLMap.ts`
- `src/components/GlobeMap.ts`
- `src/components/Map.ts`

Goal:

- no default WebGL boot path for the core platform
- advanced map route only

### 10.5 Runtime separation

Files to change:

- `src-tauri/src/main.rs`
- `src-tauri/sidecar/local-api-server.mjs`
- `scripts/master-daemon.mjs`
- PM2 or service config files

Goal:

- opening the product UI must not launch collection and scheduling jobs by default

### 10.6 Legacy archive

Move or archive:

- positive pack panels
- live channel manager
- webcam surfaces
- unused experiment panels

Goal:

- reduce default bundle, cognitive load, and maintenance noise

## 11. Execution phases

### Phase 0. Freeze

- stop adding new standalone panels
- stop adding new workspace variants
- stop adding new source-category top-level UI

### Phase 1. Build the new signal shell

- create the five-surface IA
- make `Signals` the default boot
- make the existing map hidden by default

### Phase 2. Absorb core signal, brief, and country panels

- merge live, event intelligence, insights, posture, risk, and CII
- ship a single signal and brief loop

### Phase 3. Collapse source panels into a source drawer

- replace dozens of source panels with source filters
- keep the feed infrastructure, remove the panel surface

### Phase 4. Integrate theme and watch

- move theme brief into the main shell
- connect signals to watch state and alerts

### Phase 5. Isolate validation and operations

- move replay and internal ops to advanced-only surfaces
- turn off non-visible refresh and background cost

### Phase 6. Remove globe-first identity

- no globe boot path
- no deck.gl default boot path
- optional advanced map route only

### Phase 7. Separate background automation

- move collection and scheduling out of UI startup
- keep sidecar slim

### Phase 8. Archive and delete legacy surfaces

- positive pack to archive
- experimental panels to archive or delete
- live channels and webcams out of core product

## 12. Exit criteria

The consolidation is complete only when all of the following are true.

### Product

- users can explain the product in one sentence as a signal analysis platform
- there is no standalone product identity conflict between live map and theme dashboard
- source categories are no longer the main navigation model

### UX

- default workspace count is five or fewer
- default landing experience has no cockpit grid
- selected signal drives brief, watch, and validation navigation

### Performance

- default boot path does not initialize WebGL globe or deck.gl
- opening the UI does not spawn background collector children by default
- default active refresh loops are reduced to only the current workspace needs

### Codebase

- archived and experimental panels are removed from the default export path
- old workspace and variant assumptions are simplified
- runtime responsibility is clearly separated from operations responsibility

## 13. Non-negotiable decisions

These are not optional if the goal is a coherent signal platform.

- The globe stops being the product center.
- Theme intelligence stays, but loses its separate shell identity.
- Source categories stop being top-level panels.
- Validation stays, but becomes advanced-only.
- Positive/progress surfaces leave the core product.
- UI startup stops launching background collection and scheduler jobs by default.
- Hidden panels stop consuming active refresh budget.

## 14. Recommended first implementation cut

The first real cut should not be another document-only step. It should do these together:

1. introduce the new five-surface workspace model
2. make `Signals` the default landing view
3. hide globe and map by default
4. merge `live-news`, `event-intelligence`, `insights`, `strategic-posture`, `strategic-risk`, and `cii`
5. disable desktop background automation on UI open
6. move source-category panels behind a source drawer

If those six changes are not done together, the product will keep feeling like multiple systems stitched together.
