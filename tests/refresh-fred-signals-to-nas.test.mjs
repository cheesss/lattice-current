import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDerivedMarketStress,
  latestFredObservation,
  parseFredCsv,
} from '../scripts/refresh-fred-signals-to-nas.mjs';

test('parseFredCsv extracts valid FRED observations and skips missing values', () => {
  const rows = parseFredCsv(`observation_date,T10Y2Y
2026-04-09,0.51
2026-04-10,.
2026-04-13,0.52
`, { seriesId: 'T10Y2Y', signalName: 'yieldSpread' });

  assert.deepEqual(rows, [
    {
      seriesId: 'T10Y2Y',
      signalName: 'yieldSpread',
      observationDate: '2026-04-09',
      value: 0.51,
    },
    {
      seriesId: 'T10Y2Y',
      signalName: 'yieldSpread',
      observationDate: '2026-04-13',
      value: 0.52,
    },
  ]);
});

test('latestFredObservation returns the newest observation date', () => {
  const latest = latestFredObservation([
    { observationDate: '2026-04-09', value: 0.51 },
    { observationDate: '2026-04-14', value: 0.50 },
    { observationDate: '2026-04-13', value: 0.52 },
  ]);

  assert.equal(latest.observationDate, '2026-04-14');
  assert.equal(latest.value, 0.50);
});

test('computeDerivedMarketStress uses observed VIX, credit, and curve inputs', () => {
  const stress = computeDerivedMarketStress({
    vix: 18.18,
    hyCreditSpread: 2.84,
    yieldSpread: 0.50,
  });

  assert.equal(stress, 0.1342);
});

test('computeDerivedMarketStress returns null when a component is missing', () => {
  assert.equal(computeDerivedMarketStress({ vix: 18.18, hyCreditSpread: 2.84 }), null);
});
