import test from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs as parseAutoPipelineArgs } from '../scripts/auto-pipeline.mjs';
import { scoreThemeSymbolMappings } from '../scripts/_shared/theme-symbol-quality.mjs';

test('auto-pipeline accepts repeated --step arguments', () => {
  const parsed = parseAutoPipelineArgs(['--step', '3', '--step', '5', '--limit', '200', '--since', '2025-01-01']);
  assert.deepEqual(parsed.steps, [3, 5]);
  assert.equal(parsed.limit, 200);
  assert.equal(parsed.since, '2025-01-01');
});

test('generic high-volatility symbols are penalized without symbol-specific hacks', () => {
  const rows = [
    { theme: 'conflict', symbol: 'BDRY', reaction_count: 90, reaction_ratio: 1.18, event_hit_rate: 0.51, baseline_hit_rate: 0.5, event_avg_return: 0.22, baseline_avg_return: 0.18 },
    { theme: 'economy', symbol: 'BDRY', reaction_count: 88, reaction_ratio: 1.16, event_hit_rate: 0.5, baseline_hit_rate: 0.49, event_avg_return: 0.2, baseline_avg_return: 0.18 },
    { theme: 'tech', symbol: 'NVDA', reaction_count: 70, reaction_ratio: 1.42, event_hit_rate: 0.62, baseline_hit_rate: 0.51, event_avg_return: 1.8, baseline_avg_return: 0.7 },
    { theme: 'conflict', symbol: 'ITA', reaction_count: 65, reaction_ratio: 1.32, event_hit_rate: 0.59, baseline_hit_rate: 0.51, event_avg_return: 1.1, baseline_avg_return: 0.4 },
  ];

  const scored = scoreThemeSymbolMappings(rows);
  const bdryConflict = scored.find((row) => row.symbol === 'BDRY' && row.theme === 'conflict');
  const nvdaTech = scored.find((row) => row.symbol === 'NVDA' && row.theme === 'tech');

  assert.ok(bdryConflict);
  assert.ok(nvdaTech);
  assert.equal(bdryConflict.eligible, false);
  assert.equal(nvdaTech.eligible, true);
  assert.ok(bdryConflict.generic_penalty > nvdaTech.generic_penalty);
  assert.ok(nvdaTech.quality_score > bdryConflict.quality_score);
});
