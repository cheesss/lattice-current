# Contributing to Lattice Current

This repository accepts contributions across code, data sources, documentation, and bug reports.

## Project direction

The current main branch is a signal-based decision-support workspace.

Replay, walk-forward evaluation, and NAS-backed storage still exist, but they are validation layers. They are not the primary identity of the branch.

## Development setup

```bash
make install
npm run dev
npm run dev:tech
npm run dev:finance
npm run typecheck
npm run build
```

## Branching

Use a focused branch for each change.

Example:

```bash
git checkout -b codex/your-change
```

## Contribution rules

1. Keep changes focused.
2. Update docs when behavior or workflow changes.
3. Run the narrowest relevant tests first, then `npm run typecheck`, then `npm run build`.
4. If you touch historical storage, replay, or NAS loaders, run the commands in [docs/TEST_OPERATIONS_RUNBOOK.md](docs/TEST_OPERATIONS_RUNBOOK.md).
5. Do not document archived backtest-ML modules as active on the main branch.

## Docs are part of the change

If a change affects:

- product direction
- user-facing behavior
- signal interpretation
- storage or replay behavior
- public site content

then update the relevant Markdown files in `docs/` and `site/`.
