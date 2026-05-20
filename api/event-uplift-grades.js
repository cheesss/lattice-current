/**
 * GET /api/event-uplift-grades
 * Returns quality-gated evidence grades for UI display.
 *
 * event_uplift.evidence_grade is a raw calculation label. User-facing routes
 * must only expose E2/E3/E4 as promoted signals after the control/relevance gate.
 */
const MIN_PROMOTION_CONTROLS = 8;
const EVIDENCE_GRADE_WINDOW_DAYS = 365;

function requirePgPassword() {
  const password = process.env.PG_PASSWORD || process.env.PGPASSWORD || process.env.INTEL_PG_PASSWORD;
  if (!password) {
    throw new Error('Missing PostgreSQL password. Set PG_PASSWORD, PGPASSWORD, or INTEL_PG_PASSWORD.');
  }
  return password;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let pool;
  try {
    const pg = await import('pg');
    pool = new pg.default.Pool({
      host: process.env.PG_HOST || '192.168.0.2',
      port: Number(process.env.PG_PORT || 5433),
      user: process.env.PG_USER || 'postgres',
      password: requirePgPassword(),
      database: process.env.PG_DATABASE || 'lattice',
      max: 2,
      idleTimeoutMillis: 10000,
    });

    const summaryResult = await pool.query(`
      WITH uplift_candidates AS (
        SELECT eu.*
          FROM event_uplift eu
          JOIN canonical_events ce ON ce.id = eu.canonical_event_id
         WHERE eu.evidence_grade IS NOT NULL
           AND ce.event_date >= CURRENT_DATE - INTERVAL '${EVIDENCE_GRADE_WINDOW_DAYS} days'
      ),
      candidate_event_ids AS (
        SELECT DISTINCT canonical_event_id AS id
          FROM uplift_candidates
      ),
      article_quality AS (
        SELECT aem.canonical_event_id,
               COUNT(*) FILTER (WHERE a.market_relevance IS NOT NULL)::int AS known_market_relevance_articles,
               COUNT(*) FILTER (WHERE a.market_relevance IN ('high', 'medium'))::int AS market_relevant_articles,
               COUNT(*) FILTER (WHERE a.market_relevance = 'low')::int AS low_relevance_articles
          FROM article_event_map aem
          JOIN candidate_event_ids cei ON cei.id = aem.canonical_event_id
          JOIN articles a ON a.id = aem.article_id
         GROUP BY aem.canonical_event_id
      ),
      gated AS (
        SELECT eu.evidence_grade AS raw_evidence_grade,
               CASE
                 WHEN eu.evidence_grade IN ('E2','E3','E4')
                  AND (
                    ABS(COALESCE(eu.t_stat, 0)) < 2
                    OR COALESCE(eu.n_controls, 0) < ${MIN_PROMOTION_CONTROLS}
                    OR (
                      COALESCE(aq.known_market_relevance_articles, 0) > 0
                      AND COALESCE(aq.market_relevant_articles, 0) = 0
                      AND COALESCE(aq.low_relevance_articles, 0) > 0
                    )
                  ) THEN NULL
                 ELSE eu.evidence_grade
               END AS evidence_grade,
               eu.uplift
         FROM uplift_candidates eu
         LEFT JOIN article_quality aq ON aq.canonical_event_id = eu.canonical_event_id
      )
      SELECT evidence_grade,
             COUNT(*)::int AS count,
             AVG(COALESCE(uplift, 0)) AS avg_uplift,
             COUNT(*) FILTER (WHERE raw_evidence_grade IS NOT NULL AND evidence_grade IS NULL)::int AS quarantined
        FROM gated
       GROUP BY evidence_grade
       ORDER BY evidence_grade DESC NULLS LAST
    `);

    const signalsResult = await pool.query(`
      WITH candidate_events AS (
        SELECT ce.id AS canonical_event_id,
               ce.theme,
               ce.representative_title AS title,
               ce.event_date,
               eu.symbol,
               eu.horizon,
               eu.evidence_grade,
               eu.uplift,
               eu.t_stat,
               eu.n_controls
          FROM event_uplift eu
          JOIN canonical_events ce ON ce.id = eu.canonical_event_id
         WHERE eu.evidence_grade = 'E2'
           AND ce.event_date >= CURRENT_DATE - INTERVAL '30 days'
           AND ABS(COALESCE(eu.t_stat, 0)) >= 2
           AND COALESCE(eu.n_controls, 0) >= ${MIN_PROMOTION_CONTROLS}
      ),
      article_quality AS (
        SELECT aem.canonical_event_id,
               COUNT(*) FILTER (WHERE a.market_relevance IS NOT NULL)::int AS known_market_relevance_articles,
               COUNT(*) FILTER (WHERE a.market_relevance IN ('high', 'medium'))::int AS market_relevant_articles,
               COUNT(*) FILTER (WHERE a.market_relevance = 'low')::int AS low_relevance_articles
          FROM article_event_map aem
          JOIN candidate_events ce ON ce.canonical_event_id = aem.canonical_event_id
          JOIN articles a ON a.id = aem.article_id
         GROUP BY aem.canonical_event_id
      )
      SELECT ce.*
        FROM candidate_events ce
        LEFT JOIN article_quality aq ON aq.canonical_event_id = ce.canonical_event_id
       WHERE NOT (
         COALESCE(aq.known_market_relevance_articles, 0) > 0
         AND COALESCE(aq.market_relevant_articles, 0) = 0
         AND COALESCE(aq.low_relevance_articles, 0) > 0
       )
       ORDER BY ABS(COALESCE(ce.uplift, 0)) * 0.6 + ABS(COALESCE(ce.t_stat, 0)) * 0.4 DESC
       LIMIT 500
    `);

    const summaryRows = summaryResult.rows || [];
    const grades = summaryRows
      .filter((row) => row.evidence_grade)
      .map((row) => ({
        grade: row.evidence_grade,
        count: Number(row.count || 0),
        totalUplift: Number(row.avg_uplift || 0) * Number(row.count || 0),
        avgUplift: Number(Number(row.avg_uplift || 0).toFixed(4)),
      }))
      .sort((a, b) => String(b.grade).localeCompare(String(a.grade)));
    const signals = signalsResult.rows.map((row) => ({
        canonical_event_id: row.canonical_event_id,
        theme: row.theme,
        title: row.title,
        symbol: row.symbol,
        horizon: row.horizon,
        evidence_grade: row.evidence_grade,
        raw_evidence_grade: row.raw_evidence_grade,
        uplift: row.uplift,
        t_stat: row.t_stat,
        n_controls: row.n_controls,
      }));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({
      grades,
      signals,
      meta: {
        minPromotionControls: MIN_PROMOTION_CONTROLS,
        windowDays: EVIDENCE_GRADE_WINDOW_DAYS,
        rawRows: summaryRows.reduce((sum, row) => sum + Number(row.count || 0), 0),
        promotedRows: grades.reduce((sum, row) => sum + Number(row.count || 0), 0),
        quarantinedRows: summaryRows.reduce((sum, row) => sum + Number(row.quarantined || 0), 0),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  } finally {
    if (pool) await pool.end();
  }
}
