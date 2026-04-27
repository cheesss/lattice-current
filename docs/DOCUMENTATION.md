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
| [../CLAUDE.md](../CLAUDE.md) | Project conventions, scripts, NAS tables, code modification principles |
| [./PROJECT_HANDOFF_2026-04-27.md](./PROJECT_HANDOFF_2026-04-27.md) | **Current** — 14-commit sprint covering ML pipeline activation, data-pipeline cascade fixes, perf audit, root-cause closures |
| [./PROJECT_HANDOFF_2026-04-23.md](./PROJECT_HANDOFF_2026-04-23.md) | Architectural reference for OpenClaw + decision-engine internals (still authoritative for those subsystems) |
| [./SESSION_IMPROVEMENTS_2026-04-23.md](./SESSION_IMPROVEMENTS_2026-04-23.md) | Source repair, OpenClaw, freshness, scheduler, validation fixes (4-23 session log) |
| [./SESSION_HANDOFF_2026-04-12.md](./SESSION_HANDOFF_2026-04-12.md) | Historical repo-wide handoff; superseded for current operation by PROJECT_HANDOFF_2026-04-23 |
| [./NOWCAST_HANDOFF_2026-04-18.md](./NOWCAST_HANDOFF_2026-04-18.md) | Nowcast subsystem state: Phase 0–5 shipped, gate + fuse filter enforced, rates redesign opened as separate track. OpenClaw exposure via `lattice.get_nowcast_status` (added 2026-04-23) |
| [./NOWCAST_RATES_REDESIGN_TRACK_2026-04-18.md](./NOWCAST_RATES_REDESIGN_TRACK_2026-04-18.md) | Open track — why rates models failed acceptance gate and candidate redesign directions |
| [./CONNECTED_SYSTEM_WORKFLOW_DETAILED_EXPLAINED_2026-04-18.md](./CONNECTED_SYSTEM_WORKFLOW_DETAILED_EXPLAINED_2026-04-18.md) | End-to-end workflow narrative — layer-by-layer explanation: source-add path, keyword/theme-add path, observed/estimated split, operationally-important routes |
| [./CONNECTED_SYSTEM_WORKFLOW_VISUAL_2026-04-18.md](./CONNECTED_SYSTEM_WORKFLOW_VISUAL_2026-04-18.md) | High-level visual walk-through of the detailed workflow |
| [./CONNECTED_SYSTEM_WORKFLOW_DETAILED_2026-04-18.html](./CONNECTED_SYSTEM_WORKFLOW_DETAILED_2026-04-18.html) / [.svg](./CONNECTED_SYSTEM_WORKFLOW_DETAILED_2026-04-18.svg) / [.png](./CONNECTED_SYSTEM_WORKFLOW_DETAILED_2026-04-18.png) / [.mmd](./CONNECTED_SYSTEM_WORKFLOW_DETAILED_2026-04-18.mmd) | Zoomable HTML / SVG / PNG renders + Mermaid source for the detailed workflow diagram (companions to the EXPLAINED doc above) |
| [./WORKFLOW_SOURCE_ADD_PATH_2026-04-18.md](./WORKFLOW_SOURCE_ADD_PATH_2026-04-18.md) | Code-level deep-dive of the source-add path — detectors, quality gate, review, executor, self-heal loop |
| [./WORKFLOW_KEYWORD_THEME_ADD_PATH_2026-04-18.md](./WORKFLOW_KEYWORD_THEME_ADD_PATH_2026-04-18.md) | Code-level deep-dive of the keyword + theme-add path — LLM proposal generation, evidence enrichment, bulk executor, downstream propagation |
| [./WORKFLOW_OPENCLAW_INTEGRATION_PATH_2026-04-18.md](./WORKFLOW_OPENCLAW_INTEGRATION_PATH_2026-04-18.md) | Code-level deep-dive of the OpenClaw integration path — channels, TaskFlow, source repair delivery, scheduler retry escalation, briefing |
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
| [./TROUBLESHOOTING_INDEX.md](./TROUBLESHOOTING_INDEX.md) | Symptom-to-fix quick reference |
| [./DASHBOARD_DATA_CONTINUITY_AUDIT_2026-04-14.md](./DASHBOARD_DATA_CONTINUITY_AUDIT_2026-04-14.md) | Most recent dashboard data freshness/fallback audit |
| [./COMPREHENSIVE_REVIEW_PROMPT.md](./COMPREHENSIVE_REVIEW_PROMPT.md) | Master prompt for full-stack project review (used 2026-04-14) |
| [./OPENCLAW_INTEGRATION_ARCHITECTURE_2026-04-16.md](./OPENCLAW_INTEGRATION_ARCHITECTURE_2026-04-16.md) | OpenClaw control-plane integration plan for channels, TaskFlow automation, source repair, scheduler retry, and briefing |

## How to read the repo now

1. Start with `PROJECT_HANDOFF_2026-04-23.md`.
2. Read `SESSION_IMPROVEMENTS_2026-04-23.md` only when you need the exact latest change log.
3. Read the workflow docs for code-level source, theme, Decision Inbox, and OpenClaw paths.
4. Read replay, NAS, and old plan docs only if you are validating historical behavior or debugging storage.

Do not infer the current product identity from old plan files, handoff notes, or archived backtest experiments.

## Archive note

The `docs/` folder still contains dated plans, audits, and handoff notes. Those files now carry an explicit `> **Status**:` line on the second row indicating one of: `shipped`, `partial`, `active`, `historical`, or `superseded`. When a dated document disagrees with the files listed above, prefer the canonical docs and the current code.

Recently removed (2026-04-14 cleanup):

- `CHANGELOG.md` (root) — World Monitor era changelog
- `docs/worldmonitor_architecture_handoff_ko.md` — superseded by SESSION_HANDOFF
- `docs/ADDING_ENDPOINTS.md` — described deprecated sebuf RPC pattern
- `docs/API_KEY_DEPLOYMENT.md` — referenced obsolete WORLDMONITOR_API_KEY gating
- `docs/TAURI_VALIDATION_REPORT.md` — environment-specific one-off report
- `docs/branding/nanobanana-prompt.md` — one-off design brief

Recently removed (2026-04-23 cleanup):

- `docs/NOWCAST_PLAN_ISSUES_2026-04-17.md` — superseded by `NOWCAST_HANDOFF_2026-04-18.md` (§3 commit map + §6 gap table absorbed all P1 issues)
- `docs/NOWCAST_ESTIMATION_ARCHITECTURE_PLAN_2026-04-17.md` — superseded by `NOWCAST_HANDOFF_2026-04-18.md` (original design doc; Phase 0–5 implementation landed across commits `62825c96` / `746a0e58` / `8bce577b` / `87c21b6d`)

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
