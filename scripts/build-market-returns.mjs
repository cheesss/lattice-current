#!/usr/bin/env node
/**
 * Build market_returns and abnormal_return using the project-standard Node pg
 * runtime. This replaces the Python-only path for daemon use so Windows hosts
 * without psycopg2 still keep the signal pipeline current.
 */

import process from 'node:process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

const { Pool } = pg;
const DRY_RUN = process.argv.includes('--dry-run');

const SECTOR_ETF_MAP = {
  XLK: ['AAPL', 'MSFT', 'NVDA', 'AVGO', 'ORCL', 'CRM', 'AMD', 'ADBE', 'CSCO', 'ACN', 'IBM', 'INTC', 'QCOM', 'TXN', 'AMAT'],
  SMH: ['NVDA', 'AMD', 'INTC', 'QCOM', 'TXN', 'AMAT', 'LRCX', 'MU', 'MRVL', 'KLAC', 'TSM', 'ASML'],
  XLE: ['XOM', 'CVX', 'COP', 'SLB', 'EOG', 'MPC', 'PSX', 'VLO', 'OXY', 'HES', 'HAL', 'DVN', 'FANG'],
  XLF: ['JPM', 'BAC', 'WFC', 'GS', 'MS', 'BLK', 'C', 'SCHW', 'AXP', 'USB', 'PNC', 'TFC'],
  XLV: ['UNH', 'JNJ', 'LLY', 'PFE', 'ABBV', 'MRK', 'TMO', 'ABT', 'DHR', 'BMY', 'AMGN', 'GILD'],
  XLY: ['AMZN', 'TSLA', 'HD', 'MCD', 'NKE', 'LOW', 'SBUX', 'TJX', 'BKNG', 'CMG'],
  XLP: ['PG', 'KO', 'PEP', 'COST', 'WMT', 'PM', 'MDLZ', 'MO', 'CL', 'GIS'],
  XLI: ['GE', 'CAT', 'HON', 'UNP', 'BA', 'RTX', 'DE', 'LMT', 'MMM', 'UPS', 'FDX'],
  XLU: ['NEE', 'SO', 'DUK', 'D', 'SRE', 'AEP', 'EXC', 'ED', 'WEC', 'ES'],
  XLRE: ['PLD', 'AMT', 'CCI', 'EQIX', 'SPG', 'O', 'PSA', 'DLR', 'WELL', 'AVB'],
  XLC: ['META', 'GOOGL', 'GOOG', 'NFLX', 'DIS', 'CMCSA', 'CHTR', 'TMUS', 'VZ', 'T'],
  XLB: ['LIN', 'APD', 'SHW', 'FCX', 'ECL', 'NEM', 'NUE', 'VMC', 'MLM', 'DOW'],
  GLD: ['GLD', 'IAU'],
  DBC: ['DBC', 'USO', 'UNG'],
};

function buildSymbolToSector() {
  const out = {};
  for (const [etf, symbols] of Object.entries(SECTOR_ETF_MAP)) {
    for (const symbol of symbols) out[symbol] = etf;
  }
  return out;
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export async function buildMarketReturns(options = {}) {
  loadOptionalEnvFile(options.envFile || '.env.local');
  const pool = new Pool({ ...resolveNasPgConfig(), max: 4 });
  const dryRun = Boolean(options.dryRun ?? DRY_RUN);
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS market_returns (
        trade_date DATE NOT NULL,
        symbol TEXT NOT NULL DEFAULT 'SPY',
        horizon TEXT NOT NULL,
        forward_return_pct DOUBLE PRECISION,
        PRIMARY KEY (trade_date, symbol, horizon)
      )
    `);
    if (dryRun) return { ok: true, dryRun: true };

    const spy = await pool.query(`
      INSERT INTO market_returns (trade_date, symbol, horizon, forward_return_pct)
      SELECT DISTINCT ON (DATE(a.published_at), lo.horizon)
          DATE(a.published_at), 'SPY', lo.horizon, lo.forward_return_pct
      FROM labeled_outcomes lo
      JOIN articles a ON a.id = lo.article_id
      WHERE lo.symbol = 'SPY' AND lo.forward_return_pct IS NOT NULL
      ORDER BY DATE(a.published_at), lo.horizon, a.published_at DESC
      ON CONFLICT (trade_date, symbol, horizon) DO UPDATE
        SET forward_return_pct = EXCLUDED.forward_return_pct
    `);

    const sectorEtfs = Object.keys(SECTOR_ETF_MAP);
    const sectors = await pool.query(`
      INSERT INTO market_returns (trade_date, symbol, horizon, forward_return_pct)
      SELECT DISTINCT ON (DATE(a.published_at), lo.symbol, lo.horizon)
          DATE(a.published_at), lo.symbol, lo.horizon, lo.forward_return_pct
      FROM labeled_outcomes lo
      JOIN articles a ON a.id = lo.article_id
      WHERE lo.symbol = ANY($1::text[]) AND lo.forward_return_pct IS NOT NULL
      ORDER BY DATE(a.published_at), lo.symbol, lo.horizon, a.published_at DESC
      ON CONFLICT (trade_date, symbol, horizon) DO UPDATE
        SET forward_return_pct = EXCLUDED.forward_return_pct
    `, [sectorEtfs]);

    const abnormal = await pool.query(`
      UPDATE labeled_outcomes lo
         SET market_return = mr.forward_return_pct,
             abnormal_return = lo.forward_return_pct - mr.forward_return_pct
        FROM articles a
        JOIN market_returns mr ON mr.trade_date = DATE(a.published_at)
         AND mr.symbol = 'SPY'
       WHERE a.id = lo.article_id
         AND mr.horizon = lo.horizon
         AND lo.symbol != 'SPY'
         AND lo.forward_return_pct IS NOT NULL
         AND lo.abnormal_return IS NULL
    `);

    const symbolToSector = buildSymbolToSector();
    const sectorCase = `CASE lo.symbol ${
      Object.entries(symbolToSector)
        .map(([symbol, etf]) => `WHEN ${sqlString(symbol)} THEN ${sqlString(etf)}`)
        .join(' ')
    } ELSE NULL END`;
    const sectorUpdate = await pool.query(`
      UPDATE labeled_outcomes lo
         SET sector_return = mr.forward_return_pct
        FROM articles a
        JOIN market_returns mr ON mr.trade_date = DATE(a.published_at)
       WHERE a.id = lo.article_id
         AND mr.symbol = (${sectorCase})
         AND mr.horizon = lo.horizon
         AND lo.sector_return IS NULL
         AND lo.forward_return_pct IS NOT NULL
    `);

    const { rows } = await pool.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(abnormal_return)::int AS with_abnormal_return
        FROM labeled_outcomes
       WHERE forward_return_pct IS NOT NULL
    `);
    return {
      ok: true,
      dryRun: false,
      spyRows: spy.rowCount || 0,
      sectorRows: sectors.rowCount || 0,
      abnormalUpdated: abnormal.rowCount || 0,
      sectorUpdated: sectorUpdate.rowCount || 0,
      coverage: rows[0],
    };
  } finally {
    await pool.end().catch(() => {});
  }
}

async function main() {
  const result = await buildMarketReturns({ dryRun: DRY_RUN });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
    process.exitCode = 1;
  });
}
