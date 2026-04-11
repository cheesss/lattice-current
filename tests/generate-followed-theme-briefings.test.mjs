import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseArgs,
  runGenerateFollowedThemeBriefingsJob,
  selectDefaultFollowedThemes,
} from '../scripts/generate-followed-theme-briefings.mjs';

test('generate-followed-theme-briefings parses explicit args', () => {
  const parsed = parseArgs([
    '--themes', 'quantum-computing, ai-ml',
    '--period', 'month',
    '--limit', '4',
    '--snapshot-date', '2026-04-07',
    '--dry-run',
  ]);

  assert.deepEqual(parsed.themes, ['quantum-computing', 'ai-ml']);
  assert.equal(parsed.period, 'month');
  assert.equal(parsed.limit, 4);
  assert.equal(parsed.snapshotDate, '2026-04-07');
  assert.equal(parsed.dryRun, true);
});

test('selectDefaultFollowedThemes prefers aggregate-ranked themes and falls back cleanly', async () => {
  const selected = await selectDefaultFollowedThemes({
    query: async () => ({
      rows: [
        { theme: 'quantum-computing' },
        { theme: 'ai-ml' },
        { theme: 'unknown' },
      ],
    }),
  }, 'week', 4);

  assert.deepEqual(selected.slice(0, 2), ['quantum-computing', 'ai-ml']);
  assert.equal(selected.length, 4);

  const fallback = await selectDefaultFollowedThemes({
    query: async () => {
      throw new Error('table unavailable');
    },
  }, 'week', 3);

  assert.equal(fallback.length, 3);
});

test('runGenerateFollowedThemeBriefingsJob builds snapshot payload with refresh semantics', async () => {
  const seen = { params: null };
  const fakeClient = {
    query: async () => ({ rows: [{ theme: 'quantum-computing' }, { theme: 'ai-ml' }] }),
  };

  const summary = await runGenerateFollowedThemeBriefingsJob({
    period: 'week',
    limit: 2,
    dryRun: true,
  }, {
    client: fakeClient,
    buildBriefingPayload: async (_safeQuery, params) => {
      seen.params = params;
      return {
        periodType: 'week',
        themeCount: 2,
        themes: ['quantum-computing', 'ai-ml'],
        headline: 'Weekly structural briefing for 2 followed themes.',
        items: [{ theme: 'quantum-computing' }, { theme: 'ai-ml' }],
        snapshot: {
          persisted: false,
          snapshotDate: '2026-04-07',
        },
      };
    },
  });

  assert.equal(summary.ok, true);
  assert.equal(summary.dryRun, true);
  assert.equal(summary.themeCount, 2);
  assert.equal(summary.itemCount, 2);
  assert.ok(seen.params instanceof URLSearchParams);
  assert.equal(seen.params.get('refresh'), '1');
  assert.equal(seen.params.get('persist'), '0');
  assert.equal(seen.params.get('period'), 'week');
  assert.equal(seen.params.get('themes'), 'quantum-computing,ai-ml');
});
