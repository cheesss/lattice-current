/**
 * Event intelligence builders — expose the project's core domain data
 * (events, evidence grades, meta-model predictions, source diversity)
 * through read-only payloads for dashboard APIs and OpenClaw tools.
 *
 * Philosophy:
 *   - aggregate metrics only, no raw predictions beyond small samples
 *   - include evidence grade (E0–E4) so consumers never mistake weak
 *     signals for strong ones
 *   - every payload carries generatedAt and explicit zero-result markers
 *
 * Tables touched (all read-only):
 *   canonical_events, event_hawkes_intensity, event_uplift,
 *   model_predictions, model_eval, matched_controls, article_event_map,
 *   articles
 */

const HOT_EVENTS_LIMIT = 10;
const HOT_EVENTS_LOOKBACK_DAYS = 7;
export const HOT_EVENTS_MIN_PROMOTION_CONTROLS = 8;
const EXPLAIN_EVENT_ARTICLE_LIMIT = 12;
const EXPLAIN_EVENT_SYMBOL_LIMIT = 10;
const SOURCE_DIVERSITY_WINDOW_HOURS = 24;
const SOURCE_DIVERSITY_TOP_LIMIT = 15;
const SOURCE_DOMINANCE_WARN_PCT = 0.30;
const SOURCE_DOMINANCE_CRITICAL_PCT = 0.50;
const META_MODEL_RECENT_HOURS = 24;

async function tableExists(executor, tableName) {
  const { rows } = await executor.query(
    `SELECT to_regclass($1) AS oid`,
    [`public.${tableName}`],
  );
  return Boolean(rows[0]?.oid);
}

/* ===================== get_hot_events ===================== */

function asBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function buildHotEventQualityFlags(row = {}) {
  const flags = [];
  const rawGrade = row.raw_best_grade || row.raw_evidence_grade || row.best_grade || null;
  const promotedGrade = row.promoted_grade || null;
  const controlsBlocked = asBoolean(row.controls_blocked);
  const relevanceBlocked = asBoolean(row.relevance_blocked);

  if (rawGrade && !promotedGrade) {
    flags.push('raw-grade-not-promoted');
  }
  if (controlsBlocked) {
    flags.push('low-control-count');
  }
  if (relevanceBlocked) {
    flags.push('low-market-relevance');
  }
  if (Number(row.article_count ?? 0) < 2) {
    flags.push('single-article');
  }
  if (Number(row.source_count ?? 0) < 2) {
    flags.push('single-source');
  }
  return flags;
}

export function normalizeHotEventRow(row = {}) {
  const qualityFlags = buildHotEventQualityFlags(row);
  const promotedGrade = row.promoted_grade || null;
  const rawGrade = row.raw_best_grade || row.raw_evidence_grade || row.best_grade || null;

  return {
    id: Number(row.id),
    theme: row.theme,
    title: row.representative_title,
    eventDate: row.event_date,
    articleCount: Number(row.article_count ?? 0),
    sourceCount: Number(row.source_count ?? 0),
    temperature: row.temperature == null ? null : Number(row.temperature),
    isSurge: Boolean(row.is_surge),
    bestEvidenceGrade: promotedGrade,
    rawEvidenceGrade: rawGrade,
    upliftRows: Number(row.uplift_rows ?? 0),
    promotedUpliftRows: Number(row.promoted_uplift_rows ?? 0),
    maxAbsUplift: row.rank_abs_uplift == null ? null : Number(row.rank_abs_uplift),
    rawMaxAbsUplift: row.raw_max_abs_uplift == null ? null : Number(row.raw_max_abs_uplift),
    maxAbsTStat: row.rank_abs_t == null ? null : Number(row.rank_abs_t),
    rawMaxAbsTStat: row.raw_max_abs_t == null ? null : Number(row.raw_max_abs_t),
    minStrongControls: row.min_strong_controls == null ? null : Number(row.min_strong_controls),
    maxStrongControls: row.max_strong_controls == null ? null : Number(row.max_strong_controls),
    marketRelevantArticles: Number(row.market_relevant_articles ?? 0),
    knownMarketRelevanceArticles: Number(row.known_market_relevance_articles ?? 0),
    lowRelevanceArticles: Number(row.low_relevance_articles ?? 0),
    qualityFlags,
    promotionEligible: ['E2', 'E3', 'E4'].includes(String(promotedGrade || '').toUpperCase()),
    qualityGate: {
      minControlsRequired: HOT_EVENTS_MIN_PROMOTION_CONTROLS,
      controlsBlocked: asBoolean(row.controls_blocked),
      relevanceBlocked: asBoolean(row.relevance_blocked),
    },
  };
}

