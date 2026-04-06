#!/usr/bin/env node
/**
 * backfill-new-sources.mjs — 신규 데이터 소스 5년치 히스토리컬 백필
 *
 * FRED 신규 시리즈 + signal_history 테이블에 일괄 적재.
 * COT/Put-Call/BDI/GPR/EPU는 별도 스크립트로 수집하되,
 * signal_history에 통합 적재하는 역할도 수행.
 *
 * Usage:
 *   node --import tsx scripts/backfill-new-sources.mjs
 *   node --import tsx scripts/backfill-new-sources.mjs --from 2021-01-01
 *   node --import tsx scripts/backfill-new-sources.mjs --source fred
 *   node --import tsx scripts/backfill-new-sources.mjs --source signal-history
 */

import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();
const { Client } = pg;
const PG_CONFIG = resolveNasPgConfig();

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { from: '2021-01-01', source: 'all' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from') result.from = args[++i];
    if (args[i] === '--source') result.source = args[++i];
  }
  return result;
}

// ---------------------------------------------------------------------------
// FRED backfill — fetch historical data directly from FRED API
// ---------------------------------------------------------------------------

const FRED_API_KEY = process.env.FRED_API_KEY || '';

const FRED_NEW_SERIES = [
  // Market volatility
  { id: 'VIXCLS', signal: 'vix' },
  // Rates & spreads
  { id: 'T10Y2Y', signal: 'yieldSpread' },
  { id: 'DGS10', signal: 'treasury10y' },
  { id: 'FEDFUNDS', signal: 'fedFundsRate' },
  { id: 'TEDRATE', signal: 'tedSpread' },
  // Credit stress
  { id: 'BAMLH0A0HYM2', signal: 'hy_credit_spread' },
  { id: 'BAMLC0A0CM', signal: 'ig_credit_spread' },
  // Macro
  { id: 'DTWEXBGS', signal: 'dollarIndex' },
  { id: 'DCOILWTICO', signal: 'oilPrice' },
  { id: 'NAPM', signal: 'pmiManufacturing' },
  { id: 'UNRATE', signal: 'unemployment' },
  { id: 'CPIAUCSL', signal: 'cpiIndex' },
];

