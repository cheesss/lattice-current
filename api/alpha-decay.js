/** GET /api/alpha-decay - Alpha decay by theme and horizon. */
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
      SELECT theme, horizon,
             ROUND(AVG(abnormal_return)::numeric, 3) as avg_alpha,
             COUNT(*) as sample_size
      FROM labeled_outcomes
      WHERE abnormal_return IS NOT NULL
      GROUP BY theme, horizon
      HAVING COUNT(*) >= 50
      ORDER BY theme, horizon
    `);

    const themes = {};
    for (const r of result.rows) {
      if (!themes[r.theme]) themes[r.theme] = [];
      themes[r.theme].push({ horizon: r.horizon, alpha: Number(r.avg_alpha) });
    }
    const curves = Object.entries(themes).map(([theme, points]) => ({ theme, points }));

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200');
    return res.status(200).json(curves);
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  } finally {
    if (pool) await pool.end();
  }
}
