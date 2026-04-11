import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseArgs,
  TAXONOMY_MIGRATION_SCHEMA_STATEMENTS,
} from '../scripts/migrate-taxonomy.mjs';

test('taxonomy migration exposes labeled_outcomes taxonomy columns and indexes', () => {
  const joined = TAXONOMY_MIGRATION_SCHEMA_STATEMENTS.join('\n');
  assert.match(joined, /ADD COLUMN IF NOT EXISTS theme_key/i);
  assert.match(joined, /ADD COLUMN IF NOT EXISTS parent_theme/i);
  assert.match(joined, /ADD COLUMN IF NOT EXISTS theme_category/i);
  assert.match(joined, /CREATE INDEX IF NOT EXISTS idx_labeled_outcomes_theme_key/i);
});

test('taxonomy migration parses rebuild and rewrite flags', () => {
  const parsed = parseArgs([
    '--batch-size', '500',
    '--limit', '1000',
    '--from-article-id', '25',
    '--as-of', '2026-04-07',
    '--rewrite-outcome-theme',
    '--with-rebuild',
  ]);

  assert.equal(parsed.batchSize, 500);
  assert.equal(parsed.limit, 1000);
  assert.equal(parsed.fromArticleId, 25);
  assert.equal(parsed.asOf, '2026-04-07');
  assert.equal(parsed.rewriteOutcomeTheme, true);
  assert.equal(parsed.rebuildAggregates, true);
  assert.equal(parsed.rebuildCuration, true);
  assert.equal(parsed.invalidateCache, true);
});
