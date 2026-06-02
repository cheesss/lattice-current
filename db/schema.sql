-- db/schema.sql
-- Lattice Current — foundational base-table schema for a FRESH EMPTY Postgres 16.
--
-- Purpose: the repo is split-brained. ~108 analytics/report tables self-create via
-- `CREATE TABLE IF NOT EXISTS` inside their owning modules, but a set of foundational
-- "base" tables have NO CREATE TABLE anywhere and were assumed to pre-exist on a
-- private NAS Postgres. This file creates exactly those gap base tables (plus copies
-- of the few demo-seed tables that ARE self-created elsewhere, so the seed can run
-- before their owning script) so the minimal demo works against an empty DB:
--   node scripts/generate-intelligence-report.mjs --db --depth deep --type theme_report --subject "AI / Machine Learning"
-- plus populated dashboard panels (research-seeds, report backfill closure, decision inbox).
--
-- Idempotent + non-destructive: every statement is CREATE ... IF NOT EXISTS or an
-- ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS migration so it is safe to run
-- repeatedly and is a no-op once later module ensureSchema/migrations have already run.
-- No DROP anywhere. Column names/types are derived from ACTUAL reader/writer usage
-- (see per-table provenance in db/seed.sql comments), not guesswork.

-- pgvector extension (docker image is pgvector/pgvector:pg16). Required by
-- articles.embedding / canonical_events.avg_embedding (used with the <=> operator
-- in scripts/build-canonical-events.mjs and scripts/auto-pipeline.mjs).
CREATE EXTENSION IF NOT EXISTS vector;

-- ===========================================================================
-- articles  (GAP base table — no CREATE TABLE anywhere)
--   read:  scripts/_shared/report-db-adapter.mjs:509-522,767 (id,source,theme,
--          published_at,title,summary,url,wire_source,publisher_group,market_relevance)
--          + :235-243 (source_quality_score, evidence_grade)
--   read:  scripts/event-dashboard-api.mjs:946-953 (published_at), :804-808
--          (market_relevance), :1175 (embedding via <=>)
--   write: scripts/fetch-news-archive.mjs:67-70 + ensureSchema:117-118 (url + UNIQUE INDEX)
--   alter: scripts/migrations/add-articles-source-metadata.mjs:22-45 (wire_source,
--          publisher_group, market_relevance + CHECK + indexes)
--   alter: scripts/fix-time-alignment.legacy.mjs:47 (market_session)
--   id is INTEGER/SERIAL: auto-pipeline.mjs:301 FK `article_id INTEGER REFERENCES articles(id)`.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS articles (
  id SERIAL PRIMARY KEY,
  source TEXT,
  theme TEXT,
  published_at TIMESTAMPTZ,
  title TEXT,
  summary TEXT,
  url TEXT,
  embedding vector(768),
  wire_source TEXT,
  publisher_group TEXT,
  market_relevance TEXT,
  source_quality_score DOUBLE PRECISION,
  evidence_grade TEXT,
  market_session TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- ensureSchema/migration ALTERs made into no-ops on fresh installs:
ALTER TABLE articles ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS wire_source TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS publisher_group TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS market_relevance TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS source_quality_score DOUBLE PRECISION;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS evidence_grade TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS market_session TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS embedding vector(768);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'articles'
      AND constraint_name = 'articles_market_relevance_check'
  ) THEN
    ALTER TABLE articles
      ADD CONSTRAINT articles_market_relevance_check
        CHECK (market_relevance IS NULL OR market_relevance IN ('high','medium','low'));
  END IF;
