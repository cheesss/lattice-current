/*
 * Report theme context loader.
 *
 * Phase 2 enrichment: when a theme report is generated, the bundle should
 * carry enough domain-specific context that downstream prose can reference
 * specific subtopics, peer symbols, multi-regime impacts, knowledge graph
 * connections, and event timeline — not just a single aggregate row.
 *
 * The previous bundle had only:
 *   - 1 theme_trend_aggregates row → 4 metrics
 *   - 6 article evidence items
 *   - up to 5 regime_conditional_impact rows (unstructured)
 *
 * The enriched bundle adds:
 *   - top 5 subtopics from theme_evolution
 *   - top 6 peer symbols from stock_sensitivity_matrix
 *   - regime impacts grouped by regime label
 *   - up to 8 knowledge_edges from theme node → entities
 *   - 30-day event timeline with hawkes intensity
 *
 * The bundle is read by report-llm-analyst.mjs to produce subject-specific
 * statements (Phase 3) instead of the current meta-prose templates.
 */

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function many(client, sql, params = []) {
  return (await client.query(sql, params)).rows;
}

/*
 * Subtopic movement — what's growing/shrinking inside the theme this period.
 *
 * theme_evolution.parent_theme typically holds the broad bucket
 * ('technology' / 'environment' / etc.). Some themes ARE parents, others
 * appear only as sub_theme. The query handles both.
 */
async function loadSubtopics(client, themeKey, periodType = 'week') {
  /* Dedup per sub_theme — keep the latest period row only. Otherwise the
   * same subtopic appears twice with conflicting momentum/accel from
   * different periods, which the prose then reports as inconsistent reads. */
  const rows = await many(client, `
    SELECT DISTINCT ON (sub_theme)
           parent_theme, sub_theme, theme_label, period_type, period_start, period_end,
           article_count, share_pct, rank_in_parent, acceleration, lifecycle_stage, momentum_score
    FROM theme_evolution
    WHERE period_type = $1
      AND (parent_theme = $2 OR sub_theme = $2)
    ORDER BY sub_theme, period_end DESC NULLS LAST
  `, [periodType, themeKey]).catch(() => []);
  /* Then sort by article_count for the report's "top movers" framing */
  return rows.sort((a, b) => (num(b.article_count) || 0) - (num(a.article_count) || 0)).slice(0, 8);
}

/*
 * Peer symbols — top symbols whose returns are sensitive to this theme.
 * Returns are bucketed: positive_high (zscore > 1), neutral, negative_high.
 */
async function loadPeerSymbols(client, themeKey) {
  const rows = await many(client, `
    SELECT id, theme, symbol, horizon, sample_size, avg_return, hit_rate,
           return_vol, sensitivity_zscore, baseline_return, baseline_vol,
           interpretation, updated_at
    FROM stock_sensitivity_matrix
    WHERE theme = $1
    ORDER BY ABS(sensitivity_zscore) DESC NULLS LAST, sample_size DESC NULLS LAST
    LIMIT 12
  `, [themeKey]).catch(() => []);
  /* Bucket by sign and significance for downstream prose. Dedup by symbol —
   * stock_sensitivity_matrix can contain multiple rows per (theme, symbol) at
   * different horizons; keep the row with the largest |zscore|. */
  const bySymbolMaxZ = new Map();
  for (const row of rows) {
    const z = Math.abs(num(row.sensitivity_zscore) || 0);
    const prev = bySymbolMaxZ.get(row.symbol);
    if (!prev || Math.abs(num(prev.sensitivity_zscore) || 0) < z) bySymbolMaxZ.set(row.symbol, row);
  }
  const deduped = [...bySymbolMaxZ.values()];
  const positive = deduped.filter((r) => num(r.sensitivity_zscore) > 1).sort((a, b) => Math.abs(num(b.sensitivity_zscore) || 0) - Math.abs(num(a.sensitivity_zscore) || 0)).slice(0, 5);
  const negative = deduped.filter((r) => num(r.sensitivity_zscore) < -1).sort((a, b) => Math.abs(num(b.sensitivity_zscore) || 0) - Math.abs(num(a.sensitivity_zscore) || 0)).slice(0, 3);
  const neutral = deduped.filter((r) => Math.abs(num(r.sensitivity_zscore) || 0) <= 1).slice(0, 2);
  return { all: deduped, positive, negative, neutral };
}

/*
 * Multi-regime impact — same symbol/horizon, different regimes. Lets the
 * report say "X works in stress but not in calm" type statements.
 */