export async function buildHotEventsPayload(pool, { limit = HOT_EVENTS_LIMIT, lookbackDays = HOT_EVENTS_LOOKBACK_DAYS } = {}) {
  const client = pool;
  try {
    const haveCanonical = await tableExists(client, 'canonical_events');
    if (!haveCanonical) {
      return {
        ok: true,
        generatedAt: new Date().toISOString(),
        available: false,
        lookbackDays,
        events: [],
        note: 'canonical_events table missing — event engine not initialized',
      };
    }

    const safeLimit = Math.min(25, Math.max(1, Number(limit) || HOT_EVENTS_LIMIT));
    // Widened cap: old 30d cap meant the outcome-window lag (E2 events are ~2-4 weeks
    // behind real-time by design) could never surface. Allow up to 90d so graded events
    // from the outcome-completed zone are visible alongside recent-but-pending items.
    const safeLookback = Math.min(90, Math.max(1, Number(lookbackDays) || HOT_EVENTS_LOOKBACK_DAYS));

    const { rows } = await client.query(
      `
      WITH recent_events AS (
        -- UNION two pools: (a) most recent events by volume, (b) top graded events by |t|
        -- so the 200-row cap doesn't clip out the event_uplift-labeled zone (~2w older).
        --
        -- Filters applied to both pools:
        --   article_count >= 2   excludes singleton arXiv-style entries that are
        --                        publications, not multi-source confirmed events.
        --                        Without this, the volume pool fills with ~500/day
        --                        emerging-tech singletons.
        --   theme NOT LIKE 'dt-%' excludes auto-generated dynamic theme codes
        --                        (hash-named, missing canonical classification).
        (SELECT ce.id, ce.theme, ce.representative_title, ce.event_date,
                COALESCE(ce.article_count, 0) AS article_count,
                COALESCE(ce.source_count, 0)  AS source_count
           FROM canonical_events ce
          WHERE ce.event_date >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
            AND COALESCE(ce.article_count, 0) >= 2
            AND ce.theme NOT LIKE 'dt-%'
          ORDER BY ce.event_date DESC, ce.article_count DESC NULLS LAST
          LIMIT 120)
        UNION
        (SELECT ce.id, ce.theme, ce.representative_title, ce.event_date,
                COALESCE(ce.article_count, 0) AS article_count,
                COALESCE(ce.source_count, 0)  AS source_count
           FROM canonical_events ce
           JOIN event_uplift eu ON eu.canonical_event_id = ce.id
          WHERE ce.event_date >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
            AND eu.evidence_grade IN ('E2','E3','E4')
            AND ABS(COALESCE(eu.t_stat, 0)) >= 2
            AND COALESCE(ce.article_count, 0) >= 2
            AND ce.theme NOT LIKE 'dt-%'
          ORDER BY ce.event_date DESC
          LIMIT 80)
      ),
      hawkes AS (
        SELECT theme, event_date,
               MAX(normalized_temperature) AS temperature,
               BOOL_OR(is_surge)           AS is_surge
          FROM event_hawkes_intensity
         WHERE event_date >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
         GROUP BY theme, event_date
      ),
      article_quality AS (
        SELECT aem.canonical_event_id,
               COUNT(*)::int AS mapped_articles,
               COUNT(DISTINCT COALESCE(NULLIF(a.publisher_group, ''), NULLIF(a.source, '')))::int AS publisher_groups,
               COUNT(*) FILTER (WHERE a.market_relevance IS NOT NULL)::int AS known_market_relevance_articles,
               COUNT(*) FILTER (WHERE a.market_relevance IN ('high', 'medium'))::int AS market_relevant_articles,
               COUNT(*) FILTER (WHERE a.market_relevance = 'low')::int AS low_relevance_articles
          FROM article_event_map aem
          JOIN recent_events re ON re.id = aem.canonical_event_id
          JOIN articles a ON a.id = aem.article_id
         GROUP BY aem.canonical_event_id
      ),
      uplift_agg AS (
        SELECT eu.canonical_event_id,
               MAX(eu.evidence_grade) AS raw_best_grade,
               MAX(eu.evidence_grade) FILTER (
                 WHERE eu.evidence_grade IN ('E2','E3','E4')
                   AND ABS(COALESCE(eu.t_stat, 0)) >= 2
                   AND COALESCE(eu.n_controls, 0) >= ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
               ) AS control_qualified_grade,
               COUNT(*)::int AS uplift_rows,
               COUNT(*) FILTER (
                 WHERE eu.evidence_grade IN ('E2','E3','E4')
                   AND ABS(COALESCE(eu.t_stat, 0)) >= 2
               )::int AS strong_uplift_rows,
               COUNT(*) FILTER (
                 WHERE eu.evidence_grade IN ('E2','E3','E4')
                   AND ABS(COALESCE(eu.t_stat, 0)) >= 2
                   AND COALESCE(eu.n_controls, 0) >= ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
               )::int AS promoted_uplift_rows,
               MAX(ABS(COALESCE(eu.uplift, 0))) AS raw_max_abs_uplift,
               MAX(ABS(COALESCE(eu.t_stat, 0))) AS raw_max_abs_t,
               MAX(ABS(COALESCE(eu.uplift, 0))) FILTER (
                 WHERE eu.evidence_grade IN ('E2','E3','E4')
                   AND ABS(COALESCE(eu.t_stat, 0)) >= 2
                   AND COALESCE(eu.n_controls, 0) >= ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
               ) AS promoted_max_abs_uplift,
               MAX(ABS(COALESCE(eu.t_stat, 0))) FILTER (
                 WHERE eu.evidence_grade IN ('E2','E3','E4')
                   AND ABS(COALESCE(eu.t_stat, 0)) >= 2
                   AND COALESCE(eu.n_controls, 0) >= ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
               ) AS promoted_max_abs_t,
               MIN(NULLIF(eu.n_controls, 0)) FILTER (
                 WHERE eu.evidence_grade IN ('E2','E3','E4')
                   AND ABS(COALESCE(eu.t_stat, 0)) >= 2
               ) AS min_strong_controls,
               MAX(NULLIF(eu.n_controls, 0)) FILTER (
                 WHERE eu.evidence_grade IN ('E2','E3','E4')
                   AND ABS(COALESCE(eu.t_stat, 0)) >= 2
               ) AS max_strong_controls
          FROM event_uplift eu
          JOIN recent_events re ON re.id = eu.canonical_event_id
         GROUP BY eu.canonical_event_id
      ),
      ranked AS (
        SELECT re.id,
               re.theme,
               re.representative_title,
               re.event_date,
               re.article_count,
               re.source_count,
               h.temperature,
               h.is_surge,
               ua.raw_best_grade,
               CASE
                 WHEN ua.control_qualified_grade IS NULL THEN NULL
                 WHEN COALESCE(aq.known_market_relevance_articles, 0) > 0
                  AND COALESCE(aq.market_relevant_articles, 0) = 0
                  AND COALESCE(aq.low_relevance_articles, 0) > 0 THEN NULL
                 ELSE ua.control_qualified_grade
               END AS promoted_grade,
               ua.uplift_rows,
               ua.strong_uplift_rows,
               ua.promoted_uplift_rows,
               ua.raw_max_abs_uplift,
               ua.raw_max_abs_t,
               CASE
                 WHEN ua.control_qualified_grade IS NULL THEN NULL
                 WHEN COALESCE(aq.known_market_relevance_articles, 0) > 0
                  AND COALESCE(aq.market_relevant_articles, 0) = 0
                  AND COALESCE(aq.low_relevance_articles, 0) > 0 THEN NULL
                 ELSE ua.promoted_max_abs_uplift
               END AS rank_abs_uplift,
               CASE
                 WHEN ua.control_qualified_grade IS NULL THEN NULL
                 WHEN COALESCE(aq.known_market_relevance_articles, 0) > 0
                  AND COALESCE(aq.market_relevant_articles, 0) = 0
                  AND COALESCE(aq.low_relevance_articles, 0) > 0 THEN NULL
                 ELSE ua.promoted_max_abs_t
               END AS rank_abs_t,
               ua.min_strong_controls,
               ua.max_strong_controls,
               COALESCE(aq.known_market_relevance_articles, 0) AS known_market_relevance_articles,
               COALESCE(aq.market_relevant_articles, 0) AS market_relevant_articles,
               COALESCE(aq.low_relevance_articles, 0) AS low_relevance_articles,
               (COALESCE(ua.strong_uplift_rows, 0) > 0 AND COALESCE(ua.promoted_uplift_rows, 0) = 0) AS controls_blocked,
               (COALESCE(aq.known_market_relevance_articles, 0) > 0
                AND COALESCE(aq.market_relevant_articles, 0) = 0
                AND COALESCE(aq.low_relevance_articles, 0) > 0) AS relevance_blocked
          FROM recent_events re
          LEFT JOIN hawkes h          ON h.theme = re.theme AND h.event_date = re.event_date
          LEFT JOIN uplift_agg ua     ON ua.canonical_event_id = re.id
          LEFT JOIN article_quality aq ON aq.canonical_event_id = re.id
      )
      SELECT *
        FROM ranked
       ORDER BY
         CASE WHEN promoted_grade IN ('E4','E3') THEN 0
              WHEN promoted_grade IN ('E2','E1') THEN 1
              ELSE 2 END,
         COALESCE(rank_abs_t, 0) DESC,
         COALESCE(temperature, 0) DESC,
         event_date DESC,
         article_count DESC
       LIMIT $1::int
      `,
      [safeLimit, safeLookback],
    );

    const events = rows.map(normalizeHotEventRow);

    const gradeCounts = { E4: 0, E3: 0, E2: 0, E1: 0, E0: 0, none: 0 };
    for (const ev of events) {
      const g = ev.bestEvidenceGrade;
      if (g && g in gradeCounts) gradeCounts[g] += 1;
      else gradeCounts.none += 1;
    }

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      available: true,
      lookbackDays: safeLookback,
      limit: safeLimit,
      qualityGate: {
        minControlsRequired: HOT_EVENTS_MIN_PROMOTION_CONTROLS,
        note: 'Raw E2/E3/E4 grades are promoted only when the uplift row has enough matched controls and is not market-relevance blocked.',
      },
      totalReturned: events.length,
      gradeCounts,
      surgeCount: events.filter((e) => e.isSurge).length,
      events,
    };
  } catch (err) {
    throw err;
  }
}

