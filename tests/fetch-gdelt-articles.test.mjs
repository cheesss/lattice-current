import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGdeltSeenDate } from '../scripts/fetch-gdelt-articles.mjs';

const fetchHistoricalSource = readFileSync(new URL('../scripts/fetch-historical-data.mjs', import.meta.url), 'utf8');

test('parseGdeltSeenDate supports compact GDELT timestamps', () => {
  assert.equal(parseGdeltSeenDate('20260415123045'), '2026-04-15T12:30:45.000Z');
});

test('parseGdeltSeenDate supports compact GDELT dates', () => {
  assert.equal(parseGdeltSeenDate('20260415'), '2026-04-15T00:00:00.000Z');
});

test('parseGdeltSeenDate falls back when the date is invalid', () => {
  assert.equal(
    parseGdeltSeenDate('not-a-date', new Date('2026-04-14T00:00:00Z')),
    '2026-04-14T00:00:00.000Z',
  );
});

test('GDELT document fetches use shared rate-limit state and fallback', () => {
  assert.match(fetchHistoricalSource, /GDELT_RATE_LIMIT_STATE_PATH/);
  assert.match(fetchHistoricalSource, /GDELT_RATE_LIMIT_LOCK_DIR/);
  assert.match(fetchHistoricalSource, /fetchGdeltWithFallback\(wrappedQuery, params\)/);
});
