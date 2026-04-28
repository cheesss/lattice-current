/** GET /api/kpi-summary - KPI bar data. */
const MIN_PROMOTION_CONTROLS = 8;

function requirePgPassword() {
  const password = process.env.PG_PASSWORD || process.env.PGPASSWORD || process.env.INTEL_PG_PASSWORD;
  if (!password) {
    throw new Error('Missing PostgreSQL password. Set PG_PASSWORD, PGPASSWORD, or INTEL_PG_PASSWORD.');
  }
  return password;
}

export default async function handler(req, res) {
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

    const signals = await pool.query(`
      SELECT sh.signal_name, sh.value, sh.ts
      FROM signal_history sh
      WHERE sh.signal_name IN ('vix','yieldSpread','oilPrice','dollarIndex')
        AND sh.ts = (
          SELECT MAX(sh2.ts)
          FROM signal_history sh2
          WHERE sh2.signal_name = sh.signal_name
        )
    `);
    const vixHistory = await pool.query(`
      SELECT value FROM signal_history WHERE signal_name = 'vix' ORDER BY ts DESC LIMIT 30
    `);
    const evidenceCounts = await pool.query(`
      WITH article_quality AS (
        SELECT aem.canonical_event_id,
               COUNT(*) FILTER (WHERE a.market_relevance IS NOT NULL)::int AS known_market_relevance_articles,
               COUNT(*) FILTER (WHERE a.market_relevance IN ('high', 'medium'))::int AS market_relevant_articles,
               COUNT(*) FILTER (WHERE a.market_relevance = 'low')::int AS low_relevance_articles
          FROM article_event_map aem
          JOIN articles a ON a.id = aem.article_id
         GROUP BY aem.canonical_event_id
      ),
      gated AS (
        SELECT CASE
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
               END AS promoted_grade
          FROM event_uplift eu
          LEFT JOIN article_quality aq ON aq.canonical_event_id = eu.canonical_event_id
      )
      SELECT
        COUNT(*) FILTER (WHERE promoted_grade = 'E2')::int AS e2_count,
        COUNT(*) FILTER (WHERE promoted_grade IN ('E1','E2'))::int AS total_signals
      FROM gated
    `);
    const sigMap = {};
    for (const r of signals.rows) sigMap[r.signal_name] = Number(r.value);
    const vix = sigMap.vix ?? null;
    const riskGauge = vix != null ? Math.min(100, Math.max(4, 45 + (vix - 20) * 2)) : null;
    const riskState = vix > 25 ? 'risk-off' : vix < 18 ? 'risk-on' : 'balanced';

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({
      vix,
      vixHistory: vixHistory.rows.map((r) => Number(r.value)).reverse(),
      riskGauge,
      riskState,
      yieldSpread: sigMap.yieldSpread ?? null,
      oilPrice: sigMap.oilPrice ?? null,
      dollarIndex: sigMap.dollarIndex ?? null,
      e2Count: Number(evidenceCounts.rows[0]?.e2_count || 0),
      totalSignals: Number(evidenceCounts.rows[0]?.total_signals || 0),
      evidenceGate: { minControlsRequired: MIN_PROMOTION_CONTROLS },
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  } finally {
    if (pool) await pool.end();
  }
}
