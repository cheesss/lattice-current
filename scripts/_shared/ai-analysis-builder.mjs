/**
 * ai-analysis-builder.mjs — Investigate surface의 AI 분석 기능 7종 백엔드
 *
 * P0:
 *   buildEventTimelinePayload       — 90d events + regime bands + VIX overlay
 *   buildEventNarrativePayload      — Codex exec로 이벤트 narrative 생성
 *   buildSimilarEventsPayload       — pgvector cosine으로 유사 이벤트
 *
 * P1:
 *   buildRegimeScenarioPayload      — regime_conditional_impact 기반 what-if
 *   buildAssetDossierPayload        — 종목별 이벤트/테마/매크로 집계
 *
 * P2:
 *   buildWeeklyDigestPayload        — Codex exec로 주간 AI 브리핑
 *   buildCorrelationBreaksPayload   — 90d vs 30d signal correlation 차이
 *
 * 모든 함수는 read-only SELECT만 수행. Write는 proposal-executor 경유.
 */

const DEFAULT_TIMELINE_DAYS = 90;

async function tableExists(executor, t) {
  const { rows } = await executor.query(`SELECT to_regclass($1) AS oid`, [`public.${t}`]);
  return Boolean(rows[0]?.oid);
}

/* ============================================================ */
/* P0-1: Event Timeline                                         */
/* ============================================================ */
export async function buildEventTimelinePayload(pool, { days = DEFAULT_TIMELINE_DAYS, theme = null } = {}) {
  const safeDays = Math.min(180, Math.max(7, Number(days) || DEFAULT_TIMELINE_DAYS));

  const [events, regime, vix] = await Promise.all([
    pool.query(
      `
      WITH ev AS (
        SELECT ce.id, ce.theme, ce.representative_title, ce.event_date,
               COALESCE(ce.article_count, 0) AS article_count,
               COALESCE(ce.source_count, 0) AS source_count
          FROM canonical_events ce
         WHERE ce.event_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
           AND ($2::text IS NULL OR LOWER(ce.theme) = LOWER($2))
      ),
      upl AS (
        SELECT eu.canonical_event_id,
               MAX(eu.evidence_grade) AS best_grade,
               MAX(ABS(COALESCE(eu.t_stat, 0))) AS max_abs_t,
               MAX(ABS(COALESCE(eu.uplift, 0))) AS max_abs_uplift
          FROM event_uplift eu
         GROUP BY eu.canonical_event_id
      ),
      haw AS (
        SELECT theme, event_date, MAX(normalized_temperature) AS temperature
          FROM event_hawkes_intensity
         WHERE event_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
         GROUP BY theme, event_date
      )
      SELECT ev.id, ev.theme, ev.representative_title AS title, ev.event_date,
             ev.article_count, ev.source_count,
             upl.best_grade, upl.max_abs_t, upl.max_abs_uplift,
             haw.temperature
        FROM ev
        LEFT JOIN upl ON upl.canonical_event_id = ev.id
        LEFT JOIN haw ON haw.theme = ev.theme AND haw.event_date = ev.event_date
       ORDER BY ev.event_date ASC, upl.best_grade DESC NULLS LAST
       LIMIT 500
      `,
      [safeDays, theme],
    ),
    pool.query(
      `
      SELECT event_date::text AS d, regime, COUNT(*) AS n
        FROM matched_controls
       WHERE event_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
         AND regime_event IS NOT NULL
       GROUP BY event_date, regime
       ORDER BY event_date
      `,
      [safeDays],
    ).catch(() => ({ rows: [] })),
    pool.query(
      `
      SELECT ts::date AS d, AVG(value) AS v
        FROM signal_history
       WHERE signal_name = 'vix'
         AND ts >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
       GROUP BY ts::date
       ORDER BY d
      `,
      [safeDays],
    ),
  ]);

  const evList = events.rows.map((r) => ({
    id: Number(r.id),
    theme: r.theme,
    title: r.title,
    eventDate: r.event_date,
    articleCount: Number(r.article_count ?? 0),
    sourceCount: Number(r.source_count ?? 0),
    bestEvidenceGrade: r.best_grade || null,
    maxAbsT: r.max_abs_t == null ? null : Number(r.max_abs_t),
    maxAbsUplift: r.max_abs_uplift == null ? null : Number(r.max_abs_uplift),
    temperature: r.temperature == null ? null : Number(r.temperature),
  }));

  const vixSeries = vix.rows.map((r) => ({
    date: r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10),
    value: r.v == null ? null : Number(r.v),
  }));

  // Regime: collapse to one regime per date (the mode / most common)
  const regimeByDate = {};
  for (const r of regime.rows) {
    const d = r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10);
    if (!regimeByDate[d] || Number(r.n) > regimeByDate[d].n) {
      regimeByDate[d] = { regime: r.regime, n: Number(r.n) };
    }
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    days: safeDays,
    theme,
    events: evList,
    regimeByDate,
    vixSeries,
    counts: {
      total: evList.length,
      e2: evList.filter((e) => e.bestEvidenceGrade === 'E2').length,
      surge: evList.filter((e) => e.temperature != null && e.temperature >= 2).length,
    },
  };
}

