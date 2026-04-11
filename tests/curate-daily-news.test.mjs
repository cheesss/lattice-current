import test from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs as parseCurateArgs } from '../scripts/curate-daily-news.mjs';
import { parseArgs as parseTrendArgs } from '../scripts/compute-trend-aggregates.mjs';

test('curate-daily-news parseArgs accepts tuning flags', () => {
  const parsed = parseCurateArgs([
    '--as-of', '2026-04-07',
    '--limit', '7',
    '--candidate-limit', '180',
    '--window-hours', '72',
    '--theme', 'ai-ml,quantum-computing',
    '--refresh-aggregates',
    '--no-codex',
  ]);

  assert.equal(parsed.asOf, '2026-04-07');
  assert.equal(parsed.limit, 7);
  assert.equal(parsed.candidateLimit, 180);
  assert.equal(parsed.windowHours, 72);
  assert.deepEqual(parsed.themes, ['ai-ml', 'quantum-computing']);
  assert.equal(parsed.refreshAggregates, true);
  assert.equal(parsed.noCodex, true);
});

test('compute-trend-aggregates parseArgs supports selective periods and history windows', () => {
  const parsed = parseTrendArgs([
    '--as-of', '2026-04-07',
    '--period', 'month,quarter',
    '--theme', 'ai-ml,space',
    '--history-month', '8',
    '--history-quarter', '6',
    '--dry-run',
  ]);

  assert.equal(parsed.asOf, '2026-04-07');
  assert.deepEqual(parsed.periodTypes, ['month', 'quarter']);
  assert.deepEqual(parsed.themes, ['ai-ml', 'space']);
  assert.equal(parsed.historyByPeriod.month, 8);
  assert.equal(parsed.historyByPeriod.quarter, 6);
  assert.equal(parsed.dryRun, true);
});
