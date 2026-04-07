import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeWeeklyDigestPayload,
  parseArgs,
} from '../scripts/generate-weekly-digest.mjs';

test('generate-weekly-digest parseArgs applies defaults and overrides', () => {
  const defaults = parseArgs([]);
  assert.equal(defaults.topicLimit, 8);
  assert.equal(defaults.reportLimit, 8);

  const overridden = parseArgs(['--topic-limit', '5', '--report-limit', '3', '--as-of', '2026-04-05', '--codex-only']);
  assert.equal(overridden.topicLimit, 5);
  assert.equal(overridden.reportLimit, 3);
  assert.equal(overridden.asOf, '2026-04-05');
  assert.equal(overridden.codexOnly, true);
});

test('generate-weekly-digest normalizes digest payload with fallback', () => {
  const payload = normalizeWeeklyDigestPayload({
    headline: 'Photonics leads',
    summary: 'Optical AI is rising.',
    watchlist: ['Photonics', 'AI optics', '', null],
  }, {
    headline: 'Fallback headline',
    summary: 'Fallback summary',
    watchlist: ['Fallback'],
  });
  assert.equal(payload.headline, 'Photonics leads');
  assert.equal(payload.summary, 'Optical AI is rising.');
  assert.deepEqual(payload.watchlist, ['Photonics', 'AI optics']);
});

test('generate-weekly-digest falls back when arrays are missing', () => {
  const payload = normalizeWeeklyDigestPayload({}, {
    headline: 'Fallback headline',
    summary: 'Fallback summary',
    watchlist: ['Photonics', 'Compute'],
  });
  assert.equal(payload.headline, 'Fallback headline');
  assert.equal(payload.summary, 'Fallback summary');
  assert.deepEqual(payload.watchlist, ['Photonics', 'Compute']);
});
