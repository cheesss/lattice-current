#!/usr/bin/env node
/**
 * Backfill: set wire_source / publisher_group / market_relevance on articles
 * for rows where the columns are still NULL (newly added by
 * add-articles-source-metadata.mjs migration).
 *
 * Safe to re-run. Processes articles in batches of 2_000 to avoid long
 * transactions.
 *
 * Run: node scripts/migrations/backfill-article-source-metadata.mjs
 *      node scripts/migrations/backfill-article-source-metadata.mjs --dry-run
 *      node scripts/migrations/backfill-article-source-metadata.mjs --limit 5000
 */

import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from '../_shared/nas-runtime.mjs';
import { classifyArticleSource } from '../_shared/source-classifier.mjs';

const { Client } = pg;

loadOptionalEnvFile();

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.indexOf('--limit');
const TOTAL_LIMIT = LIMIT_ARG >= 0 && process.argv[LIMIT_ARG + 1]
  ? Number(process.argv[LIMIT_ARG + 1])
  : Infinity;

const BATCH_SIZE = 2000;

async function fetchBatch(client, offset) {
  // Pull URL + source + title (body/content column may or may not exist — keep optional).
  // We purposely do NOT filter published_at, we backfill the entire history.
  const { rows } = await client.query(`
    SELECT id, url, source, title
    FROM articles
    WHERE publisher_group IS NULL
      AND market_relevance IS NULL
      AND wire_source IS NULL
    ORDER BY id
    LIMIT $1 OFFSET $2
  `, [BATCH_SIZE, offset]);
  return rows;
}

async function updateRow(client, row) {
  const { publisherGroup, marketRelevance, wireSource } = classifyArticleSource({
    url: row.url,
    source: row.source,
    title: row.title,
  });
  if (DRY_RUN) {
    return { publisherGroup, marketRelevance, wireSource };
  }
  await client.query(`
    UPDATE articles
    SET publisher_group = COALESCE(publisher_group, $1),
        market_relevance = COALESCE(market_relevance, $2),
        wire_source = COALESCE(wire_source, $3)
    WHERE id = $4
  `, [publisherGroup, marketRelevance, wireSource, row.id]);
  return { publisherGroup, marketRelevance, wireSource };
}

async function main() {
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    let processed = 0;
    let classified = 0;
    let withWire = 0;
    const relevanceCounts = { high: 0, medium: 0, low: 0 };
    let offset = 0;

    while (processed < TOTAL_LIMIT) {
      const batch = await fetchBatch(client, offset);
      if (!batch.length) break;
      for (const row of batch) {
        const result = await updateRow(client, row);
        processed += 1;
        if (result.publisherGroup) classified += 1;
        if (result.wireSource) withWire += 1;
        if (result.marketRelevance) relevanceCounts[result.marketRelevance] = (relevanceCounts[result.marketRelevance] || 0) + 1;
        if (processed >= TOTAL_LIMIT) break;
      }
      console.log(`batch offset=${offset} processed=${processed} classified=${classified} wire=${withWire}`);
      offset += batch.length;
      if (DRY_RUN) break; // one batch is enough for a dry-run preview
    }

    console.log('\nFinal tally:');
    console.log(`  processed          ${processed}`);
    console.log(`  with publisher     ${classified}`);
    console.log(`  with wire_source   ${withWire}`);
    console.log(`  relevance=high     ${relevanceCounts.high || 0}`);
    console.log(`  relevance=medium   ${relevanceCounts.medium || 0}`);
    console.log(`  relevance=low      ${relevanceCounts.low || 0}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(String(err?.stack || err?.message || err));
  process.exit(1);
});