/* ============================================================ */
/* P0-2: AI Event Narrative via Codex                           */
/* ============================================================ */
export async function buildEventNarrativePayload(pool, { eventId, forceRefresh = false } = {}) {
  const id = Number(eventId);
  if (!Number.isFinite(id) || id < 1) return { ok: false, error: 'eventId required' };

  const cacheCheck = await pool.query(
    `SELECT to_regclass('public.event_narrative_cache') AS oid`,
  );
  const hasCache = Boolean(cacheCheck.rows[0]?.oid);

  if (hasCache && !forceRefresh) {
    const { rows } = await pool.query(
      `SELECT narrative, citations, generated_at FROM event_narrative_cache WHERE canonical_event_id = $1 AND generated_at > now() - INTERVAL '24 hours'`,
      [id],
    ).catch(() => ({ rows: [] }));
    if (rows.length) {
      return {
        ok: true,
        cached: true,
        eventId: id,
        narrative: rows[0].narrative,
        citations: rows[0].citations || [],
        generatedAt: rows[0].generated_at,
      };
    }
  }

  const eventRes = await pool.query(
    `SELECT id, theme, representative_title, event_date, article_count, source_count FROM canonical_events WHERE id = $1`,
    [id],
  );
  if (!eventRes.rows.length) return { ok: false, error: 'event not found' };
  const event = eventRes.rows[0];

  const articlesRes = await pool.query(
    `
    SELECT a.id, a.title, a.source, a.published_at, a.summary
      FROM article_event_map aem JOIN articles a ON a.id = aem.article_id
     WHERE aem.canonical_event_id = $1
     ORDER BY a.published_at DESC NULLS LAST
     LIMIT 8
    `,
    [id],
  );

  const upliftRes = await pool.query(
    `
    SELECT symbol, horizon, uplift, t_stat, evidence_grade, n_controls
      FROM event_uplift
     WHERE canonical_event_id = $1
     ORDER BY ABS(COALESCE(t_stat, 0)) DESC NULLS LAST
     LIMIT 6
    `,
    [id],
  ).catch(() => ({ rows: [] }));

  const prompt = buildNarrativePrompt({
    event,
    articles: articlesRes.rows,
    uplift: upliftRes.rows,
  });

  const { runCodexJsonPrompt } = await import('./codex-json.mjs');
  const result = await runCodexJsonPrompt(prompt, 80_000, {
    label: 'event-narrative',
    eventId: id,
  });

  const parsed = result.parsed;
  if (!parsed || typeof parsed !== 'object') {
    return {
      ok: false,
      eventId: id,
      error: 'codex output not JSON',
      codexCode: result.code,
      codexMessage: String(result.message || '').slice(0, 800),
      stderr: String(result.stderr || '').slice(0, 400),
    };
  }

  const narrative = String(parsed.narrative || '').slice(0, 3000);
  const citations = Array.isArray(parsed.citations) ? parsed.citations.slice(0, 8) : [];
  const payload = {
    ok: true,
    cached: false,
    eventId: id,
    event: {
      theme: event.theme,
      title: event.representative_title,
      eventDate: event.event_date,
      articleCount: Number(event.article_count ?? 0),
    },
    narrative,
    citations,
    upliftHighlights: upliftRes.rows.map((u) => ({
      symbol: u.symbol,
      horizon: u.horizon,
      uplift: u.uplift == null ? null : Number(u.uplift),
      tStat: u.t_stat == null ? null : Number(u.t_stat),
      evidenceGrade: u.evidence_grade,
    })),
    generatedAt: new Date().toISOString(),
  };

  if (hasCache) {
    await pool.query(
      `
      INSERT INTO event_narrative_cache (canonical_event_id, narrative, citations, generated_at)
      VALUES ($1, $2, $3, now())
      ON CONFLICT (canonical_event_id) DO UPDATE
      SET narrative = EXCLUDED.narrative, citations = EXCLUDED.citations, generated_at = EXCLUDED.generated_at
      `,
      [id, narrative, JSON.stringify(citations)],
    ).catch(() => {});
  }

  return payload;
}