/* ===================== get_meta_model_health ===================== */

export async function buildMetaModelHealthPayload(pool) {
  const client = pool;
  try {
    const haveEval = await tableExists(client, 'model_eval');
    const havePredictions = await tableExists(client, 'model_predictions');

    let latestEval = null;
    let evalHistory = [];
    if (haveEval) {
      const { rows } = await client.query(`
        SELECT model_version, eval_date, brier_score, ece, log_loss, n_samples,
               deflated_sharpe, top20_precision, alpha_hit_rate, split_type
          FROM model_eval
         ORDER BY eval_date DESC
         LIMIT 8
      `);
      evalHistory = rows.map((r) => ({
        modelVersion: r.model_version,
        evalDate: r.eval_date,
        splitType: r.split_type ?? null,
        brierScore: r.brier_score == null ? null : Number(r.brier_score),
        ece: r.ece == null ? null : Number(r.ece),
        logLoss: r.log_loss == null ? null : Number(r.log_loss),
        sampleCount: r.n_samples == null ? null : Number(r.n_samples),
        deflatedSharpe: r.deflated_sharpe == null ? null : Number(r.deflated_sharpe),
        top20Precision: r.top20_precision == null ? null : Number(r.top20_precision),
        alphaHitRate: r.alpha_hit_rate == null ? null : Number(r.alpha_hit_rate),
      }));
      latestEval = evalHistory[0] ?? null;
    }

    let recentPredictions = null;
    let activeModelVersions = [];
    if (havePredictions) {
      const counts = await client.query(
        `
        SELECT COUNT(*)::int                                AS total,
               COUNT(DISTINCT model_version)::int           AS model_versions,
               COUNT(*) FILTER (
                 WHERE created_at > now() - ($1 || ' hours')::interval
               )::int                                       AS recent
          FROM model_predictions
        `,
        [String(META_MODEL_RECENT_HOURS)],
      ).catch(() => null);
      if (counts) {
        recentPredictions = {
          total: counts.rows[0]?.total ?? 0,
          modelVersions: counts.rows[0]?.model_versions ?? 0,
          recentWindowHours: META_MODEL_RECENT_HOURS,
          recentCount: counts.rows[0]?.recent ?? 0,
        };
      }
      const versions = await client.query(`
        SELECT model_version, COUNT(*)::int AS n, MAX(created_at) AS latest
          FROM model_predictions
         GROUP BY model_version
         ORDER BY latest DESC NULLS LAST
         LIMIT 5
      `).catch(() => null);
      if (versions) {
        activeModelVersions = versions.rows.map((r) => ({
          modelVersion: r.model_version,
          predictionCount: Number(r.n ?? 0),
          latestAt: r.latest,
        }));
      }
    }

    let level = 'ok';
    const notes = [];
    if (!haveEval && !havePredictions) {
      level = 'warning';
      notes.push('model_eval / model_predictions 테이블 없음 — meta-model 파이프라인 미초기화');
    } else if (!haveEval) {
      level = 'warning';
      notes.push('model_eval 테이블 없음 — Brier/ECE 추적 불가');
    } else if (!latestEval) {
      level = 'warning';
      notes.push('model_eval 비어 있음 — 첫 검증 실행 필요');
    } else {
      if (Number.isFinite(latestEval.brierScore) && latestEval.brierScore > 0.25) {
        level = 'warning';
        notes.push(`Brier ${latestEval.brierScore.toFixed(4)} > 0.25 — 확률 보정 재검토`);
      }
      if (Number.isFinite(latestEval.ece) && latestEval.ece > 0.10) {
        level = 'warning';
        notes.push(`ECE ${latestEval.ece.toFixed(4)} > 0.10 — calibration drift 가능성`);
      }
    }
    if (recentPredictions && recentPredictions.recentCount === 0 && recentPredictions.total > 0) {
      if (level !== 'warning') level = 'warning';
      notes.push(`최근 ${META_MODEL_RECENT_HOURS}시간 예측 0건 — 추론 서버 확인`);
    }

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      summary: {
        level,
        hasEvalTable: haveEval,
        hasPredictionsTable: havePredictions,
        latestEval,
        recentPredictions,
        notes,
      },
      evalHistory,
      activeModelVersions,
    };
  } catch (err) {
    throw err;
  }
}

