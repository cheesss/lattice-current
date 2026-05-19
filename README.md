# Lattice Current

Theme-led signal intelligence workspace for live monitoring, canonical event resolution, operator review, and validation.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![GitHub Pages](https://img.shields.io/badge/docs-GitHub%20Pages-24292f?logo=github)](https://cheesss.github.io/lattice-current/)

## What It Is

Lattice Current is a public research fork of a multi-variant intelligence platform centered on one operator shell that combines:

- live global news and OSINT collection
- AI-assisted summaries, deduction, and Q&A
- map-based geopolitical, infrastructure, and market visualization
- ontology and graph-based relation analysis
- canonical event resolution before downstream interpretation
- replay and historical validation surfaces used to calibrate signal quality
- batch compute pipelines that write reusable outputs back to PostgreSQL

## Current design center

The main branch has shifted away from a backtest-first product identity.

The current emphasis is:

- one integrated theme shell for live signal intake, theme briefs, geo context, proposal review, validation, and runtime diagnostics
- canonical event resolution between ingestion and candidate generation
- evidence quality and transmission analysis
- operator-facing decision support
- TypeScript for product surfaces, APIs, and orchestration
- Python for CPU-bound batch compute such as canonical-event clustering and abnormal-return analytics
- replay and NAS-backed historical validation as secondary calibration layers

## Primary entry surface

The canonical product entry is now the theme shell:

- `/` redirects to `/event-dashboard.html`
- `event-dashboard.html` is the main surface for live signals, theme briefs, the 2D Geo Lens, Codex proposal review, approval handling, validation snapshots, and operator diagnostics
- the old main page is retired from the user entry flow and kept only as legacy source material while remaining functionality is absorbed

The heavy backtest-ML modules were removed from the main branch and preserved on `legacy/backtest`.

## Theme shell surfaces

- `Theme Brief`: the main evidence-backed reading surface for the selected theme or signal
- `2D Geo Lens`: flat map surface with legacy risk-region, infrastructure, and event overlays preserved without the globe-first UI
- `Proposal Inbox`: Codex-suggested sources, themes, and exposures with accept or reject review in place
- `Approval Queue`: human-gated actions that execute directly from the shell once accepted
- `Signal And Validation Snapshots`: compact risk, macro, investment, and replay surfaces kept inside the same operator loop
- `Operator Diagnostics`: automation telemetry, system health, data quality, and Codex quality

The same repository still powers multiple variants:

- `full`: geopolitics, conflict, infrastructure, intelligence
- `tech`: AI, startups, cloud, cyber, technology ecosystems
- `finance`: markets, macro, central banks, commodities, cross-asset analysis

## Highlights

- Real-time monitoring across curated feeds, strategic assets, and market data
- AI and statistical analysis layers for summaries, trend detection, evidence handling, and operator briefs
- Canonical event resolution that sits between raw article rows and usable signal objects
- Evidence-first intelligence report generation with client memo, audit appendix, source-query queue, and investment-readiness caps
- Python compute lane for heavy batch analytics while TypeScript remains the orchestration layer
- Ontology graph, transmission graph, and historical validation tooling
- Desktop runtime with Tauri sidecar, local services, and offline-capable workflows
- Single codebase with variant-aware data, panels, and build targets

## Capability areas

- Signal intake: live feeds, OSINT, macro, market, and conflict-oriented datasets
- Evidence handling: event resolution, source quality, corroboration handling, and data quality operations
- Research workflow: Codex-assisted expansion, automation governance, ontology and graph views
- Validation workflow: historical fetch/import, replay, abnormal-return computation, and loader/storage verification
- Report workflow: evidence bundles, signal cards, long-form analyst memos, exhibits, audit appendices, and source-query/backfill tasks
- Decision support: operator briefs, transmission interpretation, watchlist refinement, and guarded recommendations
- Operations: scheduler loops, pipeline heartbeats, retention, and blocker visibility

## Execution boundary

The repository now follows a workload split instead of forcing all compute through one language:

- TypeScript: browser UI, API handlers, schedulers, ingestion, desktop shell
- Python: canonical-event clustering, abnormal-return analytics, model training, and future heavy batch analytics
- Rust: Tauri runtime only, with optional future hot-loop acceleration

Batch compute should write results to NAS PostgreSQL so frontend and API code can consume stable outputs without importing Python directly.

## Repository structure

- `src/`: app shell, panels, services, analysis logic
- `server/`: API handlers and domain services
- `src-tauri/`: desktop runtime and local sidecar
- `docs/`: technical reference and deep-dive docs
- `site/`: GitHub Pages documentation site
- `scripts/`: build, packaging, historical data tooling, and Python-first batch compute entrypoints

## Getting started

```bash
npm install
npm run dev
```

`npm run dev` now starts the integrated theme-shell stack: the event dashboard API plus the Vite frontend. The root path `/` redirects to the theme shell automatically.

Optional Python compute setup:

```bash
python -m pip install -r scripts/requirements-compute.txt
```

Other common commands:

```bash
npm run dev:full
npm run dev:tech
npm run dev:finance
npm run typecheck
npm run build
npm run docs:dev
npm run docs:build
npm run canonical:build -- --dry-run
npm run returns:abnormal -- --dry-run
npm run public:sync:dry
npm run public:sync
```

## Documentation

- Technical docs index: [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md)
- Report generator plan: [docs/INTELLIGENCE_REPORT_GENERATOR_PLAN_2026-05-06.md](docs/INTELLIGENCE_REPORT_GENERATOR_PLAN_2026-05-06.md)
- Report output layer: [docs/REPORT_OUTPUT_LAYER_OVERHAUL_2026-05-09.md](docs/REPORT_OUTPUT_LAYER_OVERHAUL_2026-05-09.md)
- Report handoff: [docs/INTELLIGENCE_REPORT_HANDOFF_2026-05-07.md](docs/INTELLIGENCE_REPORT_HANDOFF_2026-05-07.md)
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
