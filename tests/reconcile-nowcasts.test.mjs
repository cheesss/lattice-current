import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyReconciliation,
  classifyDriftAlert,
} from '../scripts/reconcile-nowcasts.mjs';

test('classifyReconciliation: small absError → good bucket', () => {
  const result = classifyReconciliation({
    predicted: 2.85,
    observed: 2.86,
    intervalLow: 2.80,
    intervalHigh: 2.90,
  });
  assert.ok(Math.abs(result.absError - 0.01) < 1e-9);
  assert.equal(result.calibrationBucket, 'good');
  assert.equal(result.withinInterval, true);
  assert.ok(result.pctError > 0 && result.pctError < 0.01);
});

test('classifyReconciliation: observation outside interval', () => {
  const result = classifyReconciliation({
    predicted: 2.85,
    observed: 3.05,        // absError 0.20 → 'poor' bucket
    intervalLow: 2.80,
    intervalHigh: 2.90,
  });
  assert.equal(result.withinInterval, false);
  assert.equal(result.calibrationBucket, 'poor');
});

test('classifyReconciliation: bad bucket for large error', () => {
  const result = classifyReconciliation({
    predicted: 2.0,
    observed: 2.5,
    intervalLow: 1.8,
    intervalHigh: 2.2,
  });
  assert.equal(result.calibrationBucket, 'bad');
  assert.equal(result.withinInterval, false);
});

test('classifyReconciliation: pctError is null when observed=0', () => {
  // observed=0 is still inside [-0.05, 0.05], so withinInterval=true
  const result = classifyReconciliation({
    predicted: 0.1,
    observed: 0,
    intervalLow: -0.05,
    intervalHigh: 0.05,
  });
  assert.equal(result.pctError, null);
  assert.equal(result.withinInterval, true);
});

test('classifyReconciliation: withinInterval=null when bounds missing', () => {
  const result = classifyReconciliation({
    predicted: 1.0,
    observed: 1.05,
    intervalLow: null,
    intervalHigh: null,
  });
  assert.equal(result.withinInterval, null);
});

test('classifyDriftAlert: no alert when coverage healthy', () => {
  const decision = classifyDriftAlert({ coverage: 0.85, samples: 30 });
  assert.equal(decision.alert, false);
});

test('classifyDriftAlert: warning when coverage between critical and hard floor', () => {
  const decision = classifyDriftAlert({ coverage: 0.62, samples: 30 });
  assert.equal(decision.alert, true);
  assert.equal(decision.severity, 'warning');
});

test('classifyDriftAlert: critical when coverage below 0.50', () => {
  const decision = classifyDriftAlert({ coverage: 0.40, samples: 30 });
  assert.equal(decision.alert, true);
  assert.equal(decision.severity, 'critical');
});

test('classifyDriftAlert: suppressed when samples < 5', () => {
  const decision = classifyDriftAlert({ coverage: 0.30, samples: 3 });
  assert.equal(decision.alert, false);
  assert.match(decision.reason, /too few samples/);
});

test('classifyDriftAlert: suppressed when coverage missing', () => {
  const decision = classifyDriftAlert({ coverage: null, samples: 30 });
  assert.equal(decision.alert, false);
  assert.match(decision.reason, /missing/);
});