/* ===================== explain_event ===================== */

export async function buildExplainEventPayload(pool, { eventId }) {
  const id = Number(eventId);
  if (!Number.isFinite(id) || id < 1) {
    return { ok: false, error: 'eventId required (positive integer)' };
  }

  const client = pool;
  try {
    const eventRes = await client.query(
      `
      SELECT id, theme, representative_title, event_date,
             COALESCE(article_count, 0)::int AS article_count,
             COALESCE(source_count, 0)::int  AS source_count,
             created_at
        FROM canonical_events
       WHERE id = $1
      `,
      [id],
    );
    if (!eventRes.rows.length) {
      return { ok: false, error: `event ${id} not found` };
    }
    const event = eventRes.rows[0];

    const [articlesRes, upliftRes, controlsRes, hawkesRes] = await Promise.all([
      client.query(
        `
        SELECT a.id, a.title, a.source, a.published_at, a.url
          FROM article_event_map aem
          JOIN articles a ON a.id = aem.article_id
         WHERE aem.canonical_event_id = $1
         ORDER BY a.published_at DESC NULLS LAST
         LIMIT $2
        `,
        [id, EXPLAIN_EVENT_ARTICLE_LIMIT],
      ).catch(() => ({ rows: [] })),
      client.query(
        `
        WITH article_quality AS (
          SELECT aem.canonical_event_id,
                 COUNT(*) FILTER (WHERE a.market_relevance IS NOT NULL)::int AS known_market_relevance_articles,
                 COUNT(*) FILTER (WHERE a.market_relevance IN ('high', 'medium'))::int AS market_relevant_articles,
                 COUNT(*) FILTER (WHERE a.market_relevance = 'low')::int AS low_relevance_articles
            FROM article_event_map aem
            JOIN articles a ON a.id = aem.article_id
           WHERE aem.canonical_event_id = $1
           GROUP BY aem.canonical_event_id
        )
        SELECT eu.symbol, eu.horizon, eu.uplift, eu.t_stat,
               eu.evidence_grade AS raw_evidence_grade,
               CASE
                 WHEN eu.evidence_grade IN ('E2','E3','E4')
                  AND (
                    ABS(COALESCE(eu.t_stat, 0)) < 2
                    OR COALESCE(eu.n_controls, 0) < ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
                    OR (
                      COALESCE(aq.known_market_relevance_articles, 0) > 0
                      AND COALESCE(aq.market_relevant_articles, 0) = 0
                      AND COALESCE(aq.low_relevance_articles, 0) > 0
                    )
                  ) THEN NULL
                 ELSE eu.evidence_grade
               END AS promoted_grade,
               eu.event_alpha, eu.control_avg_return, eu.n_controls,
               COALESCE(aq.known_market_relevance_articles, 0) AS known_market_relevance_articles,
               COALESCE(aq.market_relevant_articles, 0) AS market_relevant_articles,
               COALESCE(aq.low_relevance_articles, 0) AS low_relevance_articles,
               (
                 eu.evidence_grade IN ('E2','E3','E4')
                 AND COALESCE(eu.n_controls, 0) < ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
               ) AS controls_blocked,
               (
                 eu.evidence_grade IN ('E2','E3','E4')
                 AND COALESCE(aq.known_market_relevance_articles, 0) > 0
                 AND COALESCE(aq.market_relevant_articles, 0) = 0
                 AND COALESCE(aq.low_relevance_articles, 0) > 0
               ) AS relevance_blocked
          FROM event_uplift eu
          LEFT JOIN article_quality aq ON aq.canonical_event_id = eu.canonical_event_id
         WHERE eu.canonical_event_id = $1
         ORDER BY ABS(COALESCE(eu.t_stat, 0)) DESC NULLS LAST,
                  ABS(COALESCE(eu.uplift, 0)) DESC NULLS LAST
         LIMIT $2
        `,
        [id, EXPLAIN_EVENT_SYMBOL_LIMIT],
      ).catch(() => ({ rows: [] })),
      client.query(
        `
        SELECT control_date, match_distance,
               (vix_event - vix_control)                 AS vix_delta,
               (yield_spread_event - yield_spread_control) AS yield_delta,
               regime_event, regime_control
          FROM matched_controls
         WHERE canonical_event_id = $1
         ORDER BY control_date
         LIMIT 10
        `,
        [id],
      ).catch(() => ({ rows: [] })),
      client.query(
        `
        SELECT theme, event_date, normalized_temperature, is_surge, article_count
          FROM event_hawkes_intensity
         WHERE theme = $1 AND event_date = $2
         LIMIT 1
        `,
        [event.theme, event.event_date],
      ).catch(() => ({ rows: [] })),
    ]);

    const sourceSet = new Set(
      articlesRes.rows.map((a) => String(a.source || '')).filter(Boolean),
    );

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      event: {
        id: Number(event.id),
        theme: event.theme,
        title: event.representative_title,
        eventDate: event.event_date,
        articleCount: event.article_count,
        sourceCount: event.source_count,
        sampledSourceDiversity: sourceSet.size,
        createdAt: event.created_at,
      },
      hawkes: hawkesRes.rows[0]
        ? {
            temperature: hawkesRes.rows[0].normalized_temperature == null
              ? null
              : Number(hawkesRes.rows[0].normalized_temperature),
            isSurge: Boolean(hawkesRes.rows[0].is_surge),
            articleCount: Number(hawkesRes.rows[0].article_count ?? 0),
          }
        : null,
      articles: articlesRes.rows.map((a) => ({
        id: Number(a.id),
        title: a.title,
        sourceId: a.source,
        publishedAt: a.published_at,
        url: a.url,
      })),
      uplift: upliftRes.rows.map((u) => ({
        ...(() => {
          const qualityFlags = buildHotEventQualityFlags({
            raw_evidence_grade: u.raw_evidence_grade,
            promoted_grade: u.promoted_grade,
            controls_blocked: u.controls_blocked,
            relevance_blocked: u.relevance_blocked,
            article_count: event.article_count,
            source_count: event.source_count,
          });
          return {
            rawEvidenceGrade: u.raw_evidence_grade,
            evidenceGrade: u.promoted_grade,
            qualityFlags,
            promotionEligible: ['E2', 'E3', 'E4'].includes(String(u.promoted_grade || '').toUpperCase()),
            qualityGate: {
              minControlsRequired: HOT_EVENTS_MIN_PROMOTION_CONTROLS,
              controlsBlocked: asBoolean(u.controls_blocked),
              relevanceBlocked: asBoolean(u.relevance_blocked),
            },
          };
        })(),
        symbol: u.symbol,
        horizon: u.horizon,
        uplift: u.uplift == null ? null : Number(u.uplift),
        tStat: u.t_stat == null ? null : Number(u.t_stat),
        eventAlphaMean: u.event_alpha == null ? null : Number(u.event_alpha),
        controlAlphaMean: u.control_avg_return == null ? null : Number(u.control_avg_return),
        nControls: u.n_controls == null ? null : Number(u.n_controls),
        marketRelevantArticles: Number(u.market_relevant_articles ?? 0),
        knownMarketRelevanceArticles: Number(u.known_market_relevance_articles ?? 0),
        lowRelevanceArticles: Number(u.low_relevance_articles ?? 0),
      })),
      controls: controlsRes.rows.map((c) => ({
        controlDate: c.control_date,
        matchDistance: c.match_distance == null ? null : Number(c.match_distance),
        vixDelta: c.vix_delta == null ? null : Number(c.vix_delta),
        yieldSpreadDelta: c.yield_delta == null ? null : Number(c.yield_delta),
        regimeEvent: c.regime_event ?? null,
        regimeControl: c.regime_control ?? null,
      })),
    };
  } catch (err) {
    throw err;
  }
}