function buildNarrativePrompt({ event, articles, uplift }) {
  const articleLines = articles.slice(0, 6).map((a, i) =>
    `[${i + 1}] (${a.source || '?'} · ${String(a.published_at || '').slice(0, 10)}) ${a.title || ''}`,
  ).join('\n');
  const upliftLines = uplift.length
    ? uplift.map((u) => `  ${u.symbol} ${u.horizon} uplift=${u.uplift} t=${u.t_stat} grade=${u.evidence_grade} n=${u.n_controls}`).join('\n')
    : '  (no uplift labeled yet)';
  return `You are a financial intelligence analyst. Summarize this event in 2-3 short paragraphs grounded in the provided articles. Keep it analytical, factual, and specific about market implications.

EVENT
- id: ${event.id}
- theme: ${event.theme}
- date: ${String(event.event_date || '').slice(0, 10)}
- title: ${event.representative_title}
- articles: ${event.article_count} · sources: ${event.source_count}

ARTICLES
${articleLines || '(none)'}

UPLIFT (symbol reactions)
${upliftLines}

Output ONLY a single JSON object with this schema (no markdown, no prose outside JSON):
{
  "narrative": "2-3 short paragraphs in English. Analytical tone. Cite articles by [1], [2] references. Include why it mattered to markets and which sector(s) absorb the shock.",
  "citations": [{"index": 1, "source": "...", "title": "..."}, ...]
}

Keep narrative under 700 characters. Cite at most 4 articles. If uplift exists, reference it as evidence.`;
}