async function loadRegimeImpacts(client, themeKey) {
  const rows = await many(client, `
    SELECT theme, symbol, horizon, regime, avg_return, hit_rate, avg_abs_return,
           sample_size, regime_multiplier, anomaly_rate, updated_at
    FROM regime_conditional_impact
    WHERE theme = $1
    ORDER BY sample_size DESC NULLS LAST, ABS(regime_multiplier) DESC NULLS LAST
    LIMIT 24
  `, [themeKey]).catch(() => []);
  /* Group by symbol; dedup by (symbol, regime, horizon) to avoid same-regime
   * duplicates from multiple updates. Then keep only symbols that appear in
   * 2+ DISTINCT regimes (not just multiple rows of the same regime). */
  const bySymbol = new Map();
  for (const row of rows) {
    if (!bySymbol.has(row.symbol)) bySymbol.set(row.symbol, new Map());
    const inner = bySymbol.get(row.symbol);
    const k = `${row.regime}|${row.horizon}`;
    if (!inner.has(k)) inner.set(k, row);
  }
  const grouped = Array.from(bySymbol.entries())
    .map(([symbol, inner]) => {
      const regimes = [...inner.values()];
      const distinctRegimes = new Set(regimes.map((r) => r.regime));
      return { symbol, regimes, regimeCount: regimes.length, distinctRegimeCount: distinctRegimes.size };
    })
    /* Keep symbols with at least 2 observations across any (regime, horizon)
     * — useful for prose even if both rows share a regime label, since the
     * horizon differs. */
    .filter((g) => g.regimeCount >= 2)
    .sort((a, b) => b.distinctRegimeCount - a.distinctRegimeCount || b.regimeCount - a.regimeCount)
    .slice(0, 5);
  return { all: rows, grouped };
}

/*
 * Controlled event uplifts — matched-control event studies already computed by
 * the event engine. These are stronger market evidence than broad
 * stock_sensitivity_matrix rows because they carry explicit n_controls and
 * event_uplift evidence grades.
 *
 * n_controls can be small on a single event row because the matched-control
 * engine stores per-event control sets. Report evidence is a symbol/horizon
 * aggregate, so the control gate is applied in HAVING after grouping.
 */
async function loadControlledEventUplifts(client, themeKey) {
  const rows = await many(client, `
    SELECT
      eu.symbol,
      eu.horizon,
      COUNT(*)::int AS event_count,
      SUM(COALESCE(eu.n_controls, 0))::int AS n_controls,
      AVG(eu.uplift)::float AS avg_uplift,
      AVG(eu.event_alpha)::float AS avg_event_alpha,
      AVG(eu.control_avg_return)::float AS avg_control_return,
      MAX(ABS(eu.t_stat))::float AS max_abs_t_stat,
      AVG(eu.t_stat)::float AS representative_t_stat,
      (AVG(eu.uplift) / NULLIF(STDDEV_SAMP(eu.uplift) / SQRT(COUNT(*)), 0))::float AS aggregate_t_stat,
      (ARRAY_AGG(eu.evidence_grade ORDER BY CASE WHEN eu.evidence_grade IN ('E4','E3','E2') THEN 0 ELSE 1 END, ABS(eu.t_stat) DESC NULLS LAST))[1] AS top_evidence_grade,
      MAX(ce.event_date) AS latest_event_date
    FROM event_uplift eu
    JOIN canonical_events ce ON ce.id = eu.canonical_event_id
    WHERE ce.theme = $1
      AND eu.evidence_grade IN ('E2','E3','E4')
      AND ce.event_date >= CURRENT_DATE - INTERVAL '730 days'
    GROUP BY eu.symbol, eu.horizon
    HAVING SUM(COALESCE(eu.n_controls, 0)) >= 30
       AND COUNT(*) >= 5
    ORDER BY ABS(AVG(eu.t_stat)) DESC NULLS LAST, SUM(COALESCE(eu.n_controls, 0)) DESC NULLS LAST
    LIMIT 8
  `, [themeKey]).catch(() => []);
  return rows;
}

/*
 * Knowledge graph paths — entities (companies/components/materials) connected
 * to the theme via knowledge_edges.
 */
