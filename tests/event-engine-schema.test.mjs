import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REGIME_TABLE_SQL,
  WHATIF_TABLE_SQL,
  REGIME_CASE_SQL,
  classifyRegimeFromSignals,
  computeHawkesDecayPerDay,
  computeWhatIfSharpeRatio,
} from '../scripts/event-engine-full-build.mjs';

test('event-engine classifies crisis and risk regimes from signal inputs', () => {
  assert.equal(classifyRegimeFromSignals({
    vix: 31,
    hyCreditSpread: 5.2,
    hyWindowMean: 3.0,
    hyWindowStd: 1.0,
  }), 'crisis');

  assert.equal(classifyRegimeFromSignals({
    vix: 27,
    hyCreditSpread: 3.4,
    hyWindowMean: 3.0,
    hyWindowStd: 1.0,
  }), 'risk-off');

  assert.equal(classifyRegimeFromSignals({
    vix: 15,
    hyCreditSpread: 1.4,
    hyWindowMean: 2.5,
    hyWindowStd: 1.0,
  }), 'risk-on-strong');

  assert.equal(classifyRegimeFromSignals({
    vix: 16,
    hyCreditSpread: 2.7,
    hyWindowMean: 2.5,
    hyWindowStd: 1.0,
  }), 'risk-on');
});

test('event-engine Hawkes decay helper matches configured half-life math', () => {
  const decay = computeHawkesDecayPerDay(7);
  assert.ok(Math.abs(decay - (0.693 / 7)) < 1e-12);
});

test('event-engine what-if Sharpe helper annualizes pnl dispersion', () => {
  const pnls = [0.2, 0.1, -0.05, 0.15, 0.05];
  const mean = pnls.reduce((sum, value) => sum + value, 0) / pnls.length;
  const variance = pnls.reduce((sum, value) => sum + (value - mean) ** 2, 0) / pnls.length;
  const expected = (mean / Math.sqrt(variance)) * Math.sqrt(52);

  assert.ok(Math.abs(computeWhatIfSharpeRatio(pnls, 52) - expected) < 1e-12);
  assert.equal(computeWhatIfSharpeRatio([], 52), 0);
});

test('event-engine schema SQL includes anomaly feedback and expected table names', () => {
  assert.match(REGIME_TABLE_SQL, /anomaly_rate DOUBLE PRECISION DEFAULT 0/);
  assert.match(REGIME_TABLE_SQL, /CREATE TABLE IF NOT EXISTS regime_conditional_impact/);
  assert.match(WHATIF_TABLE_SQL, /CREATE TABLE IF NOT EXISTS whatif_simulations/);
  assert.match(REGIME_CASE_SQL, /risk-on-strong/);
  assert.match(REGIME_CASE_SQL, /crisis/);
});
