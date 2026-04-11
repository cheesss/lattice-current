# Agent Deep Context

Date: 2026-04-08  
Audience: new chat threads, new agents, future maintainers  
Purpose: one detailed orientation document for the active repository and branch direction

## What This Repository Is

`lattice-current-fix` is a layered intelligence workspace.

It should not be understood as only one of the following:

- a globe or map visualization project
- a trading signal engine
- a backtesting lab
- a Codex automation playground
- a news summarizer

It is a hybrid system that combines:

- live news and OSINT intake
- country and event intelligence
- map and globe visualization
- theme and trend intelligence
- automation and proposal workflows
- replay and historical validation
- desktop runtime and sidecar control
- server and edge handlers

The best current one-line description is:

**a signal-first intelligence workbench for structural change, where live intake, theme objects, watch workflows, operations, and replay cooperate inside one operator shell**

## Design Philosophy

These principles matter more than any single feature.

### 1. Intelligence first, prediction second

The repo still contains signals, market links, and historical evaluation, but the active branch should not be read as a short-horizon prediction engine. The direction is toward:

- structural monitoring
- evidence-backed interpretation
- transmission logic
- operator support
- long-horizon workflow

### 2. Durable objects beat feed walls

The system is moving away from raw lists and temporary widgets toward stable objects such as:

- canonical themes
- Theme Briefs
- structural alerts
- followed briefings
- adjacent pathways
- evidence lanes

If a future change adds more rows, more JSON, or more charts without strengthening those objects, it is probably moving in the wrong direction.

### 3. Evidence outranks narrative

LLMs help summarize, classify, compare, and propose. They do not get to silently replace:

- source quality
- corroboration
- explicit uncertainty
- provenance
- operator review

Good changes increase explainability, not just fluency.

### 4. Maps, automation, and replay are supporting planes

Each of these planes is real and important:

- maps and globe surfaces
- Codex and daemon automation
- replay and historical validation

But none alone defines the whole product.

### 5. Hybrid architecture is intentional

The repository spans:

- a React browser app
- a standalone dashboard surface
- scripts and daemons
- local sidecars
- server handlers
- storage orchestration
- evaluation tooling

That is not accidental drift. It reflects a deliberately broad operating model.

## Current Product Direction

The active branch is no longer centered on:

- short-term price prediction
- retail buy/sell calls
- becoming a Bloomberg clone
- becoming a Dataminr clone
- being a generic AI news chatbot

The clearest active direction is:

- signal-first operator workflow
- embedded theme intelligence and structural change monitoring
- horizon scanning with evidence-backed interpretation
- followed themes, alerts, and watch loops
- replay and historical systems as validation and calibration layers

The strongest current surface expressing that direction is the five-workspace
shell centered on:

- `Signals`
- `Brief`
- `Watch`
- `Validate`
- `Operate`

The standalone trend dashboard still exists, but it is now treated as an
embedded theme workspace synchronized with the shell instead of as a separate
product identity.

## Major Runtime Surfaces

### 1. Main app shell

Primary files:

- [App.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\App.ts)
- [main.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\main.ts)
- [src/app](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app)
- [src/components](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components)

This is the large React browser and desktop shell. It owns startup, layout,
data loading, workspace state, map rendering, panel orchestration, refresh
cadence, and the operator loop that ties signals, briefs, watch, validation,
and operations together.

### 2. Embedded theme workspace

Primary files:

- [event-dashboard.html](C:\Users\chohj\Documents\Playground\lattice-current-fix\event-dashboard.html)
- [event-dashboard-api.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\event-dashboard-api.mjs)
- [trend-dashboard-queries.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\_shared\trend-dashboard-queries.mjs)
- [trend-workbench.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\_shared\trend-workbench.mjs)

This surface still owns:

- Theme Brief
- My Themes
- followed-theme briefing
- structural alerts
- discovery triage
- notebook hooks
- adjacent pathways
- trend pyramid
- theme evolution

The important current implementation detail is that it is embedded inside the
main shell and synchronized through `postMessage`. It should not be treated as
a separate app that is polled through iframe URL rewrites.

### 3. Replay and validation workspace

Primary files:

- [BacktestLabPanel.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components\BacktestLabPanel.ts)
- [backtest-hub-window.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\backtest-hub-window.ts)
- [historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)
- [replay-adaptation.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\replay-adaptation.ts)

This plane is no longer the main product story, but it is still strategically important. It is how the system checks whether new logic, evidence lanes, or admission rules improve or degrade quality over time.

### 4. Desktop runtime and local sidecar

Primary files:

- [src-tauri](C:\Users\chohj\Documents\Playground\lattice-current-fix\src-tauri)
- [local-api-server.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\src-tauri\sidecar\local-api-server.mjs)