END $$;
-- Dedup key used by fetch-news-archive.mjs:118 (ON CONFLICT DO NOTHING relies on it):
CREATE UNIQUE INDEX IF NOT EXISTS articles_url_idx ON articles (url);
CREATE INDEX IF NOT EXISTS idx_articles_theme_published_at
  ON articles (theme, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_wire_source
  ON articles (wire_source) WHERE wire_source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_articles_publisher_group
  ON articles (publisher_group) WHERE publisher_group IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_articles_market_relevance
  ON articles (market_relevance) WHERE market_relevance IS NOT NULL;

-- ===========================================================================
-- canonical_events  (GAP base table — no CREATE TABLE anywhere)
--   write: scripts/build-canonical-events.mjs:166-214, build_canonical_events.py:119-134
--   read:  scripts/_shared/report-db-adapter.mjs:716-747,798-836
--   read:  scripts/event-dashboard-api.mjs:794-798, :5488-5492
--   alter: scripts/migrations/add-canonical-events-hhi.mjs:27-36
-- ===========================================================================
CREATE TABLE IF NOT EXISTS canonical_events (
  id SERIAL PRIMARY KEY,
  event_date DATE,
  theme TEXT,
  representative_title TEXT,
  source_count INTEGER DEFAULT 0,
  source_diversity DOUBLE PRECISION DEFAULT 0,
  article_count INTEGER DEFAULT 0,
  avg_embedding vector(768),
  source_hhi DOUBLE PRECISION,
  effective_source_count DOUBLE PRECISION,
  wire_dominated BOOLEAN NOT NULL DEFAULT FALSE,
  top_source_share DOUBLE PRECISION,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE canonical_events ADD COLUMN IF NOT EXISTS source_hhi DOUBLE PRECISION;
ALTER TABLE canonical_events ADD COLUMN IF NOT EXISTS effective_source_count DOUBLE PRECISION;
ALTER TABLE canonical_events ADD COLUMN IF NOT EXISTS wire_dominated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE canonical_events ADD COLUMN IF NOT EXISTS top_source_share DOUBLE PRECISION;
ALTER TABLE canonical_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_canonical_events_theme_event_date
  ON canonical_events (theme, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_canonical_events_event_date
  ON canonical_events (event_date DESC);
CREATE INDEX IF NOT EXISTS idx_canonical_events_wire_dominated
  ON canonical_events (wire_dominated) WHERE wire_dominated = true;

-- ===========================================================================
-- article_event_map  (GAP base table — no CREATE TABLE anywhere)
--   write: scripts/build-canonical-events.mjs:171/220 (article_id, canonical_event_id)
--   read:  scripts/_shared/report-db-adapter.mjs:768-772 (JOIN articles ON a.id = aem.article_id)
--   read:  scripts/event-dashboard-api.mjs:806-808
-- ===========================================================================
CREATE TABLE IF NOT EXISTS article_event_map (
  article_id INTEGER NOT NULL REFERENCES articles(id),
  canonical_event_id INTEGER NOT NULL REFERENCES canonical_events(id),
  PRIMARY KEY (article_id, canonical_event_id)
);
CREATE INDEX IF NOT EXISTS idx_article_event_map_event
  ON article_event_map (canonical_event_id);

-- ===========================================================================
-- event_uplift  (GAP base table — no CREATE TABLE anywhere)
--   write: scripts/incremental-event-engine.mjs:542 + ON CONFLICT (canonical_event_id,symbol,horizon):578
--   read:  scripts/_shared/report-db-adapter.mjs:725-734,774-826
--   read:  scripts/event-dashboard-api.mjs:814-833
-- ===========================================================================
CREATE TABLE IF NOT EXISTS event_uplift (
  id SERIAL PRIMARY KEY,
  canonical_event_id INTEGER NOT NULL REFERENCES canonical_events(id),
  symbol TEXT NOT NULL,
  horizon TEXT NOT NULL,
  event_alpha DOUBLE PRECISION,
  control_avg_return DOUBLE PRECISION,
  uplift DOUBLE PRECISION,
  t_stat DOUBLE PRECISION,
  n_controls INTEGER,
  evidence_grade TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (canonical_event_id, symbol, horizon)
);
CREATE INDEX IF NOT EXISTS idx_event_uplift_canonical_event
  ON event_uplift (canonical_event_id);
CREATE INDEX IF NOT EXISTS idx_event_uplift_grade
  ON event_uplift (evidence_grade);

-- ===========================================================================
-- event_features  (GAP base table — no CREATE TABLE anywhere)
--   write: scripts/incremental_event_engine.py:446-465 (full INSERT column list)
--   read:  scripts/calibrate-meta-model.py:121-125, compare-models.py:94,
--          compute-validation-metrics.py:127-128 (JOIN on canonical_event_id)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS event_features (
  canonical_event_id INTEGER PRIMARY KEY REFERENCES canonical_events(id),
  source_count INTEGER,
  source_diversity DOUBLE PRECISION,
  article_count INTEGER,
  hawkes_intensity DOUBLE PRECISION,
  hawkes_momentum DOUBLE PRECISION,
  hmm_regime TEXT,
  vix_value DOUBLE PRECISION,
  vix_zscore DOUBLE PRECISION,
  vix_momentum DOUBLE PRECISION,
  yield_spread DOUBLE PRECISION,
  oil_price DOUBLE PRECISION,
  dollar_index DOUBLE PRECISION,
  credit_spread_hy DOUBLE PRECISION,
  market_stress DOUBLE PRECISION,
  transmission_strength DOUBLE PRECISION,
  event_intensity DOUBLE PRECISION,
  regime_label TEXT,
  regime_multiplier DOUBLE PRECISION,
  risk_gauge DOUBLE PRECISION,
  graph_signal_score DOUBLE PRECISION,
  nmi_score DOUBLE PRECISION,
  narrative_alignment DOUBLE PRECISION,
  truth_discovery_score DOUBLE PRECISION,
  legacy_conviction DOUBLE PRECISION,
  legacy_fpr DOUBLE PRECISION,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===========================================================================
-- event_impact_profiles  (GAP base table — no CREATE TABLE anywhere)
--   read:  scripts/event-dashboard-api.mjs:5225-5230 (article_id,event_date,title,
--          source,theme,symbol,forward_return_pct,hit,reaction_pattern,
--          causal_explanation,horizon), :5255-5259 (reaction_pattern GROUP BY)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS event_impact_profiles (
  id BIGSERIAL PRIMARY KEY,
  article_id INTEGER,
  event_date DATE,
  title TEXT,
  source TEXT,
  theme TEXT,
  symbol TEXT,
  horizon TEXT,
  forward_return_pct DOUBLE PRECISION,
  hit BOOLEAN,
  reaction_pattern TEXT,
  causal_explanation TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_event_impact_profiles_symbol_horizon
  ON event_impact_profiles (symbol, horizon);
CREATE INDEX IF NOT EXISTS idx_event_impact_profiles_title
  ON event_impact_profiles (title);

-- ===========================================================================
-- gdelt_daily_agg  (GAP base table — no CREATE TABLE anywhere)
--   write: scripts/backfill-gdelt-events.mjs:240 + ON CONFLICT (date,country,cameo_root)
--   read:  scripts/inject-gdelt-agg-to-raw-items.mjs:34-36
-- ===========================================================================
CREATE TABLE IF NOT EXISTS gdelt_daily_agg (
  date DATE NOT NULL,
  country TEXT NOT NULL,
  cameo_root TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  avg_goldstein DOUBLE PRECISION,
  avg_tone DOUBLE PRECISION,
  num_mentions BIGINT,
  num_sources BIGINT,
  num_articles BIGINT,
  PRIMARY KEY (date, country, cameo_root)
);
CREATE INDEX IF NOT EXISTS idx_gdelt_daily_agg_cameo_root
  ON gdelt_daily_agg (cameo_root, date DESC);

-- ===========================================================================
-- themes  (GAP base table — legacy taxonomy table assumed to pre-exist)
-- No minimal-demo consumer SELECTs bare `themes`; defined minimally so a fresh DB
-- carries the foundational table. Not seeded.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS themes (
  theme TEXT PRIMARY KEY,
  label TEXT,
  parent_theme TEXT,
  category TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===========================================================================
-- theme_symbols  (GAP base table — legacy curated theme->symbol map)
-- The live demo path reads `auto_theme_symbols` (self-created in auto-pipeline.mjs:383),
-- NOT bare `theme_symbols`. Defined minimally so a fresh DB carries the table. Not seeded.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS theme_symbols (
  theme TEXT NOT NULL,
  symbol TEXT NOT NULL,
  weight DOUBLE PRECISION DEFAULT 1.0,
  method TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (theme, symbol)
);

-- ===========================================================================
-- theme_trend_aggregates  (self-created elsewhere — COPIED VERBATIM for idempotent seed)
-- Source: scripts/compute-trend-aggregates.mjs:81-135.
-- The --db theme report binds against this table (report-db-adapter.mjs:567-595).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS theme_trend_aggregates (
  theme TEXT NOT NULL,
  theme_label TEXT,
  parent_theme TEXT,
  category TEXT,
  period_type TEXT NOT NULL
    CHECK (period_type IN ('week', 'month', 'quarter', 'year')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  article_count INTEGER NOT NULL DEFAULT 0,
  run_rate_article_count DOUBLE PRECISION NOT NULL DEFAULT 0,
  annualized_article_count DOUBLE PRECISION NOT NULL DEFAULT 0,
  period_progress_ratio DOUBLE PRECISION NOT NULL DEFAULT 1,
  theme_share_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  unique_sources INTEGER NOT NULL DEFAULT 0,
  unique_keywords INTEGER NOT NULL DEFAULT 0,
  geographic_spread INTEGER NOT NULL DEFAULT 0,
  source_diversity DOUBLE PRECISION NOT NULL DEFAULT 0,
  recurrence_ratio DOUBLE PRECISION NOT NULL DEFAULT 0,
  mean_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  novelty_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  vs_previous_period_pct DOUBLE PRECISION,
  vs_year_ago_pct DOUBLE PRECISION,
  vs_3year_ago_pct DOUBLE PRECISION,
  trend_acceleration DOUBLE PRECISION,
  lifecycle_stage TEXT,
  lifecycle_confidence DOUBLE PRECISION,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (theme, period_type, period_start)
);
ALTER TABLE theme_trend_aggregates ADD COLUMN IF NOT EXISTS theme_label TEXT;
ALTER TABLE theme_trend_aggregates ADD COLUMN IF NOT EXISTS parent_theme TEXT;
ALTER TABLE theme_trend_aggregates ADD COLUMN IF NOT EXISTS category TEXT;
CREATE INDEX IF NOT EXISTS idx_theme_trend_aggregates_period_end
  ON theme_trend_aggregates (period_type, period_end DESC);
CREATE INDEX IF NOT EXISTS idx_theme_trend_aggregates_theme_period
  ON theme_trend_aggregates (theme, period_type, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_theme_trend_aggregates_lifecycle
  ON theme_trend_aggregates (lifecycle_stage, period_type, period_end DESC);

-- ===========================================================================
-- regime_conditional_impact  (self-created elsewhere — COPIED VERBATIM)
-- Source: scripts/event-engine-full-build.mjs:36-52 (REGIME_TABLE_SQL).
-- Read by report-db-adapter.mjs:621-627 and :987-992.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS regime_conditional_impact (
  id SERIAL PRIMARY KEY,
  theme TEXT,
  symbol TEXT,
  horizon TEXT,
  regime TEXT,
  avg_return DOUBLE PRECISION,
  hit_rate DOUBLE PRECISION,
  avg_abs_return DOUBLE PRECISION,
  sample_size INTEGER,
  regime_multiplier DOUBLE PRECISION DEFAULT 1.0,
  anomaly_rate DOUBLE PRECISION DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(theme, symbol, horizon, regime)
);

-- ===========================================================================
-- event_hawkes_intensity  (self-created elsewhere — COPIED VERBATIM)
-- Source: scripts/event-engine-full-build.mjs:54-66 (HAWKES_TABLE_SQL).
-- report-db-adapter.mjs:783-789 reads this UNGUARDED in the event-signal report
-- path, so the table must exist or `--type event_signal` throws. Also read by the
-- hot-themes / explain-event dashboard panels.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS event_hawkes_intensity (
  id SERIAL PRIMARY KEY,
  theme TEXT,
  event_date DATE,
  article_count INTEGER,
  hawkes_intensity DOUBLE PRECISION,
  normalized_temperature DOUBLE PRECISION,
  is_surge BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(theme, event_date)
);

-- ===========================================================================
-- market_quotes  (self-created elsewhere — COPIED VERBATIM)
-- Source: scripts/refresh-market-quotes-to-nas.mjs:102-122.
-- Read by report-db-adapter.mjs:981-986 and event-dashboard-api.mjs:486-528.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS market_quotes (
  symbol text NOT NULL,
  provider text NOT NULL DEFAULT 'unknown',
  observed_at timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT NOW(),
  last_price double precision NOT NULL,
  change_pct double precision,
  currency text,
  exchange text,
  raw jsonb,
  PRIMARY KEY (symbol, fetched_at)
);
CREATE INDEX IF NOT EXISTS idx_market_quotes_symbol_fetched_at
  ON market_quotes (symbol, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_quotes_symbol_observed_at
  ON market_quotes (symbol, observed_at DESC);

-- ===========================================================================
-- codex_proposals  (self-created elsewhere — COPIED VERBATIM)
-- Source: scripts/_shared/schema-proposals.mjs:3-14 (ensureCodexProposalSchema).
-- The decision inbox reads this: event-dashboard-api.mjs:2899-2905
--   SELECT ... FROM codex_proposals WHERE status NOT IN ('executed','dead').
-- ===========================================================================
CREATE TABLE IF NOT EXISTS codex_proposals (
  id SERIAL PRIMARY KEY,
  proposal_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT DEFAULT 'pending',
  result JSONB,
  reasoning TEXT,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  executed_at TIMESTAMPTZ
);

-- ===========================================================================
-- Report-path analytics tables (self-created elsewhere — COPIED so the `--db`
-- report path does not error on a fresh DB). They stay EMPTY in the demo; the
-- report's enrichment queries against them simply return no rows and degrade.
-- ===========================================================================

-- theme_evolution — sub-theme evolution read by the --db theme report.
-- Source: scripts/compute-trend-aggregates.mjs:162-180.
CREATE TABLE IF NOT EXISTS theme_evolution (
  parent_theme TEXT NOT NULL,
  sub_theme TEXT NOT NULL,
  theme_label TEXT,
  category TEXT,
  period_type TEXT NOT NULL
    CHECK (period_type IN ('week', 'month', 'quarter', 'year')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  article_count INTEGER NOT NULL DEFAULT 0,
  share_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  rank_in_parent INTEGER,
  acceleration DOUBLE PRECISION,
  lifecycle_stage TEXT,
  momentum_score DOUBLE PRECISION,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (parent_theme, sub_theme, period_type, period_start)
);
CREATE INDEX IF NOT EXISTS idx_theme_evolution_parent_period
  ON theme_evolution (parent_theme, period_type, period_start DESC);

-- stock_sensitivity_matrix — per-symbol theme sensitivity read by the theme report.
-- Columns from the consumer SELECT in scripts/_shared/report-db-adapter.mjs.
CREATE TABLE IF NOT EXISTS stock_sensitivity_matrix (
  id BIGSERIAL PRIMARY KEY,
  theme TEXT,
  symbol TEXT,
  horizon TEXT,
  sample_size INTEGER,
  avg_return DOUBLE PRECISION,
  hit_rate DOUBLE PRECISION,
  return_vol DOUBLE PRECISION,
  sensitivity_zscore DOUBLE PRECISION,
  baseline_return DOUBLE PRECISION,
  baseline_vol DOUBLE PRECISION,
  interpretation TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_sensitivity_matrix_theme
  ON stock_sensitivity_matrix (theme);

-- knowledge_nodes / knowledge_edges — entity & relation graph read by the report.
-- Source: scripts/_shared/adjacency-graph.mjs:92-125.
CREATE TABLE IF NOT EXISTS knowledge_nodes (
  id BIGSERIAL PRIMARY KEY,
  node_type TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  normalized_key TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}'::text[],
  status TEXT NOT NULL DEFAULT 'candidate',
  created_by TEXT NOT NULL DEFAULT 'system',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(node_type, normalized_key)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_type_status
  ON knowledge_nodes(node_type, status, updated_at DESC);
CREATE TABLE IF NOT EXISTS knowledge_edges (
  id BIGSERIAL PRIMARY KEY,
  source_node_id BIGINT NOT NULL REFERENCES knowledge_nodes(id),
  target_node_id BIGINT NOT NULL REFERENCES knowledge_nodes(id),
  relation_type TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  evidence_count INT NOT NULL DEFAULT 0,
  source_diversity INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'candidate',
  created_by TEXT NOT NULL DEFAULT 'system',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_node_id, target_node_id, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_edges_source
  ON knowledge_edges(source_node_id, status, relation_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_edges_target
  ON knowledge_edges(target_node_id, status, relation_type);
