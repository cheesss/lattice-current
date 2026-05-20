import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRegimeScenarioPayload,
  classifyRegime,
} from '../scripts/_shared/ai-analysis-builder.mjs';

function fakePool() {
  return {
    calls: [],
    async query(_sql, params) {
      this.calls.push(params);
      return {
        rows: [{
          theme: 'macroeconomics',
          symbol: 'SPY',
          horizon: '2w',
          regime: params[0],
          sample_size: 24,
          avg_return: 1.2,
          hit_rate: 0.58,
          regime_multiplier: 1.1,
        }],
      };
    },
  };
}

test('regime scenario uses yield curve and oil shock, not only VIX', () => {
  assert.equal(
    classifyRegime({ vix: 14, yieldSpread: 1.6, oilPrice: 66 }).regime,
    'risk-on-strong',
  );
  assert.equal(
    classifyRegime({ vix: 14, yieldSpread: -0.8, oilPrice: 140 }).regime,
    'risk-off',
  );
  assert.equal(
    classifyRegime({ vix: 19, yieldSpread: 0.5, oilPrice: 92 }).regime,
    'balanced',
  );
  assert.equal(
    classifyRegime({ vix: 32, yieldSpread: 1.6, oilPrice: 66 }).regime,
    'crisis',
  );
});

test('regime scenario payload queries the regime implied by all sliders', async () => {
  const pool = fakePool();
  const payload = await buildRegimeScenarioPayload(pool, {
    vix: 14,
    yieldSpread: -0.8,
    oilPrice: 140,
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.targetRegime, 'risk-off');
  assert.equal(pool.calls[0][0], 'risk-off');
  assert.ok(Array.isArray(payload.regimeDrivers));
  assert.ok(payload.regimeDrivers.some((driver) => driver.input === 'yieldSpread'));
  assert.ok(payload.regimeDrivers.some((driver) => driver.input === 'oilPrice'));
});
