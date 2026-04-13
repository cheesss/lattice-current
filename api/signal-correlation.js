/** GET /api/signal-correlation — 90-day rolling signal correlation matrix */
export default async function handler(req, res) {
  try {
    const pg = await import('pg');
    const pool = new pg.default.Pool({
      host: process.env.PG_HOST || '192.168.0.2', port: Number(process.env.PG_PORT || 5433),
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || process.env.PGPASSWORD || process.env.INTEL_PG_PASSWORD || 'lattice1234',
      database: process.env.PG_DATABASE || 'lattice', max: 2, idleTimeoutMillis: 10000,
    });
    const signals = ['vix', 'yieldSpread', 'oilPrice', 'dollarIndex', 'hy_credit_spread', 'marketStress'];
    const result = await pool.query(`
      SELECT a.signal_name as signal_a, b.signal_name as signal_b,
             CORR(a.value, b.value) as correlation
      FROM signal_history a
      JOIN signal_history b ON DATE(a.ts) = DATE(b.ts)
      WHERE a.signal_name = ANY($1) AND b.signal_name = ANY($1)
        AND a.ts >= NOW() - INTERVAL '90 days'
        AND a.signal_name <= b.signal_name
      GROUP BY a.signal_name, b.signal_name
    `, [signals]);
    await pool.end();

    // Mirror the matrix
    const full = [];
    for (const r of result.rows) {
      full.push(r);
      if (r.signal_a !== r.signal_b) {
        full.push({ signal_a: r.signal_b, signal_b: r.signal_a, correlation: r.correlation });
      }
    }
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200');
    return res.status(200).json(full);
  } catch (err) { return res.status(500).json({ error: String(err?.message || err) }); }
}
