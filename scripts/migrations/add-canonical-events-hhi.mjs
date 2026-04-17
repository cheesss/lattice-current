#!/usr/bin/env node
/**
 * Migration: add source concentration columns to canonical_events.
 *
 * Adds:
 *   - source_hhi             (real concentration index, 0..1)
 *   - effective_source_count (1 / HHI, rounded)
 *   - wire_dominated         (boolean — majority from wire services)
 *   - top_source_share       (highest single-publisher share)
 *
 * Keeps legacy source_diversity for back-compat; a later recompute pass
 * overwrites it using publisher_group instead of raw source.
 *
 * Run: node scripts/migrations/add-canonical-events-hhi.mjs [--dry-run]
 */

import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from '../_shared/nas-runtime.mjs';

const { Client } = pg;

loadOptionalEnvFile();

const DRY_RUN = process.argv.includes('--dry-run');

const STATEMENTS = [
  `ALTER TABLE canonical_events
     ADD COLUMN IF NOT EXISTS source_hhi double precision`,
  `ALTER TABLE canonical_events
     ADD COLUMN IF NOT EXISTS effective_source_count double precision`,
  `ALTER TABLE canonical_events
     ADD COLUMN IF NOT EXISTS wire_dominated boolean NOT NULL DEFAULT false`,
  `ALTER TABLE canonical_events
     ADD COLUMN IF NOT EXISTS top_source_share double precision`,
  `CREATE INDEX IF NOT EXISTS idx_canonical_events_wire_dominated
     ON canonical_events (wire_dominated) WHERE wire_dominated = true`,
];

async function main() {
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    for (const stmt of STATEMENTS) {
      if (DRY_RUN) {
        console.log('[dry-run]', stmt.split('\n')[0]);
        continue;
      }
      console.log('→', stmt.split('\n')[0]);
      await client.query(stmt);
    }
    if (!DRY_RUN) {
      const { rows } = await client.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(source_hhi)::int AS with_hhi,
          COUNT(*) FILTER (WHERE wire_dominated = true)::int AS wire_dominated
        FROM canonical_events
      `);
      const r = rows[0];
      console.log(`\ncanonical_events: total=${r.total}, with_hhi=${r.with_hhi}, wire_dominated=${r.wire_dominated}`);
      console.log('Run recompute-canonical-events-hhi.mjs to populate the new columns.');
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(String(err?.stack || err?.message || err));
  process.exit(1);
});
