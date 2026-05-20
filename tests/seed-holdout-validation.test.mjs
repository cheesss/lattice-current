import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateHoldoutValidation } from '../scripts/_shared/seed-bias-diagnostics.mjs';

test('holdout source confirmation increases holdoutConfirmationRate', () => {
  const seeds = [{
    seedId: 'msd-holdout',
    seedTitle: 'queue bottleneck',
    theme: { key: 'clean-energy', label: 'Clean Energy' },
    requiredInputs: ['transformer'],
    bottleneck: { label: 'transformer queue bottleneck', class: 'power_constraint' },
    expectedEvidenceClasses: ['power_constraint'],
  }];
  const result = evaluateHoldoutValidation(seeds, [{
    title: 'Official utility filing confirms transformer queue bottleneck',
    evidenceClass: 'power_constraint',
    summary: 'transformer queue bottleneck confirmed by holdout utility filing',
  }]);
  assert.equal(result.holdoutConfirmationRate, 1);
  assert.equal(result.items[0].confirmed, true);
  assert.deepEqual(result.items[0].matchedEvidenceClasses, ['power_constraint']);
});
