/** GET /api/hawkes-heatmap - Hawkes intensity heatmap data. */
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
    const result = await pool.query(`
      SELECT theme, event_date::text, hawkes_intensity
      FROM event_hawkes_intensity
      WHERE event_date >= NOW() - INTERVAL '6 months'
      ORDER BY theme, event_date
    `);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  } finally {
    if (pool) await pool.end();
  }
}
