---
title: Getting Started
summary: Run the app locally, understand the repo surfaces, and know where public docs stop.
status: stable
variants:
  - full
  - tech
  - finance
updated: 2026-03-15
owner: core
---

# Getting Started

## Requirements

- Node.js 20+
- npm
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

## Repo surfaces

- `src/`: frontend and analysis services
- `server/`: service handlers and APIs
- `src-tauri/`: desktop runtime and local sidecar
- `docs/`: deep technical docs and reference material
- `site/`: GitHub Pages docs site

## Branding note

This public fork is branded as `Lattice Current`.

Some internal identifiers still use legacy `worldmonitor` names in code paths, package names, localStorage keys, proto packages, or docs that describe inherited structure. Those identifiers are implementation details, not the public brand of this repository.

## Read next

- [Variants](/variants)
- [Features](/features/)
- [Architecture](/architecture)
- [API](/api)