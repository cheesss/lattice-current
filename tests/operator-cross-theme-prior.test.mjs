import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  compareParentSelectionRuns,
  crossThemePriorToSeedInputs,
  loadOperatorCrossThemePrior,
  scoreUserCrossThemePriorFit,
  selectDiversifiedParentSeedPool,
  validateOperatorCrossThemePrior,
} from '../scripts/_shared/operator-cross-theme-prior.mjs';
import {
  generateMechanismSeeds,
} from '../scripts/_shared/mechanism-seed-generator.mjs';
import {
  decomposeChildBottleneckSeeds,
} from '../scripts/_shared/seed-child-bottleneck-decomposition.mjs';
import {
  evaluateAutonomousSeedReportCandidateGate,
} from '../scripts/_shared/seed-bias-diagnostics.mjs';
import {
  runMechanismSeedGeneration,
} from '../scripts/run-mechanism-seed-generation.mjs';

const generatedAt = '2026-05-20T00:00:00.000Z';

function input(id, prompt, klass, extras = {}) {
  return {
    id,
    source: extras.source || 'research_question',
    themeKey: extras.themeKey || '',
    themeLabel: extras.themeLabel || '',
    label: prompt,
    prompt,
    seedTerms: extras.seedTerms || [prompt],
    evidenceClasses: [klass],
    sourceRefs: extras.sourceRefs || [],
    sourceTypes: extras.sourceTypes || [],
    metadata: extras.metadata || {},
  };
}

function seedBatch() {
  return generateMechanismSeeds({
    inputs: [
      input('ai-power-1', 'AI data centers need grid interconnection study capacity and substation equipment lead time for new load requests', 'power_constraint', { themeKey: 'ai-ml', themeLabel: 'AI / Machine Learning' }),
      input('ai-power-2', 'data center power demand and transformer allocation for AI campuses mentions VRT ETN PWR', 'power_constraint', { themeKey: 'ai-ml', themeLabel: 'AI / Machine Learning' }),
      input('pack-1', 'AI semiconductor underfill and mold compound supply for advanced packaging reliability', 'material_input', { themeKey: 'semiconductor', themeLabel: 'Semiconductor' }),
      input('pack-2', 'advanced packaging CoWoS is constrained and HBM demand is rising', 'supplier_capacity', { themeKey: 'semiconductor', themeLabel: 'Semiconductor' }),
      input('pack-3', 'probe card and test socket capacity for HBM and accelerators', 'test_facility_capacity', { themeKey: 'semiconductor', themeLabel: 'Semiconductor' }),
      input('def-1', 'defense space propulsion energetic binder qualified supplier capacity and rocket motor test facility capacity', 'technical_qualification', { themeKey: 'defense-industrial', themeLabel: 'Defense Industrial' }),
      input('def-2', 'ammonium perchlorate supply and carbon composite motor case capacity for interceptor production', 'material_input', { themeKey: 'space', themeLabel: 'Space' }),
      input('cryo-1', 'space fusion quantum helium supply and recovery capacity with cryogenic valve qualification', 'technical_qualification', { themeKey: 'space', themeLabel: 'Space' }),
      input('cryo-2', 'vacuum chamber and high vacuum equipment lead time for fusion and quantum hardware', 'supplier_capacity', { themeKey: 'fusion', themeLabel: 'Fusion' }),
      input('glp-1', 'GLP-1 sterile fill-finish line capacity and autoinjector component supply', 'supplier_capacity', { themeKey: 'biotech', themeLabel: 'Biotech' }),
      input('geo-1', 'tungsten supply for defense and semiconductor tooling with non-China supply chain exposure', 'material_input', { themeKey: 'geopolitics', themeLabel: 'Geopolitics', sourceRefs: ['provider_gap_dart'] }),
      input('perm-1', 'grid permitting queue processing capacity and local authority records for large data center loads', 'permitting_regulatory', { themeKey: 'climate-change', themeLabel: 'Climate Change' }),
    ],
  }, { generatedAt, includeRejected: true, limit: 12 });
}

test('operator cross-theme prior config is exploration-only and cannot raise readiness', () => {
  const prior = loadOperatorCrossThemePrior();
  assert.equal(prior.version, 'user-cross-theme-prior-v1');
  assert.equal(prior.role, 'exploration_prior_only');
  assert.equal(prior.promotionPolicy.canRaiseReportReadiness, false);
  assert.equal(prior.promotionPolicy.canRaiseInvestmentReadiness, false);
  assert.equal(prior.selectionPolicy.disableTopOneParentSelection, true);
  assert.deepEqual(validateOperatorCrossThemePrior(prior), { ok: true });
});

