-- db/seed.sql
-- Demo seed for the Lattice minimal demo — theme "AI / Machine Learning".
-- Small coherent dataset so a FRESH EMPTY DB supports:
--   * the --db theme report (binds without --allowFallback via theme_trend_aggregates)
--   * the --db event_signal report (canonical_events + event_uplift + event_hawkes_intensity)
--   * dashboard panels (decision inbox via codex_proposals; report/event surfaces)
-- WITHOUT live news ingest. Every inserted column exists in db/schema.sql AND is
-- read by a real consumer (cited inline). Stable ids + ON CONFLICT make re-running idempotent.
--
-- IMPORTANT: theme is the slug 'ai-machine-learning' to match
-- slugify("AI / Machine Learning") = 'ai-machine-learning'
-- (report-db-adapter.mjs:44-49,567-574). theme_label keeps the human label.

-- ---------------------------------------------------------------------------
-- articles — recent AI/ML evidence. Read by report-db-adapter.mjs recentThemeArticles()
-- :509-522 and articleEvidence() :235-243. embedding left NULL (schema allows it).
-- ---------------------------------------------------------------------------
INSERT INTO articles (id, source, theme, published_at, title, summary, url, wire_source, publisher_group, market_relevance, source_quality_score, evidence_grade)
VALUES
  (900001, 'Reuters', 'ai-machine-learning', NOW() - INTERVAL '2 hours',
   'Nvidia unveils next-gen AI accelerator as data-center demand surges',
   'Nvidia announced a new GPU family targeting large language model training, citing record data-center backlog.',
   'https://example.com/lattice-demo/ai-ml/nvidia-next-gen-accelerator', NULL, 'Reuters', 'high', 0.9, 'article'),
  (900002, 'Bloomberg', 'ai-machine-learning', NOW() - INTERVAL '8 hours',
   'Microsoft expands AI capex guidance on enterprise Copilot adoption',
   'Microsoft raised full-year AI infrastructure spending guidance, pointing to broad enterprise Copilot uptake.',
   'https://example.com/lattice-demo/ai-ml/microsoft-ai-capex', NULL, 'Bloomberg', 'high', 0.88, 'article'),
  (900003, 'The Guardian', 'ai-machine-learning', NOW() - INTERVAL '20 hours',
   'AMD positions MI-series GPUs as a credible AI training alternative',
   'AMD detailed roadmap and design wins for its data-center AI accelerators, intensifying competition with Nvidia.',
   'https://example.com/lattice-demo/ai-ml/amd-mi-series', 'Guardian Wire', 'Guardian', 'medium', 0.8, 'article'),
  (900004, 'CNBC', 'ai-machine-learning', NOW() - INTERVAL '30 hours',
   'Cloud providers signal tighter AI GPU supply through next quarter',
   'Major cloud providers warned that AI accelerator supply remains constrained, supporting elevated pricing.',
   'https://example.com/lattice-demo/ai-ml/cloud-gpu-supply', NULL, 'CNBC', 'medium', 0.78, 'article')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- theme_trend_aggregates — ONE row so the --db theme report binds the subject on
-- theme=$2 ('ai-machine-learning') WITHOUT --allowFallback (report-db-adapter.mjs:567-595).
-- article_count>0 so repairEmptyThemeAggregate is a no-op (:525-555).
-- ---------------------------------------------------------------------------
INSERT INTO theme_trend_aggregates (
  theme, theme_label, parent_theme, category, period_type, period_start, period_end,
  article_count, run_rate_article_count, annualized_article_count, period_progress_ratio,
  theme_share_pct, unique_sources, unique_keywords, geographic_spread, source_diversity,
  recurrence_ratio, mean_confidence, novelty_score, vs_previous_period_pct, vs_year_ago_pct,
  vs_3year_ago_pct, trend_acceleration, lifecycle_stage, lifecycle_confidence, metadata, computed_at
) VALUES (
  'ai-machine-learning', 'AI / Machine Learning', 'technology-general', 'technology', 'week',
  (CURRENT_DATE - INTERVAL '7 days')::date, CURRENT_DATE,
  4, 4.0, 208.0, 1.0,
  12.5, 4, 18, 3, 0.82,
  0.35, 0.81, 0.64, 22.0, 145.0,
  260.0, 18.0, 'accelerating', 0.7,
  '{"comparisonCounts":{"current":4,"previous":3,"previousPrevious":2,"yearAgo":1}}'::jsonb,
  NOW()
)
ON CONFLICT (theme, period_type, period_start) DO NOTHING;

-- ---------------------------------------------------------------------------
-- canonical_events — 1 validated AI/ML event. Read by report-db-adapter.mjs
-- loadEventRow():716-747 and :798-836; event-dashboard-api.mjs map-lens :794-798.
-- ---------------------------------------------------------------------------
INSERT INTO canonical_events (id, event_date, theme, representative_title, source_count, source_diversity, article_count, source_hhi, effective_source_count, wire_dominated, top_source_share, created_at)
VALUES
  (910001, (CURRENT_DATE - INTERVAL '2 days')::date, 'ai-machine-learning',
   'AI accelerator demand surge across hyperscalers', 3, 0.86, 3, 0.34, 2.9, FALSE, 0.4, NOW() - INTERVAL '2 days')
ON CONFLICT (id) DO NOTHING;

-- article_event_map — link AI/ML articles to the canonical event.
-- Read by report-db-adapter.mjs:768-772 (JOIN articles ON a.id = aem.article_id).
INSERT INTO article_event_map (article_id, canonical_event_id)
VALUES
  (900001, 910001),
  (900002, 910001),
  (900003, 910001)
