# Lattice Current

News event to asset reaction analysis platform. Collects articles from 40+ real-time sources, clusters them into canonical events, measures abnormal returns against matched controls, and surfaces statistically grounded trading signals.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![GitHub Pages](https://img.shields.io/badge/docs-GitHub%20Pages-24292f?logo=github)](https://cheesss.github.io/lattice-current/)

## What it does

```
40+ news sources → article ingestion → canonical event clustering
    → abnormal return calculation (market/sector adjusted)
    → matched control comparison → evidence grading (E0~E4)
    → multi-task meta-model prediction → investment signal generation
```

1. **Collect**: Guardian, NYT, BBC, Reuters, GDELT, HackerNews, arXiv, and 30+ more sources
2. **Cluster**: Deduplicate overlapping coverage into canonical events via embedding similarity
3. **Measure**: Calculate abnormal returns by subtracting market/sector benchmarks
4. **Validate**: Match each event against control days (same weekday, similar VIX/yield spread) to estimate causal uplift
5. **Predict**: Multi-task neural network outputs P(alpha>0), E[alpha], downside risk, and time-to-peak
6. **Grade**: Evidence ladder from E0 (noise) through E2 (statistically significant) to E4 (mechanism confirmed)

## Architecture

```
Layer 1 — Rules & Statistics (60 formulas)
  Hawkes process, HMM regime, Kalman filter, Transfer entropy,
  Truth discovery, Graph inference, Contextual bandit, RMT, ...

Layer 2 — Learning Meta-Model (PyTorch)
  Formula outputs become features → multi-task MLP → final predictions
  OOS Brier 0.216, accuracy 68.2%

Layer 3 — Counterfactual Validation
  Abnormal returns, matched controls, evidence ladder, purged walk-forward
```

### Language boundary

- **TypeScript**: Browser UI, API handlers, schedulers, ingestion, desktop shell
- **Python**: Canonical event clustering, abnormal return analytics, model training, batch compute
- **Rust**: Tauri desktop runtime

Python writes results to NAS PostgreSQL; TypeScript reads and displays them.

## Data scale

| Table | Rows | Purpose |
|-------|------|---------|
| articles | 67k+ | News articles with embeddings |
| labeled_outcomes | 619k+ | Article-symbol return labels |
| canonical_events | 53k+ | Deduplicated event clusters |
| event_features | 53k+ | 17+ features per event (meta-model input) |
| event_uplift | 116k+ | Uplift vs matched controls + evidence grade |
| matched_controls | 133k+ | Event-to-control day pairings |

## Dashboard

The primary interface is `event-dashboard.html` — a standalone dashboard with:

- KPI strip: VIX, risk gauge, regime, spreads, oil, dollar, E2 signal count
- Analytics: evidence distribution, alpha decay, Hawkes heatmap, signal correlation, regime timeline, calibration chart
- 2D geo lens with theme filters and LOD-optimized layers
- EN/KO language toggle

## Getting started

```bash
npm install
npm run dev          # Vite + API server + meta-model GPU server

# Separate terminal: 5-minute pipeline daemon
node --import tsx scripts/master-daemon.mjs
```

Optional Python compute:

```bash
pip install -r scripts/requirements-compute.txt
python scripts/train-meta-model.py --epochs 50    # model training
python scripts/compare-models.py                   # model comparison
```

## Pipeline

`master-pipeline.mjs` runs 7 steps every 5 minutes:

1. Data collection (40+ sources)
2. Article classification + symbol mapping
3. Event engine (Python-first, JS fallback): clustering, alpha, alignment, features, controls
4. Codex proposals (AI-suggested new sources/themes/symbols)
5. Proposal execution with budget/quality gates
6. Incremental event engine update
7. Signal snapshot

## Repository structure

```
src/              App shell, panels, services, analysis logic
scripts/          Pipeline scripts, Python batch compute, model training
server/           API handlers and domain services
src-tauri/        Desktop runtime and local sidecar
site/             GitHub Pages documentation
docs/             Technical reference
```

## Variants

The same codebase powers three build variants:

- **full**: Geopolitics, conflict, infrastructure, intelligence
- **tech**: AI, startups, cloud, cyber, technology ecosystems
- **finance**: Markets, macro, central banks, commodities, cross-asset

## License

[AGPL-3.0-only](LICENSE)
