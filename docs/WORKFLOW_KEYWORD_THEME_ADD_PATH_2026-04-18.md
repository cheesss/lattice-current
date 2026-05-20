# Workflow Deep-Dive: Keyword + Theme-Add Path

> **Status**: reference (code-level expansion of [CONNECTED_SYSTEM_WORKFLOW_DETAILED_EXPLAINED_2026-04-18.md](./CONNECTED_SYSTEM_WORKFLOW_DETAILED_EXPLAINED_2026-04-18.md) §"키워드/테마 추가는 어디에 들어가나")

Parent doc's summary:

`콘텐츠 저장소 → 테마/전파 계산 → 스냅샷 빌더 → Home/Investigate → 인간 리뷰`

This doc expands each stage with the actual scripts, LLM calls, and NAS
tables that run.

## Two different "keyword/theme" inputs

Important distinction:

1. **System-generated candidates** — LLM + clustering propose themes from
   the article corpus. Operator reviews in Decision Inbox.
2. **Operator-proposed add-theme** — Operator explicitly asks the system
   to track a new theme. Runs through `handleAddTheme` in the executor.

Both converge on the same `auto_theme_symbols` + `auto_article_themes`
tables, but their review flows differ.

## Candidate generation — system side

### Theme candidates from clustering

`scripts/generate-codex-theme-proposals.mjs` (daemon task
`generate-codex-theme-proposals`, 6-hourly):

1. Reads recent `canonical_events` + `discovery_topics`.
2. Builds prompts describing recent clusters.
3. Calls Claude API to propose theme labels + associated keywords + asset
   symbols.
4. Writes to `codex_proposals` with `kind='add-theme'`.

Related inputs:

- `scripts/fast-keyword-extractor.mjs` — noun-phrase surfacer over article titles
- `scripts/label-discovery-topics.mjs` — BERTopic-style cluster labels
- `scripts/codex-from-analysis.mjs` — alternative path that pulls from
  analytical snapshots into proposal drafts

### Evidence enrichment

Before the proposal reaches review, evidence surfaces are built:

- `scripts/fetch-openalex-theme-evidence.mjs` — academic evidence
- `scripts/fetch-github-theme-evidence.mjs` — engineering/commit evidence
- `scripts/refresh-sec-theme-exposure.mjs` — SEC filing exposure

These populate `theme_openalex_evidence`, `theme_github_evidence`,
`theme_entity_exposure`. The Decision Inbox surfaces them as citations
when the operator opens the proposal.

## Candidate generation — operator side

Operator can submit via:

- Decision Inbox "Propose Theme" form
- OpenClaw tool call (`propose_theme` — hits the same API endpoint)

Both write a `codex_proposals` row with:

- `kind='add-theme'`
- `payload.triggers` — keyword list that defines which articles belong
- `payload.symbols` — optional: pre-assigned asset mapping

## Review storage

All theme proposals land in `codex_proposals`. Same table as source-add —
but with `kind='add-theme'`. The Decision Inbox filters on `kind`.

Additional context surfaced on review:

- `approval_queue` — human-visible queue with reasoning
- `theme_brief_notebooks` — working notes the operator can attach
- `theme_structural_alerts` — algorithmic warnings on low evidence /
  stale activity

## Execution

Approved `add-theme` proposals go to `scripts/proposal-executor.mjs`
`handleAddTheme`. After this session's bulk-INSERT rewrite, the executor:

1. Finds articles matching the trigger keywords via a single
   `SELECT FROM articles WHERE title ILIKE any trigger`.
2. **One bulk INSERT** into `auto_article_themes` — binds those articles
   to the new theme at `confidence=0.7`.
3. **One bulk INSERT** into `auto_theme_symbols` — registers the
   theme↔symbol mappings from the proposal.
4. For each article × symbol × horizon (1w / 2w / 1m), computes forward
   return from `worldmonitor_intel.historical_raw_items` Yahoo prices and
   **one bulk INSERT** into `labeled_outcomes`.
