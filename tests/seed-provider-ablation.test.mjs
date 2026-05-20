import assert from 'node:assert/strict';
import test from 'node:test';

import {
  diagnoseSeedBias,
  runSeedProviderAblation,
} from '../scripts/_shared/seed-bias-diagnostics.mjs';

function seed(id, source, klass, score) {
  return {
    seedId: id,
    seedTitle: id,
    theme: { key: 'theme', label: 'Theme' },
    growthDriver: 'driver',
    realActivity: 'activity',
    physicalProcess: 'process',
    requiredInputs: ['input'],
    bottleneck: { label: id, class: klass, mechanism: 'mechanism' },
    supplierCategory: { label: 'supplier', publicIssuerCandidates: [] },
    evidenceQueries: ['query'],
    counterEvidenceQueries: ['counter'],
    expectedEvidenceClasses: [klass],
    scores: { composite_seed_score: score, knownNarrativeScore: 0.2 },
    biasAudit: { source_type_diversity: 1, seed_dependence_score: source === 'ontology' ? 0.5 : 0.2 },
    lineage: { source, sourceIds: [id] },
  };
}

test('provider ablation measures ranking and distribution sensitivity', () => {
  const seeds = [
    seed('a', 'ontology', 'supplier_capacity', 0.9),
    seed('b', 'ontology', 'supplier_capacity', 0.8),
    seed('c', 'research_question', 'technical_qualification', 0.7),
    seed('d', 'adjacent_lane', 'power_constraint', 0.6),
  ];
  const ablations = runSeedProviderAblation(seeds);
  const removed = ablations.find((item) => item.condition === 'ontology_removed');
  assert.equal(removed.seedCount, 2);
  assert.equal(removed.rankingDelta > 0, true);
  const diagnosis = diagnoseSeedBias({ seeds, providerAblations: ablations, marketValidation: { holdoutConfirmationRate: 0 } });
  assert.equal(diagnosis.providerSensitivityScore > 0, true);
});
