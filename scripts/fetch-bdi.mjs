#!/usr/bin/env node
/**
 * fetch-bdi.mjs — Baltic Dry Index 수집
 *
 * 소스: 무료 공개 API 또는 CSV 파일
 *
 * Usage:
 *   node --import tsx scripts/fetch-bdi.mjs
 *   node --import tsx scripts/fetch-bdi.mjs --file data/bdi-history.csv
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();
const { Client } = pg;
const PG_CONFIG = resolveNasPgConfig();

const BDI_DDL = `
CREATE TABLE IF NOT EXISTS macro_bdi (
  date DATE NOT NULL PRIMARY KEY,
  value DOUBLE PRECISION NOT NULL
);
`;

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { file: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file') result.file = args[++i];
  }
  return result;
}

async function importFromCSV(client, filePath) {
  console.log(`[BDI] Importing from CSV: ${filePath}`);
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.trim().split('\n');

  let inserted = 0;
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    const date = parts[0]?.trim().replace(/"/g, '');
    const value = parseFloat(parts[1]?.trim().replace(/"/g, ''));
    if (!date || isNaN(value) || isNaN(Date.parse(date))) continue;

    await client.query(`
      INSERT INTO macro_bdi (date, value) VALUES ($1, $2)
      ON CONFLICT (date) DO UPDATE SET value = EXCLUDED.value
    `, [date, value]);
    inserted++;
  }
  console.log(`[BDI] Inserted/updated ${inserted} rows from CSV`);
  return inserted;
}

async function fetchLatestBDI(client) {
  console.log('[BDI] Fetching latest BDI from public API...');

  // Try Trading Economics style endpoint or Nasdaq Data Link
  const nasdaqApiKey = process.env.NASDAQ_DATA_LINK_API_KEY || process.env.QUANDL_API_KEY || '';
  if (nasdaqApiKey) {
    try {
      const url = `https://data.nasdaq.com/api/v3/datasets/CHRIS/CME_BJ1.json?api_key=${nasdaqApiKey}&rows=30`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (resp.ok) {
        const data = await resp.json();
        const rows = data?.dataset?.data || [];
        let inserted = 0;
        for (const row of rows) {
          const date = row[0]; // YYYY-MM-DD
          const settle = row[5] ?? row[4] ?? row[1]; // Settle or Last
          if (!date || !settle) continue;
          await client.query(`
            INSERT INTO macro_bdi (date, value) VALUES ($1, $2)
            ON CONFLICT (date) DO UPDATE SET value = EXCLUDED.value
          `, [date, settle]);
          inserted++;
        }
        console.log(`[BDI] Inserted ${inserted} rows from Nasdaq Data Link`);
        return inserted;
      }
    } catch (err) {
      console.warn(`[BDI] Nasdaq Data Link fetch failed: ${err.message}`);
    }
  }

  console.warn('[BDI] No API key found. Use --file to import from CSV.');
  console.warn('[BDI] Set NASDAQ_DATA_LINK_API_KEY in .env.local for API access.');
  return 0;
}

async function main() {
  const args = parseArgs();
  const client = new Client(PG_CONFIG);

  try {
    await client.connect();
    await client.query(BDI_DDL);

    if (args.file) {
      await importFromCSV(client, args.file);
    } else {
      await fetchLatestBDI(client);
    }

    const count = await client.query('SELECT COUNT(*) as n, MIN(date) as min_date, MAX(date) as max_date FROM macro_bdi');
    const r = count.rows[0];
    console.log(`[BDI] DB total: ${r.n} rows, ${r.min_date} ~ ${r.max_date}`);
  } finally {
    await client.end();
  }
}

main().catch(err => { console.error('[BDI] Fatal:', err); process.exit(1); });
