import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHistoricalAnalogueBridge,
  loadHistoricalAnalogueCases,
  scoreHistoricalAnalogueCase,
} from '../scripts/_shared/historical-analogue-bridge.mjs';

const structuralSeed = {
  seedId: 'msd-child-defense',
  bottleneckClass: 'technical_qualification',
  bottleneckNode: 'rocket motor casing composite capacity',
  issuerRolePattern: ['propulsion_structure_supplier', 'defense_prime_backlog'],
  evidenceClasses: ['issuer_exposure', 'backlog', 'capacity', 'holdout_validation'],
  catalystTypes: ['program backlog', 'supplier readiness', 'capacity expansion'],
  issuerUniverse: ['NOC', 'LHX'],
  peerBasket: ['LMT', 'RTX'],
};

test('historical analogue scoring favors structural evidence match over topic-only wording', () => {
  const structural = {
    analogueId: 'structural-match',
    bottleneckClass: 'technical_qualification',
    bottleneckNode: 'qualified propulsion structure throughput',
    issuerRolePattern: ['propulsion_structure_supplier', 'defense_prime_backlog'],
    evidenceClasses: ['issuer_exposure', 'backlog', 'capacity', 'holdout_validation'],
    catalystTypes: ['program backlog', 'supplier readiness'],
    issuerBasket: ['NOC'],
    peerBasket: ['LMT'],
    marketOutcome: { return90dExcess: 0.12 },
    invalidators: [],
    sourceProvenance: 'trusted_local_analogue_library',
  };
  const topicOnly = {
    ...structural,
    analogueId: 'topic-only',
    bottleneckClass: 'macro_theme',
    issuerRolePattern: ['generic_defense_contractor'],
    evidenceClasses: ['market_commentary'],
    catalystTypes: ['defense spending rising'],
  };

  const structuralScore = scoreHistoricalAnalogueCase(structuralSeed, structural);
  const topicScore = scoreHistoricalAnalogueCase(structuralSeed, topicOnly);

  assert.equal(structuralScore.totalScore > topicScore.totalScore, true);
  assert.equal(structuralScore.evidenceClassScore, 1);
});

test('unrelated topic can still match when repricing structure is similar', () => {
  const bridge = buildHistoricalAnalogueBridge({
    ...structuralSeed,
    historicalAnalogueCases: [
      {
        analogueId: 'grid-transformer-structure',
        title: 'Transformer lead-time bottleneck',
        bottleneckClass: 'technical_qualification',
        bottleneckNode: 'qualified equipment throughput',
        issuerRolePattern: ['propulsion_structure_supplier', 'defense_prime_backlog'],
        evidenceClasses: ['issuer_exposure', 'backlog', 'capacity', 'holdout_validation'],
        catalystTypes: ['program backlog', 'supplier readiness'],
        issuerBasket: ['PWR'],
        peerBasket: ['ACM'],
        marketOutcome: { return90dExcess: 0.1, multipleChange: 0.05 },
        invalidators: [],
        sourceProvenance: 'trusted_local_analogue_library',
      },
      {
        analogueId: 'semicap-test-structure',
        title: 'Semicap test bottleneck',
        bottleneckClass: 'technical_qualification',
        bottleneckNode: 'qualified test throughput',
        issuerRolePattern: ['propulsion_structure_supplier', 'defense_prime_backlog'],
        evidenceClasses: ['issuer_exposure', 'backlog', 'capacity', 'holdout_validation'],
        catalystTypes: ['program backlog', 'supplier readiness'],
        issuerBasket: ['TER'],
        peerBasket: ['KLAC'],
        marketOutcome: { return90dExcess: 0.14, multipleChange: 0.07 },
        invalidators: [],
        sourceProvenance: 'trusted_local_analogue_library',
      },
    ],
  });

  assert.equal(bridge.usableAnalogueCount, 2);
  assert.equal(bridge.reflectionStatus, 'comparison_ready');
  assert.equal(bridge.analogueMedianExcessMove90d, 0.12);
});

test('generated or untrusted analogue rows are rejected and insufficient comparison is explicit', () => {
  const loaded = loadHistoricalAnalogueCases({
    cases: [
      {
        analogueId: 'bad-generated',
        bottleneckClass: 'technical_qualification',
        sourceProvenance: 'generated_dry_run_report',
      },
    ],
  });
  assert.equal(loaded.caseCount, 0);
  assert.equal(loaded.rejectedCases[0].validationErrors.includes('untrusted_source_provenance'), true);

  const bridge = buildHistoricalAnalogueBridge({
    ...structuralSeed,
    historicalAnalogueCases: [],
  });
  assert.equal(bridge.reflectionStatus, 'insufficient_comparison_data');
  assert.equal(bridge.missingInputs.includes('historical_analogue_case_count_below_2'), true);
});
