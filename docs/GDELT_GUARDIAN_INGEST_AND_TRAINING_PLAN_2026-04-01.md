# GDELT, Guardian, And Live News Training Plan

Date: 2026-04-01

## Purpose

This note documents:

1. how the current project uses GDELT and Guardian data,
2. why the current GDELT collector is not suitable as the 5-year historical source of truth,
3. whether live news already shown in the platform can be reused for backfill, backtesting, and continual training,
4. what to implement next.

## Current Source Roles

### GDELT in the current codebase

Current collector:

- `scripts/fetch-historical-data.mjs`

Observed behavior:

- calls `http://api.gdeltproject.org/api/v2/doc/doc`
- uses `mode=ArtList`
- uses keyword queries
- splits date windows
- limits per request with `maxrecords`
- deduplicates article hits
- falls back to Google News RSS on failure

This means the current project is using **GDELT DOC article search**, not the canonical raw historical event streams.

Practical consequence:

- good for recent tactical article retrieval,
- weak for canonical 5-year historical backfill,
- very sensitive to query wording and date-window sparsity.

### Guardian in the current codebase

Current collector:

- `scripts/fetch-news-archive.mjs`

Observed behavior:

- uses Guardian Open Platform Content API,
- stores articles directly in PostgreSQL `public.articles`,
- preserves publisher-level article metadata:
  - source
  - theme
  - published_at
  - title
  - summary
  - url

Practical consequence:

- high-quality publisher archive,
- stable article-level text corpus,
- good for retrieval, narrative analysis, embedding, and text-side training,
- narrower global coverage than GDELT.

## GDELT vs Guardian: What Is Actually Different?

### GDELT

Think of GDELT as a **global structured event and metadata layer** built from world news.

What it is good at:

- large-scale world coverage,
- event coding,
- entity/theme/tone metadata,
- cross-country conflict / macro / geopolitical monitoring,
- event-time analytics,
- graph construction,
- trend and contagion analysis.

What it is weak at in the current project path:

- exact long-range article retrieval through DOC queries,
- reproducible 5-year full corpus backfill with keyword slicing,
- publisher-quality full-text archival.

Example:

- If the goal is "find geopolitical stress patterns across countries, actors, themes, and tones over five years",
  GDELT Event/GKG is the right backbone.
- If the goal is "retrieve a clean article body and its publisher context to embed and compare narratives",
  GDELT DOC is weaker than direct publisher APIs or a dedicated news archive.

### Guardian

Think of Guardian as a **single-publisher, high-quality article corpus**.

What it is good at:

- full article retrieval,
- stable schema,
- article-level archive behavior,
- narrative inspection,
- embeddings and RAG,
- event explanation and interpretation.

What it is weak at:

- not a global event backbone,
- no multi-publisher consensus by itself,
- cannot replace GDELT for worldwide structured event coverage.

Example:

- GDELT can tell us that a conflict/intensity/tone/location pattern is rising globally.
- Guardian can give us a cleaner article-level narrative about one slice of that pattern.

The two are not substitutes. They belong in different layers.

## What The Platform's Live News Can Already Do

### Real-time source input already exists

Relevant code:

- `src-tauri/sidecar/local-api-server.mjs`

Observed behavior:

- the sidecar includes live RSS/news source seeds such as:
  - BBC World
  - The Guardian World
  - Al Jazeera
  - Crisis Group
  - Defense News
  - Economist
  - Dow Jones Markets
  - CNBC
  - CoinDesk
  - The Record
- the app already has live/local intelligence import endpoints:
  - `/api/local-intelligence-import`
  - replay/archive endpoints around the same path family

Meaning:

- the platform already has a working path to fetch live news,
- convert it into local historical artifacts,
- import those artifacts into the historical engine.

### Backtest and adaptation state already consume replay outputs

Relevant code:

- `src/services/historical-intelligence.ts`
- `src/services/replay-adaptation.ts`
- `src/services/investment/conviction-scorer.ts`
- `src/services/investment/learning-state-io.ts`

Observed behavior:

- replay runs produce:
  - idea runs
  - forward returns
  - theme diagnostics
  - source credibility state
  - mapping stats
- replay results are persisted and adaptation snapshots are updated,
- conviction weights are updated online from realized returns,
- bandit state, tracked ideas, mapping stats, Hawkes state, discovered links, and conviction model state are all persisted.

Meaning:

- the system already supports **lightweight online adaptation**,
- but it does **not yet implement a full continual retraining pipeline over a unified article corpus**.

## Can Live Platform News Be Used As Ongoing Training Input?

### Short answer

Yes, but only partially today.

### What is already implemented

Implemented now:

