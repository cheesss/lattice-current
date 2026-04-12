/** GET /api/regime-timeline — VIX-based regime transition segments */
export default async function handler(req, res) {
  try {
    const pg = await import('pg');
    const pool = new pg.default.Pool({
      host: process.env.PG_HOST || '192.168.0.76', port: Number(process.env.PG_PORT || 5433),
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || process.env.PGPASSWORD || process.env.INTEL_PG_PASSWORD || 'lattice1234',
      database: process.env.PG_DATABASE || 'lattice', max: 2, idleTimeoutMillis: 10000,
    });
    const result = await pool.query(`
      WITH daily_regime AS (
        SELECT DATE(ts) as d, value,
          CASE WHEN value > 25 THEN 'risk-off'
               WHEN value < 18 THEN 'risk-on'
               ELSE 'balanced' END as regime
        FROM signal_history WHERE signal_name = 'vix'
        ORDER BY d
      ),
      regime_groups AS (
        SELECT d, regime,
          d - (ROW_NUMBER() OVER (PARTITION BY regime ORDER BY d) * INTERVAL '1 day') as grp
        FROM daily_regime
      )
      SELECT regime, MIN(d)::text as start, MAX(d)::text as end
      FROM regime_groups
      GROUP BY regime, grp
      HAVING COUNT(*) >= 2
      ORDER BY MIN(d)
    `);
    await pool.end();
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json(result.rows);
  } catch (err) { return res.status(500).json({ error: String(err?.message || err) }); }
}
