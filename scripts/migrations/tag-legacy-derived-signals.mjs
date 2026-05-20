#!/usr/bin/env node
/**
 * Migration: tag legacy derived signals in signal_history with correct
 * value_origin / writer_id. Does NOT delete any rows (CLAUDE.md rule 5).
 *
 * Before this migration: all rows defaulted to value_origin='observed'.
 * This script reclassifies historical derived/proxy rows that should never
 * have been treated as observed.
 *
 * Rules:
 *   - marketStress, transmissionStrength, eventIntensity, gpr were written
 *     from derived formulas (GDELT proxy, FRED composite). Mark as such.
 *   - value_origin='proxy' for GDELT-driven rows (imprecise proxies).
 *   - value_origin='composite' for multi-signal blends (marketStress FRED path).
 *   - writer_id identifies the producing script so later queries can filter.
 *
 * Run: node scripts/migrations/tag-legacy-derived-signals.mjs [--dry-run]
 */

import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from '../_shared/nas-runtime.mjs';

const { Client } = pg;

loadOptionalEnvFile();

const DRY_RUN = process.argv.includes('--dry-run');

// (signal_name, expected_writer, new_value_origin)
// These tags apply only to rows that currently have the default writer_id IS NULL.
// Future writes will set writer_id explicitly so they are excluded.
const TAGS = [
  // GDELT proxy signals (written by master-pipeline.mjs STEP 0)
  { signal: 'marketStress',         writer: 'master-pipeline-step0-gdelt', origin: 'proxy' },
  { signal: 'transmissionStrength', writer: 'master-pipeline-step0-gdelt', origin: 'proxy' },
  { signal: 'eventIntensity',       writer: 'master-pipeline-step0-gdelt', origin: 'proxy' },
  { signal: 'gpr',                  writer: 'master-pipeline-step0-gdelt', origin: 'proxy' },
];

async function main() {
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    for (const tag of TAGS) {
      const stmt = `
        UPDATE signal_history
        SET value_origin = $1,
            writer_id = COALESCE(writer_id, $2)
        WHERE signal_name = $3
          AND value_origin = 'observed'
          AND writer_id IS NULL
      `;
      if (DRY_RUN) {
        console.log(`[dry-run] would tag signal=${tag.signal} → origin=${tag.origin}, writer=${tag.writer}`);
        continue;
      }
      const result = await client.query(stmt, [tag.origin, tag.writer, tag.signal]);
      console.log(`tagged signal=${tag.signal} rows=${result.rowCount} → origin=${tag.origin}`);
    }

    if (!DRY_RUN) {
      const { rows } = await client.query(`
        SELECT signal_name, value_origin, writer_id, COUNT(*)::int AS n
        FROM signal_history
        WHERE signal_name = ANY($1)
        GROUP BY signal_name, value_origin, writer_id
        ORDER BY signal_name, n DESC
      `, [TAGS.map((t) => t.signal)]);
      console.log('\nPost-tag distribution for legacy derived signals:');
      for (const row of rows) {
        console.log(`  ${row.signal_name.padEnd(24)} origin=${String(row.value_origin).padEnd(10)} writer=${row.writer_id || '(null)'}  ${row.n}`);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(String(err?.stack || err?.message || err));
  process.exit(1);
});
