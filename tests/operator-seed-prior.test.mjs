import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadOperatorSeedPrior,
  validateOperatorSeedPrior,
} from '../scripts/_shared/mechanism-seed-generator.mjs';

test('operator seed prior loads with scoring weights and source coverage expectations', () => {
  const prior = loadOperatorSeedPrior();
  assert.equal(prior.version, 'operator-seed-prior-v1');
  assert.equal(prior.prefer.includes('physical bottleneck'), true);
  assert.equal(prior.penalize.includes('generic theme narrative'), true);
  assert.equal(Number.isFinite(prior.scoringWeights.physical_linkage), true);
  assert.equal(Number.isFinite(prior.scoringWeights.counter_evidence_risk_penalty), true);
  assert.equal(prior.sourceCoverageExpectations.require_counter_evidence_query, true);
  assert.deepEqual(validateOperatorSeedPrior(prior), { ok: true });
});

test('operator seed prior keeps score thresholds configurable instead of hard readiness gates', () => {
  const prior = loadOperatorSeedPrior();
  assert.equal(Number.isFinite(prior.statusThresholds.needs_evidence_min), true);
  assert.equal(Number.isFinite(prior.statusThresholds.ranking_high_min), true);
  assert.equal(prior.statusThresholds.ranking_high_min > prior.statusThresholds.needs_evidence_min, true);
});
