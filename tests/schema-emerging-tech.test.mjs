import test from 'node:test';
import assert from 'node:assert/strict';

import { EMERGING_TECH_SCHEMA_STATEMENTS } from '../scripts/_shared/schema-emerging-tech.mjs';

test('emerging-tech schema defines discovery topics, reports, and backfill state tables', () => {
  const joined = EMERGING_TECH_SCHEMA_STATEMENTS.join('\n');
  assert.match(joined, /CREATE TABLE IF NOT EXISTS discovery_topics/i);
  assert.match(joined, /CREATE TABLE IF NOT EXISTS discovery_topic_articles/i);
  assert.match(joined, /CREATE TABLE IF NOT EXISTS tech_reports/i);
  assert.match(joined, /CREATE TABLE IF NOT EXISTS backfill_state/i);
  assert.match(joined, /source_quality_score DOUBLE PRECISION/i);
  assert.match(joined, /source_quality_breakdown JSONB/i);
  assert.match(joined, /ALTER TABLE discovery_topics[\s\S]*ADD COLUMN IF NOT EXISTS source_quality_score/i);
  assert.match(joined, /ALTER TABLE discovery_topics[\s\S]*ADD COLUMN IF NOT EXISTS source_quality_breakdown/i);
  assert.match(joined, /ALTER TABLE tech_reports[\s\S]*ADD COLUMN IF NOT EXISTS source_quality_score/i);
  assert.match(joined, /status IN \('pending', 'labeled', 'reported', 'expired'\)/i);
});
