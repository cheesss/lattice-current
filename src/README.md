# `src` Guide

This folder contains the main product shell.

## Runtime layers

- [App.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\App.ts)
  - top-level composition, startup wiring, workspace state, and refresh orchestration
- [app](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app)
  - orchestration managers such as layout, data loading, handlers, and scheduler logic
- [components](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components)
  - UI surfaces and panel implementations
- [services](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services)
  - domain logic, stateful processing, runtime bridges, and automation support
- [styles](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\styles)
  - visual system
- [config](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\config)
  - variants, panels, feeds, and workspace definitions
- [types](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\types)
  - shared runtime types
- [utils](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\utils)
  - helper utilities

## Fast orientation

If you only need the shortest useful path:

- startup and global state
  - [App.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\App.ts)
  - [main.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\main.ts)
- data loading and refresh
  - [data-loader.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\data-loader.ts)
  - [refresh-scheduler.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\refresh-scheduler.ts)
- signal and briefing flow
  - [event-handlers.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\event-handlers.ts)
  - [panel-layout.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\panel-layout.ts)
  - [workspaces.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\config\workspaces.ts)
- validation
  - [BacktestLabPanel.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components\BacktestLabPanel.ts)
  - [backtest-hub-window.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\backtest-hub-window.ts)
  - [historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)

## Operator loop mental model

The current shell is organized around five workspaces:

- `Signals`
- `Brief`
- `Watch`
- `Validate`
- `Operate`

The code is easiest to follow if you read it in that order:

1. `App.ts` initializes runtime state, global services, and the shell.
2. `DataLoaderManager` hydrates caches and live datasets.
3. service modules turn raw provider data into signal, brief, and validation state.
4. `PanelLayoutManager` mounts the surfaces for the active workspace.
5. `EventHandlerManager` wires buttons, workspace changes, and cross-surface actions.
6. `RefreshScheduler` keeps only the visible, active surfaces fresh.

## Common failure patterns

- UI looks empty
  - check whether `data-loader.ts` populated context and whether the active workspace expects those panels
- hub shows no runs
  - check `historical-intelligence.ts` and sidecar archive routes
- data present but stale
  - check `persistent-cache.ts`, `runtime.ts`, and scheduler gating
- map layer exists but nothing renders
  - check map layer toggle state plus the relevant `set*` method in `DeckGLMap.ts` or `GlobeMap.ts`
