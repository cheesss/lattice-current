import test from 'node:test';
import assert from 'node:assert/strict';

import { classifySignalQuality, withMeta } from '../scripts/event-dashboard-api.mjs';

test('withMeta separates wrapper generation time from data freshness time', () => {
  const publishedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const payload = withMeta({
    events: [
      { title: 'Recent source item', publishedAt },
    ],
  });

  assert.ok(payload.meta.generatedAt);
  assert.equal(payload.meta.dataUpdatedAt, publishedAt);
  assert.equal(payload.meta.updatedAt, publishedAt);
  assert.notEqual(payload.meta.generatedAt, payload.meta.updatedAt);
  assert.equal(payload.meta.mode, 'live');
  assert.equal(payload.meta.stale, false);
});

test('withMeta marks fallback windows stale even when data timestamp is recent', () => {
  const publishedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const payload = withMeta({
    events: [
      { title: 'Fallback source item', publishedAt },
    ],
    meta: {
      window: '7d-fallback',
    },
  });

  assert.equal(payload.meta.mode, 'fallback');
  assert.equal(payload.meta.window, '7d-fallback');
  assert.equal(payload.meta.dataUpdatedAt, publishedAt);
  assert.equal(payload.meta.stale, true);
  assert.match(payload.meta.staleReason, /fallback/i);
});

test('withMeta marks cache hits with explicit cache mode and cacheHit flag', () => {
  const updatedAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const payload = withMeta({
    items: [
      { title: 'Cached item', updatedAt },
    ],
  }, {
    cacheHit: true,
    stale: true,
    cacheReason: 'empty payload',
  });

  assert.equal(payload.meta.mode, 'cache');
  assert.equal(payload.meta.cacheHit, true);
  assert.equal(payload.meta.stale, true);
  assert.equal(payload.meta.cacheReason, 'empty payload');
  assert.equal(payload.meta.dataUpdatedAt, updatedAt);
});

test('withMeta adds staleReason when data age exceeds the mode threshold', () => {
  const updatedAt = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
  const payload = withMeta({
    items: [
      { title: 'Old live item', updatedAt },
    ],
  }, {
    mode: 'live',
    maxAgeHours: 48,
  });

  assert.equal(payload.meta.mode, 'live');
  assert.equal(payload.meta.stale, true);
  assert.match(payload.meta.staleReason, /exceeds 48h live threshold/);
});

test('classifySignalQuality flags repeated recent samples as mirrored', () => {
  const value = 19.23;
  const samples = Array.from({ length: 8 }, (_, index) => ({
    ts: new Date(Date.now() - index * 60 * 60 * 1000).toISOString(),
    value,
  }));
  const quality = classifySignalQuality('vix', samples[0], samples);

  assert.equal(quality.status, 'mirrored');
  assert.equal(quality.mirrored, true);
  assert.equal(quality.stale, false);
  assert.equal(quality.repeatedCount, 8);
});

test('classifySignalQuality flags old observations as stale', () => {
  const oldTs = new Date(Date.now() - 130 * 60 * 60 * 1000).toISOString();
  const quality = classifySignalQuality('oilPrice', { ts: oldTs, value: 114.01 }, [
    { ts: oldTs, value: 114.01 },
  ]);

  assert.equal(quality.status, 'stale');
  assert.equal(quality.stale, true);
  assert.match(quality.reason, /exceeds 120h threshold/);
});

test('classifySignalQuality gives daily FRED spread signals a 72h live window', () => {
  const dailyTs = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
  const quality = classifySignalQuality('yieldSpread', { ts: dailyTs, value: 0.54 }, [
    { ts: dailyTs, value: 0.54 },
  ]);
  assert.equal(quality.status, 'observed');
  assert.equal(quality.stale, false);

  const staleTs = new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString();
  const stale = classifySignalQuality('hy_credit_spread', { ts: staleTs, value: 2.87 }, [
    { ts: staleTs, value: 2.87 },
  ]);
  assert.equal(stale.status, 'stale');
  assert.match(stale.reason, /exceeds 72h threshold/);
});