5. Refreshes `stock_sensitivity_matrix` with one aggregate SQL.

Pre-rewrite this was up to ~12k round-trips per large proposal; post-rewrite
it is ~22 (see commit `329e9071`).

## Downstream propagation

Once theme rows exist in the tables above, downstream consumers pick them up:

- `scripts/auto-pipeline.mjs` — runs `labeled_outcomes` → theme-level sensitivity updates
- `scripts/event-engine-full-build.mjs` — propagates into `regime_conditional_impact`, `event_hawkes_intensity`
- `event-dashboard-api.mjs` KPI + theme-brief endpoints serve theme cards

The dashboard (`Home`, `Investigate`) then shows:

- Theme chip in the KPI strip
- Theme brief page with evidence, reactions, related signals
- Signal queue row if the theme triggers an actionable reaction

## Keyword backfill for theme trackers

Once a theme is live, `scripts/fetch-keyword-news-backfill.mjs` runs
on-demand to pull historical articles matching the trigger terms into
`articles`. This back-populates the theme with historical context without
waiting for new articles.

## Theme lifecycle

Themes don't stay static:

- `scripts/compute-trend-aggregates.mjs` updates `theme_trend_aggregates`
  daily — activity / sentiment trends
- `scripts/generate-structural-alerts.mjs` emits `theme_structural_alerts`
  when a theme's evidence pattern shifts (e.g. all signals go stale)
- `scripts/repair-theme-shell-data.mjs` and `migrate-taxonomy.mjs` handle
  reorganisations (merging themes, renaming, reparenting under a new
  `parent_theme`)

## Key tables

| Table | Role |
|---|---|
| `auto_article_themes` | Article → theme binding (many-to-many via theme string) |
| `auto_theme_symbols` | Theme → symbol mapping with `avg_abs_reaction`, `correlation` |
| `codex_proposals` | Unified proposal + status |
| `auto_theme_symbol_candidates` | Pre-approval symbol suggestions |
| `labeled_outcomes` | Theme × symbol × horizon forward returns |
| `stock_sensitivity_matrix` | Aggregated theme×symbol×horizon sensitivity |
| `theme_lifecycle_transitions` | Audit log of theme state changes |
| `theme_brief_notebooks` | Operator notes per theme |
| `theme_openalex_evidence` / `theme_github_evidence` | External evidence surfaces |

## Operational gotchas

- **Trigger specificity matters.** Over-broad triggers (`"ai"`, `"tech"`)
  match tens of thousands of articles and balloon `auto_article_themes`.
  The bulk-INSERT rewrite handles it, but downstream aggregates become
  noisy. Prefer 2-3-word trigger phrases.
- **Confidence=0.7 is a ceiling on overwrite.** The ON CONFLICT clause
  only overwrites a previous theme binding if the existing confidence is
  lower than 0.7 — so a higher-confidence manual tag survives automated
  rewrites. This matters when you have both LLM and operator sources.
- **Symbols without price history silently produce zero labeled_outcomes.**
  The executor needs `worldmonitor_intel.historical_raw_items` entries for
  the symbol. New tickers the Yahoo warm store hasn't seen will get empty
  outcomes until bootstrap runs.

## Related code pointers

- Theme proposal generator: `scripts/generate-codex-theme-proposals.mjs`
- Theme executor: `scripts/proposal-executor.mjs:handleAddTheme`
- Keyword extraction: `scripts/fast-keyword-extractor.mjs`
- Cluster labelling: `scripts/label-discovery-topics.mjs`
- Keyword backfill: `scripts/fetch-keyword-news-backfill.mjs`
- Theme lifecycle: `scripts/compute-trend-aggregates.mjs`, `generate-structural-alerts.mjs`
- Evidence surfaces: `scripts/fetch-{openalex,github}-theme-evidence.mjs`, `refresh-sec-theme-exposure.mjs`
- Dashboard serving: `scripts/event-dashboard-api.mjs` + `_shared/trend-dashboard-queries.mjs` +
  `_shared/theme-shell-snapshot-builders.mjs`
