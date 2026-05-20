/**
 * Coverage audit for market_quotes feature symbols. Blocks nowcast
 * training/inference from proceeding when the required Yahoo history is
 * missing (pre-bootstrap) or partially populated.
 *
 * Pure logic (evaluateCoverage) is unit-testable. checkCoverage is the
 * DB wrapper used by trainers + compute-*.mjs + daemon pre-check.
 */

const DEFAULT_WINDOW_DAYS = 180;
const DEFAULT_MIN_TRADING_DAYS = 120;

/**
 * @param {Record<string, number>} rowCountBySymbol — distinct trading-day count per symbol in window
 * @param {string[]} requiredSymbols
 * @param {{ windowDays?: number, minTradingDays?: number }} opts
 * @returns {{ ok: boolean, windowDays: number, minTradingDays: number, missing: Array<{symbol: string, days: number, gap: number}> }}
 */
export function evaluateCoverage(rowCountBySymbol, requiredSymbols, opts = {}) {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const minTradingDays = opts.minTradingDays ?? DEFAULT_MIN_TRADING_DAYS;
  const missing = [];
  for (const sym of requiredSymbols) {
    const days = Number(rowCountBySymbol[sym] || 0);
    if (days < minTradingDays) missing.push({ symbol: sym, days, gap: minTradingDays - days });
  }
  return {
    ok: missing.length === 0,
    windowDays,
    minTradingDays,
    missing,
  };
}

/**
 * DB wrapper. Accepts a pg Client/Pool. Returns the same shape as
 * evaluateCoverage plus the raw counts so callers can log them.
 */
export async function checkCoverage(client, requiredSymbols, opts = {}) {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const { rows } = await client.query(`
    SELECT symbol, COUNT(DISTINCT DATE(observed_at)) AS days
    FROM market_quotes
    WHERE symbol = ANY($1::text[])
      AND observed_at >= NOW() - ($2 || ' days')::interval
    GROUP BY symbol
  `, [requiredSymbols, String(windowDays)]);
  const rowCountBySymbol = Object.create(null);
  for (const r of rows) rowCountBySymbol[r.symbol] = Number(r.days);
  const evaluated = evaluateCoverage(rowCountBySymbol, requiredSymbols, opts);
  return { ...evaluated, rowCountBySymbol };
}

export const COVERAGE_HINT_MESSAGE =
  'Run: node scripts/bootstrap-market-quotes-history.mjs — fuses worldmonitor_intel warm store + Yahoo 1y fetch. Re-check with checkCoverage after.';
