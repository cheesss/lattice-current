#!/usr/bin/env node
/**
 * Cleanup canonical_events whose theme matches the auto-generated
 * dynamic-theme-code pattern (`dt-[0-9a-f]+`). These are placeholder
 * codes minted by the discovery pipeline before themes are promoted to
 * canonical taxonomy. They never get symbol mappings, never get graded,
 * and pollute downstream queries.
 *
 * Safe deletion order respecting foreign keys:
 *   article_event_map → matched_controls → event_features →
 *   model_predictions → event_uplift → canonical_events
 *
 * (No FK has ON DELETE CASCADE, so each child must be cleaned first.)
 *
 * Idempotent — re-runs do nothing once dt-* events are gone.
 *
 * Usage:
 *   node scripts/migrations/cleanup-dt-canonical-events.mjs
 *   node scripts/migrations/cleanup-dt-canonical-events.mjs --dry-run
 */

import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from '../_shared/nas-runtime.mjs';

loadOptionalEnvFile();

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const pool = new pg.Pool(resolveNasPgConfig());
  const client = await pool.connect();
  try {
    const target = await client.query(
      "SELECT count(*)::int n FROM canonical_events WHERE theme ~ '^dt-[0-9a-f]+'",
    );
    const targetCount = target.rows[0].n;
    console.log(`canonical_events with dt-* theme: ${targetCount}`);
    if (targetCount === 0) {
      console.log('nothing to clean.');
      return;
    }

    if (DRY_RUN) {
      const childCounts = await Promise.all([
        ['event_uplift', 'event_uplift'],
        ['matched_controls', 'matched_controls'],
        ['model_predictions', 'model_predictions'],
        ['event_features', 'event_features'],
        ['article_event_map', 'article_event_map'],
      ].map(async ([_, table]) => {
        const r = await client.query(
          `SELECT count(*)::int n FROM ${table} c
             JOIN canonical_events ce ON ce.id = c.canonical_event_id
            WHERE ce.theme ~ '^dt-[0-9a-f]+'`,
        );
        return { table, count: r.rows[0].n };
      }));
      console.log('would also delete from child tables:');
      for (const { table, count } of childCounts) console.log(`  ${table.padEnd(24)} ${count}`);
      console.log('--dry-run; no changes made.');
      return;
    }

    await client.query('BEGIN');
    const deletedSummary = {};
    const childTables = ['event_uplift', 'matched_controls', 'model_predictions', 'event_features', 'article_event_map'];
    for (const table of childTables) {
      const r = await client.query(
        `DELETE FROM ${table}
          WHERE canonical_event_id IN (
            SELECT id FROM canonical_events WHERE theme ~ '^dt-[0-9a-f]+'
          )`,
      );
      deletedSummary[table] = r.rowCount;
      console.log(`  ${table.padEnd(24)} deleted ${r.rowCount}`);
    }
    const parentDel = await client.query(
      "DELETE FROM canonical_events WHERE theme ~ '^dt-[0-9a-f]+'",
    );
    deletedSummary.canonical_events = parentDel.rowCount;
    console.log(`  canonical_events     deleted ${parentDel.rowCount}`);
    await client.query('COMMIT');
    console.log('done. Summary:', JSON.stringify(deletedSummary));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(String(error?.stack || error?.message || error) + '\n');
  process.exitCode = 1;
});
