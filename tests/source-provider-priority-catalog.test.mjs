import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPrioritySourceProviderCandidates,
  buildPrioritySourceProviderCoverage,
  prioritySourceProviderSpecs,
} from '../scripts/_shared/source-provider-priority-catalog.mjs';
import {
  buildSourceProviderActivationRecords,
} from '../scripts/_shared/source-registry-safe-writer.mjs';

test('priority provider catalog includes official providers needed for non-US issuer coverage', () => {
  const providers = prioritySourceProviderSpecs().map((item) => item.providerName).sort();
  assert.deepEqual(providers, ['company_ir_direct_pdf', 'dart', 'edinet', 'taiwan_mops', 'tdnet'].sort());
  for (const spec of prioritySourceProviderSpecs()) {
    assert.equal(spec.reviewGatedActivation, undefined);
    assert.equal(spec.authRequired, false);
    assert.equal(spec.apiKeyRequired, false);
    assert.equal(spec.fixtureRequired, true);
    assert.ok(spec.parserOutputSchema.requiredFields.includes('desiredEvidenceClass'));
    assert.ok(spec.healthCheckCommand);
    assert.ok(spec.testCommand);
    assert.equal(spec.failureModes.includes('NO_RESULT'), true);
    assert.equal(spec.failureModes.includes('TIMEOUT'), true);
    assert.equal(spec.failureModes.includes('TICKER_ONLY'), true);
    assert.equal(spec.failureModes.includes('provider_rate_limited'), true);
  }
});

test('priority provider candidates register as needs_fixture without activation writes', () => {
  const payload = buildSourceProviderActivationRecords(buildPrioritySourceProviderCandidates(), {
    mode: 'test',
  });
  assert.equal(payload.records.length > 5, true);
  assert.equal(payload.records.every((record) => record.reviewGatedActivation === true), true);
  assert.equal(payload.records.every((record) => record.status === 'needs_fixture'), true);
  assert.equal(payload.records.every((record) => record.fixtureStatus === 'fixture_declared'), true);
  assert.equal(payload.records.every((record) => record.parserStatus === 'schema_declared'), true);
  assert.equal(payload.records.every((record) => record.healthcheckStatus === 'declared'), true);
  assert.equal(payload.records.every((record) => record.activationBlocker === 'fixture_required_before_activation'), true);
  assert.equal(payload.boundaries.providerActivationWrites, 0);
  assert.equal(payload.boundaries.canonicalWrites, 0);
  assert.equal(payload.boundaries.readinessPromotionWrites, 0);
});

test('priority coverage summary reports missing and fixture-needed providers', () => {
  const payload = buildSourceProviderActivationRecords(buildPrioritySourceProviderCandidates(), {
    mode: 'test',
  });
  const summary = buildPrioritySourceProviderCoverage(payload.records);
  assert.equal(summary.providerCount, 5);
  assert.deepEqual(summary.missingProviders, []);
  assert.equal(summary.needsFixtureProviders.includes('taiwan_mops'), true);
  assert.equal(summary.needsFixtureProviders.includes('company_ir_direct_pdf'), true);
  assert.equal(summary.providers.every((provider) => provider.activationBlockers.includes('fixture_required_before_activation')), true);
});