This is the local control plane. It matters for desktop mode, local services,
sensitive operations, persistent state, and workflows that should not depend
entirely on a remote deployment.

Current guardrail: the sidecar is intended to lazy-start when local runtime
services are actually needed. Desktop startup should not automatically spawn
heavy automation or collection processes just because the shell opened.

### 5. Server and edge handlers

Primary directories:

- [server](C:\Users\chohj\Documents\Playground\lattice-current-fix\server)
- [api](C:\Users\chohj\Documents\Playground\lattice-current-fix\api)

This plane contains network-facing handlers, shared backend utilities, and edge-compatible paths. It is not the only backend, but it is a real backend layer.

## Main App Architecture

The React app is organized around `App.ts` plus the managers in `src/app/*`.

- [App.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\App.ts)
  - composition root
  - variant handling
  - runtime initialization
  - storage hydration
  - module wiring
- [data-loader.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\data-loader.ts)
  - data fetch and hydration
- [refresh-scheduler.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\refresh-scheduler.ts)
  - cadence and refresh policy
- [event-handlers.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\event-handlers.ts)
  - UI event routing and interaction logic
- [panel-layout.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\panel-layout.ts)
  - layout zones and panel placement
- [country-intel.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\country-intel.ts)
  - country deep-dive flow

The component layer is large, but it helps to think in families:

- map and globe
  - [MapContainer.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components\MapContainer.ts)
  - [DeckGLMap.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components\DeckGLMap.ts)
  - [GlobeMap.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components\GlobeMap.ts)
- intelligence and briefing
  - [InsightsPanel.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components\InsightsPanel.ts)
  - [EventIntelligencePanel.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components\EventIntelligencePanel.ts)
  - [CountryBriefPage.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components\CountryBriefPage.ts)
- research and graph
  - [AnalysisHubPage.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components\AnalysisHubPage.ts)
  - [CodexHubPage.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components\CodexHubPage.ts)
  - [OntologyGraphPage.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components\OntologyGraphPage.ts)
- replay and validation
  - [BacktestLabPanel.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components\BacktestLabPanel.ts)
  - [DataQAPanel.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components\DataQAPanel.ts)

## Service Layer Mental Model

Directory:

- [src/services](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services)

This is a real logic layer, not a thin API shell.

Useful families:

- collection and normalization
  - [rss.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\rss.ts)
  - [gdelt-intel.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\gdelt-intel.ts)
  - [military-flights.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\military-flights.ts)
- aggregation and interpretation
  - [event-market-transmission.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\event-market-transmission.ts)
  - [investment-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment-intelligence.ts)
  - [country-instability.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\country-instability.ts)
- historical replay and learning
  - [historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)
  - [replay-adaptation.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\replay-adaptation.ts)
- runtime and infrastructure
  - [runtime.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\runtime.ts)
  - [runtime-config.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\runtime-config.ts)
  - [persistent-cache.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\persistent-cache.ts)
- server-oriented automation and proposals
  - [intelligence-automation.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\intelligence-automation.ts)
  - [codex-theme-proposer.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\codex-theme-proposer.ts)
  - [codex-candidate-proposer.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\codex-candidate-proposer.ts)
  - [codex-dataset-proposer.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\codex-dataset-proposer.ts)

## Trend-Intelligence Branch Details

This branch lives mostly in `scripts/` plus the standalone dashboard.

Primary files:

- [theme-taxonomy.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\_shared\theme-taxonomy.mjs)
- [auto-pipeline.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\auto-pipeline.mjs)
- [compute-trend-aggregates.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\compute-trend-aggregates.mjs)
- [curate-daily-news.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\curate-daily-news.mjs)
- [generate-followed-theme-briefings.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\generate-followed-theme-briefings.mjs)
- [generate-structural-alerts.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\generate-structural-alerts.mjs)
- [migrate-taxonomy.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\migrate-taxonomy.mjs)

Important objects:

- canonical taxonomy
  - durable theme IDs with parent and child structure
- Theme Brief
  - primary explanatory research object
- My Themes
  - followed-theme workflow
- structural alerts
  - lifecycle, acceleration, share-shift, and evidence-change alerts
- adjacent pathways
  - second-, third-, and fourth-order consequences without polluting canonical taxonomy
- evidence lanes
  - SEC, OpenAlex, GitHub, and future lanes such as patents

One important recent strategic shift:

`add-theme` is no longer a forced two-way decision.

It now supports:

- `propose`
- `attach`
- `reject`

That means an interesting but overlapping discovery topic can still become a durable object as an attached pathway under an existing theme.

## Maps and Trend Workbench Are Not Fully Unified Yet

