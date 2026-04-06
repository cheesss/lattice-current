import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTO_THEME_CONFIDENT_THRESHOLD,
  AUTO_THEME_UNCERTAIN_THRESHOLD,
  classifyAutoThemeCandidate,
  parseArgs,
} from '../scripts/auto-pipeline.mjs';

test('auto-pipeline parseArgs uses defaults when no args are provided', () => {
  const parsed = parseArgs([]);
  assert.deepEqual(parsed, {
    steps: [],
    since: null,
    limit: 10000,
  });
});

test('auto-pipeline parseArgs ignores invalid steps and invalid limits', () => {
  const parsed = parseArgs(['--step', '9', '--step', '3', '--limit', '-1', '--limit', '42.8']);
  assert.deepEqual(parsed.steps, [3]);
  assert.equal(parsed.limit, 42);
});

test('auto-pipeline classifies confident, uncertain, and unknown theme matches with shared thresholds', () => {
  const confident = classifyAutoThemeCandidate('energy', AUTO_THEME_CONFIDENT_THRESHOLD);
  const uncertain = classifyAutoThemeCandidate('conflict', AUTO_THEME_UNCERTAIN_THRESHOLD);
  const unknown = classifyAutoThemeCandidate('economy', AUTO_THEME_UNCERTAIN_THRESHOLD - 0.01);

  assert.deepEqual(confident, {
    autoTheme: 'energy',
    confidence: AUTO_THEME_CONFIDENT_THRESHOLD,
    tier: 'confident',
  });
  assert.deepEqual(uncertain, {
    autoTheme: 'conflict',
    confidence: AUTO_THEME_UNCERTAIN_THRESHOLD,
    tier: 'uncertain',
  });
  assert.deepEqual(unknown, {
    autoTheme: 'unknown',
    confidence: AUTO_THEME_UNCERTAIN_THRESHOLD - 0.01,
    tier: 'unknown',
  });
});

test('auto-pipeline classification handles empty candidates without throwing', () => {
  const empty = classifyAutoThemeCandidate('', Number.NaN);
  assert.deepEqual(empty, {
    autoTheme: 'unknown',
    confidence: 0,
    tier: 'unknown',
  });
});