ON CONFLICT (article_id, canonical_event_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- event_uplift — validated market reactions. evidence_grade IN ('E2','E3','E4')
-- required by loadEventRow():725-734; t_stat>=2 and n_controls>=8 pass the live-signal
-- gate (event-dashboard-api.mjs:5498-5501). UNIQUE(canonical_event_id,symbol,horizon).
-- ---------------------------------------------------------------------------
INSERT INTO event_uplift (canonical_event_id, symbol, horizon, event_alpha, control_avg_return, uplift, t_stat, n_controls, evidence_grade)
VALUES
  (910001, 'NVDA', '2w', 0.041, 0.006, 0.035, 2.61, 42, 'E2'),
  (910001, 'AMD',  '2w', 0.028, 0.005, 0.023, 2.10, 38, 'E2')
ON CONFLICT (canonical_event_id, symbol, horizon) DO NOTHING;

-- ---------------------------------------------------------------------------
-- event_hawkes_intensity — clustering intensity for the event. Read UNGUARDED by
-- report-db-adapter.mjs:783-789 (event-signal path) and the hot-themes panel.
-- UNIQUE(theme, event_date).
-- ---------------------------------------------------------------------------
INSERT INTO event_hawkes_intensity (theme, event_date, article_count, hawkes_intensity, normalized_temperature, is_surge)
VALUES
  ('ai-machine-learning', (CURRENT_DATE - INTERVAL '2 days')::date, 3, 1.84, 0.72, TRUE)
ON CONFLICT (theme, event_date) DO NOTHING;

-- ---------------------------------------------------------------------------
-- event_impact_profiles — asset-dossier / explain-event row. Read by
-- event-dashboard-api.mjs:5225-5230 and :5255-5259.
-- ---------------------------------------------------------------------------
INSERT INTO event_impact_profiles (id, article_id, event_date, title, source, theme, symbol, horizon, forward_return_pct, hit, reaction_pattern, causal_explanation)
VALUES
  (920001, 900001, (CURRENT_DATE - INTERVAL '2 days')::date,
   'AI accelerator demand surge across hyperscalers', 'Reuters', 'ai-machine-learning', 'NVDA', '2w',
   4.1, TRUE, 'momentum_continuation',
   'Record data-center backlog drove a sustained positive drift in NVDA over the 2-week window.')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- regime_conditional_impact — theme-level regime reaction. Read by
-- report-db-adapter.mjs:621-627 and :987-992. UNIQUE(theme, symbol, horizon, regime).
-- ---------------------------------------------------------------------------
INSERT INTO regime_conditional_impact (theme, symbol, horizon, regime, avg_return, hit_rate, avg_abs_return, sample_size, regime_multiplier, anomaly_rate)
VALUES
  ('ai-machine-learning', 'NVDA', '2w', 'risk-on', 0.031, 0.62, 0.045, 48, 1.35, 0.08)
ON CONFLICT (theme, symbol, horizon, regime) DO NOTHING;

-- ---------------------------------------------------------------------------
-- market_quotes — one ^VIX quote so the KPI strip has a live-quote feed. Read by
-- event-dashboard-api.mjs:496-528 (detectLiveQuoteFeed flags >4h old as stale).
-- Fresh-at-seed (NOW()-based) and idempotent via a NOT EXISTS guard on provider.
-- ---------------------------------------------------------------------------
INSERT INTO market_quotes (symbol, provider, observed_at, fetched_at, last_price, change_pct, currency, exchange, raw)
SELECT '^VIX', 'demo-seed', NOW() - INTERVAL '35 minutes', NOW() - INTERVAL '30 minutes',
       14.8, -2.1, 'USD', 'CBOE', '{"seed":true}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM market_quotes WHERE symbol = '^VIX' AND provider = 'demo-seed'
);

-- ---------------------------------------------------------------------------
-- codex_proposals — one PENDING proposal so the decision inbox is non-empty.
-- Inbox keeps rows WHERE status NOT IN ('executed','dead') (event-dashboard-api.mjs:2899-2905).
-- Idempotent via a unique payload key + NOT EXISTS guard (table has no natural UNIQUE).
-- ---------------------------------------------------------------------------
INSERT INTO codex_proposals (proposal_type, payload, status, reasoning, source)
SELECT 'add-theme-symbol',
       '{"seedKey":"lattice-demo-ai-ml-nvda","theme":"ai-machine-learning","symbol":"NVDA","reason":"AI accelerator demand surge supports NVDA as a theme-leading reactive symbol."}'::jsonb,
       'pending',
       'Demo seed: propose attaching NVDA to the AI / Machine Learning theme based on validated E2 event uplift.',
       'demo-seed'
WHERE NOT EXISTS (
  SELECT 1 FROM codex_proposals
  WHERE payload->>'seedKey' = 'lattice-demo-ai-ml-nvda'
);

-- ---------------------------------------------------------------------------
-- Advance sequences past the explicit demo ids so later real ingests don't collide.
-- ---------------------------------------------------------------------------
SELECT setval(pg_get_serial_sequence('articles', 'id'), GREATEST((SELECT MAX(id) FROM articles), 1));
SELECT setval(pg_get_serial_sequence('canonical_events', 'id'), GREATEST((SELECT MAX(id) FROM canonical_events), 1));
SELECT setval(pg_get_serial_sequence('event_impact_profiles', 'id'), GREATEST((SELECT MAX(id) FROM event_impact_profiles), 1));