async function loadKnowledgePaths(client, themeKey) {
  /* knowledge_nodes for the theme itself */
  const themeNode = await many(client, `
    SELECT id, node_type, canonical_name, normalized_key, status
    FROM knowledge_nodes
    WHERE normalized_key = $1
       OR lower(canonical_name) = lower($2)
    LIMIT 1
  `, [themeKey, themeKey.replace(/-/g, ' ')]).catch(() => []);
  if (!themeNode.length) return { nodes: [], edges: [] };
  const themeNodeId = themeNode[0].id;
  /* outgoing edges → connected entities */
  const edges = await many(client, `
    SELECT ke.id, ke.relation_type, ke.confidence, ke.evidence_count, ke.source_diversity,
           ke.status, ke.metadata,
           kn_target.canonical_name AS target_name, kn_target.node_type AS target_type,
           kn_source.canonical_name AS source_name, kn_source.node_type AS source_type,
           ke.source_node_id, ke.target_node_id
    FROM knowledge_edges ke
    JOIN knowledge_nodes kn_target ON kn_target.id = ke.target_node_id
    JOIN knowledge_nodes kn_source ON kn_source.id = ke.source_node_id
    WHERE (ke.source_node_id = $1 OR ke.target_node_id = $1)
      AND ke.status IN ('active','validated','candidate')
    ORDER BY ke.confidence DESC NULLS LAST, ke.evidence_count DESC NULLS LAST
    LIMIT 12
  `, [themeNodeId]).catch(() => []);
  /* Normalize: from theme's perspective, "the other end" is the connected entity */
  const connections = edges.map((row) => {
    const isSource = String(row.source_node_id) === String(themeNodeId);
    return {
      edgeId: String(row.id),
      relationType: row.relation_type,
      confidence: num(row.confidence),
      evidenceCount: num(row.evidence_count),
      sourceDiversity: num(row.source_diversity),
      status: row.status,
      direction: isSource ? 'theme→entity' : 'entity→theme',
      entityName: isSource ? row.target_name : row.source_name,
      entityType: isSource ? row.target_type : row.source_type,
      metadata: row.metadata || {},
    };
  });
  return { nodes: themeNode, connections };
}

/*
 * Event timeline — recent canonical_events for the theme with their hawkes
 * intensity, so the prose can say "intensity surged 3x on date X driven by
 * event Y".
 */
async function loadEventTimeline(client, themeKey, days = 30) {
  const events = await many(client, `
    SELECT ce.id, ce.event_date, ce.theme, ce.representative_title,
           ce.source_count, ce.source_diversity, ce.article_count, ce.wire_dominated,
           ce.top_source_share,
           hi.hawkes_intensity, hi.normalized_temperature, hi.is_surge
    FROM canonical_events ce
    LEFT JOIN event_hawkes_intensity hi
      ON hi.theme = ce.theme AND hi.event_date = ce.event_date
    WHERE ce.theme = $1
      AND ce.event_date >= (CURRENT_DATE - INTERVAL '${days} days')::date
    ORDER BY ce.event_date DESC, ce.article_count DESC NULLS LAST
    LIMIT 12
  `, [themeKey]).catch(() => []);
  return events.map((row) => ({
    eventId: row.id,
    eventDate: iso(row.event_date),
    title: row.representative_title,
    articleCount: num(row.article_count),
    sourceCount: num(row.source_count),
    sourceDiversity: num(row.source_diversity),
    wireDominated: row.wire_dominated === true,
    topSourceShare: num(row.top_source_share),
    hawkesIntensity: num(row.hawkes_intensity),
    normalizedTemperature: num(row.normalized_temperature),
    isSurge: row.is_surge === true,
  }));
}

/*
 * Hawkes time series — daily intensity over the last N days for the theme.
 * Lets prose discuss "intensity peaked on day-3 then decayed".
 */
async function loadHawkesSeries(client, themeKey, days = 30) {
  return many(client, `
    SELECT event_date, article_count, hawkes_intensity, normalized_temperature, is_surge
    FROM event_hawkes_intensity
    WHERE theme = $1
      AND event_date >= (CURRENT_DATE - INTERVAL '${days} days')::date
    ORDER BY event_date ASC
  `, [themeKey]).catch(() => []);
}

/*
 * Top-level loader. Returns the full theme context object.
 */
export async function loadThemeContext(client, themeKey, { periodType = 'week', days = 30 } = {}) {
  if (!themeKey) {
    return { subtopics: [], peerSymbols: { all: [], positive: [], negative: [], neutral: [] }, regimeImpacts: { all: [], grouped: [] }, controlledUplifts: [], knowledge: { nodes: [], connections: [] }, events: [], hawkes: [] };
  }
  /* pg@8 warns when multiple queries run concurrently on the same client.
   * The report builder passes one checked-out client through the pipeline, so
   * keep this loader sequential instead of using Promise.all. */
  const subtopics = await loadSubtopics(client, themeKey, periodType);
  const peerSymbols = await loadPeerSymbols(client, themeKey);
  const regimeImpacts = await loadRegimeImpacts(client, themeKey);
  const controlledUplifts = await loadControlledEventUplifts(client, themeKey);
  const knowledge = await loadKnowledgePaths(client, themeKey);
  const events = await loadEventTimeline(client, themeKey, days);
  const hawkes = await loadHawkesSeries(client, themeKey, days);
  return { subtopics, peerSymbols, regimeImpacts, controlledUplifts, knowledge, events, hawkes };
}

