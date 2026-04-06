# User Guide

This guide is for the current main branch of Lattice Current.

The product is a signal-first decision-support workspace. Replay and historical validation still exist, but they are supporting tools rather than the primary product surface.

## Quick start

Install and start the main app:

```bash
npm install
npm run dev
```

The default development entry point uses the full signal workspace launcher. On Windows it starts background helpers without opening transient `cmd.exe` windows.

## Main surfaces

### Live Workspace

Use this for current feeds, live news, and immediate signal visibility.

Key panels:

- `Event Intelligence`
- `Live News`
- `GDELT Intel`
- `Source Ops`
- `Data Flow Ops`

### Briefing Desk

Use this when you need a concise situation view rather than raw feeds.

Focus areas:

- current posture
- event summaries
- transmission interpretation
- operator-facing context

### Research Desk

Use this for graph, ontology, and exploratory analysis.

Focus areas:

- relation analysis
- theme linkage
- supporting evidence
- source quality and coverage

### Replay Studio

Use this only when you are validating signal quality, data coverage, or admission logic.

Replay is not the primary product identity of the branch.

## Operational commands

Core checks:

```bash
npm run typecheck
npm run build
```

Focused signal/data verification:

```bash
node --import tsx scripts/verify-e2e.mjs
node --import tsx scripts/master-daemon.mjs --once --task pending-check
node --import tsx scripts/master-daemon.mjs --once --task dashboard-health
```

Historical validation path:

```bash
npm run verify:nas:e2e -- --walk-start 2023-06-01T00:00:00Z --walk-end 2025-12-31T23:59:59Z --folds 1
```

## Article analysis workflow

Fast bulk extraction:

```bash
node --import tsx scripts/fast-keyword-extractor.mjs --limit 60000
```

Ambiguity-focused Ollama analysis:

```bash
node --import tsx scripts/ollama-article-analyzer.mjs --mode ambiguous --confidence-threshold 0.45 --limit 20
```

Theme-symbol refresh:

```bash
node --import tsx scripts/auto-pipeline.mjs --step 2 --limit 60000
```

## What "working" means

Do not treat a script as successful just because it exits with code `0`.

Treat a feature as working only when:

1. its results are stored in the intended table or cache
2. the runtime surface reads that data
3. operator-visible output changes as expected
4. the relevant regression command passes

Examples:

- `dashboard-health` is not complete if the command exits `0` but `data/daemon-state.json` still shows `health.dashboard.ok = false`
- article analysis is not complete if `article_analysis` rows exist but the operator-facing panels never consume them
- a NAS data change is not complete if data exists in PostgreSQL but replay or signal generation still sees zero usable frames

## Common checks

### Check daemon state

Inspect:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\data\daemon-state.json](/C:/Users/chohj/Documents/Playground/lattice-current-fix/data/daemon-state.json)

You should review:

- `taskResults`
- `failures`
- `health`

### Check article analysis coverage

The main tables are:

- `article_analysis`
- `auto_trend_keywords`
- `auto_article_themes`
- `auto_theme_symbol_candidates`
- `auto_theme_symbols`

### Check signal/data flow

If UI panels look sparse:

1. confirm the source tables are populated
2. confirm the sidecar/API path is healthy
3. confirm the panel is reading the expected endpoint
4. confirm stale-data fallback is being used instead of blank rendering

## Current limitations

As of this update:

- daemon logic is implemented, but long-run burn-in is still pending
- dashboard health currently reports a failed fetch in the recorded daemon state
- replay validation remains available, but it is secondary to the signal workspace
- some historical and dated docs still exist for reference; prefer canonical docs first

## Read next

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\README.md](/C:/Users/chohj/Documents/Playground/lattice-current-fix/README.md)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\ARCHITECTURE.md](/C:/Users/chohj/Documents/Playground/lattice-current-fix/docs/ARCHITECTURE.md)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\TEST_OPERATIONS_RUNBOOK.md](/C:/Users/chohj/Documents/Playground/lattice-current-fix/docs/TEST_OPERATIONS_RUNBOOK.md)
