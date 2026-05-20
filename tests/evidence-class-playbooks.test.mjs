import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateEvidenceClassAcceptance,
  evidenceClassPlaybook,
  extractFactsForEvidenceClass,
} from '../scripts/_shared/evidence-class-playbooks.mjs';

test('evidence class playbooks expose required facts for core unblock classes', () => {
  const substitution = evidenceClassPlaybook('substitution_limit');
  const propulsion = evidenceClassPlaybook('propulsion_constraint');
  const historical = evidenceClassPlaybook('historical_analog');
  const market = evidenceClassPlaybook('market_validation');
  const negative = evidenceClassPlaybook('negative_control');

  assert.equal(substitution.requiredFacts.includes('qualified_supplier_limit'), true);
  assert.equal(propulsion.requiredFacts.includes('delivery_timing'), true);
  assert.equal(historical.requiredFacts.includes('operating_or_market_outcome'), true);
  assert.equal(market.requiredFacts.includes('t_stat'), true);
  assert.equal(negative.requiredFacts.includes('invalidator'), true);
});

test('substitution_limit generic bottleneck mentions stay context until qualification facts appear', () => {
  const context = evaluateEvidenceClassAcceptance({
    evidenceClass: 'substitution_limit',
    provider: 'source-query',
    text: 'The supplier update mentions a supply-chain bottleneck for the component.',
    evidenceUse: 'promotion_candidate',
    maxEvidenceUse: 'promotion_candidate',
    targetHit: true,
    classCueHit: true,
  });
  const promotion = evaluateEvidenceClassAcceptance({
    evidenceClass: 'substitution_limit',
    provider: 'source-query',
    text: 'The source says only limited qualified suppliers exist, with no near-term alternative and a qualification lead time.',
    evidenceUse: 'promotion_candidate',
    maxEvidenceUse: 'promotion_candidate',
    targetHit: true,
    classCueHit: true,
    strongClassCueHit: true,
  });

  assert.equal(context.evidenceUse, 'supporting_context');
  assert.equal(context.promotionEligible, false);
  assert.equal(promotion.evidenceUse, 'promotion_candidate');
  assert.equal(promotion.factsExtracted.some((fact) => fact.key === 'qualified_supplier_limit'), true);
});

test('negative control playbook never promotes evidence', () => {
  const result = evaluateEvidenceClassAcceptance({
    evidenceClass: 'negative_control',
    provider: 'source-query',
    text: 'The source says there are easy substitutes and redundant capacity, invalidating the bottleneck thesis.',
    evidenceUse: 'promotion_candidate',
    maxEvidenceUse: 'promotion_candidate',
    targetHit: true,
    classCueHit: true,
  });

  assert.equal(result.evidenceUse, 'negative_control_candidate');
  assert.equal(result.promotionEligible, false);
  assert.equal(result.closureReason, 'negative_collected');
});

test('power_constraint does not treat generic English power as grid evidence', () => {
  const generic = extractFactsForEvidenceClass('power_constraint', {
    text: 'Quantum computing leverages the power of quantum bits for healthcare machine learning applications.',
  });
  const grid = extractFactsForEvidenceClass('power_constraint', {
    text: 'Data center power availability depends on utility interconnection queues and grid capacity.',
  });

  assert.equal(generic.factKeys.includes('generic_power_term'), false);
  assert.equal(grid.factKeys.includes('generic_power_term'), true);
  assert.equal(grid.factKeys.includes('utility_or_grid_operator'), true);
});

test('historical analog extracts comparison facts but remains context by default', () => {
  const facts = extractFactsForEvidenceClass('historical_analog', {
    text: 'During the 2018 capacity cycle, similar mechanism pressure hit suppliers and the market outcome was margin expansion, unlike the current case.',
  });
  const result = evaluateEvidenceClassAcceptance({
    evidenceClass: 'historical_analog',
    provider: 'source-query',
    text: 'During the 2018 capacity cycle, similar mechanism pressure hit suppliers and the market outcome was margin expansion, unlike the current case.',
    evidenceUse: 'promotion_candidate',
    maxEvidenceUse: 'promotion_candidate',
    targetHit: true,
    classCueHit: true,
  });

  assert.equal(facts.factKeys.includes('period_or_event'), true);
  assert.equal(result.evidenceUse, 'supporting_context');
  assert.equal(result.promotionEligible, false);
});
