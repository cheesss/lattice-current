#!/usr/bin/env node
/**
 * fetch-positioning-data.mjs — COT (CFTC) + Put/Call Ratio (CBOE) 수집
 *
 * COT: 주간 CFTC Commitments of Traders (주요 선물 넷포지셔닝)
 * Put/Call: CBOE 일별 총 Put/Call Ratio
 *
 * Usage:
 *   node --import tsx scripts/fetch-positioning-data.mjs              # 최신 데이터
 *   node --import tsx scripts/fetch-positioning-data.mjs --backfill   # 히스토리컬 백필
 *   node --import tsx scripts/fetch-positioning-data.mjs --type cot   # COT만
 *   node --import tsx scripts/fetch-positioning-data.mjs --type putcall  # Put/Call만
 */

import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import {
  CBOE_PUTCALL_SOURCES,
  COT_ASSET_SPECS,
  COT_PRE_DATASETS,
  buildCotApiUrl,
  normalizeUsDate,
  parseCsvTable,
  parseNumeric,
} from './_shared/positioning-sources.mjs';

loadOptionalEnvFile();
const { Client } = pg;
const PG_CONFIG = resolveNasPgConfig();

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { type: 'all', backfill: false, from: '2021-01-01' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--type') result.type = args[++i];
    if (args[i] === '--backfill') result.backfill = true;
    if (args[i] === '--from') result.from = args[++i];
  }
  return result;
}

// ---------------------------------------------------------------------------
// DB Schema
// ---------------------------------------------------------------------------

const COT_DDL = `
CREATE TABLE IF NOT EXISTS positioning_cot (
  report_date DATE NOT NULL,
  asset TEXT NOT NULL,
  long_contracts BIGINT,
  short_contracts BIGINT,
  net_contracts BIGINT,
  net_pct DOUBLE PRECISION,
  open_interest BIGINT,
  PRIMARY KEY (report_date, asset)
);
`;

const PUTCALL_DDL = `
CREATE TABLE IF NOT EXISTS positioning_putcall (
  date DATE NOT NULL PRIMARY KEY,
  total_ratio DOUBLE PRECISION,
  equity_ratio DOUBLE PRECISION,
  index_ratio DOUBLE PRECISION
);
`;

// ---------------------------------------------------------------------------
// COT Fetching — official CFTC Public Reporting Environment
// ---------------------------------------------------------------------------

