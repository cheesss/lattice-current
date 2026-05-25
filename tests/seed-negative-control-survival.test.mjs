import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateNegativeControlSurvival } from '../scripts/_shared/seed-bias-diagnostics.mjs';

test('negative-control invalidator rejects seed survival', () => {
  const seeds = [{
    seedId: 'msd-neg',
    seedTitle: 'capacity seed',
    bottleneck: { label: 'capacity bottleneck', class: 'supplier_capacity' },
    counterEvidenceQueries: ['easy substitute supplier redundancy'],
  }];
  const result = evaluateNegativeControlSurvival(seeds, [{
    operatorSeedId: 'msd-neg',
    evidenceClass: 'negative_control',
    summary: 'easy substitute and supplier redundancy invalidator',
  }]);
  assert.equal(result.items[0].survivalStatus, 'REJECTED');
  assert.equal(result.negativeControlSurvivalRate, 0);
});

test('negative-control supported constraint survives but remains separate from promotion', () => {
  const seeds = [{ seedId: 'msd-survive', bottleneck: { label: 'constraint', class: 'supplier_capacity' } }];
  const result = evaluateNegativeControlSurvival(seeds, [{
    operatorSeedId: 'msd-survive',
    evidenceClass: 'negative_control',
    summary: 'supported_constraint no direct invalidator found',
  }]);
  assert.equal(result.items[0].survivalStatus, 'SURVIVED');
  assert.equal(result.negativeControlSurvivalRate, 1);
});

test('negative-control checked no direct invalidator is closed but not promotion evidence', () => {
  const seeds = [{ seedId: 'msd-checked', bottleneck: { label: 'constraint', class: 'supplier_capacity' } }];
  const result = evaluateNegativeControlSurvival(seeds, [{
    operatorSeedId: 'msd-checked',
    evidenceClass: 'negative_control',
    summary: 'checked_no_direct no direct invalidator after substitute and redundancy search',
  }]);
  assert.equal(result.items[0].survivalStatus, 'CHECKED_NO_DIRECT');
  assert.equal(result.negativeControlSurvivalRate, 1);
});
