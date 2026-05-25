import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BACKFILL_FAILURE_TAXONOMY,
  buildEvidenceClassExecutorPlan,
  buildEvidenceExecutorRegistry,
  validateEvidenceExecutorManifest,
} from '../scripts/_shared/evidence-executor-registry.mjs';

test('evidence executor registry covers required evidence classes', () => {
  const registry = buildEvidenceExecutorRegistry({ generatedAt: '2026-05-22T00:00:00.000Z' });
  assert.equal(registry.ok, true);
  assert.equal(registry.missingClasses.length, 0);
  assert.equal(registry.executorCount >= registry.requiredEvidenceClasses.length, true);
  assert.equal(registry.summary.requiredClassCoverage, 1);
  assert.equal(registry.summary.promotionDisabledClasses.includes('negative_control'), true);
  assert.equal(registry.summary.localControlledMarketClasses.includes('market_validation'), true);
});

test('executor registry exposes class route plan for backfill executor compatibility', () => {
  const plan = buildEvidenceClassExecutorPlan();
  assert.equal(plan.issuer_exposure.includes('sec_filing'), true);
  assert.equal(plan.negative_control.includes('bounded_source_query'), true);
  assert.equal(plan.market_validation.includes('local_controlled_market_data'), true);
  assert.equal(plan.provider_data_gap.includes('adapter_proposal_only'), true);
  assert.equal(plan.supplier_capacity.includes('supplier_filing'), true);
});

test('executor validation rejects unsafe negative control and market validation policies', () => {
  const negative = validateEvidenceExecutorManifest({
    evidenceClass: 'negative_control',
    routes: ['source_query'],
    promotionEvidenceAllowed: true,
    terminalFailureTaxonomy: BACKFILL_FAILURE_TAXONOMY,
  });
  assert.equal(negative.ok, false);
  assert.equal(negative.errors.includes('negative_control_promotion_must_be_false'), true);

  const market = validateEvidenceExecutorManifest({
    evidenceClass: 'market_validation',
    routes: ['source_query'],
    promotionEvidenceAllowed: true,
    terminalFailureTaxonomy: BACKFILL_FAILURE_TAXONOMY,
  });
  assert.equal(market.ok, false);
  assert.equal(market.errors.includes('market_validation_requires_local_controlled_data'), true);
});