test('withMeta derives valueOrigin=observed for live mode', () => {
  const updatedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const payload = withMeta({
    items: [{ updatedAt }],
  });
  assert.equal(payload.meta.mode, 'live');
  assert.equal(payload.meta.valueOrigin, 'observed');
  assert.equal(payload.meta.validAsOf, updatedAt);
});

test('withMeta derives valueOrigin=estimated for nowcast mode', () => {
  const updatedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const payload = withMeta({
    items: [{ updatedAt }],
  }, {
    mode: 'nowcast',
  });
  assert.equal(payload.meta.mode, 'nowcast');
  assert.equal(payload.meta.valueOrigin, 'estimated');
});

test('withMeta derives valueOrigin=research for cache/fallback/backfill modes', () => {
  const updatedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  for (const mode of ['cache', 'fallback', 'backfill', 'replay']) {
    const payload = withMeta({ items: [{ updatedAt }] }, { mode });
    assert.equal(payload.meta.valueOrigin, 'research', `mode=${mode}`);
  }
});

test('withMeta marks mirrored mode as stale with explicit reason', () => {
  const updatedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const payload = withMeta({ items: [{ updatedAt }] }, { mode: 'mirrored' });
  assert.equal(payload.meta.mode, 'mirrored');
  assert.equal(payload.meta.valueOrigin, 'research');
  assert.equal(payload.meta.stale, true);
  assert.match(payload.meta.staleReason, /mirrored/i);
});

test('withMeta rejects unknown mode values and falls back to live', () => {
  const updatedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const payload = withMeta({ items: [{ updatedAt }] }, { mode: 'bogus-mode-xyz' });
  assert.equal(payload.meta.mode, 'live');
  assert.equal(payload.meta.valueOrigin, 'observed');
});

test('withMeta marks nowcast stale after 6h threshold', () => {
  const updatedAt = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
  const payload = withMeta({ items: [{ updatedAt }] }, { mode: 'nowcast' });
  assert.equal(payload.meta.stale, true);
  assert.match(payload.meta.staleReason, /exceeds 6h nowcast threshold/);
});

test('withMeta respects explicit validAsOf over dataUpdatedAt', () => {
  const updatedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const validAsOf = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const payload = withMeta({ items: [{ updatedAt }] }, { validAsOf });
  assert.equal(payload.meta.validAsOf, validAsOf);
  assert.equal(payload.meta.dataUpdatedAt, updatedAt);
});

test('classifySignalQuality recognises proxy value_origin', () => {
  const ts = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const quality = classifySignalQuality(
    'marketStress',
    { ts, value: 0.13, value_origin: 'proxy', writer_id: 'master-pipeline-step0-gdelt' },
    [{ ts, value: 0.13 }],
  );
  assert.equal(quality.status, 'proxy');
  assert.equal(quality.valueOrigin, 'proxy');
  assert.equal(quality.writerId, 'master-pipeline-step0-gdelt');
  assert.match(quality.reason, /proxy/);
});

test('classifySignalQuality recognises composite value_origin', () => {
  const ts = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
  const quality = classifySignalQuality(
    'marketStress',
    { ts, value: 0.14, value_origin: 'composite', writer_id: 'refresh-fred-marketstress-composite' },
    [{ ts, value: 0.14 }],
  );
  assert.equal(quality.status, 'composite');
  assert.equal(quality.valueOrigin, 'composite');
});

test('classifySignalQuality keeps observed status when value_origin absent', () => {
  const ts = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
  const quality = classifySignalQuality(
    'vix',
    { ts, value: 18.4 },
    [{ ts, value: 18.4 }, { ts: new Date(Date.now() - 2*60*60*1000).toISOString(), value: 18.1 }],
  );
  assert.equal(quality.status, 'observed');
  assert.equal(quality.valueOrigin, 'observed');
});
