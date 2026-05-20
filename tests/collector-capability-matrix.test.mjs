import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectorCapability,
  collectorCapabilitiesForEvidenceClass,
  collectorCanPromote,
  maxEvidenceUseForCollector,
  routeCollectorCapabilities,
} from '../scripts/_shared/collector-capability-matrix.mjs';

test('collector capability matrix maps official defense providers to procurement promotion', () => {
  const dod = collectorCapability('dod-contracts', 'procurement_trigger');
  const usa = collectorCapability('usaspending', 'policy_funding');

  assert.equal(dod.supported, true);
  assert.equal(dod.maxEvidenceUse, 'promotion_candidate');
  assert.equal(usa.supported, true);
  assert.equal(collectorCanPromote('usaspending', 'mission_award'), true);
});

test('source-query is specialist discovery and negative control is never promotion', () => {
  const substitution = collectorCapability('source-query', 'substitution_limit');
  const negative = collectorCapability('source-query', 'negative_control');

  assert.equal(substitution.supported, true);
  assert.equal(substitution.promotionRequiresPlaybook, true);
  assert.equal(substitution.maxEvidenceUse, 'promotion_candidate');
  assert.equal(negative.maxEvidenceUse, 'negative_control_candidate');
});

test('market and power collectors route to local market and energy lanes', () => {
  assert.equal(maxEvidenceUseForCollector('polygon', 'market_validation'), 'promotion_candidate');
  assert.equal(maxEvidenceUseForCollector('eia', 'power_constraint'), 'promotion_candidate');

  const marketCollectors = collectorCapabilitiesForEvidenceClass('market_validation').map((item) => item.collector);
  assert.equal(marketCollectors.includes('polygon'), true);
  assert.equal(marketCollectors.includes('dod-contracts'), false);
});

test('unsupported collector returns collector_not_available', () => {
  const capability = collectorCapability('dod-contracts', 'historical_analog');
  assert.equal(capability.supported, false);
  assert.equal(capability.closureReason, 'collector_not_available');

  const route = routeCollectorCapabilities({
    evidenceClass: 'historical_analog',
    collectors: ['dod-contracts', 'source-query'],
  });
  assert.equal(route.some((item) => item.collector === 'source-query' && item.supported), true);
  assert.equal(route.some((item) => item.collector === 'dod-contracts' && !item.supported), true);
});
