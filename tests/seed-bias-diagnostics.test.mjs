import assert from 'node:assert/strict';
import test from 'node:test';

import { diagnoseSeedBias } from '../scripts/_shared/seed-bias-diagnostics.mjs';

function seed(id, klass, overrides = {}) {
  return {
    seedId: id,
    seedTitle: `${klass} seed`,
    theme: { key: overrides.theme || 'ai-ml', label: overrides.theme || 'AI / Machine Learning' },
    growthDriver: 'autonomous source-derived driver',
    realActivity: 'physical deployment activity',
    physicalProcess: 'specific engineering process',
    requiredInputs: ['input'],
    bottleneck: { label: `${klass} bottleneck`, class: klass, mechanism: 'mechanism' },
    supplierCategory: { label: 'supplier', publicIssuerCandidates: [] },
    evidenceQueries: ['official evidence query'],
    counterEvidenceQueries: ['negative control query'],
    expectedEvidenceClasses: ['mechanism_validation', klass],
    scores: { composite_seed_score: 0.7, knownNarrativeScore: overrides.knownNarrativeScore || 0.2 },
    biasAudit: {
      source_type_diversity: 1,
      seed_dependence_score: 0.35,
      provider_gap_labels: ['provider_gap_trade_media'],
    },
    providerGaps: ['provider_gap_trade_media'],
    lineage: { source: overrides.source || 'research_question', sourceIds: [id] },
  };
}

test('supplier_capacity and power_constraint collapse creates diversity warning and data-limited verdict', () => {
  const seeds = [
    ...Array.from({ length: 8 }, (_, index) => seed(`s-${index}`, 'supplier_capacity')),
    ...Array.from({ length: 2 }, (_, index) => seed(`p-${index}`, 'power_constraint')),
  ];
  const result = diagnoseSeedBias({ seeds, sourceCoverage: { skew: 0.9 }, marketValidation: { holdoutConfirmationRate: 0 } });
  assert.equal(result.verdict, 'DATA_LIMITED_BIAS');
  assert.equal(result.overrepresentedClasses.some((item) => item.evidenceClass === 'supplier_capacity'), true);
  assert.equal(result.warnings.some((item) => item.code === 'seed_diversity_collapse'), true);
  assert.equal(result.underrepresentedClasses.some((item) => item.evidenceClass === 'technical_qualification'), true);
});

test('known narrative overlap can classify overfit before promotion', () => {
  const seeds = Array.from({ length: 5 }, (_, index) => seed(`k-${index}`, 'power_constraint', { knownNarrativeScore: 0.9 }));
  const result = diagnoseSeedBias({
    seeds,
    sourceCoverage: { providerSensitivityScore: 0.8, skew: 0.8 },
  });
  assert.equal(result.verdict, 'KNOWN_NARRATIVE_OVERFIT');
  assert.equal(result.knownNarrativeOverlap > 0.7, true);
});
