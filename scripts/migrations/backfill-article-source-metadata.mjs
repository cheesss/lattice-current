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

const BATCH_SIZE = 5000;

async function fetchBatch(client) {
  // WHERE filters already-populated rows, so next call returns the next window
  // of still-NULL rows without needing OFFSET.
  const { rows } = await client.query(`
    SELECT id, url, source, title
    FROM articles
    WHERE publisher_group IS NULL
      AND market_relevance IS NULL
      AND wire_source IS NULL
    ORDER BY id
    LIMIT $1
  `, [BATCH_SIZE]);
  return rows;
}

async function processBatch(client, batch) {
  const ids = [];
  const pgs = [];
  const mrs = [];
  const wss = [];
  let classified = 0;
  let withWire = 0;
  const relevanceCounts = { high: 0, medium: 0, low: 0 };

  for (const row of batch) {
    const { publisherGroup, marketRelevance, wireSource } = classifyArticleSource({
      url: row.url,
      source: row.source,
      title: row.title,
    });
    ids.push(row.id);
    pgs.push(publisherGroup);
    mrs.push(marketRelevance);
    wss.push(wireSource);
    if (publisherGroup) classified += 1;
    if (wireSource) withWire += 1;
    if (marketRelevance) relevanceCounts[marketRelevance] = (relevanceCounts[marketRelevance] || 0) + 1;
  }

  if (!DRY_RUN) {
    await client.query(`
      UPDATE articles a
      SET publisher_group = COALESCE(a.publisher_group, v.pg),
          market_relevance = COALESCE(a.market_relevance, v.mr),
          wire_source = COALESCE(a.wire_source, v.ws)
      FROM UNNEST($1::bigint[], $2::text[], $3::text[], $4::text[])
           AS v(id, pg, mr, ws)
      WHERE a.id = v.id
    `, [ids, pgs, mrs, wss]);
  }

  return { classified, withWire, relevanceCounts };
}

async function main() {
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    let processed = 0;
    let classified = 0;
    let withWire = 0;
    const relevanceCounts = { high: 0, medium: 0, low: 0 };

    while (processed < TOTAL_LIMIT) {
      const batch = await fetchBatch(client);
      if (!batch.length) break;
      const slice = processed + batch.length > TOTAL_LIMIT
        ? batch.slice(0, TOTAL_LIMIT - processed)
        : batch;
      const result = await processBatch(client, slice);
      processed += slice.length;
      classified += result.classified;
      withWire += result.withWire;
      for (const [k, v] of Object.entries(result.relevanceCounts)) {
        relevanceCounts[k] = (relevanceCounts[k] || 0) + v;
      }
      console.log(`batch processed=${processed} classified=${classified} wire=${withWire}`);
      if (DRY_RUN) break;
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
