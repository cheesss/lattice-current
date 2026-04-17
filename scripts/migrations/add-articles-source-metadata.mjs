#!/usr/bin/env node
/**
 * Migration: add wire_source, publisher_group, market_relevance to articles.
 *
 * Phase 0.6 of Nowcast plan. These columns let the eventIntensity nowcast
 * and regime detector exclude soft news, collapse multi-lingual duplicates,
 * and ignore wire syndication inflation.
 *
 * Run: node scripts/migrations/add-articles-source-metadata.mjs [--dry-run]
 */

import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from '../_shared/nas-runtime.mjs';

const { Client } = pg;

loadOptionalEnvFile();

const DRY_RUN = process.argv.includes('--dry-run');

const STATEMENTS = [
  `ALTER TABLE articles
     ADD COLUMN IF NOT EXISTS wire_source text`,
  `ALTER TABLE articles
     ADD COLUMN IF NOT EXISTS publisher_group text`,
  `ALTER TABLE articles
     ADD COLUMN IF NOT EXISTS market_relevance text`,
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM information_schema.table_constraints
       WHERE table_name = 'articles'
         AND constraint_name = 'articles_market_relevance_check'
     ) THEN
       ALTER TABLE articles
         ADD CONSTRAINT articles_market_relevance_check
           CHECK (market_relevance IS NULL OR market_relevance IN ('high','medium','low'));
     END IF;
   END $$`,
  `CREATE INDEX IF NOT EXISTS idx_articles_wire_source
     ON articles (wire_source) WHERE wire_source IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_articles_publisher_group
     ON articles (publisher_group) WHERE publisher_group IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_articles_market_relevance
     ON articles (market_relevance) WHERE market_relevance IS NOT NULL`,
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
          COUNT(wire_source)::int AS with_wire,
          COUNT(publisher_group)::int AS with_group,
          COUNT(market_relevance)::int AS with_relevance
        FROM articles
      `);
      const r = rows[0];
      console.log(`\narticles: total=${r.total}, with_wire=${r.with_wire}, with_group=${r.with_group}, with_relevance=${r.with_relevance}`);
      console.log('(Run backfill-article-source-metadata.mjs to populate the new columns.)');
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(String(err?.stack || err?.message || err));
  process.exit(1);
});