/* ============================================================ */
/* P0-3: Similar Events Finder (pgvector cosine)                */
/* ============================================================ */
export async function buildSimilarEventsPayload(pool, { eventId, limit = 6 } = {}) {
  const id = Number(eventId);
  if (!Number.isFinite(id) || id < 1) return { ok: false, error: 'eventId required' };
  const safeLimit = Math.min(15, Math.max(1, Number(limit) || 6));

  const seedRes = await pool.query(
    `
    SELECT a.embedding, ce.theme, ce.representative_title, ce.event_date
      FROM canonical_events ce
      JOIN article_event_map aem ON aem.canonical_event_id = ce.id
      JOIN articles a ON a.id = aem.article_id
     WHERE ce.id = $1 AND a.embedding IS NOT NULL
     ORDER BY a.published_at DESC
     LIMIT 1
    `,
    [id],
  );
  if (!seedRes.rows.length) {
    return { ok: false, error: 'no seed embedding for this event' };
  }

  const seedEmbedding = seedRes.rows[0].embedding;
  const seedTitle = seedRes.rows[0].representative_title;

  const { rows } = await pool.query(
    `
    WITH seed AS (SELECT $1::vector AS emb),
    near AS (
      SELECT a.id AS article_id, aem.canonical_event_id,
             1 - (a.embedding <=> seed.emb) AS similarity
        FROM articles a CROSS JOIN seed
        JOIN article_event_map aem ON aem.article_id = a.id
       WHERE a.embedding IS NOT NULL
         AND aem.canonical_event_id <> $2
       ORDER BY a.embedding <=> seed.emb
       LIMIT 200
    ),
    best AS (
      SELECT canonical_event_id, MAX(similarity) AS sim
        FROM near
       GROUP BY canonical_event_id
       ORDER BY sim DESC
       LIMIT $3::int
    )
    SELECT ce.id, ce.theme, ce.representative_title AS title, ce.event_date,
           ce.article_count, b.sim AS similarity,
           (SELECT MAX(evidence_grade) FROM event_uplift eu WHERE eu.canonical_event_id = ce.id) AS best_grade,
           (SELECT MAX(ABS(t_stat)) FROM event_uplift eu WHERE eu.canonical_event_id = ce.id) AS max_abs_t,
           (SELECT MAX(ABS(uplift)) FROM event_uplift eu WHERE eu.canonical_event_id = ce.id) AS max_abs_uplift
      FROM best b JOIN canonical_events ce ON ce.id = b.canonical_event_id
     ORDER BY b.sim DESC
    `,
    [seedEmbedding, id, safeLimit],
  );

  const similar = rows.map((r) => ({
    id: Number(r.id),
    theme: r.theme,
    title: r.title,
    eventDate: r.event_date,
    articleCount: Number(r.article_count ?? 0),
    similarity: Number(r.similarity),
    bestEvidenceGrade: r.best_grade || null,
    maxAbsT: r.max_abs_t == null ? null : Number(r.max_abs_t),
    maxAbsUplift: r.max_abs_uplift == null ? null : Number(r.max_abs_uplift),
  }));

  const withUplift = similar.filter((s) => s.maxAbsUplift != null);
  const avgUplift = withUplift.length
    ? withUplift.reduce((acc, s) => acc + s.maxAbsUplift, 0) / withUplift.length
    : null;
  const e2Count = similar.filter((s) => s.bestEvidenceGrade === 'E2').length;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    seedEventId: id,
    seedTitle,
    similar,
    summary: {
      count: similar.length,
      e2Count,
      avgSimilarity: similar.length ? similar.reduce((a, s) => a + s.similarity, 0) / similar.length : null,
      avgUplift,
      withUpliftCount: withUplift.length,
    },
  };
}

/* ============================================================ */
/* P1-1: Regime Scenario Lab                                     */
/* ============================================================ */
export async function buildRegimeScenarioPayload(pool, { vix = null, yieldSpread = null, oilPrice = null } = {}) {
  // Determine target regime from inputs (rough heuristic matching regime_conditional_impact convention)
  const targetRegime = classifyRegime({ vix, yieldSpread, oilPrice });

  const { rows } = await pool.query(
    `
    SELECT theme, symbol, horizon, regime, sample_size, avg_return, hit_rate, regime_multiplier
      FROM regime_conditional_impact
     WHERE ($1::text IS NULL OR regime = $1)
       AND sample_size >= 8
     ORDER BY ABS(COALESCE(regime_multiplier, 0)) DESC NULLS LAST,
              sample_size DESC
     LIMIT 50
    `,
    [targetRegime],
  ).catch(() => ({ rows: [] }));

  const predictions = rows.map((r) => ({
    theme: r.theme,
    symbol: r.symbol,
    horizon: r.horizon,
    regime: r.regime,
    sampleSize: Number(r.sample_size ?? 0),
    avgReturn: r.avg_return == null ? null : Number(r.avg_return),
    hitRate: r.hit_rate == null ? null : Number(r.hit_rate),
    regimeMultiplier: r.regime_multiplier == null ? null : Number(r.regime_multiplier),
  }));

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    inputs: { vix, yieldSpread, oilPrice },
    targetRegime,
    predictions,
    summary: {
      totalPairs: predictions.length,
      posAvg: predictions.filter((p) => (p.avgReturn ?? 0) > 0).length,
      negAvg: predictions.filter((p) => (p.avgReturn ?? 0) < 0).length,
    },
  };
}

