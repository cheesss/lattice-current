#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './nas-runtime.mjs';

loadOptionalEnvFile();

const { Client } = pg;

export const EMERGING_TECH_SCHEMA_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS discovery_topics (
      id TEXT PRIMARY KEY,
      label TEXT,
      description TEXT,
      category TEXT,
      stage TEXT,
      keywords TEXT[] NOT NULL DEFAULT '{}'::text[],
      centroid_embedding DOUBLE PRECISION[],
      representative_article_ids INTEGER[] NOT NULL DEFAULT '{}'::integer[],
      article_count INTEGER NOT NULL DEFAULT 0,
      first_seen DATE,
      last_seen DATE,
      monthly_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
      momentum DOUBLE PRECISION,
      research_momentum DOUBLE PRECISION,
      source_quality_score DOUBLE PRECISION,
      source_quality_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
      novelty DOUBLE PRECISION,
      diversity INTEGER NOT NULL DEFAULT 0,
      cohesion DOUBLE PRECISION,
      parent_theme TEXT,
      key_companies TEXT[] NOT NULL DEFAULT '{}'::text[],
      key_technologies TEXT[] NOT NULL DEFAULT '{}'::text[],
      codex_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'labeled', 'reported', 'expired')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_discovery_topics_status
      ON discovery_topics(status);
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_discovery_topics_momentum
      ON discovery_topics(momentum DESC NULLS LAST);
  `,
  `
    ALTER TABLE discovery_topics
      ADD COLUMN IF NOT EXISTS source_quality_score DOUBLE PRECISION;
  `,
  `
    ALTER TABLE discovery_topics
      ADD COLUMN IF NOT EXISTS source_quality_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb;
  `,
  `
    CREATE TABLE IF NOT EXISTS discovery_topic_articles (
      topic_id TEXT NOT NULL REFERENCES discovery_topics(id) ON DELETE CASCADE,
      article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (topic_id, article_id)
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_discovery_topic_articles_article
      ON discovery_topic_articles(article_id);
  `,
  `
    CREATE TABLE IF NOT EXISTS tech_reports (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL REFERENCES discovery_topics(id) ON DELETE CASCADE,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      topic_label TEXT,
      description TEXT,
      stage TEXT,
      momentum DOUBLE PRECISION,
      research_momentum DOUBLE PRECISION,
      source_quality_score DOUBLE PRECISION,
      top_articles JSONB NOT NULL DEFAULT '[]'::jsonb,
      related_symbols JSONB NOT NULL DEFAULT '[]'::jsonb,
      monthly_timeline JSONB NOT NULL DEFAULT '{}'::jsonb,
      investment_thesis TEXT,
      key_companies TEXT[] NOT NULL DEFAULT '{}'::text[],
      novelty_score DOUBLE PRECISION,
      tracking_score INTEGER,
      next_review_at TIMESTAMPTZ
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_tech_reports_topic_generated
      ON tech_reports(topic_id, generated_at DESC);
  `,
  `
    ALTER TABLE tech_reports
      ADD COLUMN IF NOT EXISTS source_quality_score DOUBLE PRECISION;
  `,
  `
    CREATE TABLE IF NOT EXISTS backfill_state (
      source TEXT PRIMARY KEY,
      last_processed_id TEXT,
      total_fetched INTEGER NOT NULL DEFAULT 0,
      total_inserted INTEGER NOT NULL DEFAULT 0,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      error_message TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_articles_source_published
      ON articles(source, published_at DESC);
  `,
];

export async function ensureEmergingTechSchema(queryable) {
  for (const statement of EMERGING_TECH_SCHEMA_STATEMENTS) {
    await queryable.query(statement);
  }
}

export async function runEmergingTechSchema(config = resolveNasPgConfig()) {
  const client = new Client(config);
  await client.connect();
  try {
    await ensureEmergingTechSchema(client);
    return { ok: true, statementCount: EMERGING_TECH_SCHEMA_STATEMENTS.length };
  } finally {
    await client.end();
  }
}

const isDirectRun = (() => {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  try {
    return import.meta.url === pathToFileURL(entryArg).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  runEmergingTechSchema()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
      process.exit(1);
    });
}
