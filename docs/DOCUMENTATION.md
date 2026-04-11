# Lattice Current Documentation Index

This repository is now centered on a theme-led signal intelligence shell.

Theme tracking, live intake, watch workflows, replay, and local runtime
support still exist, but they are absorbed into one root product surface
instead of multiple competing entry pages.

## Current project direction

The main branch focuses on:

- `event-dashboard.html` as the canonical root shell, with `/` redirecting there
- one integrated surface for live signals, theme briefs, the 2D Geo Lens, proposal review, approval execution, validation snapshots, and operator diagnostics
- live signal intake across news, OSINT, macro, market, and infrastructure sources
- durable theme tracking and briefing objects inside the operator shell
- canonical event resolution and evidence quality scoring
- replay and historical validation as secondary calibration surfaces
- local and desktop runtime support without auto-starting heavy background jobs on every launch

The following backtest-heavy ML modules were removed from the main branch and preserved on `legacy/backtest`:

- `elastic-net`
- `gradient-boosting`
- `bayesian-logistic`
- `ensemble-predictor`
- `cma-es`
- `isotonic-calibrator`
- `ml-walk-forward`
- `cpcv`

## Canonical docs

Use these first. They describe the current branch, not historical experiments.

| Document | Purpose |
| --- | --- |
| [../README.md](../README.md) | Top-level repository overview |
| [./ARCHITECTURE.md](./ARCHITECTURE.md) | Current runtime, data, and storage architecture |
| [./USER_GUIDE.md](./USER_GUIDE.md) | Operator-oriented quick start and runtime usage |
| [./ALGORITHMS.md](./ALGORITHMS.md) | Active signal, evidence, and admission logic |
| [./AI_INTELLIGENCE.md](./AI_INTELLIGENCE.md) | LLM, RAG, narrative, and operator-support layers |
| [./AGENT_DEEP_CONTEXT_2026-04-08.md](./AGENT_DEEP_CONTEXT_2026-04-08.md) | Single-file deep context for new agents and new chat threads across the entire active repository |
| [./SIGNAL_PLATFORM_CONSOLIDATION_MASTER_PLAN_2026-04-09.md](./SIGNAL_PLATFORM_CONSOLIDATION_MASTER_PLAN_2026-04-09.md) | Full end-state plan for collapsing the globe-heavy product into a lighter signal analysis platform, including panel-by-panel absorb/archive/delete decisions |
| [../src/README.md](../src/README.md) | Fast orientation to the product shell and workspace flow |
| [../src/services/README.md](../src/services/README.md) | Guide to the service layer and the safest validation shortcuts |
| [./investment-usage-playbook.md](./investment-usage-playbook.md) | Practical operator workflow |
| [./NAS_BACKTEST_STORAGE_PLAN_2026-04-01.md](./NAS_BACKTEST_STORAGE_PLAN_2026-04-01.md) | NAS-backed historical storage policy |
| [./TEST_OPERATIONS_RUNBOOK.md](./TEST_OPERATIONS_RUNBOOK.md) | Required validation commands and completion criteria |
| [./TEMPORAL_FEATURE_UPGRADE_2026-04-05.md](./TEMPORAL_FEATURE_UPGRADE_2026-04-05.md) | Status of retained temporal and external-signal features |
| [./BACKTEST_SYSTEM_EXPLAINER_2026-04-01.md](./BACKTEST_SYSTEM_EXPLAINER_2026-04-01.md) | Replay system explainer for historical validation |
| [./BACKTEST_SYSTEM_DEEP_DIVE_2026-04-01.md](./BACKTEST_SYSTEM_DEEP_DIVE_2026-04-01.md) | Technical replay and storage deep dive |

## How to read the repo now

1. Start with the workspace shell and live operator loop.
2. Read event resolution and evidence-quality logic.
3. Read replay and NAS docs only if you are validating historical behavior or debugging storage.

Do not infer the current product identity from old plan files, handoff notes, or archived backtest experiments.

## Archive note

The `docs/` folder still contains dated plans, audits, and handoff notes. Those files are useful as historical context only. When a dated document disagrees with the files listed above, prefer the canonical docs and the current code.

## Current implementation notes

The refactored shell now assumes:

- the root path `/` redirects to the integrated theme shell, and the old main page is retired from the user entry flow
- source-only category feeds live in the source drawer, not as default standalone panels
- hidden workspaces do not keep refreshing their panels just because panel objects exist
- the embedded theme workspace syncs with the shell through `postMessage`, not iframe URL polling
- the theme shell now includes a flat `event-map-lens.html` 2D spatial surface instead of restoring the old globe-first UI
- Codex proposal review and human approval review execute from the theme shell instead of stopping at status flips
- compact `risk`, `macro`, `investment`, and `validation` snapshots are served through the shared `theme-shell-snapshots` API contract
- system health, data quality, and Codex quality are surfaced directly inside the operator drawer in the theme shell
- desktop local runtime services are lazy-started instead of eagerly spawning the local API on every launch