- live news can be fetched,
- historical artifacts can be imported,
- replay runs can be generated,
- replay outcomes can update:
  - replay adaptation state,
  - conviction model weights,
  - source credibility state,
  - mapping performance stats,
  - bandit states,
  - tracked ideas.

This is already useful.

### What is not fully implemented yet

Not fully implemented:

- no unified "live article -> embedding -> retrieval -> labeled outcome -> retraining dataset" pipeline,
- no robust article warehouse joining publisher text with backtest outcome labels,
- no scheduled continuous retraining job over accumulated article-level history,
- no canonical historical article/event store that blends:
  - Guardian / NYT / other article APIs
  - GDELT raw Event/GKG
  - live platform RSS/news flows

## Why Reusing Live News Is Worth It

Benefits if implemented properly:

1. better coverage continuity
- recent platform-visible news becomes part of future training data automatically,
- reduces the gap between "what the operator saw live" and "what the model later learns from".

2. better regime adaptation
- source credibility and conviction weights can adapt to current conditions faster.

3. better narrative learning
- article text can be embedded and linked to realized outcomes,
- this is the missing bridge for learned narrative scorers.

4. better replay realism
- if live ingestion becomes the same source family that later feeds historical replay,
  train/test behavior becomes closer to production reality.

## Why The Current GDELT Path Should Not Be Forced To Fill Gaps

The issue is not just missing rows.

The deeper problem is source mismatch:

- current GDELT path = search API article hits,
- desired use = 5-year canonical historical event backbone.

If we keep trying to fill historical gaps with more DOC keyword windows, we will create:

- inconsistent coverage,
- query-dependent blind spots,
- misleading apparent completeness.

The correct fix is architectural:

- use GDELT raw Event/GKG or BigQuery for historical event backbone,
- use Guardian/NYT/Event Registry-style sources for article archive and narrative text.

## Recommended Target Architecture

### Layer 1: Structured historical event backbone

Use:

- GDELT Event raw files / BigQuery
- GDELT GKG raw files / BigQuery
- ACLED for conflict ground truth

Role:

- event counts,
- actors,
- locations,
- themes,
- tone,
- temporal event structure,
- geopolitical backbone for replay.

### Layer 2: Article archive and narrative corpus

Use:

- Guardian
- NYT
- Event Registry / NewsAPI.ai style archive
- optionally selected live-source RSS capture

Role:

- full text,
- embeddings,
- RAG,
- learned narrative factors,
- disagreement / novelty analysis,
- article-level explanation layer.

### Layer 3: Live production stream

Use:

- current app-visible news and source seeds from `local-api-server.mjs`

Role:

- recent operational input,
- rolling training additions,
- shadow evaluation,
- post-hoc outcome labeling.

## Implementation Sequence

### Phase A: Stop using DOC API as the 5-year backbone

Implement:

1. `backfill-gdelt-events-raw.mjs`
2. `backfill-gdelt-gkg-raw.mjs`
3. NAS raw partition layout:
   - `raw/gdelt/events/YYYY/MM/DD/...`
   - `raw/gdelt/gkg/YYYY/MM/DD/...`

Keep current `gdelt-doc` only for:

- recent tactical enrichment,
- spot searches,
- operator-facing exploratory fetches.

### Phase B: Build a unified article warehouse

Implement:

1. Guardian/NYT archive stabilization,
2. NYT pagination,
3. article embedding generation,
4. optional Event Registry-style archive integration,
5. article outcome labeling:
   - map article -> event/theme/symbol -> realized return horizon.

### Phase C: Connect live news to continual learning

Implement:

1. persist live platform-visible news into the article warehouse,
2. schedule periodic historical import snapshots,
3. attach realized outcome labels after horizon completion,
4. materialize training sets for:
   - narrative scorer
   - trade/no-trade meta model
   - source dependence calibration

### Phase D: Retraining and validation

Implement:

1. batch narrative scorer retraining,
2. meta-labeling retraining,
3. replay-based calibration,
4. validation with CPCV / DSR / PBO before promotion.

## Immediate Recommendation

Do these next:

1. build a new GDELT historical collector based on raw Event/GKG or BigQuery,
2. keep Guardian as the article-text archive layer,
3. route live app news into the same warehouse schema,
4. add outcome labeling and embedding generation,
5. only then promote learned narrative and continual training beyond shadow mode.

## Summary

- GDELT and Guardian are different layers, not interchangeable sources.
- The current project uses GDELT DOC article search, which is not the right tool for 5-year historical completeness.
- The platform already has enough replay/adaptation machinery to benefit from ongoing live-news capture.
- What is missing is a unified article-and-event warehouse plus scheduled labeling/retraining.
