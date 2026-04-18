#!/usr/bin/env node
/**
 * Bootstrap market_quotes history so nowcast trainers + inference have the
 * 180-day daily feature window they expect on day 0.
 *
 * Fill strategy per symbol:
 *   1. FUSE from worldmonitor_intel.historical_raw_items — the project's
 *      pre-existing Yahoo 5-year warm store. Matches dataset_id
 *      'yahoo-{SYM}' and 'yahoo-{SYM}-5y'.
 *   2. PATCH the remainder via Yahoo chart API (range=1y, interval=1d).
 *   3. Idempotent — re-runs skip rows already present (symbol, observed_at).
 *
 * Symbol list comes from scripts/_shared/market-quote-symbols.json so this
 * stays aligned with refresh + trainers.
 *
 * Usage:
 *   node scripts/bootstrap-market-quotes-history.mjs
 *   node scripts/bootstrap-market-quotes-history.mjs --dry-run
 *   node scripts/bootstrap-market-quotes-history.mjs --symbols HYG,LQD
 *   node scripts/bootstrap-market-quotes-history.mjs --range 5y
 */

import process from 'node:process';
import pg from 'pg';
import { sleep } from './_seed-utils.mjs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { getAllRequiredSymbols } from './_shared/market-quote-symbols.mjs';
import { fetchYahooChart, parseDailyBars } from './_shared/yahoo-chart.mjs';

const { Pool } = pg;

const YAHOO_DELAY_MS = 1200;
const DEFAULT_RANGE = '1y';
const DEFAULT_INTERVAL = '1d';

function parseArgs(argv) {
  const args = { dryRun: false, symbols: null, range: DEFAULT_RANGE };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--dry-run') args.dryRun = true;
    else if (t === '--symbols') args.symbols = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (t === '--range') args.range = String(argv[++i] || DEFAULT_RANGE);
  }
  return args;
}

async function fuseFromWarmStore(pool, symbol) {
  const datasetIds = [`yahoo-${symbol}`, `yahoo-${symbol}-5y`];
  const { rows } = await pool.query(`
    SELECT valid_time_start AS observed_at, price
    FROM worldmonitor_intel.historical_raw_items
    WHERE dataset_id = ANY($1::text[])
      AND symbol = $2
      AND price IS NOT NULL
    ORDER BY valid_time_start
  `, [datasetIds, symbol]);
  return rows.map((r) => ({
    symbol,
    observedAt: r.observed_at instanceof Date ? r.observed_at.toISOString() : r.observed_at,
    price: Number(r.price),
  }));
}

async function fetchYahooDaily(symbol, range = DEFAULT_RANGE, interval = DEFAULT_INTERVAL) {
  const payload = await fetchYahooChart(symbol, { range, interval, timeoutMs: 20_000 });
  return parseDailyBars(payload, symbol);
}

async function writeHistoricalBars(pool, rows, provider) {
  if (!rows.length) return 0;
  const symbols = rows.map((r) => r.symbol);
  const observeds = rows.map((r) => r.observedAt);
  const prices = rows.map((r) => r.price);
  const result = await pool.query(`
    INSERT INTO market_quotes (symbol, provider, observed_at, fetched_at, last_price)
    SELECT v.sym, $4, v.obs,
           NOW() + (v.rn * INTERVAL '1 microsecond'),
           v.price
    FROM (
      SELECT sym, obs, price, ROW_NUMBER() OVER () AS rn
      FROM UNNEST($1::text[], $2::timestamptz[], $3::double precision[])
           AS t(sym, obs, price)
    ) v
    WHERE NOT EXISTS (
      SELECT 1 FROM market_quotes q
      WHERE q.symbol = v.sym AND q.observed_at = v.obs
    )
  `, [symbols, observeds, prices, provider]);
  return result.rowCount || 0;
}

async function coverageFor(pool, symbol, windowDays = 180) {
  const { rows } = await pool.query(`
    SELECT COUNT(DISTINCT DATE(observed_at)) AS days
    FROM market_quotes
    WHERE symbol = $1
      AND observed_at >= NOW() - ($2 || ' days')::interval
  `, [symbol, String(windowDays)]);
  return Number(rows[0]?.days || 0);
}

async function ensureMarketQuotesSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market_quotes (
      symbol text NOT NULL,
      provider text NOT NULL DEFAULT 'unknown',
      observed_at timestamptz,
      fetched_at timestamptz NOT NULL DEFAULT NOW(),
      last_price double precision NOT NULL,
      change_pct double precision,
      currency text,
      exchange text,
      raw jsonb,
      PRIMARY KEY (symbol, fetched_at)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_market_quotes_symbol_observed_at
      ON market_quotes (symbol, observed_at DESC)
  `);
}

async function bootstrapSymbol(pool, symbol, { dryRun, range }) {
  const report = { symbol, warmStoreRows: 0, warmInserted: 0, yahooRows: 0, yahooInserted: 0, coverage180d: 0, error: null };
  try {
    const warmRows = await fuseFromWarmStore(pool, symbol);
    report.warmStoreRows = warmRows.length;
    if (warmRows.length && !dryRun) {
      report.warmInserted = await writeHistoricalBars(pool, warmRows, 'yahoo-chart-warm');
    }

    try {
      const yahooRows = await fetchYahooDaily(symbol, range);
      report.yahooRows = yahooRows.length;
      if (yahooRows.length && !dryRun) {
        report.yahooInserted = await writeHistoricalBars(pool, yahooRows, 'yahoo-chart-historical');
      }
    } catch (err) {
      report.error = `yahoo fetch failed: ${err.message}`;
    }

    report.coverage180d = await coverageFor(pool, symbol, 180);
  } catch (err) {
    report.error = (report.error ? `${report.error}; ` : '') + `fatal: ${err.message}`;
  }
  return report;
}

async function main() {
  loadOptionalEnvFile();
  const args = parseArgs(process.argv.slice(2));
  const symbols = args.symbols && args.symbols.length ? args.symbols : getAllRequiredSymbols();

  console.log(`bootstrap ${symbols.length} symbols (dryRun=${args.dryRun}, range=${args.range})`);
  const pool = new Pool({ ...resolveNasPgConfig(), max: 4 });
  const reports = [];
  try {
    if (!args.dryRun) await ensureMarketQuotesSchema(pool);
    for (const sym of symbols) {
      const r = await bootstrapSymbol(pool, sym, args);
      reports.push(r);
      console.log(
        `[${r.symbol.padEnd(10)}] warm=${r.warmStoreRows} (+${r.warmInserted} new)  ` +
        `yahoo=${r.yahooRows} (+${r.yahooInserted} new)  ` +
        `cov180d=${r.coverage180d}${r.error ? '  ERR=' + r.error : ''}`,
      );
      await sleep(YAHOO_DELAY_MS);
    }
    const ok = reports.filter((r) => r.coverage180d >= 120).length;
    const total = reports.length;
    console.log(`\nFinal: ${ok}/${total} symbols ≥120 trading days of coverage in last 180d`);
    if (ok < total) {
      const under = reports.filter((r) => r.coverage180d < 120);
      console.log('Under-covered:');
      for (const r of under) console.log(`  ${r.symbol}: cov=${r.coverage180d}${r.error ? '  err=' + r.error : ''}`);
    }
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(String(err?.stack || err?.message || err));
  process.exit(1);
});
