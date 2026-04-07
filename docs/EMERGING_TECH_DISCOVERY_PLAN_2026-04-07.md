# Emerging Tech Discovery Plan

Date: 2026-04-07  
Status: tranche 3 implemented

## Goal

Build a durable emerging-technology discovery path that does not depend on
predefined main themes only.

The target flow is:

1. ingest broad tech-native sources
2. discover clusters outside the current main-theme anchors
3. label those clusters into operator-readable topics
4. expose them through the dashboard and automation
5. reuse them in downstream symbol and report generation

## Implemented in tranche 1

### Schema

Added canonical emerging-tech tables:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\_shared\schema-emerging-tech.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/_shared/schema-emerging-tech.mjs)
  - `discovery_topics`
  - `discovery_topic_articles`
  - `tech_reports`
  - `backfill_state`

This is the key structural change. Discovery topics now have a durable
membership table instead of being represented only by loose keyword labels.

### Hacker News archive backfill

Added:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\fetch-hackernews-archive.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/fetch-hackernews-archive.mjs)

Capabilities:

- time-bounded archive fetch
- score thresholding
- durable checkpoint state
- NAS PostgreSQL ingestion into `articles`
- `backfill_state` synchronization

### Discovery pipeline

Added:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\_shared\emerging-tech-discovery.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/_shared/emerging-tech-discovery.mjs)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\discover-emerging-tech.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/discover-emerging-tech.mjs)

Current logic:

- builds main-theme anchors from labeled outcomes
- classifies low-similarity article embeddings as potentially emerging
- clusters them with deterministic k-means
- computes:
  - keywords
  - monthly counts
  - momentum
  - diversity
  - cohesion
  - parent theme similarity
- persists both topic rows and topic-article memberships

### Topic labeling

Added:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\_shared\codex-json.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/_shared/codex-json.mjs)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\label-discovery-topics.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/label-discovery-topics.mjs)

Current logic:

- loads pending discovery topics
- pulls representative article titles
- uses Codex JSON output for topic naming and metadata
- stores:
  - `label`
  - `description`
  - `category`
  - `stage`
  - `key_companies`
  - `key_technologies`
  - `novelty`
  - raw metadata

### Dashboard and daemon wiring

Updated:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\event-dashboard-api.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/event-dashboard-api.mjs)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\master-daemon.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/master-daemon.mjs)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\_shared\daemon-contract.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/_shared/daemon-contract.mjs)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\auto-pipeline.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/auto-pipeline.mjs)

New API routes:

- `/api/emerging-tech`
- `/api/emerging-tech/:id`
- `/api/emerging-tech/timeline`
- `/api/reports/latest`
- `/api/reports/:id`
- `/api/digest/weekly`

New daemon tasks:

- `discover-emerging-tech`
- `label-discovery-topics`

`auto-pipeline` step 2 now consumes labeled discovery topics through
`discovery_topic_articles`, so dynamic topics are no longer stranded outside the
existing symbol-scoring path.

## Validation completed

Executed successfully:

```bash
node --import tsx --test tests/fetch-hackernews-archive.test.mjs tests/emerging-tech-discovery.test.mjs tests/label-discovery-topics.test.mjs tests/schema-emerging-tech.test.mjs tests/event-dashboard-emerging-tech.test.mjs tests/auto-pipeline-dryrun.test.mjs tests/master-daemon-guardrails.test.mjs
npm run typecheck
npm run build
npm run test:ci:core
npm run test:ci:data-integrity
```

## Guardrails

- Do not treat `discovery_topics` rows as usable if `discovery_topic_articles`
  is empty. Topic membership is part of the contract.
- Do not treat ingestion as complete because a source row count increased. The
  topic must be discoverable through the dashboard or daemon path.
- Do not add a second ad-hoc discovery table for article membership. Reuse
  `discovery_topic_articles`.
- Do not wire dynamic topics only into UI. They must also remain consumable by
  the downstream scoring path.
- Do not treat topic quality as article count only. Source-quality scoring must
  remain durable in schema and visible through API/detail views.
- Do not mark a new source complete until it has:
  1. canonical ingestion
  2. discovery visibility
  3. labeling compatibility
  4. runtime/API surface
  5. runtime smoke verification

