#!/usr/bin/env node
/**
 * Adds an IVFFlat index on articles.embedding for cosine similarity search.
 *
 * Without this, /api/similar-events/:id and any cosine query falls back to
 * sequential scan over all rows. Currently OK at 73k rows (~200ms), but
 * grows linearly. This index lets pgvector skip irrelevant clusters.
 *
 * Idempotent — uses IF NOT EXISTS. Safe to re-run.
 *
 * Usage:
 *   node scripts/migrations/add-articles-embedding-index.mjs
 */

import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from '../_shared/nas-runtime.mjs';

loadOptionalEnvFile();

const { Pool } = pg;

async function main() {
  const pool = new Pool(resolveNasPgConfig());
  try {
    const before = await pool.query(
      "SELECT count(*)::int AS n FROM articles WHERE embedding IS NOT NULL",
    );
    const rowCount = before.rows[0]?.n ?? 0;

    const existing = await pool.query(
      "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'articles' AND indexdef ILIKE '%ivfflat%embedding%'",
    );
    const hasIvfflat = existing.rows.length > 0;

    console.log(`articles with embedding: ${rowCount}`);
    console.log(`existing IVFFlat indexes on articles.embedding: ${existing.rows.length}`);
    for (const row of existing.rows) {
      console.log(`  ${row.indexname}: ${row.indexdef}`);
    }

    if (hasIvfflat) {
      console.log('skip — embedding column already has an IVFFlat index. Done.');
      return;
    }

    // Heuristic: lists ≈ sqrt(rows). Cap at 200 to avoid over-partitioning.
    const lists = Math.max(50, Math.min(200, Math.round(Math.sqrt(rowCount))));
    console.log(`creating IVFFlat index with lists=${lists}…`);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS articles_embedding_cos_idx
      ON articles
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = ${lists})
    `);
    console.log('done.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(String(error?.stack || error?.message || error) + '\n');
  process.exitCode = 1;
});
