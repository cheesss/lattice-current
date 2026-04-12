/** GET /api/kpi-summary — KPI bar data */
export default async function handler(req, res) {
  try {
    const pg = await import('pg');
    const pool = new pg.default.Pool({
      host: process.env.PG_HOST || '192.168.0.76', port: Number(process.env.PG_PORT || 5433),
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || process.env.PGPASSWORD || process.env.INTEL_PG_PASSWORD || 'lattice1234',
      database: process.env.PG_DATABASE || 'lattice', max: 2, idleTimeoutMillis: 10000,
    });
    const signals = await pool.query(`
      SELECT signal_name, value, ts FROM signal_history
      WHERE signal_name IN ('vix','yieldSpread','oilPrice','dollarIndex')
      AND ts = (SELECT MAX(ts) FROM signal_history WHERE signal_name = signal_history.signal_name)
    `);
    const vixHistory = await pool.query(`
      SELECT value FROM signal_history WHERE signal_name = 'vix' ORDER BY ts DESC LIMIT 30
    `);
    const e2 = await pool.query(`SELECT COUNT(*) as n FROM event_uplift WHERE evidence_grade = 'E2'`);
    const totalSig = await pool.query(`SELECT COUNT(*) as n FROM event_uplift WHERE evidence_grade IN ('E1','E2')`);
    await pool.end();

    const sigMap = {};
    for (const r of signals.rows) sigMap[r.signal_name] = Number(r.value);
    const vix = sigMap.vix ?? null;
    const riskGauge = vix != null ? Math.min(100, Math.max(4, 45 + (vix - 20) * 2)) : null;
    const riskState = vix > 25 ? 'risk-off' : vix < 18 ? 'risk-on' : 'balanced';

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({
      vix, vixHistory: vixHistory.rows.map(r => Number(r.value)).reverse(),
      riskGauge, riskState,
      yieldSpread: sigMap.yieldSpread ?? null,
      oilPrice: sigMap.oilPrice ?? null,
      dollarIndex: sigMap.dollarIndex ?? null,
      e2Count: Number(e2.rows[0]?.n || 0),
      totalSignals: Number(totalSig.rows[0]?.n || 0),
    });
  } catch (err) { return res.status(500).json({ error: String(err?.message || err) }); }
}
