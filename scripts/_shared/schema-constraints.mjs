#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './nas-runtime.mjs';

loadOptionalEnvFile();

const { Client } = pg;

const CONSTRAINT_STEPS = [
  {
    id: 'labeled_outcomes.theme.not_null',
    sql: 'ALTER TABLE labeled_outcomes ALTER COLUMN theme SET NOT NULL',
  },
  {
    id: 'labeled_outcomes.symbol.not_null',
    sql: 'ALTER TABLE labeled_outcomes ALTER COLUMN symbol SET NOT NULL',
  },
  {
    id: 'labeled_outcomes.horizon.not_null',
    sql: 'ALTER TABLE labeled_outcomes ALTER COLUMN horizon SET NOT NULL',
  },
  {
    id: 'labeled_outcomes.entry_price.check',
    sql: `DO $$
      BEGIN
        ALTER TABLE labeled_outcomes
        ADD CONSTRAINT chk_lo_entry_price CHECK (entry_price > 0);
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;`,
  },
  {
    id: 'labeled_outcomes.exit_price.check',
    sql: `DO $$
      BEGIN
        ALTER TABLE labeled_outcomes
        ADD CONSTRAINT chk_lo_exit_price CHECK (exit_price > 0);
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;`,
  },
  {
    id: 'labeled_outcomes.return_range.check',
    sql: `DO $$
      BEGIN
        ALTER TABLE labeled_outcomes
        ADD CONSTRAINT chk_lo_return_range CHECK (forward_return_pct BETWEEN -100 AND 1000);
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;`,
  },
  {
    id: 'regime_conditional_impact.theme.not_null',
    sql: 'ALTER TABLE regime_conditional_impact ALTER COLUMN theme SET NOT NULL',
  },
  {
    id: 'regime_conditional_impact.symbol.not_null',
    sql: 'ALTER TABLE regime_conditional_impact ALTER COLUMN symbol SET NOT NULL',
  },
  {
    id: 'regime_conditional_impact.hit_rate.check',
    sql: `DO $$
      BEGIN
        ALTER TABLE regime_conditional_impact
        ADD CONSTRAINT chk_rci_hit_rate CHECK (hit_rate >= 0 AND hit_rate <= 1);
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;`,
  },
  {
    id: 'regime_conditional_impact.sample_size.check',
    sql: `DO $$
      BEGIN
        ALTER TABLE regime_conditional_impact
        ADD CONSTRAINT chk_rci_sample_size CHECK (sample_size >= 0);
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;`,
  },
  {
    id: 'auto_article_themes.confidence.check',
    sql: `DO $$
      BEGIN
        ALTER TABLE auto_article_themes
        ADD CONSTRAINT chk_aat_confidence CHECK (confidence >= 0 AND confidence <= 1);
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;`,
  },
  {
    id: 'event_hawkes_intensity.theme.not_null',
    sql: 'ALTER TABLE event_hawkes_intensity ALTER COLUMN theme SET NOT NULL',
  },
  {
    id: 'event_hawkes_intensity.temperature.check',
    sql: `DO $$
      BEGIN
        ALTER TABLE event_hawkes_intensity
        ADD CONSTRAINT chk_ehi_temperature CHECK (normalized_temperature >= 0 AND normalized_temperature <= 1);
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;`,
  },
  {
    id: 'event_hawkes_intensity.article_count.check',
    sql: `DO $$
      BEGIN
        ALTER TABLE event_hawkes_intensity
        ADD CONSTRAINT chk_ehi_article_count CHECK (article_count >= 0);
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;`,
  },
  {
    id: 'articles.link.unique',
    sql: 'CREATE UNIQUE INDEX IF NOT EXISTS articles_link_key ON articles(link) WHERE link IS NOT NULL',
  },
];

export async function applySchemaConstraints(queryable) {
  const results = [];
  for (const step of CONSTRAINT_STEPS) {
    try {
      await queryable.query(step.sql);
      results.push({ id: step.id, ok: true, error: '' });
    } catch (error) {
      results.push({ id: step.id, ok: false, error: String(error?.message || error || 'constraint failed') });
    }
  }
  return {
    ok: results.every((result) => result.ok),
    appliedCount: results.filter((result) => result.ok).length,
    failedCount: results.filter((result) => !result.ok).length,
    results,
  };
}

export async function runSchemaConstraints(config = resolveNasPgConfig()) {
  const client = new Client(config);
  await client.connect();
  try {
    return await applySchemaConstraints(client);
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
  runSchemaConstraints()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      process.exit(summary.failedCount > 0 ? 1 : 0);
    })
    .catch((error) => {
      process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
      process.exit(1);
    });
}
