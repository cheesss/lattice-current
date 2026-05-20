import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEvidenceClassMatrix,
  buildEvidenceContractCollectionTasks,
  buildUniversalEvidenceContract,
  evidenceClassCueHit,
  evidenceClassProfile,
} from '../scripts/_shared/universal-evidence-contract.mjs';

function bundle(overrides = {}) {
  return {
    reportType: 'theme_report',
    subject: {
      subjectId: 'unknown-theme',
      subjectType: 'theme',
      displayName: 'Unknown Theme',
    },
    evidence: [],
    metadata: {},
    ...overrides,
  };
}

test('unknown subjects resolve to a non-empty generic universal evidence contract', () => {
  const contract = buildUniversalEvidenceContract(bundle());

  assert.equal(contract.version, 'universal-evidence-contract-v1');
  assert.equal(contract.ontologyKey, 'generic');
  assert.equal(contract.requiredClasses.some((item) => item.evidenceClass === 'operating_kpi'), true);
  assert.equal(contract.requiredClasses.some((item) => item.evidenceClass === 'issuer_commentary'), true);
  assert.equal(contract.requiredClasses.length > 0, true);
});

test('AI/ML themes produce operating-economics classes rather than defense-only classes', () => {
  const contract = buildUniversalEvidenceContract(bundle({
    subject: {
      subjectId: 'ai-ml',
      subjectType: 'theme',
      displayName: 'AI / Machine Learning',
    },
  }));
  const classes = new Set(contract.requiredClasses.map((item) => item.evidenceClass));

  assert.equal(contract.ontologyKey, 'data_center_infrastructure');
  assert.equal(classes.has('capex_confirmation'), true);
  assert.equal(classes.has('compute_demand'), true);
  assert.equal(classes.has('power_constraint'), true);
  assert.equal(classes.has('data_center_utilization'), true);
  assert.equal(classes.has('procurement_trigger'), false);
});

test('cross-theme defense and space candidate adds bottleneck discovery classes through the generic contract layer', () => {
  const contract = buildUniversalEvidenceContract(bundle({
    reportType: 'cross_theme_bottleneck_report',
    subject: {
      subjectId: '16776',
      subjectType: 'cross_theme_candidate',
      displayName: 'solid rocket motor capacity',
      metadata: { themes: ['defense-industrial', 'space'] },
    },
    metadata: {
      candidate: {
        themes: ['defense-industrial', 'space'],
        connector_name: 'solid rocket motor capacity',
      },
    },
  }));
  const classes = new Set(contract.requiredClasses.map((item) => item.evidenceClass));

  assert.equal(classes.has('supplier_capacity'), true);
  assert.equal(classes.has('technical_qualification'), true);
  assert.equal(classes.has('procurement_trigger'), true);
  assert.equal(classes.has('substitution_limit'), true);
  assert.equal(classes.has('negative_control'), true);
});

test('strict endogenous frontier contract scopes classes to the generated node rather than broad parent themes', () => {
  const contract = buildUniversalEvidenceContract(bundle({
    reportType: 'cross_theme_bottleneck_report',
    subject: {
      subjectId: 'endogenous-adjacent-ai-generated-interconnection-study-capacity',
      subjectType: 'cross_theme_candidate',
      displayName: 'interconnection study capacity',
      metadata: {
        themes: ['ai-ml', 'clean-energy'],
        discovery: {
          discoveryNamespace: 'strict_endogenous_adjacent',
          generatedLane: true,
          frontierDiscovery: true,
          connector: 'grid interconnection queue',
          concreteBottleneckNodes: [
            {
              node: 'interconnection study capacity',
              evidenceClasses: ['grid_interconnection', 'power_constraint', 'technical_qualification'],
              acceptanceCriteria: ['utility/RTO/ISO planning document', 'study backlog or queue duration'],
            },
          ],
        },
      },
    },
  }));
  const classes = new Set(contract.requiredClasses.map((item) => item.evidenceClass));

  assert.equal(classes.has('grid_interconnection'), true);
  assert.equal(classes.has('power_constraint'), true);
  assert.equal(classes.has('technical_qualification'), true);
  assert.equal(classes.has('substitution_limit'), true);
  assert.equal(classes.has('issuer_exposure'), true);
  assert.equal(classes.has('negative_control'), true);
  assert.equal(classes.has('cloud_revenue'), false);
  assert.equal(classes.has('accelerator_orders'), false);
  assert.equal(classes.has('compute_demand'), false);
  assert.equal(classes.has('commodity_input'), false);
});

test('issuer universe excludes ETFs and macro proxies from issuer-commentary routes', () => {
  const contract = buildUniversalEvidenceContract(bundle({
    subject: {
      subjectId: 'defense-industrial',
      subjectType: 'theme',
      displayName: 'Defense Industrial',
    },
    symbols: ['RTX', 'LMT', 'ITA', 'UUP', 'QQQ'],
  }));

  assert.deepEqual(contract.issuerUniverse.sort(), ['LMT', 'RTX']);
});

test('evidence class cues cover universal positive and negative evidence without promoting negative controls', () => {
  assert.equal(evidenceClassCueHit('capex_confirmation', 'Hyperscaler capex guidance increased for AI data centers'), true);
  assert.equal(evidenceClassCueHit('negative_control', 'Supplier redundancy means there is no capacity constraint'), true);
  assert.equal(evidenceClassProfile('negative_control').promotionEligible, false);
});

test('evidence matrix separates direct promotion evidence from context and creates class-specific collection tasks', () => {
  const sourceBundle = bundle({
    reportType: 'cross_theme_bottleneck_report',
    subject: {
      subjectId: '16776',
      subjectType: 'cross_theme_candidate',
      displayName: 'solid rocket motor capacity',
      metadata: { themes: ['defense-industrial', 'space'] },
    },
    evidence: [
      {
        evidenceId: 'EVID-SRM-CAPACITY',
        kind: 'source_query',
        publisher: 'Defense News',
        title: 'Pentagon funds solid rocket motor production capacity expansion',
        metadata: {
          desiredEvidenceClass: 'supplier_capacity',
          evidenceUse: 'promotion_candidate',
          promotionEligible: true,
          sourceGroup: 'defense-news',
        },
      },
      {
        evidenceId: 'EVID-SRM-CONTEXT',
        kind: 'source_query',
        publisher: 'Market Report',
        title: 'Rocket motor market outlook mentions defense suppliers',
        metadata: {
          desiredEvidenceClass: 'issuer_exposure',
          evidenceUse: 'supporting_context',
          promotionEligible: false,
          sourceGroup: 'market-report',
        },
      },
    ],
  });
  const contract = buildUniversalEvidenceContract(sourceBundle);
  const matrix = buildEvidenceClassMatrix({ bundle: sourceBundle, contract });
  const supplier = matrix.find((row) => row.evidenceClass === 'supplier_capacity');
  const issuer = matrix.find((row) => row.evidenceClass === 'issuer_exposure');
  const tasks = buildEvidenceContractCollectionTasks({ bundle: sourceBundle, contract, matrix });

  assert.equal(supplier.status, 'promotion_eligible');
  assert.equal(issuer.status, 'context');
  assert.equal(tasks.some((task) => task.collectionKind === 'universal_evidence_contract'), true);
  assert.equal(tasks.every((task) => task.metadata?.evidenceContract?.desiredEvidenceClass || task.metadata?.evidenceContract?.evidenceClass), true);
});
