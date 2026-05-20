#!/usr/bin/env node
/**
 * Migration: add value_origin + writer_id columns to signal_history.
 *
 * Phase 0.5 of Nowcast plan. Existing rows get value_origin='observed' default
 * (safe assumption — most legacy rows were observed market/FRED values).
 * Writers that emit derived/proxy values will overwrite via later migrations
 * (see tag-legacy-derived-signals.mjs).
 *
 * Run: node scripts/migrations/add-signal-history-origin.mjs
 *      node scripts/migrations/add-signal-history-origin.mjs --dry-run
 */

import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from '../_shared/nas-runtime.mjs';

const { Client } = pg;

loadOptionalEnvFile();

const DRY_RUN = process.argv.includes('--dry-run');

const STATEMENTS = [
  `ALTER TABLE signal_history
     ADD COLUMN IF NOT EXISTS value_origin text NOT NULL DEFAULT 'observed'`,
  `ALTER TABLE signal_history
     ADD COLUMN IF NOT EXISTS writer_id text`,
  `CREATE INDEX IF NOT EXISTS idx_signal_history_origin
     ON signal_history (signal_name, value_origin, ts DESC)`,
];

async function main() {
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    for (const stmt of STATEMENTS) {
      if (DRY_RUN) {
        console.log('[dry-run]', stmt);
        continue;
      }
      console.log('→', stmt.split('\n')[0]);
      await client.query(stmt);
    }
    if (!DRY_RUN) {
      const { rows } = await client.query(`
        SELECT value_origin, COUNT(*)::int AS n
        FROM signal_history
        GROUP BY value_origin
        ORDER BY n DESC
      `);
      console.log('\nvalue_origin distribution after migration:');
      for (const row of rows) console.log(`  ${row.value_origin.padEnd(16)} ${row.n}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(String(err?.stack || err?.message || err));
  process.exit(1);
});