This is one of the most important practical facts for a new agent.

The map and globe plane and the trend-intelligence dashboard share lineage and some data, but they are still mostly separate UX surfaces.

Examples:

- [GlobeMap.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components\GlobeMap.ts) is still a dedicated spatial renderer
- [EventIntelligencePanel.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components\EventIntelligencePanel.ts) still uses older event-intel endpoints
- [event-dashboard.html](C:\Users\chohj\Documents\Playground\lattice-current-fix\event-dashboard.html) owns the newer Theme Brief workflow

Do not assume that a fix in the trend dashboard automatically changes the globe experience, or vice versa.

## Automation and Codex Layer

The automation layer is a real subsystem, not decoration.

Primary files:

- [master-daemon.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\master-daemon.mjs)
- [proposal-executor.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\proposal-executor.mjs)
- [generate-codex-theme-proposals.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\generate-codex-theme-proposals.mjs)
- [discover-emerging-tech.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\discover-emerging-tech.mjs)
- [label-discovery-topics.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\label-discovery-topics.mjs)
- [generate-weekly-digest.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\generate-weekly-digest.mjs)
- [generate-tech-report.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\generate-tech-report.mjs)

Mental model:

- Codex is not the product
- Codex is an expansion, proposal, labeling, and briefing layer
- the active work emphasizes structured output contracts over pretty prose
- reject versus attach versus propose is now part of the core proposal flow

## Storage and Runtime Planes

This repo uses multiple storage layers:

- NAS PostgreSQL
  - structured historical and operational storage
- local DuckDB
  - compatibility, sync, and execution cache
- local persistent cache
  - UI and runtime persistence
- NAS snapshots and local archival flows
  - rebuild and recovery support

This infrastructure matters because the project is built to survive:

- stale feeds
- partial outages
- rebuild cycles
- sidecar-driven local workflows
- mixed desktop and browser execution

## Replay and Historical Validation

Replay is still important.
It is simply no longer the main pitch.

Use replay to answer:

- did canonical or thematic logic regress
- did a new evidence lane improve or degrade quality
- did storage or ingestion changes distort results
- did prompt or admission logic become too loose

Key references:

- [historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)
- [BACKTEST_SYSTEM_EXPLAINER_2026-04-01.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\BACKTEST_SYSTEM_EXPLAINER_2026-04-01.md)
- [BACKTEST_SYSTEM_DEEP_DIVE_2026-04-01.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\BACKTEST_SYSTEM_DEEP_DIVE_2026-04-01.md)

## Validation and Tests

Directory:

- [tests](C:\Users\chohj\Documents\Playground\lattice-current-fix\tests)

The test suite is broad. Important recent families include:

- event-dashboard route contracts
- Theme Brief workflow tests
- structural alert generation tests
- taxonomy migration tests
- evidence lane tests for SEC, OpenAlex, and GitHub
- daemon guardrails
- prompt-contract tests
- evaluation-set validation tests

The evaluation set matters:

- [data/evaluation-set](C:\Users\chohj\Documents\Playground\lattice-current-fix\data\evaluation-set)

It protects the system against:

- plausible-but-wrong theme labels
- noisy discovery promotion
- weak briefs
- silent prompt regressions

## What a New Agent Should Not Misread

Do not make these mistakes:

- This is basically a trading signal engine.
- This is just a map UI.
- Replay is dead.
- Codex outputs are only informal helpers.
- The trend dashboard already replaced the React app.

All of those are wrong or half-true.

## Recommended Read Order

Fast path:

1. [README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\README.md)
2. [DOCUMENTATION.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\DOCUMENTATION.md)
3. this file
4. [App.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\App.ts)
5. [trend-dashboard-queries.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\_shared\trend-dashboard-queries.mjs)
6. [event-dashboard.html](C:\Users\chohj\Documents\Playground\lattice-current-fix\event-dashboard.html)
7. [historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)
8. [master-daemon.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\master-daemon.mjs)

Longer path:

1. [ARCHITECTURE.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\ARCHITECTURE.md)
2. [AI_INTELLIGENCE.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\AI_INTELLIGENCE.md)
3. [SIGNAL_PLATFORM_CONSOLIDATION_MASTER_PLAN_2026-04-09.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\SIGNAL_PLATFORM_CONSOLIDATION_MASTER_PLAN_2026-04-09.md)
4. [src/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\README.md)
5. [src/services/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\README.md)
6. [local-api-server.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src-tauri\sidecar\local-api-server.md)

## Final Rule

The correct mental model is:

**a layered intelligence workspace where map surfaces, country views, theme briefs, automation, and replay all cooperate, with the active branch pushing toward a more evidence-backed, theme-centered, structurally oriented operator workflow**
