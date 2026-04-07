import test from 'node:test';
import assert from 'node:assert/strict';

import { ALLOWED_BACKFILL_SOURCES, validateBackfillArgs } from '../scripts/_shared/backfill-whitelist.mjs';

test('backfill whitelist includes executable sources', () => {
  assert.ok(ALLOWED_BACKFILL_SOURCES.hackernews);
  assert.ok(ALLOWED_BACKFILL_SOURCES.arxiv);
  assert.ok(ALLOWED_BACKFILL_SOURCES['gdelt-articles']);
  assert.ok(ALLOWED_BACKFILL_SOURCES['guardian-keyword']);
});

test('validateBackfillArgs normalizes arxiv requests', () => {
  const result = validateBackfillArgs('arxiv', {
    categories: ['cs.AI', 'cs.LG'],
    from: '2024-01-01',
    limit: 8000,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.categories, ['cs.AI', 'cs.LG']);
  assert.equal(result.value.limit, 8000);
});

test('validateBackfillArgs rejects missing required arguments', () => {
  const result = validateBackfillArgs('guardian-keyword', { from: '2024-01-01' });
  assert.equal(result.ok, false);
  assert.match(result.error, /missing required arg 'query'/i);
});