function classifyRegime({ vix, yieldSpread, oilPrice }) {
  const v = Number(vix);
  const y = Number(yieldSpread);
  if (Number.isFinite(v) && v > 30) return 'crisis';
  if (Number.isFinite(v) && v > 22) return 'risk-off';
  if (Number.isFinite(v) && v < 15) return 'risk-on';
  return 'balanced';
}

/* ============================================================ */
/* P1-2: Asset Dossier                                          */
/* ============================================================ */
export async function buildAssetDossierPayload(pool, { symbol }) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return { ok: false, error: 'symbol required' };

  const [themes, upliftStats, recentEvents, macroCorr] = await Promise.all([
    pool.query(
      `
      SELECT theme, avg_abs_reaction, reaction_count, correlation, quality_score,
             outcome_hit_rate, outcome_avg_return
        FROM auto_theme_symbols
       WHERE symbol = $1
       ORDER BY COALESCE(quality_score, 0) DESC NULLS LAST, reaction_count DESC
       LIMIT 8
      `,
      [sym],
    ).catch(() => ({ rows: [] })),
    pool.query(
      `
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE evidence_grade = 'E2')::int AS e2,
             COUNT(*) FILTER (WHERE evidence_grade = 'E1')::int AS e1,
             COUNT(*) FILTER (WHERE evidence_grade = 'E0')::int AS e0,
             AVG(uplift) FILTER (WHERE evidence_grade = 'E2') AS avg_e2_uplift,
             AVG(ABS(t_stat)) FILTER (WHERE evidence_grade = 'E2') AS avg_e2_t
        FROM event_uplift
       WHERE symbol = $1
      `,
      [sym],
    ).catch(() => ({ rows: [] })),
    pool.query(
      `
      SELECT ce.id, ce.theme, ce.representative_title AS title, ce.event_date,
             eu.evidence_grade, eu.uplift, eu.t_stat, eu.horizon
        FROM event_uplift eu
        JOIN canonical_events ce ON ce.id = eu.canonical_event_id
       WHERE eu.symbol = $1
       ORDER BY ce.event_date DESC
       LIMIT 8
      `,
      [sym],
    ).catch(() => ({ rows: [] })),
    pool.query(
      `
      SELECT 'macro_events' AS bucket, COUNT(*)::int AS cnt
        FROM event_uplift WHERE symbol = $1
      `,
      [sym],
    ).catch(() => ({ rows: [] })),
  ]);

  const stats = upliftStats.rows[0] || {};
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    symbol: sym,
    themes: themes.rows.map((t) => ({
      theme: t.theme,
      avgAbsReaction: t.avg_abs_reaction == null ? null : Number(t.avg_abs_reaction),
      reactionCount: Number(t.reaction_count ?? 0),
      correlation: t.correlation == null ? null : Number(t.correlation),
      qualityScore: t.quality_score == null ? null : Number(t.quality_score),
      outcomeHitRate: t.outcome_hit_rate == null ? null : Number(t.outcome_hit_rate),
      outcomeAvgReturn: t.outcome_avg_return == null ? null : Number(t.outcome_avg_return),
    })),
    upliftStats: {
      total: Number(stats.total ?? 0),
      e2: Number(stats.e2 ?? 0),
      e1: Number(stats.e1 ?? 0),
      e0: Number(stats.e0 ?? 0),
      avgE2Uplift: stats.avg_e2_uplift == null ? null : Number(stats.avg_e2_uplift),
      avgE2T: stats.avg_e2_t == null ? null : Number(stats.avg_e2_t),
    },
    recentEvents: recentEvents.rows.map((e) => ({
      id: Number(e.id),
      theme: e.theme,
      title: e.title,
      eventDate: e.event_date,
      evidenceGrade: e.evidence_grade,
      uplift: e.uplift == null ? null : Number(e.uplift),
      tStat: e.t_stat == null ? null : Number(e.t_stat),
      horizon: e.horizon,
    })),
  };
}

