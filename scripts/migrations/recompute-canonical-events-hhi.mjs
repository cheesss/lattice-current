#!/usr/bin/env node
/**
 * Recompute canonical_events.source_hhi / effective_source_count /
 * wire_dominated / top_source_share based on publisher_group and wire_source
 * annotations on articles.
 *
 * Requires:
 *   - add-canonical-events-hhi.mjs   (schema)
 *   - add-articles-source-metadata.mjs (schema)
 *   - backfill-article-source-metadata.mjs (data populated)
 *
 * Run: node scripts/migrations/recompute-canonical-events-hhi.mjs [--limit 1000]
 */

import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from '../_shared/nas-runtime.mjs';
import { computeSourceConcentration, computeLegacyDiversity } from '../_shared/source-concentration.mjs';

const { Client } = pg;

loadOptionalEnvFile();

const LIMIT_ARG = process.argv.indexOf('--limit');
const TOTAL_LIMIT = LIMIT_ARG >= 0 && process.argv[LIMIT_ARG + 1]
  ? Number(process.argv[LIMIT_ARG + 1])
  : Infinity;

const BATCH_SIZE = 500;

async function main() {
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    let offset = 0;
    let processed = 0;
    let wireDominatedTotal = 0;

    while (processed < TOTAL_LIMIT) {
      const { rows: events } = await client.query(`
        SELECT id
        FROM canonical_events
        ORDER BY id
        LIMIT $1 OFFSET $2
      `, [BATCH_SIZE, offset]);
      if (!events.length) break;

      for (const ev of events) {
        const { rows: articles } = await client.query(`
          SELECT a.publisher_group, a.source, a.wire_source
          FROM article_event_map aem
          JOIN articles a ON a.id = aem.article_id
          WHERE aem.canonical_event_id = $1
        `, [ev.id]);

        if (!articles.length) continue;
        const c = computeSourceConcentration(articles);
        const legacyDiv = computeLegacyDiversity(articles);

        await client.query(`
          UPDATE canonical_events
          SET source_hhi = $1,
              effective_source_count = $2,
              wire_dominated = $3,
              top_source_share = $4,
              source_diversity = $5
          WHERE id = $6
        `, [c.hhi, c.effectiveSourceCount, c.wireDominated, c.topShare, legacyDiv, ev.id]);

        processed += 1;
        if (c.wireDominated) wireDominatedTotal += 1;
        if (processed >= TOTAL_LIMIT) break;
      }
      console.log(`offset=${offset} processed=${processed} wireDominated=${wireDominatedTotal}`);
      offset += events.length;
    }

    console.log(`\nFinal tally: processed=${processed}, wireDominated=${wireDominatedTotal}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(String(err?.stack || err?.message || err));
  process.exit(1);
});
