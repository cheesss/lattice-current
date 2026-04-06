import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeCalibrationDiagnostic,
  summarizeCalibrationRows,
} from '../scripts/_shared/calibration-diagnostic.mjs';

test('summarizeCalibrationRows computes buckets, ECE, and warning state', () => {
  const summary = summarizeCalibrationRows([
    { predicted: 0.1, actual: 0 },
    { predicted: 0.3, actual: 1 },
    { predicted: 0.7, actual: 1 },
    { predicted: 0.9, actual: 0 },
  ]);

  assert.equal(summary.sampleSize, 4);
  assert.equal(summary.buckets.length, 5);
  assert.equal(typeof summary.ece, 'number');
  assert.equal(typeof summary.brierScore, 'number');
  assert.ok(summary.buckets.some((bucket) => bucket.count > 0));
});

test('computeCalibrationDiagnostic reads joined prediction rows from queryable', async () => {
  const diagnostic = await computeCalibrationDiagnostic({
    async query() {
      return {
        rows: [
          { predicted: 0.2, actual: 0 },
          { predicted: 0.4, actual: 1 },
          { predicted: 0.6, actual: 1 },
          { predicted: 0.8, actual: 0 },
        ],
      };
    },
  });

  assert.equal(diagnostic.sampleSize, 4);
  assert.equal(diagnostic.buckets.length, 5);
  assert.equal(typeof diagnostic.ece, 'number');
  assert.equal(typeof diagnostic.brierScore, 'number');
});
