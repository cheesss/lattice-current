import test from 'node:test';
import assert from 'node:assert/strict';

import { fuseNowcastsIntoLookup } from '../scripts/event-dashboard-api.mjs';

test('fuseNowcastsIntoLookup never overrides an observed value', () => {
  const result = fuseNowcastsIntoLookup({
    lookup: { vix: 18.5 },
    originMap: { vix: { valueOrigin: 'observed', writerId: 'refresh-market-quotes' } },
    nowcasts: {
      vix: {
        estimated_value: 22.0,
        estimate_method: 'vix-nowcast-v1',
        estimate_confidence: 0.8,
        interval_low: 21.0,
        interval_high: 23.0,
        target_ts: '2026-04-17T10:00:00Z',
        created_at: '2026-04-17T10:05:00Z',
      },
    },
  });
  assert.equal(result.lookup.vix, 18.5); // observed wins
  assert.equal(result.originMap.vix.valueOrigin, 'observed');
  assert.equal(result.anyEstimated, false);
  assert.deepEqual(result.nowcastSummary, {});
});

test('fuseNowcastsIntoLookup fills in estimated when observed absent', () => {
  const result = fuseNowcastsIntoLookup({
    lookup: {},
    originMap: {},
    nowcasts: {
      hy_credit_spread: {
        estimated_value: 2.87,
        estimate_method: 'hy-ridge-v1',
        estimate_confidence: 0.78,
        interval_low: 2.83,
        interval_high: 2.91,
      },
    },
  });
  assert.equal(result.lookup.hy_credit_spread, 2.87);
  assert.equal(result.originMap.hy_credit_spread.valueOrigin, 'estimated');
  assert.equal(result.anyEstimated, true);
  assert.equal(result.nowcastSummary.hy_credit_spread.method, 'hy-ridge-v1');
  assert.equal(result.nowcastSummary.hy_credit_spread.intervalLow, 2.83);
});

test('fuseNowcastsIntoLookup replaces proxy value with estimated', () => {
  // marketStress may exist as proxy (GDELT). Nowcast composite takes over.
  const result = fuseNowcastsIntoLookup({
    lookup: { marketStress: 0.30 },
    originMap: { marketStress: { valueOrigin: 'proxy', writerId: 'master-pipeline-step0-gdelt' } },
    nowcasts: {
      marketStress: {
        estimated_value: 0.13,
        estimate_method: 'composite-vix-hy-yld',
        estimate_confidence: 0.80,
        interval_low: 0.10,
        interval_high: 0.16,
      },
    },
  });
  assert.equal(result.lookup.marketStress, 0.13);
  assert.equal(result.originMap.marketStress.valueOrigin, 'estimated');
  assert.equal(result.anyEstimated, true);
});

test('fuseNowcastsIntoLookup skips nowcasts with non-finite values', () => {
  const result = fuseNowcastsIntoLookup({
    lookup: {},
    originMap: {},
    nowcasts: {
      broken_signal: { estimated_value: 'oops', estimate_method: 'x' },
    },
  });
  assert.deepEqual(result.lookup, {});
  assert.equal(result.anyEstimated, false);
});

test('fuseNowcastsIntoLookup handles empty inputs gracefully', () => {
  const result = fuseNowcastsIntoLookup({});
  assert.deepEqual(result.lookup, {});
  assert.deepEqual(result.originMap, {});
  assert.deepEqual(result.nowcastSummary, {});
  assert.equal(result.anyEstimated, false);
});

test('anyEstimated is true only when some origin ends up estimated', () => {
  const allObserved = fuseNowcastsIntoLookup({
    lookup: { vix: 19, hy_credit_spread: 2.8 },
    originMap: {
      vix: { valueOrigin: 'observed' },
      hy_credit_spread: { valueOrigin: 'observed' },
    },
    nowcasts: {},
  });
  assert.equal(allObserved.anyEstimated, false);

  const mixed = fuseNowcastsIntoLookup({
    lookup: { vix: 19 },
    originMap: { vix: { valueOrigin: 'observed' } },
    nowcasts: {
      hy_credit_spread: { estimated_value: 2.85, estimate_method: 'x', estimate_confidence: 0.8 },
    },
  });
  assert.equal(mixed.anyEstimated, true);
});