/*
 * Convert the loaded context into bundle additions:
 *   - extra metrics (subtopic counts, peer symbol breadth, knowledge breadth)
 *   - extra marketReactions (peer symbols, multi-regime)
 *   - extra evidence items (knowledge edges as relationship_evidence)
 *   - bundle.metadata.themeContext snapshot for downstream prose
 *
 * The shape is intentionally permissive — downstream prose generators read
 * what they need.
 */
export function themeContextToBundleAdditions(context, themeKey) {
  if (!context) return { metrics: [], marketReactions: [], evidence: [], extension: null };
  const metrics = [];
  const marketReactions = [];
  const evidence = [];

  if (context.controlledUplifts?.length) {
    metrics.push({
      metricId: 'MET-CONTROLLED-EVENT-UPLIFT-COUNT',
      kind: 'controlled_event_study',
      name: 'controlled_event_uplift_rows',
      value: context.controlledUplifts.length,
      unit: 'rows',
      metadata: {
        topRows: context.controlledUplifts.slice(0, 5).map((row) => ({
          symbol: row.symbol,
          horizon: row.horizon,
          tStat: num(row.representative_t_stat ?? row.max_abs_t_stat),
          aggregateTStat: num(row.aggregate_t_stat),
          nControls: num(row.n_controls),
          eventCount: num(row.event_count),
          evidenceGrade: row.top_evidence_grade,
        })),
      },
    });
    for (const row of context.controlledUplifts.slice(0, 6)) {
      const tStat = num(row.representative_t_stat ?? row.max_abs_t_stat);
      marketReactions.push({
        reactionId: `MRKT-CONTROLLED-${row.symbol}-${row.horizon}`,
        symbol: row.symbol,
        benchmark: 'matched_controls',
        eventWindow: row.horizon,
        relativeReturnPct: num(row.avg_uplift),
        uplift: num(row.avg_uplift),
        tStat,
        alpha: num(row.avg_event_alpha),
        controls: [
          'benchmark=matched_controls',
          'factor=macro_regime_matched_controls',
          `n_controls=${num(row.n_controls) || 0}`,
          `event_count=${num(row.event_count) || 0}`,
          `evidence_grade=${row.top_evidence_grade || 'unknown'}`,
        ],
        validationStatus: num(row.n_controls) >= 30 ? 'validated' : 'candidate',
        metadata: {
          source: 'event_uplift',
          evidenceGrade: row.top_evidence_grade,
          latestEventDate: iso(row.latest_event_date),
          controlledEventCount: num(row.event_count),
          aggregateTStat: num(row.aggregate_t_stat),
          maxAbsEventTStat: num(row.max_abs_t_stat),
          limitation: 'symbol_horizon_aggregate; overlapping event windows may inflate repeated-event confidence',
        },
      });
    }
  }

  /* Subtopic metrics */
  if (context.subtopics?.length) {
    metrics.push({
      metricId: 'MET-SUBTOPIC-COUNT',
      kind: 'theme_evolution',
      name: 'subtopic_count',
      value: context.subtopics.length,
      unit: 'subtopics',
      window: 'period',
      metadata: { topSubtopics: context.subtopics.slice(0, 5).map((s) => ({ key: s.sub_theme, label: s.theme_label, count: num(s.article_count), stage: s.lifecycle_stage, momentum: num(s.momentum_score), accel: num(s.acceleration) })) },
    });
  }

  /* Peer symbol metrics + reactions */
  const peers = context.peerSymbols;
  if (peers?.all?.length) {
    const regimeBySymbol = new Map((context.regimeImpacts?.grouped || []).map((group) => [
      String(group.symbol || '').toUpperCase(),
      group,
    ]));
    metrics.push({
      metricId: 'MET-PEER-COUNT',
      kind: 'symbol_sensitivity',
      name: 'peer_symbol_count',
      value: peers.all.length,
      unit: 'symbols',
      metadata: { positiveN: peers.positive.length, negativeN: peers.negative.length },
    });
    /* Promote peers to marketReactions for prose / chart consumption */
    for (const symbol of peers.positive.concat(peers.negative).slice(0, 6)) {
      const regime = regimeBySymbol.get(String(symbol.symbol || '').toUpperCase());
      const regimeLabels = [...new Set((regime?.regimes || []).map((row) => row.regime).filter(Boolean))];
      const regimeControls = regime
        ? [
          `regime_count=${regimeLabels.length || regime.regimeCount || 0}`,
          `regime_labels=${regimeLabels.slice(0, 4).join('|') || 'available'}`,
        ]
        : [];
      marketReactions.push({
        reactionId: `MRKT-PEER-${symbol.symbol}-${symbol.horizon}`,
        symbol: symbol.symbol,
        benchmark: 'baseline_return',
        eventWindow: symbol.horizon,
        relativeReturnPct: num(symbol.avg_return),
        uplift: num(symbol.sensitivity_zscore),
        tStat: num(symbol.sensitivity_zscore),
        alpha: num(symbol.avg_return) - num(symbol.baseline_return),
        controls: [`benchmark=baseline_return`, `sample_size=${num(symbol.sample_size)}`, `hit_rate=${num(symbol.hit_rate)}`, ...regimeControls],
        validationStatus: num(symbol.sample_size) >= 30 ? 'validated' : 'candidate',
        metadata: { interpretation: symbol.interpretation, theme: symbol.theme, regimeControls: regime || null },
      });
    }
  }

  /* Multi-regime grouped reactions */
  if (context.regimeImpacts?.grouped?.length) {
    metrics.push({
      metricId: 'MET-REGIME-BREADTH',
      kind: 'regime_conditional_impact',
      name: 'multi_regime_symbol_count',
      value: context.regimeImpacts.grouped.length,
      unit: 'symbols',
      metadata: { sample: context.regimeImpacts.grouped.slice(0, 3).map((g) => ({ symbol: g.symbol, regimes: g.regimes.map((r) => ({ regime: r.regime, mult: num(r.regime_multiplier), n: num(r.sample_size) })) })) },
    });
  }

  /* Knowledge graph evidence */
  if (context.knowledge?.connections?.length) {
    metrics.push({
      metricId: 'MET-KNOWLEDGE-DEGREE',
      kind: 'knowledge_graph',
      name: 'connected_entity_count',
      value: context.knowledge.connections.length,
      unit: 'entities',
      metadata: { byType: context.knowledge.connections.reduce((acc, c) => { acc[c.entityType || 'unknown'] = (acc[c.entityType || 'unknown'] || 0) + 1; return acc; }, {}) },
    });
    for (const conn of context.knowledge.connections.slice(0, 6)) {
      evidence.push({
        evidenceId: `EVID-EDGE-${conn.edgeId}`,
        kind: 'knowledge_edge',
        publisher: 'knowledge_graph',
        title: `${conn.entityName} ${conn.relationType} ${themeKey}`,
        evidenceGrade: conn.confidence > 0.7 ? 'validated' : 'candidate',
        freshnessStatus: 'fresh',
        sourceQualityScore: conn.confidence || 0.5,
        metadata: {
          relationType: conn.relationType,
          entityType: conn.entityType,
          evidenceCount: conn.evidenceCount,
          sourceDiversity: conn.sourceDiversity,
        },
      });
    }
  }

  /* Event timeline metric */
  if (context.events?.length) {
    metrics.push({
      metricId: 'MET-EVENT-TIMELINE-COUNT',
      kind: 'event_timeline',
      name: 'recent_event_count',
      value: context.events.length,
      unit: 'events',
      window: '30d',
      metadata: { surgeCount: context.events.filter((e) => e.isSurge).length, latestDate: context.events[0]?.eventDate },
    });
  }

  return {
    metrics,
    marketReactions,
    evidence,
    extension: {
      themeContext: {
        themeKey,
        loadedAt: new Date().toISOString(),
        controlledUplifts: context.controlledUplifts?.slice(0, 8) || [],
        subtopics: context.subtopics?.slice(0, 8) || [],
        peerSymbols: {
          positive: peers?.positive || [],
          negative: peers?.negative || [],
          counts: { positive: peers?.positive?.length || 0, negative: peers?.negative?.length || 0, total: peers?.all?.length || 0 },
        },
        regimeBySymbol: (context.regimeImpacts?.grouped || []).slice(0, 5),
        knowledgeConnections: (context.knowledge?.connections || []).slice(0, 8),
        events: context.events?.slice(0, 10) || [],
        hawkesSeries: context.hawkes?.slice(-30) || [],
      },
    },
  };
}