test('mechanism seed generation can explicitly exclude config priors', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'operator-prior-exclusions-'));
  try {
    const ontologyOnly = await runMechanismSeedGeneration({
      dryRun: true,
      source: 'ontology',
      limit: 20,
      planEvidence: true,
      excludeOntology: true,
      artifactOut: path.join(tmp, 'ontology.json'),
    });
    const priorOnly = await runMechanismSeedGeneration({
      dryRun: true,
      source: 'cross-theme-prior',
      limit: 20,
      planEvidence: true,
      excludeOperatorPrior: true,
      artifactOut: path.join(tmp, 'prior.json'),
    });
    assert.equal(ontologyOnly.seeds.length, 0);
    assert.equal(priorOnly.seeds.length, 0);
    assert.equal(ontologyOnly.exclusions.ontology, true);
    assert.equal(priorOnly.exclusions.operatorPrior, true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('mechanism seed generation can exclude overrepresented themes during anti-bias runs', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'operator-prior-theme-exclusion-'));
  try {
    const run = await runMechanismSeedGeneration({
      dryRun: true,
      source: 'cross-theme-prior',
      limit: 30,
      planEvidence: true,
      excludeThemes: ['ai-ml', 'cloud-infrastructure', 'climate-change'],
      artifactOut: path.join(tmp, 'anti-bias.json'),
    });
    const seedThemeText = run.seeds.map((seed) => `${seed.theme?.key || ''} ${seed.theme?.label || ''}`).join(' ');
    assert.doesNotMatch(seedThemeText, /ai-ml|cloud-infrastructure|climate-change/i);
    assert.equal(run.excludeThemes.includes('ai-ml'), true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('mechanism seeds include user cross-theme prior fit but keep readiness separate', () => {
  const seed = generateMechanismSeeds({
    inputs: [input('prior-fit', 'AI semiconductor underfill and mold compound supply for advanced packaging reliability', 'material_input', {
      themeKey: 'semiconductor',
      themeLabel: 'Semiconductor',
    })],
  }, { generatedAt, limit: 10 }).seeds[0];
  assert.equal(seed.scores.userCrossThemePriorFit > 0, true);
  assert.equal(seed.scores.matchedUserPriorIds.includes('ai_semiconductor_material_process'), true);
  assert.equal(seed.metadata.userCrossThemePrior.canRaiseReportReadiness, false);
  const gate = evaluateAutonomousSeedReportCandidateGate(seed, {
    biasDiagnosis: { verdict: 'INCONCLUSIVE_NEEDS_BACKFILL' },
    acceptedEvidence: [],
    rawEvidence: [],
    negativeControlSurvival: {},
    holdoutValidation: {},
    marketValidation: {},
    targetedBackfillRan: false,
  });
  assert.equal(gate.gate, 'blocked');
  assert.equal(gate.blockers.includes('accepted_evidence_missing'), true);
});

test('connector and evidence class utility alone do not attach unrelated user priors', () => {
  const fit = scoreUserCrossThemePriorFit({
    seedId: 'retail-capacity-control',
    seedTitle: 'checkout lane staffing throughput and warehouse service capacity',
    theme: { key: 'retail-operations', label: 'Retail Operations' },
    bottleneck: { class: 'supplier_capacity', label: 'warehouse service capacity' },
    expectedEvidenceClasses: ['supplier_capacity', 'negative_control'],
    evidenceQueries: ['warehouse service capacity official operations filing'],
    counterEvidenceQueries: ['warehouse service capacity improving substitute staffing'],
    scores: { knownNarrativeScore: 0.1 },
  });
  assert.equal(fit.userCrossThemePriorFit, 0);
  assert.deepEqual(fit.matchedUserPriorIds, []);
  assert.equal(fit.connectorClassFit, 0);
  assert.equal(fit.canRaiseReportReadiness, false);
});

test('cross-theme prior can generate autonomous seed inputs without manual subject', () => {
  const prior = loadOperatorCrossThemePrior();
  const inputs = crossThemePriorToSeedInputs(prior, { limitPerPrior: 2 });
  assert.equal(inputs.length >= 10, true);
  assert.equal(inputs.every((item) => item.source === 'operator_cross_theme_prior'), true);
  const generated = generateMechanismSeeds({ inputs }, { generatedAt, limit: 12 });
  assert.equal(generated.seeds.length >= 8, true);
  assert.equal(generated.seeds.some((seed) => seed.scores.matchedUserPriorIds.length > 0), true);
  assert.equal(generated.seeds.every((seed) => !/manual|prompt|user/i.test(seed.lineage.source)), true);
});

test('avoid narrative and high known narrative parents become decomposition-only', () => {
  const seed = generateMechanismSeeds({
    inputs: [input('known', 'advanced packaging is a bottleneck and CoWoS is constrained while HBM demand is rising', 'supplier_capacity', {
      themeKey: 'semiconductor',
      themeLabel: 'Semiconductor',
    })],
  }, { generatedAt, limit: 10 }).seeds[0];
  const fit = scoreUserCrossThemePriorFit(seed);
  assert.equal(fit.avoidNarrativeHit, true);
  assert.equal(seed.scores.parentOnlyDueToKnownNarrative, true);
  const gate = evaluateAutonomousSeedReportCandidateGate(seed, {
    biasDiagnosis: { verdict: 'INCONCLUSIVE_NEEDS_BACKFILL' },
    acceptedEvidence: [],
    negativeControlSurvival: {},
    holdoutValidation: {},
    marketValidation: {},
    targetedBackfillRan: false,
  });
  assert.equal(gate.gate, 'blocked');
  assert.equal(gate.blockers.includes('known_narrative_parent_requires_child_decomposition'), true);
});

test('diversified parent pool disables top-one selection and stores bucket metadata', () => {
  const result = seedBatch();
  assert.equal(result.summary.parentSelection.topOneSelectionDisabled, true);
  assert.equal(result.summary.parentSelection.parentPoolSize >= 8, true);
  assert.equal(result.summary.parentSelection.parentPoolSize <= 12, true);
  const buckets = result.seeds.map((seed) => seed.parentSelection?.parentSelectionBucket).filter(Boolean);
  assert.equal(new Set(buckets).size >= 4, true);
  for (const seed of result.seeds) {
    assert.equal(Boolean(seed.parentSelection?.parentPoolRank), true);
    assert.equal(Boolean(seed.parentSelection?.parentSelectionReason), true);
    assert.equal(Number.isFinite(seed.parentSelection?.parentPoolDiversityContribution), true);
  }
});

test('MMR diversified parent selection reduces similar parent duplication', () => {
  const seeds = seedBatch().seeds;
  const selected = selectDiversifiedParentSeedPool(seeds).selected;
  const advancedPackagingCount = selected.filter((seed) => /advanced packaging|cowos|hbm/i.test(JSON.stringify(seed))).length;
  assert.equal(selected.length >= 8, true);
  assert.equal(advancedPackagingCount < selected.length, true);
  assert.equal(new Set(selected.map((seed) => seed.bottleneck?.class)).size >= 4, true);
});

test('advanced packaging decomposition produces diverse child classes and not only CoWoS ABF HBM', () => {
  const parent = generateMechanismSeeds({
    inputs: [input('pack-parent', 'advanced packaging substrate capacity CoWoS ABF HBM and substrate warpage control process bottleneck', 'supplier_capacity', {
      themeKey: 'semiconductor',
      themeLabel: 'Semiconductor',
    })],
  }, { generatedAt, limit: 10 }).seeds[0];
  const result = decomposeChildBottleneckSeeds(parent);
  const classes = new Set(result.childSeeds.map((seed) => seed.childClass));
  const nodes = result.childSeeds.map((seed) => seed.bottleneckNode).join(' | ');
  assert.equal(classes.size >= 4, true);
  assert.match(nodes, /underfill|probe card|temporary bonding|warpage/i);
  assert.equal(result.childSeeds.every((seed) => seed.supplierCategory.publicIssuerCandidates.includes('NVDA') === false), true);
});

test('domain parent decomposition covers defense-space and cryogenic child nodes', () => {
  const defenseParent = generateMechanismSeeds({
    inputs: [input('def-parent', 'defense space propulsion solid rocket motor energetic binder ammonium perchlorate test facility capacity', 'supplier_capacity', {
      themeKey: 'defense-industrial',
      themeLabel: 'Defense Industrial',
    })],
  }, { generatedAt, limit: 10 }).seeds[0];
  const defenseChildren = decomposeChildBottleneckSeeds(defenseParent).childSeeds.map((seed) => seed.bottleneckNode).join(' | ');
  assert.match(defenseChildren, /energetic binder/i);
  assert.match(defenseChildren, /qualification test facility/i);
  assert.match(defenseChildren, /ammonium perchlorate/i);

  const cryogenicParent = generateMechanismSeeds({
    inputs: [input('cryo-parent', 'space fusion quantum cryogenic helium vacuum chamber high vacuum equipment lead time', 'technical_qualification', {
      themeKey: 'space',
      themeLabel: 'Space',
    })],
  }, { generatedAt, limit: 10 }).seeds[0];
  const cryoChildren = decomposeChildBottleneckSeeds(cryogenicParent).childSeeds.map((seed) => seed.bottleneckNode).join(' | ');
  assert.match(cryoChildren, /helium supply/i);
  assert.match(cryoChildren, /vacuum chamber/i);
});

test('Run C/D parent selection improves diversity without opening report candidates', () => {
  const seeds = seedBatch().seeds.map((seed) => ({
    ...seed,
    childCount: decomposeChildBottleneckSeeds(seed).childSeeds.length,
  }));
  const comparison = compareParentSelectionRuns(seeds);
  const byRun = new Map(comparison.runs.map((run) => [run.run, run]));
  assert.equal(byRun.get('C_mmr_diversified').classDiversityEntropy >= byRun.get('A_top1_composite').classDiversityEntropy, true);
  assert.equal(byRun.get('D_underrepresented_quota').classDiversityEntropy >= byRun.get('A_top1_composite').classDiversityEntropy, true);
  assert.equal(byRun.get('C_mmr_diversified').reportCandidateAllowedRate, 0);
  assert.equal(byRun.get('D_underrepresented_quota').reportCandidateAllowedRate, 0);
  assert.equal(byRun.get('C_mmr_diversified').blockedRate, 1);
});