/* ===================== get_source_diversity_audit ===================== */

export async function buildSourceDiversityAuditPayload(pool, { windowHours = SOURCE_DIVERSITY_WINDOW_HOURS } = {}) {
  const client = pool;
  try {
    const haveArticles = await tableExists(client, 'articles');
    if (!haveArticles) {
      return {
        ok: true,
        generatedAt: new Date().toISOString(),
        available: false,
        windowHours,
        sources: [],
        note: 'articles table missing',
      };
    }

    const safeWindow = Math.min(168, Math.max(1, Number(windowHours) || SOURCE_DIVERSITY_WINDOW_HOURS));

    const { rows } = await client.query(
      `
      SELECT COALESCE(NULLIF(source, ''), '(unknown)') AS source_id,
             COUNT(*)::int AS article_count
        FROM articles
       WHERE published_at > now() - ($1 || ' hours')::interval
       GROUP BY source
       ORDER BY article_count DESC
       LIMIT $2
      `,
      [String(safeWindow), SOURCE_DIVERSITY_TOP_LIMIT],
    );

    const totalRes = await client.query(
      `
      SELECT COUNT(*)::int AS total
        FROM articles
       WHERE published_at > now() - ($1 || ' hours')::interval
      `,
      [String(safeWindow)],
    );
    const total = totalRes.rows[0]?.total ?? 0;

    const SYNDICATOR_PATTERNS = [/google.?news/i, /iheart/i, /msn\b/i, /yahoo.?news/i, /feedburner/i];
    const sources = rows.map((r) => {
      const share = total > 0 ? r.article_count / total : 0;
      const syndicator = SYNDICATOR_PATTERNS.some((re) => re.test(String(r.source_id)));
      let flag = null;
      if (share >= SOURCE_DOMINANCE_CRITICAL_PCT) flag = 'critical';
      else if (share >= SOURCE_DOMINANCE_WARN_PCT) flag = 'warning';
      return {
        sourceId: r.source_id,
        articleCount: Number(r.article_count),
        share,
        isSyndicator: syndicator,
        flag,
      };
    });

    let level = 'ok';
    if (sources.some((s) => s.flag === 'critical')) level = 'critical';
    else if (sources.some((s) => s.flag === 'warning')) level = 'warning';

    const syndicatorShare = sources
      .filter((s) => s.isSyndicator)
      .reduce((acc, s) => acc + s.share, 0);
    if (syndicatorShare >= 0.25 && level === 'ok') level = 'warning';

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      available: true,
      windowHours: safeWindow,
      totalArticles: total,
      distinctSources: sources.length,
      topSourceShare: sources[0]?.share ?? 0,
      syndicatorShare,
      level,
      sources,
    };
  } catch (err) {
    throw err;
  }
}

