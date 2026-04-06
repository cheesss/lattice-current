# Lattice Current

Signal workspace for live risk, infrastructure, markets, and operator decision support.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![GitHub Pages](https://img.shields.io/badge/docs-GitHub%20Pages-24292f?logo=github)](https://cheesss.github.io/lattice-current/)

## What It Is

Lattice Current is a public research fork of a multi-variant intelligence platform that combines:

- live global news and OSINT collection
- AI-assisted summaries, deduction, and Q&A
- map-based geopolitical, infrastructure, and market visualization
- ontology and graph-based relation analysis
- event and transmission analysis
- replay and historical validation surfaces used to calibrate signal quality

## Current direction

The main branch has shifted away from a backtest-first product identity.

The current emphasis is:

- live signal intake
- canonical event resolution
- evidence quality and transmission analysis
- operator-facing decision support
- replay and NAS-backed historical validation as secondary calibration layers

The heavy backtest-ML modules were removed from the main branch and preserved on `legacy/backtest`.

## Workspace surfaces

- `Live Workspace`: prioritized live signals instead of raw feed walls
- `Briefing Desk`: decision briefs, current posture, and summary surfaces
- `Research Desk`: graph, ontology, automation, and operator research workflow
- `Replay Studio`: historical validation and storage sanity checks, not the primary product surface
- `Data Flow Ops`: freshness, lag, storage, retention, and pipeline health

The same repository still powers multiple variants:

- `full`: geopolitics, conflict, infrastructure, intelligence
- `tech`: AI, startups, cloud, cyber, technology ecosystems
- `finance`: markets, macro, central banks, commodities, cross-asset analysis

## Highlights

- Real-time monitoring across curated feeds, strategic assets, and market data
- AI and statistical analysis layers for summaries, trend detection, and evidence handling
- Ontology graph, transmission graph, and historical validation tooling
- Desktop runtime with Tauri sidecar, local services, and offline-capable workflows
- Single codebase with variant-aware data, panels, and build targets

## Capability areas

- Signal intake: live feeds, OSINT, macro, market, and conflict-oriented datasets
- Evidence handling: event resolution, source quality, and data quality operations
- Research workflow: Codex-assisted expansion, automation governance, ontology and graph views
- Validation workflow: historical fetch/import, replay, and loader/storage verification
- Decision support: operator briefs, transmission interpretation, and guarded recommendations
- Operations: scheduler loops, pipeline heartbeats, retention, and blocker visibility

## Repository structure

- `src/`: app shell, panels, services, analysis logic
- `server/`: API handlers and domain services
- `src-tauri/`: desktop runtime and local sidecar
- `docs/`: technical reference and deep-dive docs
- `site/`: GitHub Pages documentation site
- `scripts/`: build, packaging, and historical data tooling

## Getting started

```bash
npm install
npm run dev
```

Other common commands:

```bash
npm run dev:tech
npm run dev:finance
npm run typecheck
npm run build
npm run docs:dev
npm run docs:build
npm run public:sync:dry
npm run public:sync
```

## Documentation

- Technical docs index: [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md)
- User guide: [docs/USER_GUIDE.md](docs/USER_GUIDE.md)
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Algorithms: [docs/ALGORITHMS.md](docs/ALGORITHMS.md)
- AI and intelligence: [docs/AI_INTELLIGENCE.md](docs/AI_INTELLIGENCE.md)
- Decision-support playbook: [docs/investment-usage-playbook.md](docs/investment-usage-playbook.md)
- Public sync workflow: [docs/public-sync.md](docs/public-sync.md)

## Naming note

This repository is branded as `Lattice Current`.

Some deep technical documents and inherited storage keys still contain older internal identifiers. They reflect implementation lineage, not the public product name of this fork.

## Licensing and content policy

The repository uses separate policies for code and content:

- Code license: [AGPL-3.0-only](LICENSE)
- Copyright policy: [COPYRIGHT.md](COPYRIGHT.md)
- Content and screenshot policy: [CONTENT_POLICY.md](CONTENT_POLICY.md)
- Third-party notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
- Trademarks: [TRADEMARKS.md](TRADEMARKS.md)

## Contribution rule

If a change affects user-facing behavior, public APIs, product capabilities, or workflows, update either:

- a feature page, or
- an update note

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution expectations.
