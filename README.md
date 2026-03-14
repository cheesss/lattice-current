# Lattice Current

Independent public research fork for real-time global intelligence, AI-assisted analysis, historical replay, and backtesting.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![GitHub Pages](https://img.shields.io/badge/docs-GitHub%20Pages-24292f?logo=github)](https://cheesss.github.io/lattice-current/)

## What It Is

Lattice Current is a public research fork of a multi-variant intelligence platform that combines:

- live global news and OSINT collection
- AI-assisted summaries, deduction, and Q&A
- map-based geopolitical, infrastructure, and market visualization
- ontology and graph-based relation analysis
- event-to-market transmission modeling
- historical replay, walk-forward backtesting, and investment idea support

The same repository powers multiple variants:

- `full`: geopolitics, conflict, infrastructure, intelligence
- `tech`: AI, startups, cloud, cyber, technology ecosystems
- `finance`: markets, macro, central banks, commodities, cross-asset analysis

## Public Surfaces

- Repository: `https://github.com/cheesss/lattice-current`
- GitHub Pages docs: `https://cheesss.github.io/lattice-current/`

No official hosted application deployment is represented by this fork. If you want a live surface, deploy your own instance from this repository.

## Highlights

- Real-time monitoring across curated feeds, strategic assets, and market data
- AI and statistical analysis layers for summaries, trend detection, and risk scoring
- Ontology graph, transmission graph, and historical replay/backtest tooling
- Desktop runtime with Tauri sidecar, local services, and offline-capable workflows
- Single codebase with variant-aware data, panels, and build targets

## Repository Structure

- `src/`: app shell, panels, services, analysis logic
- `server/`: API handlers and domain services
- `src-tauri/`: desktop runtime and local sidecar
- `docs/`: technical reference and deep-dive docs
- `site/`: GitHub Pages documentation site
- `scripts/`: build, packaging, and historical data tooling

## Getting Started

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
```

## Documentation

- Technical docs index: [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md)
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Algorithms: [docs/ALGORITHMS.md](docs/ALGORITHMS.md)
- AI and intelligence: [docs/AI_INTELLIGENCE.md](docs/AI_INTELLIGENCE.md)
- Investment usage: [docs/investment-usage-playbook.md](docs/investment-usage-playbook.md)

## Branding and Lineage

This repository is branded as `Lattice Current`.

Some deep technical documents and internal code identifiers still reference legacy `worldmonitor` names because they describe inherited code structure, storage keys, proto package paths, or upstream lineage. Those identifiers are not the public product name of this fork.

## Licensing and Content Policy

The repository uses separate policies for code and content:

- Code license: [AGPL-3.0-only](LICENSE)
- Copyright policy: [COPYRIGHT.md](COPYRIGHT.md)
- Content and screenshot policy: [CONTENT_POLICY.md](CONTENT_POLICY.md)
- Third-party notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
- Trademarks: [TRADEMARKS.md](TRADEMARKS.md)

Important:

- source code is open under AGPL-3.0-only
- third-party news content is not redistributed in full
- screenshots and public docs should use sanitized examples
- internal operational details, credentials, private feeds, and bypass techniques are intentionally omitted from public docs

## Contribution Rule

If a change affects user-facing behavior, public APIs, product capabilities, or workflows, update either:

- a feature page, or
- an update/release note

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution expectations.