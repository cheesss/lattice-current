import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateCandidateGate,
  evaluateShadowGate,
} from '../scripts/promote-nowcast-model.mjs';

test('evaluateCandidateGate: passes when gates satisfied', () => {
  const result = evaluateCandidateGate({
    holdout_mae: 0.08,
    baseline_mae: 0.15,
    coverage_90: 0.88,
    n_train: 150,
    n_holdout: 30,
  });
  assert.equal(result.passed, true);
  assert.match(result.reason, /candidate gates satisfied/);
  assert.ok(result.improvement > 0);
});

test('evaluateCandidateGate: fails when improvement < 15%', () => {
  const result = evaluateCandidateGate({
    holdout_mae: 0.14,        // 0.14 < 0.15 * 0.85 = 0.1275 → false
    baseline_mae: 0.15,
    coverage_90: 0.88,
    n_train: 150,
    n_holdout: 30,
  });
  assert.equal(result.passed, false);
  assert.match(result.reason, /holdout MAE/);
});

test('evaluateCandidateGate: fails when coverage below 0.80', () => {
  const result = evaluateCandidateGate({
    holdout_mae: 0.05,
    baseline_mae: 0.15,
    coverage_90: 0.72,
    n_train: 150,
    n_holdout: 30,
  });
  assert.equal(result.passed, false);
  assert.match(result.reason, /coverage 0.72/);
});

test('evaluateCandidateGate: fails when too few training rows', () => {
  const result = evaluateCandidateGate({
    holdout_mae: 0.05,
    baseline_mae: 0.15,
    coverage_90: 0.90,
    n_train: 60,
    n_holdout: 20,  // total 80 < 120
  });
  assert.equal(result.passed, false);
  assert.match(result.reason, /rows 80/);
});

test('evaluateShadowGate: passes when live MAE within 20% of holdout', () => {
  const result = evaluateShadowGate({
    liveMae: 0.10,
    coverage: 0.85,
    samples: 20,
    holdoutMae: 0.09,
  });
  assert.equal(result.passed, true);
  assert.match(result.reason, /shadow passed/);
});

test('evaluateShadowGate: fails when live MAE exceeds 20% tolerance', () => {
  const result = evaluateShadowGate({
    liveMae: 0.14,
    coverage: 0.85,
    samples: 20,
    holdoutMae: 0.09,  // tol = 0.108
  });
  assert.equal(result.passed, false);
});

test('evaluateShadowGate: fails when coverage slipped below 0.80', () => {
  const result = evaluateShadowGate({
    liveMae: 0.08,
    coverage: 0.75,
    samples: 20,
    holdoutMae: 0.09,
  });
  assert.equal(result.passed, false);
});

test('evaluateShadowGate: fails when samples < 10', () => {
  const result = evaluateShadowGate({
    liveMae: 0.05,
    coverage: 0.92,
    samples: 8,
    holdoutMae: 0.09,
  });
  assert.equal(result.passed, false);
  assert.match(result.reason, /insufficient reconciliation samples/);
});