/* ===================== get_theme_impact ===================== */

export async function buildThemeImpactPayload(pool, { theme, horizon = null, symbolLimit = 12 } = {}) {
  const t = String(theme || '').trim().toLowerCase();
  if (!t) return { ok: false, error: 'theme required' };
  const safeLimit = Math.min(30, Math.max(1, Number(symbolLimit) || 12));
  const horizonFilter = horizon ? String(horizon).trim() : null;

  const [haveSens, haveRegime, haveCond, haveAuto] = await Promise.all([
    tableExists(pool, 'stock_sensitivity_matrix'),
    tableExists(pool, 'regime_conditional_impact'),
    tableExists(pool, 'conditional_sensitivity'),
    tableExists(pool, 'auto_theme_symbols'),
  ]);

  const [sens, regime, conds, auto] = await Promise.all([
    haveSens
      ? pool.query(
          `
          SELECT symbol, horizon, sample_size, avg_return, hit_rate, return_vol,
                 sensitivity_zscore, baseline_return, baseline_vol, interpretation
            FROM stock_sensitivity_matrix
           WHERE LOWER(theme) = $1
             AND ($2::text IS NULL OR horizon = $2)
           ORDER BY ABS(COALESCE(sensitivity_zscore, 0)) DESC NULLS LAST,
                    sample_size DESC
           LIMIT $3
          `,
          [t, horizonFilter, safeLimit],
        ).catch(() => ({ rows: [] }))
      : Promise.resolve({ rows: [] }),
    haveRegime
      ? pool.query(
          `
          SELECT symbol, horizon, regime, sample_size,
                 avg_return, hit_rate, avg_abs_return, regime_multiplier, anomaly_rate
            FROM regime_conditional_impact
           WHERE LOWER(theme) = $1
             AND ($2::text IS NULL OR horizon = $2)
           ORDER BY ABS(COALESCE(regime_multiplier, 0)) DESC NULLS LAST,
                    sample_size DESC
           LIMIT $3
          `,
          [t, horizonFilter, safeLimit * 2],
        ).catch(() => ({ rows: [] }))
      : Promise.resolve({ rows: [] }),
    haveCond
      ? pool.query(
          `
          SELECT symbol, horizon, condition_type, condition_value,
                 avg_return, hit_rate, avg_abs_return, sample_size
            FROM conditional_sensitivity
           WHERE LOWER(theme) = $1
             AND ($2::text IS NULL OR horizon = $2)
           ORDER BY sample_size DESC
           LIMIT $3
          `,
          [t, horizonFilter, safeLimit * 3],
        ).catch(() => ({ rows: [] }))
      : Promise.resolve({ rows: [] }),
    haveAuto
      ? pool.query(
          `
          SELECT symbol, avg_abs_reaction, reaction_count, correlation, method,
                 quality_score, directional_edge, outcome_hit_rate, outcome_avg_return
            FROM auto_theme_symbols
           WHERE LOWER(theme) = $1
           ORDER BY COALESCE(quality_score, 0) DESC NULLS LAST,
                    reaction_count DESC
           LIMIT $2
          `,
          [t, safeLimit],
        ).catch(() => ({ rows: [] }))
      : Promise.resolve({ rows: [] }),
  ]);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    theme: t,
    horizon: horizonFilter,
    sensitivityAvailable: haveSens,
    regimeAvailable: haveRegime,
    conditionalAvailable: haveCond,
    autoMappingAvailable: haveAuto,
    sensitivity: sens.rows.map((r) => ({
      symbol: r.symbol,
      horizon: r.horizon,
      sampleSize: Number(r.sample_size ?? 0),
      avgReturn: r.avg_return == null ? null : Number(r.avg_return),
      hitRate: r.hit_rate == null ? null : Number(r.hit_rate),
      returnVol: r.return_vol == null ? null : Number(r.return_vol),
      sensitivityZScore: r.sensitivity_zscore == null ? null : Number(r.sensitivity_zscore),
      baselineReturn: r.baseline_return == null ? null : Number(r.baseline_return),
      baselineVol: r.baseline_vol == null ? null : Number(r.baseline_vol),
      interpretation: r.interpretation,
    })),
    regime: regime.rows.map((r) => ({
      symbol: r.symbol,
      horizon: r.horizon,
      regime: r.regime,
      sampleSize: Number(r.sample_size ?? 0),
      avgReturn: r.avg_return == null ? null : Number(r.avg_return),
      hitRate: r.hit_rate == null ? null : Number(r.hit_rate),
      regimeMultiplier: r.regime_multiplier == null ? null : Number(r.regime_multiplier),
      anomalyRate: r.anomaly_rate == null ? null : Number(r.anomaly_rate),
    })),
    conditional: conds.rows.map((r) => ({
      symbol: r.symbol,
      horizon: r.horizon,
      conditionType: r.condition_type,
      conditionValue: r.condition_value,
      avgReturn: r.avg_return == null ? null : Number(r.avg_return),
      hitRate: r.hit_rate == null ? null : Number(r.hit_rate),
      sampleSize: Number(r.sample_size ?? 0),
    })),
    autoMapping: auto.rows.map((r) => ({
      symbol: r.symbol,
      avgAbsReaction: r.avg_abs_reaction == null ? null : Number(r.avg_abs_reaction),
      reactionCount: Number(r.reaction_count ?? 0),
      correlation: r.correlation == null ? null : Number(r.correlation),
      method: r.method,
      qualityScore: r.quality_score == null ? null : Number(r.quality_score),
      directionalEdge: r.directional_edge == null ? null : Number(r.directional_edge),
      outcomeHitRate: r.outcome_hit_rate == null ? null : Number(r.outcome_hit_rate),
      outcomeAvgReturn: r.outcome_avg_return == null ? null : Number(r.outcome_avg_return),
    })),
  };
}

export const _internals = {
  HOT_EVENTS_LIMIT,
  HOT_EVENTS_LOOKBACK_DAYS,
  SOURCE_DOMINANCE_WARN_PCT,
  SOURCE_DOMINANCE_CRITICAL_PCT,
  META_MODEL_RECENT_HOURS,
};