async function fetchJson(url) {
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(45_000),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; lattice-bot/1.0)' },
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} for ${url}`);
  }
  return resp.json();
}

async function fetchCotRows(spec, fromDate) {
  const dataset = COT_PRE_DATASETS[spec.dataset];
  const columns = [
    dataset.marketField,
    dataset.dateField,
    dataset.openInterestField,
    dataset.longField,
    dataset.shortField,
  ];
  const patterns = (spec.patterns || []).map((value) => String(value).toUpperCase().replace(/'/g, "''"));
  const patternClause = patterns
    .map((pattern) => `upper(${dataset.marketField}) like '%${pattern}%'`)
    .join(' OR ');
  const whereClause = `${dataset.dateField} >= '${fromDate}' AND (${patternClause})`;
  const url = buildCotApiUrl(dataset.resourceId, columns, whereClause);
  return fetchJson(url);
}

async function upsertCotRows(client, rows, spec) {
  let inserted = 0;
  const dataset = COT_PRE_DATASETS[spec.dataset];

  for (const row of rows) {
    const reportDate = normalizeUsDate(row[dataset.dateField]) || String(row[dataset.dateField] || '').slice(0, 10);
    const longC = parseNumeric(row[dataset.longField]);
    const shortC = parseNumeric(row[dataset.shortField]);
    const oi = parseNumeric(row[dataset.openInterestField]);
    if (!reportDate || longC == null || shortC == null || oi == null || oi <= 0) continue;

    const net = longC - shortC;
    const netPct = (net / oi) * 100;
    await client.query(`
      INSERT INTO positioning_cot (report_date, asset, long_contracts, short_contracts, net_contracts, net_pct, open_interest)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (report_date, asset) DO UPDATE SET
        long_contracts = EXCLUDED.long_contracts,
        short_contracts = EXCLUDED.short_contracts,
        net_contracts = EXCLUDED.net_contracts,
        net_pct = EXCLUDED.net_pct,
        open_interest = EXCLUDED.open_interest
    `, [reportDate, spec.asset, longC, shortC, net, netPct, oi]);
    inserted++;
  }

  return inserted;
}

async function fetchCOT(client, fromDate) {
  console.log(`[COT] Fetching CFTC PRE data from ${fromDate}...`);
  let inserted = 0;
  for (const spec of COT_ASSET_SPECS) {
    try {
      const rows = await fetchCotRows(spec, fromDate);
      const count = await upsertCotRows(client, rows, spec);
      inserted += count;
      console.log(`[COT] ${spec.asset}: ${count} rows`);
    } catch (err) {
      console.error(`[COT] ${spec.asset}: ${err.message}`);
    }
  }
  console.log(`[COT] Inserted/updated ${inserted} rows`);
  return inserted;
}

// ---------------------------------------------------------------------------
// Put/Call Ratio — CBOE
// ---------------------------------------------------------------------------

async function loadCboePutCallRows(url, label) {
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; lattice-bot/1.0)' },
  });
  if (!resp.ok) {
    throw new Error(`${label}: HTTP ${resp.status}`);
  }
  const table = parseCsvTable(await resp.text());
  const headerIndex = table.findIndex((row) => String(row[0] || '').toUpperCase().includes('DATE') || String(row[0] || '').toUpperCase().includes('TRADE_DATE'));
  if (headerIndex < 0) {
    throw new Error(`${label}: header row not found`);
  }
  const header = table[headerIndex].map((cell) => String(cell || '').trim().toUpperCase());
  const dateIdx = header.findIndex((cell) => cell === 'DATE' || cell === 'TRADE_DATE');
  const ratioIdx = header.findIndex((cell) => cell.includes('P/C RATIO'));
  if (dateIdx < 0 || ratioIdx < 0) {
    throw new Error(`${label}: missing DATE or P/C Ratio columns`);
  }
  return table.slice(headerIndex + 1).map((row) => ({
    date: normalizeUsDate(row[dateIdx]),
    ratio: parseNumeric(row[ratioIdx]),
  })).filter((row) => row.date && row.ratio != null);
}

async function fetchPutCall(client, fromDate) {
  console.log(`[PutCall] Loading official CBOE CSVs from ${fromDate}...`);
  const merged = new Map();

  for (const [label, url] of Object.entries(CBOE_PUTCALL_SOURCES)) {
    try {
      const rows = await loadCboePutCallRows(url, label);
      for (const row of rows) {
        if (row.date >= fromDate) {
          merged.set(row.date, row.ratio);
        }
      }
      console.log(`[PutCall] ${label}: ${rows.length} raw rows`);
    } catch (err) {
      console.error(`[PutCall] ${label}: ${err.message}`);
    }
  }

  let inserted = 0;
  for (const [date, totalRatio] of Array.from(merged.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    await client.query(`
      INSERT INTO positioning_putcall (date, total_ratio, equity_ratio, index_ratio)
      VALUES ($1, $2, NULL, NULL)
      ON CONFLICT (date) DO UPDATE SET
        total_ratio = EXCLUDED.total_ratio
    `, [date, totalRatio]);
    inserted++;
  }

  console.log(`[PutCall] Inserted/updated ${inserted} rows`);
  if (inserted === 0) {
    console.warn('[PutCall] No public CBOE rows available for the requested date range. Free official CSV coverage currently ends at 2019-10-04.');
  }
  return inserted;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();
  const client = new Client(PG_CONFIG);

  try {
    await client.connect();
    console.log('[positioning] Connected to NAS PostgreSQL');

    // Ensure tables
    await client.query(COT_DDL);
    await client.query(PUTCALL_DDL);

    if (args.type === 'all' || args.type === 'cot') {
      await fetchCOT(client, args.backfill ? args.from : args.from);
    }

    if (args.type === 'all' || args.type === 'putcall') {
      await fetchPutCall(client, args.backfill ? args.from : args.from);
    }

    // Summary
    const cotCount = await client.query('SELECT COUNT(*) as n FROM positioning_cot');
    const pcCount = await client.query('SELECT COUNT(*) as n FROM positioning_putcall');
    console.log(`[positioning] DB totals: COT=${cotCount.rows[0].n}, PutCall=${pcCount.rows[0].n}`);

  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('[positioning] Fatal:', err);
  process.exit(1);
});
