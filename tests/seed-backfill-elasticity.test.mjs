import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBiasBackfillPlan,
  buildBiasBackfillResults,
  diagnoseSeedBias,
} from '../scripts/_shared/seed-bias-diagnostics.mjs';

function seed(id, klass = 'supplier_capacity') {
  return {
    seedId: id,
    seedTitle: id,
    theme: { key: 'cloud-infrastructure', label: 'Cloud Infrastructure' },
    growthDriver: 'driver',
    realActivity: 'activity',
    physicalProcess: 'process',
    requiredInputs: ['transformers'],
    bottleneck: { label: 'capacity bottleneck', class: klass, mechanism: 'mechanism' },
    supplierCategory: { label: 'supplier', publicIssuerCandidates: [] },
    evidenceQueries: ['capacity official evidence'],
    counterEvidenceQueries: ['no capacity constraint'],
    expectedEvidenceClasses: ['mechanism_validation', klass],
    scores: { composite_seed_score: 0.7, knownNarrativeScore: 0.2 },
    biasAudit: { source_type_diversity: 1, provider_gap_labels: ['provider_gap_grid_interconnection_queue'] },
    providerGaps: ['provider_gap_grid_interconnection_queue'],
    lineage: { source: 'research_question', sourceIds: [id] },
  };
}

test('underrepresented classes become targeted backfill plan without accepted promotion', () => {
  const seeds = [seed('s1'), seed('s2'), seed('s3')];
  const diagnosis = diagnoseSeedBias({ seeds, sourceCoverage: { skew: 0.9 } });
  const plan = buildBiasBackfillPlan({ seeds, diagnosis });
  assert.equal(plan.tasks.some((task) => task.evidenceClass === 'technical_qualification'), true);
  assert.equal(plan.tasks.some((task) => task.evidenceClass === 'permitting_regulatory'), true);
  assert.equal(plan.tasks.some((task) => task.evidenceClass === 'provider_data_gap'), true);
  const marketTask = plan.tasks.find((task) => task.evidenceClass === 'market_validation');
  assert.equal(marketTask.adapterProposalRequired, false);
  assert.equal(marketTask.providerBackfillTask.localControlledMarketDataOnly, true);
  assert.equal(marketTask.providerBackfillTask.sourceQueryPromotionAllowed, false);
  const results = buildBiasBackfillResults(plan);
  assert.equal(results.rawEvidenceStoredCount, plan.taskCount);
  assert.equal(results.acceptedEvidenceStoredCount, 0);
  assert.equal(results.rawEvidence.every((row) => row.accepted === false), true);
});
