# Lattice Current Documentation Index

This repository is now centered on a signal-based decision-support workspace.

Historical replay, walk-forward evaluation, and NAS-backed storage still exist, but they are supporting layers used to validate and calibrate signal quality. They are no longer the primary product identity of the main branch.

## Current project direction

The main branch focuses on:

- live signal intake across news, OSINT, macro, market, and infrastructure sources
- canonical event resolution and evidence quality scoring
- operator-facing interpretation, briefing, and decision support
- graph, ontology, and transmission analysis
- replay and historical validation as secondary calibration surfaces

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
| [./investment-usage-playbook.md](./investment-usage-playbook.md) | Practical operator workflow |
| [./NAS_BACKTEST_STORAGE_PLAN_2026-04-01.md](./NAS_BACKTEST_STORAGE_PLAN_2026-04-01.md) | NAS-backed historical storage policy |
| [./TEST_OPERATIONS_RUNBOOK.md](./TEST_OPERATIONS_RUNBOOK.md) | Required validation commands and completion criteria |
| [./TEMPORAL_FEATURE_UPGRADE_2026-04-05.md](./TEMPORAL_FEATURE_UPGRADE_2026-04-05.md) | Status of retained temporal and external-signal features |
| [./BACKTEST_SYSTEM_EXPLAINER_2026-04-01.md](./BACKTEST_SYSTEM_EXPLAINER_2026-04-01.md) | Replay system explainer for historical validation |
| [./BACKTEST_SYSTEM_DEEP_DIVE_2026-04-01.md](./BACKTEST_SYSTEM_DEEP_DIVE_2026-04-01.md) | Technical replay and storage deep dive |

## How to read the repo now

1. Start with live and analysis surfaces.
2. Read event resolution and evidence-quality logic.
3. Read replay and NAS docs only if you are validating historical behavior or debugging storage.

Do not infer the current product identity from old plan files, handoff notes, or archived backtest experiments.

## Archive note

The `docs/` folder still contains dated plans, audits, and handoff notes. Those files are useful as historical context only. When a dated document disagrees with the files listed above, prefer the canonical docs and the current code.