## Implemented in tranche 2

### arXiv archive ingestion

Added:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\fetch-arxiv-archive.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/fetch-arxiv-archive.mjs)

Capabilities:

- official arXiv API ingestion across configurable categories
- durable checkpoint state in both file and `backfill_state`
- canonical `articles` ingestion with `source='arxiv'`
- category query reuse instead of one-off ad-hoc feed parsing

### Research momentum

Updated:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\discover-emerging-tech.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/discover-emerging-tech.mjs)

`discovery_topics.research_momentum` is now computed from article memberships whose
source is `arxiv`. This means research coverage is no longer a side metric outside
the discovery contract.

### Topic reports

Added:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\generate-tech-report.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/generate-tech-report.mjs)

Current logic:

- loads labeled or stale reported topics
- loads article memberships and related symbols
- uses Codex JSON when available
- degrades to a deterministic thesis when Codex is unavailable or invalid
- persists into canonical `tech_reports`
- upgrades topic status to `reported`

### Weekly digest

Added:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\generate-weekly-digest.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/generate-weekly-digest.mjs)

Current logic:

- loads top current discovery topics
- loads recent `tech_reports`
- generates weekly digest JSON in `data/weekly-digest-YYYY-MM-DD.json`
- uses Codex JSON when available
- degrades to deterministic digest text when Codex is unavailable or invalid

### Runtime surface

Updated:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\master-daemon.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/master-daemon.mjs)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\_shared\daemon-contract.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/_shared/daemon-contract.mjs)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\event-dashboard.html](/C:/Users/chohj/Documents/Playground/lattice-current-fix/event-dashboard.html)

New daemon tasks:

- `arxiv-backfill`
- `generate-tech-report`
- `generate-weekly-digest`

Dashboard HTML now exposes:

- top emerging topics
- latest report cards
- weekly digest summary

## Implemented in tranche 3

### Source-quality scoring

Updated:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\_shared\schema-emerging-tech.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/_shared/schema-emerging-tech.mjs)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\_shared\emerging-tech-discovery.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/_shared/emerging-tech-discovery.mjs)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\discover-emerging-tech.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/discover-emerging-tech.mjs)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\generate-tech-report.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/generate-tech-report.mjs)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\event-dashboard-api.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/event-dashboard-api.mjs)

Canonical durable fields now include:

- `discovery_topics.source_quality_score`
- `discovery_topics.source_quality_breakdown`
- `tech_reports.source_quality_score`

### Detail drill-down

Updated:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\event-dashboard.html](/C:/Users/chohj/Documents/Playground/lattice-current-fix/event-dashboard.html)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\event-dashboard-api.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/event-dashboard-api.mjs)

The dashboard now exposes:

- clickable topic cards
- clickable report cards
- selected topic detail
- selected report detail

### Runtime smoke verification

Added:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\verify-emerging-tech-runtime.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/verify-emerging-tech-runtime.mjs)

Package command:

```bash
npm run verify:emerging-tech:runtime
```

## Remaining phases

### Next priority

1. expand sources beyond Hacker News and arXiv only after the current contract is exercised

### Deferred for now

- Wikipedia and raw GDELT article ingestion
- report-generation Codex thesis synthesis
- weekly digest webhook delivery

## Operator commands

Schema:

```bash
node --import tsx scripts/_shared/schema-emerging-tech.mjs
```

Backfill:

```bash
node --import tsx scripts/fetch-hackernews-archive.mjs --since 2021-01-01
node --import tsx scripts/fetch-arxiv-archive.mjs --since 2021-01-01 --max-batches 5
```

Discovery:

```bash
node --import tsx scripts/discover-emerging-tech.mjs --limit 20000
node --import tsx scripts/label-discovery-topics.mjs --limit 5
node --import tsx scripts/generate-tech-report.mjs --limit 5
node --import tsx scripts/generate-weekly-digest.mjs
npm run verify:emerging-tech:runtime
```

Dashboard checks:

```bash
curl http://127.0.0.1:46200/api/emerging-tech
curl http://127.0.0.1:46200/api/emerging-tech/timeline
curl http://127.0.0.1:46200/api/reports/latest
curl http://127.0.0.1:46200/api/digest/weekly
```
