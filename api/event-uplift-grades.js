/**
 * GET /api/event-uplift-grades
 * Returns evidence grades from event_uplift table for UI display.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const pg = await import('pg');
    const pool = new pg.default.Pool({
      host: process.env.PG_HOST || '192.168.0.76',
      port: Number(process.env.PG_PORT || 5433),
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || process.env.PGPASSWORD || process.env.INTEL_PG_PASSWORD || 'lattice1234',
      database: process.env.PG_DATABASE || 'lattice',
      max: 2,
      idleTimeoutMillis: 10000,
    });

    const result = await pool.query(`
      SELECT ce.theme, eu.symbol, eu.horizon, eu.evidence_grade,
             eu.uplift, eu.t_stat, eu.n_controls
      FROM event_uplift eu
      JOIN canonical_events ce ON ce.id = eu.canonical_event_id
      WHERE eu.evidence_grade IN ('E1', 'E2', 'E3', 'E4')
      ORDER BY eu.t_stat DESC
      LIMIT 500
    `);

    await pool.end();

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