/* ============================================================ */
/* P2-1: Weekly AI Digest via Codex                              */
/* ============================================================ */
export async function buildWeeklyDigestPayload(pool, { forceRefresh = false } = {}) {
  // 7d aggregate of what changed
  const [events7d, transitions, topUplift, signals] = await Promise.all([
    pool.query(
      `
      SELECT COUNT(*)::int AS new_events,
             SUM(article_count)::int AS total_articles,
             COUNT(DISTINCT theme)::int AS themes
        FROM canonical_events
       WHERE event_date >= CURRENT_DATE - INTERVAL '7 days'
      `,
    ).catch(() => ({ rows: [{}] })),
    pool.query(
      `
      SELECT theme, COUNT(*)::int AS n
        FROM theme_trend_aggregates
       WHERE period_end >= CURRENT_DATE - INTERVAL '7 days'
         AND previous_lifecycle_stage IS NOT NULL
         AND lifecycle_stage <> previous_lifecycle_stage
       GROUP BY theme
       ORDER BY n DESC
       LIMIT 6
      `,
    ).catch(() => ({ rows: [] })),
    pool.query(
      `
      SELECT ce.representative_title AS title, ce.theme, ce.event_date,
             eu.symbol, eu.uplift, eu.t_stat, eu.evidence_grade
        FROM event_uplift eu JOIN canonical_events ce ON ce.id = eu.canonical_event_id
       WHERE ce.event_date >= CURRENT_DATE - INTERVAL '30 days'
         AND eu.evidence_grade = 'E2' AND ABS(eu.t_stat) >= 2
       ORDER BY ABS(eu.t_stat) DESC
       LIMIT 6
      `,
    ).catch(() => ({ rows: [] })),
    pool.query(
      `
      SELECT signal_name, AVG(value) AS avg_val, MAX(ts) AS latest
        FROM signal_history
       WHERE ts >= CURRENT_DATE - INTERVAL '7 days'
         AND signal_name IN ('vix', 'yieldSpread', 'oilPrice', 'dollarIndex', 'hyCreditSpread')
       GROUP BY signal_name
      `,
    ).catch(() => ({ rows: [] })),
  ]);

  const prompt = buildDigestPrompt({
    window: '7 days',
    stats: events7d.rows[0] || {},
    transitions: transitions.rows,
    topUplift: topUplift.rows,
    signals: signals.rows,
  });

  const { runCodexJsonPrompt } = await import('./codex-json.mjs');
  const result = await runCodexJsonPrompt(prompt, 120_000, { label: 'weekly-digest' });

  if (!result.parsed) {
    return {
      ok: false,
      error: 'codex output not JSON',
      stderr: String(result.stderr || '').slice(0, 400),
      message: String(result.message || '').slice(0, 600),
    };
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    window: '7 days',
    stats: events7d.rows[0],
    transitions: transitions.rows,
    topUplift: topUplift.rows,
    signals: signals.rows,
    digest: result.parsed,
  };
}

