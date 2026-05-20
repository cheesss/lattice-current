import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSeedEvidencePlan,
  generateMechanismSeeds,
  normalizeMechanismSeed,
  seedToUniversalResearchSubject,
  stableMechanismSeedId,
} from '../scripts/_shared/mechanism-seed-generator.mjs';

const generatedAt = '2026-05-19T00:00:00.000Z';

function oneSeed(prompt, overrides = {}) {
  const result = generateMechanismSeeds({
    researchQuestions: [{
      id: overrides.id || 'question-1',
      questionType: 'hot_theme',
      themes: overrides.themes || [],
      seedTerms: overrides.seedTerms || [],
      prompt,
      metadata: overrides.metadata || {},
    }],
  }, { generatedAt, limit: 10, includeRejected: true });
  return result.seeds[0];
}

test('AI data center seed creates power-grid mechanism instead of generic semiconductor narrative', () => {
  const seed = oneSeed('AI data center rack density is raising power demand. Find grid interconnection, transformer, switchgear, and cooling bottlenecks.', {
    themes: ['ai-ml'],
    seedTerms: ['AI data center power constraint'],
  });

  assert.equal(seed.status, 'needs_evidence');
  assert.equal(seed.theme.key, 'ai-ml');
  assert.equal(seed.bottleneck.class, 'power_constraint');
  assert.match(seed.physicalProcess, /power delivery|cooling|interconnection/i);
  assert.equal(seed.requiredInputs.includes('switchgear'), true);
  assert.equal(seed.expectedEvidenceClasses.includes('power_constraint'), true);
  assert.equal(seed.expectedEvidenceClasses.includes('market_validation'), true);
  assert.equal(seed.counterEvidenceQueries.some((query) => /substitutes|no capacity constraint/i.test(query)), true);
});

test('space launch seed creates cryogenic and ground-support mechanism', () => {
  const seed = oneSeed('Space launch cadence is increasing. Find LOX, liquid hydrogen, helium, cryogenic fuel farm, and propellant loading bottlenecks.', {
    themes: ['space'],
    seedTerms: ['space launch cryogenic infrastructure'],
  });

  assert.equal(seed.status, 'needs_evidence');
  assert.equal(seed.theme.key, 'space');
  assert.match(seed.physicalProcess, /cryogenic storage|propellant loading|ground support/i);
  assert.equal(seed.requiredInputs.includes('helium'), true);
  assert.match(seed.supplierCategory.label, /industrial gas|ground-support/i);
});

test('defense missile seed creates SRM and energetic-material capacity mechanism', () => {
  const seed = oneSeed('Defense missile replenishment requires solid rocket motor production capacity, energetic binders, qualified suppliers, and test range throughput.', {
    themes: ['defense-industrial'],
    seedTerms: ['solid rocket motor capacity'],
  });

  assert.equal(seed.status, 'needs_evidence');
  assert.equal(seed.theme.key, 'defense-industrial');
  assert.equal(seed.bottleneck.class, 'supplier_capacity');
  assert.equal(seed.requiredInputs.includes('solid rocket motors'), true);
  assert.equal(seed.expectedEvidenceClasses.includes('supplier_capacity'), true);
  assert.match(seed.bottleneck.mechanism, /qualified solid rocket motor/i);
});

test('GLP-1 seed creates peptide fill-finish and autoinjector mechanism', () => {
  const seed = oneSeed('GLP-1 prescription growth is stressing peptide synthesis, sterile fill-finish, autoinjector components, glass cartridges, and cold chain.', {
    themes: ['biotech'],
    seedTerms: ['GLP-1 fill-finish capacity'],
  });

  assert.equal(seed.status, 'needs_evidence');
  assert.equal(seed.requiredInputs.includes('autoinjectors'), true);
  assert.match(seed.physicalProcess, /peptide synthesis|fill-finish|cold-chain/i);
  assert.match(seed.supplierCategory.label, /CDMO|autoinjector/i);
});

test('quantum and fusion seed creates cryogenic vacuum specialty-material mechanism', () => {
  const seed = oneSeed('Quantum and fusion scale-up needs cryogenic systems, high vacuum chambers, superconducting magnets, and specialty materials.', {
    themes: ['emerging-tech'],
    seedTerms: ['quantum fusion cryogenic vacuum supply'],
  });

  assert.equal(seed.status, 'needs_evidence');
  assert.equal(seed.bottleneck.class, 'technical_qualification');
  assert.equal(seed.requiredInputs.includes('vacuum chambers'), true);
  assert.equal(seed.expectedEvidenceClasses.includes('technical_qualification'), true);
});

test('generic theme narrative is rejected and does not become review-ready in Phase A', () => {
  const seed = oneSeed('AI good semiconductor good. Growth theme buy stocks.', {
    themes: ['ai-ml'],
    seedTerms: ['AI good semiconductor good'],
  });

  assert.equal(seed.status, 'rejected');
  assert.equal(seed.rejectedReasons.includes('generic_theme_narrative'), true);
  assert.equal(seed.scores.composite_seed_score < 0.55, true);
});

test('mechanism seed ids are stable and universal subject conversion stays private', () => {
  const seed = normalizeMechanismSeed({
    source: 'direct',
    themeKey: 'space',
    themeLabel: 'Space',
    prompt: 'Space launch LOX liquid hydrogen helium cryogenic ground support equipment',
    seedTerms: ['launch cryogenic support'],
  }, { generatedAt });

  assert.equal(stableMechanismSeedId(seed), seed.seedId);
  const subject = seedToUniversalResearchSubject(seed);
  assert.equal(subject.sourceTypes.includes('operator_mechanism_seed'), true);
  assert.equal(subject.metadata.operatorSeedId, seed.seedId);
  assert.equal(subject.subjectType, 'material_or_bottleneck');
});

test('seed evidence plan is read-only and keeps market and negative-control boundaries', () => {
  const seed = oneSeed('AI data center grid interconnection and switchgear bottleneck', {
    themes: ['ai-ml'],
    seedTerms: ['grid interconnection queue'],
  });
  const plan = buildSeedEvidencePlan(seed);

  assert.equal(plan.enqueueDefault, false);
  assert.equal(plan.marketValidationPlan.promotionFromSourceQueryAllowed, false);
  assert.equal(plan.negativeControlPlan.promotionEligible, false);
  assert.equal(plan.evidenceClasses.includes('market_validation'), true);
  assert.equal(plan.counterEvidenceQueries.length > 0, true);
});
