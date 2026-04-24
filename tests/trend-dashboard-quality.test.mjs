import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inferCategory,
  sanitizeArticleSourceLabel,
} from '../scripts/_shared/trend-dashboard-queries.mjs';

test('trend dashboard maps broad taxonomy parents to useful categories', () => {
  assert.equal(inferCategory('technology'), 'technology');
  assert.equal(inferCategory('technology-general'), 'technology');
  assert.equal(inferCategory('ai-ml'), 'technology');
  assert.equal(inferCategory('macroeconomics'), 'macro');
  assert.equal(inferCategory('ai-ml', 'other'), 'technology');
  assert.equal(inferCategory('technology-general', 'other'), 'technology');
});

test('trend dashboard strips generated source suffixes and decodes source labels', () => {
  assert.equal(sanitizeArticleSourceLabel('BBC Business source'), 'BBC Business');
  assert.equal(sanitizeArticleSourceLabel('Air &amp; Space Forces Magazine'), 'Air & Space Forces Magazine');
  assert.equal(sanitizeArticleSourceLabel('TechCrunch&#8217;s feed source'), 'TechCrunch’s feed');
  assert.equal(sanitizeArticleSourceLabel('Codex E2E The Register source 20260422'), 'The Register');
});
