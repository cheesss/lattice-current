---
title: Getting Started
summary: Run the shell locally, set up optional Python compute, and understand the current runtime split.
status: stable
variants:
  - full
  - tech
  - finance
updated: 2026-04-12
owner: core
---

# Getting Started

## Requirements

- Node.js 20+
- npm
- Python 3.11+ if you want to run batch compute scripts
- optional desktop prerequisites if you build Tauri artifacts

## Local development

```bash
npm install
npm run dev
```

Other useful commands:

```bash
npm run dev:tech
npm run dev:finance
npm run typecheck
npm run build
npm run docs:dev
npm run docs:build
```

## Optional Python compute setup

The repo now includes a Python compute lane for CPU-bound scripts that should not stay in handwritten Node loops.

```bash
python -m pip install -r scripts/requirements-compute.txt
```

Useful dry-run commands:

```bash
npm run canonical:build -- --dry-run
npm run returns:abnormal -- --dry-run
```

These scripts write results back to PostgreSQL so the TypeScript UI and APIs can consume stable outputs.

## Repo surfaces

- `src/`: frontend and analysis services
- `server/`: service handlers and APIs
- `src-tauri/`: desktop runtime and local sidecar
- `scripts/`: ingestion, orchestration, and Python-first batch compute entrypoints
- `docs/`: deep technical docs and reference material
- `site/`: GitHub Pages docs site

## Current runtime split

- TypeScript: UI, API handlers, schedulers, ingestion, desktop orchestration
- Python: canonical-event clustering, abnormal-return analytics, model training
- Rust: Tauri runtime

## Branding note

This public fork is branded as `Lattice Current`.

Some internal identifiers still use legacy `worldmonitor` names in code paths, package names, localStorage keys, proto packages, or docs that describe inherited structure. Those identifiers are implementation details, not the public brand of this repository.

## Read next

- [Variants](/variants)
- [Features](/features/)
- [Architecture](/architecture)
- [API](/api)