async function backfillFRED(client, fromDate) {
  if (!FRED_API_KEY) {
    console.warn('[FRED] No FRED_API_KEY set. Skipping FRED backfill.');
    return;
  }

  console.log(`[FRED] Backfilling from ${fromDate}...`);

  for (const series of FRED_NEW_SERIES) {
    console.log(`[FRED] Fetching ${series.id} → signal:${series.signal}`);
    try {
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series.id}`
        + `&observation_start=${fromDate}&api_key=${FRED_API_KEY}&file_type=json`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!resp.ok) {
        console.warn(`[FRED] ${series.id}: HTTP ${resp.status}`);
        continue;
      }

      const data = await resp.json();
      const observations = data.observations || [];
      let inserted = 0;

      for (const obs of observations) {
        const value = parseFloat(obs.value);
        if (isNaN(value) || obs.value === '.') continue;

        await client.query(`
          INSERT INTO signal_history (signal_name, ts, value)
          VALUES ($1, $2::date, $3)
          ON CONFLICT (signal_name, ts) DO UPDATE SET value = EXCLUDED.value
        `, [series.signal, obs.date, value]);
        inserted++;
      }

      console.log(`[FRED] ${series.id}: ${inserted}/${observations.length} observations loaded`);

      // Rate limit: FRED allows ~120 requests/min
      await new Promise(r => setTimeout(r, 600));
    } catch (err) {
      console.error(`[FRED] ${series.id}: ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Populate signal_history from existing positioning/macro tables
// ---------------------------------------------------------------------------

async function populateSignalHistoryFromTables(client, fromDate) {
  console.log(`[signal-history] Populating from existing tables since ${fromDate}...`);

  const transfers = [
    {
      name: 'cot_sp500',
      query: `SELECT report_date AS date, net_pct AS value FROM positioning_cot
              WHERE asset = 'sp500' AND report_date >= $1 ORDER BY report_date`,
    },
    {
      name: 'cot_gold',
      query: `SELECT report_date AS date, net_pct AS value FROM positioning_cot
              WHERE asset = 'gold' AND report_date >= $1 ORDER BY report_date`,
    },
    {
      name: 'cot_oil',
      query: `SELECT report_date AS date, net_pct AS value FROM positioning_cot
              WHERE asset = 'oil' AND report_date >= $1 ORDER BY report_date`,
    },
    {
      name: 'cot_treasury_10y',
      query: `SELECT report_date AS date, net_pct AS value FROM positioning_cot
              WHERE asset = 'treasury_10y' AND report_date >= $1 ORDER BY report_date`,
    },
    {
      name: 'cot_dollar',
      query: `SELECT report_date AS date, net_pct AS value FROM positioning_cot
              WHERE asset = 'dollar' AND report_date >= $1 ORDER BY report_date`,
    },
    {
      name: 'cot_euro_fx',
      query: `SELECT report_date AS date, net_pct AS value FROM positioning_cot
              WHERE asset = 'euro_fx' AND report_date >= $1 ORDER BY report_date`,
    },
    {
      name: 'putcall_total',
      query: `SELECT date, total_ratio AS value FROM positioning_putcall
              WHERE date >= $1 AND total_ratio IS NOT NULL ORDER BY date`,
    },
    {
      name: 'bdi',
      query: `SELECT date, value FROM macro_bdi
              WHERE date >= $1 ORDER BY date`,
    },
    {
      name: 'gpr',
      query: `SELECT date, gpr_index AS value FROM macro_gpr
              WHERE date >= $1 AND gpr_index IS NOT NULL ORDER BY date`,
    },
    {
      name: 'epu',
      query: `SELECT date, epu_index AS value FROM macro_epu
              WHERE date >= $1 AND epu_index IS NOT NULL ORDER BY date`,
    },
  ];

  for (const t of transfers) {
    try {
      const { rows } = await client.query(t.query, [fromDate]);
      let inserted = 0;
      for (const row of rows) {
        const value = parseFloat(row.value);
        if (isNaN(value)) continue;
        await client.query(`
          INSERT INTO signal_history (signal_name, ts, value)
          VALUES ($1, $2::date, $3)
          ON CONFLICT (signal_name, ts) DO UPDATE SET value = EXCLUDED.value
        `, [t.name, row.date, value]);
        inserted++;
      }
      console.log(`[signal-history] ${t.name}: ${inserted} rows`);
    } catch (err) {
      // Table might not exist yet
      if (err.code === '42P01') {
        console.warn(`[signal-history] ${t.name}: source table not found (run collection scripts first)`);
      } else {
        console.error(`[signal-history] ${t.name}: ${err.message}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();
  const client = new Client(PG_CONFIG);

  try {
    await client.connect();
    console.log('[backfill] Connected to NAS PostgreSQL');

    // Ensure signal_history table
    await client.query(`
      CREATE TABLE IF NOT EXISTS signal_history (
        signal_name TEXT NOT NULL,
        ts TIMESTAMPTZ NOT NULL,
        value DOUBLE PRECISION NOT NULL,
        PRIMARY KEY (signal_name, ts)
      );
      CREATE INDEX IF NOT EXISTS idx_signal_history_name_ts
        ON signal_history (signal_name, ts DESC);
    `);

    if (args.source === 'all' || args.source === 'fred') {
      await backfillFRED(client, args.from);
    }

    if (args.source === 'all' || args.source === 'signal-history') {
      await populateSignalHistoryFromTables(client, args.from);
    }

    // Summary
    const summary = await client.query(`
      SELECT signal_name, COUNT(*) as n,
             MIN(ts)::date as min_date, MAX(ts)::date as max_date
      FROM signal_history
      GROUP BY signal_name
      ORDER BY signal_name
    `);
    console.log('\n[backfill] Signal history summary:');
    for (const row of summary.rows) {
      console.log(`  ${row.signal_name}: ${row.n} pts, ${row.min_date} ~ ${row.max_date}`);
    }

  } finally {
    await client.end();
  }
}

main().catch(err => { console.error('[backfill] Fatal:', err); process.exit(1); });