function buildDigestPrompt({ window, stats, transitions, topUplift, signals }) {
  const tLines = transitions.map((t) => `  ${t.theme}: ${t.n} transitions`).join('\n') || '  (none)';
  const uLines = topUplift.slice(0, 5).map((u) =>
    `  ${u.symbol} (${u.theme}): uplift=${u.uplift} t=${u.t_stat} · "${(u.title || '').slice(0, 60)}"`,
  ).join('\n') || '  (none)';
  const sLines = signals.map((s) => `  ${s.signal_name}: ${Number(s.avg_val).toFixed(2)} (latest ${String(s.latest).slice(0, 10)})`).join('\n');

  return `You are a financial intelligence analyst producing a weekly brief.

WINDOW: past ${window}

STATS
- new events: ${stats.new_events || 0}
- total articles: ${stats.total_articles || 0}
- themes touched: ${stats.themes || 0}

LIFECYCLE TRANSITIONS
${tLines}

TOP E2 UPLIFT (last 30d)
${uLines}

MACRO SIGNALS
${sLines}

Output ONLY a single JSON object (no markdown):
{
  "headline": "one-sentence summary (under 120 chars)",
  "regime": "one phrase naming the market regime currently dominating",
  "what_changed": "2-3 sentences on what shifted this week",
  "watch_next": "2-3 sentences on what to monitor next",
  "top_tickers": ["SYM1","SYM2","SYM3"]
}`;
}

/* ============================================================ */
/* P2-2: Correlation Break Anomaly Detector                     */
/* ============================================================ */
export async function buildCorrelationBreaksPayload(pool) {
  const signals = ['vix', 'yieldSpread', 'oilPrice', 'dollarIndex', 'hyCreditSpread', 'marketStress'];

  // Fetch each signal's 90d series
  const series = {};
  for (const s of signals) {
    const { rows } = await pool.query(
      `
      SELECT ts::date AS d, AVG(value) AS v
        FROM signal_history
       WHERE signal_name = $1
         AND ts >= CURRENT_DATE - INTERVAL '90 days'
       GROUP BY ts::date
       ORDER BY d
      `,
      [s],
    );
    series[s] = rows.map((r) => ({ d: r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10), v: Number(r.v) }));
  }

  // Align by date, compute correlation on last 30d vs 90d
  const allDates = Array.from(new Set(Object.values(series).flat().map((r) => r.d))).sort();
  const last30 = allDates.slice(-30);
  const last90 = allDates;

  function corr(xs, ys) {
    const n = Math.min(xs.length, ys.length);
    if (n < 5) return null;
    const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      const vx = xs[i] - mx, vy = ys[i] - my;
      num += vx * vy; dx += vx * vx; dy += vy * vy;
    }
    if (dx === 0 || dy === 0) return null;
    return num / Math.sqrt(dx * dy);
  }

  function pickSeries(sigName, dates) {
    const map = new Map(series[sigName].map((r) => [r.d, r.v]));
    return dates.map((d) => map.get(d)).filter(Number.isFinite);
  }

  const breaks = [];
  for (let i = 0; i < signals.length; i++) {
    for (let j = i + 1; j < signals.length; j++) {
      const a = signals[i], b = signals[j];
      const aligned30 = { a: pickSeries(a, last30), b: pickSeries(b, last30) };
      const aligned90 = { a: pickSeries(a, last90), b: pickSeries(b, last90) };
      if (aligned30.a.length < 5 || aligned90.a.length < 20) continue;
      const c30 = corr(aligned30.a, aligned30.b);
      const c90 = corr(aligned90.a, aligned90.b);
      if (c30 == null || c90 == null) continue;
      const delta = c30 - c90;
      breaks.push({
        pair: `${a}×${b}`,
        corr30d: c30,
        corr90d: c90,
        delta,
        absDelta: Math.abs(delta),
        direction: delta > 0 ? 'tightening' : 'breaking',
      });
    }
  }

  breaks.sort((x, y) => y.absDelta - x.absDelta);
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    window30d: last30.length,
    window90d: last90.length,
    breaks: breaks.slice(0, 15),
    alerts: breaks.filter((b) => b.absDelta >= 0.3).slice(0, 5),
  };
}

export const _internals = {
  classifyRegime,
  buildNarrativePrompt,
  buildDigestPrompt,
};
