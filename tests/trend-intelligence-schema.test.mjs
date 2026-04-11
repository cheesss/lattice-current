import test from 'node:test';
import assert from 'node:assert/strict';

import { TREND_AGGREGATION_SCHEMA_STATEMENTS } from '../scripts/compute-trend-aggregates.mjs';
import { DAILY_CURATED_NEWS_SCHEMA_STATEMENTS } from '../scripts/curate-daily-news.mjs';
import { EMERGING_TECH_SCHEMA_STATEMENTS } from '../scripts/_shared/schema-emerging-tech.mjs';
import { TAXONOMY_MIGRATION_SCHEMA_STATEMENTS } from '../scripts/migrate-taxonomy.mjs';

test('trend intelligence schema defines aggregate, transition, evolution, and curation tables', () => {
  const aggregateJoined = TREND_AGGREGATION_SCHEMA_STATEMENTS.join('\n');
  const curatedJoined = DAILY_CURATED_NEWS_SCHEMA_STATEMENTS.join('\n');
  const discoveryJoined = EMERGING_TECH_SCHEMA_STATEMENTS.join('\n');
  const migrationJoined = TAXONOMY_MIGRATION_SCHEMA_STATEMENTS.join('\n');

  assert.match(aggregateJoined, /CREATE TABLE IF NOT EXISTS theme_trend_aggregates/i);
  assert.match(aggregateJoined, /CREATE TABLE IF NOT EXISTS theme_lifecycle_transitions/i);
  assert.match(aggregateJoined, /CREATE TABLE IF NOT EXISTS theme_evolution/i);
  assert.match(aggregateJoined, /ADD COLUMN IF NOT EXISTS parent_theme/i);
  assert.match(aggregateJoined, /ADD COLUMN IF NOT EXISTS category/i);

  assert.match(curatedJoined, /CREATE TABLE IF NOT EXISTS daily_curated_news/i);
  assert.match(curatedJoined, /importance_score DOUBLE PRECISION/i);
  assert.match(curatedJoined, /why_it_matters TEXT/i);
  assert.match(curatedJoined, /related_signals JSONB/i);

  assert.match(discoveryJoined, /ADD COLUMN IF NOT EXISTS normalized_theme/i);
  assert.match(discoveryJoined, /ADD COLUMN IF NOT EXISTS normalized_parent_theme/i);
  assert.match(discoveryJoined, /ADD COLUMN IF NOT EXISTS promotion_state/i);

  assert.match(migrationJoined, /ALTER TABLE articles\s+ADD COLUMN IF NOT EXISTS legacy_theme/i);
  assert.match(migrationJoined, /ALTER TABLE labeled_outcomes\s+ADD COLUMN IF NOT EXISTS parent_theme/i);
  assert.match(migrationJoined, /ALTER TABLE labeled_outcomes\s+ADD COLUMN IF NOT EXISTS taxonomy_version/i);
});
