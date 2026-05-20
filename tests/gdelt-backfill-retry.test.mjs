import assert from 'node:assert/strict';
import test from 'node:test';

process.env.GDELT_RATE_LIMIT_MS = '1';

const {
  drainGdeltRetryQueue,
  fetchGdeltArticles,
  recordGdeltRetry,
} = await import('../scripts/data-accumulator.mjs');

function response({ ok = true, status = 200, body = '{}' } = {}) {
  return {
    ok,
    status,
    async text() {
      return body;
    },
  };
}

test('GDELT fetch failure is recorded as retry queue item', async () => {
  const result = await fetchGdeltArticles({
    name: 'conflict',
    q: '(war OR missile)',
    start: '2026-01-01T00:00:00.000Z',
    end: '2026-01-02T00:00:00.000Z',
  }, {
    retries: 0,
    fetchImpl: async () => response({ ok: false, status: 503, body: 'temporary outage' }),
  });
  const state = {};
  recordGdeltRetry(state, { queryName: 'conflict', q: '(war OR missile)', start: result.start, end: result.end, lastError: result.error });

  assert.equal(result.ok, false);
  assert.equal(result.retryable, true);
  assert.equal(state.gdeltRetryQueue.length, 1);
  assert.equal(state.gdeltRetryQueue[0].lastError, 'HTTP 503');
});

test('GDELT empty 200 response is no-hit and not a retry', async () => {
  const result = await fetchGdeltArticles({
    name: 'economy',
    q: '(inflation OR recession)',
    start: '2026-01-01T00:00:00.000Z',
    end: '2026-01-02T00:00:00.000Z',
  }, {
    retries: 0,
    fetchImpl: async () => response({ body: JSON.stringify({ articles: [] }) }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.noHit, true);
  assert.equal(result.articles.length, 0);
});

test('GDELT retry drain respects limit and nextAttemptAt', async () => {
  const state = { gdeltRetryQueue: [] };
  recordGdeltRetry(state, {
    queryName: 'tech',
    q: '(semiconductor OR AI)',
    start: '2026-01-01T00:00:00.000Z',
    end: '2026-01-02T00:00:00.000Z',
    nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
  });
  recordGdeltRetry(state, {
    queryName: 'energy',
    q: '(oil OR gas)',
    start: '2026-01-01T00:00:00.000Z',
    end: '2026-01-02T00:00:00.000Z',
    nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
  });
  state.gdeltRetryQueue[0].nextAttemptAt = new Date(Date.now() - 1_000).toISOString();
  state.gdeltRetryQueue[1].nextAttemptAt = new Date(Date.now() + 60_000).toISOString();

  const summary = await drainGdeltRetryQueue(state, {
    limit: 1,
    retries: 0,
    fetchImpl: async () => response({ body: JSON.stringify({ articles: [] }) }),
  });

  assert.equal(summary.attempted, 1);
  assert.equal(summary.noHit, 1);
  assert.equal(state.gdeltRetryQueue.length, 1);
  assert.equal(state.gdeltRetryQueue[0].queryName, 'energy');
});
