import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRouteAwareSeedEvidencePlan } from '../scripts/_shared/seed-evidence-plan.mjs';

test('adjacent-lane incompatible evidence classes are removed for target theme', () => {
  const seed = {
    seedId: 'msd-contam',
    seedTitle: 'AI grid queue',
    theme: { key: 'ai-ml', label: 'AI / Machine Learning' },
    growthDriver: 'AI data center buildout',
    realActivity: 'utility interconnection',
    physicalProcess: 'grid interconnection process',
    requiredInputs: ['transformers'],
    bottleneck: { label: 'grid interconnection queue', class: 'power_constraint', mechanism: 'utility queue delay' },
    supplierCategory: { label: 'grid supplier', publicIssuerCandidates: [] },
    evidenceQueries: ['grid queue technical qualification'],
    counterEvidenceQueries: ['no timing pressure'],
    expectedEvidenceClasses: ['mechanism_validation', 'power_constraint', 'mission_award', 'propulsion_constraint'],
    lineage: { source: 'adjacent_lane', sourceIds: ['adjacent-defense-source'] },
  };
  const plan = buildRouteAwareSeedEvidencePlan(seed);
  assert.equal(plan.evidenceClasses.includes('mission_award'), false);
  assert.equal(plan.evidenceClasses.includes('propulsion_constraint'), false);
  assert.equal(plan.evidenceClasses.includes('power_constraint'), true);
  assert.equal(plan.contaminationWarnings.length, 1);
  assert.deepEqual(plan.contaminationWarnings[0].removedEvidenceClasses, ['mission_award', 'propulsion_constraint']);
});
