import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPriorityProviderFixtureProbes,
  verifyPriorityProviderFixtureSpec,
} from '../scripts/_shared/source-provider-fixture-probes.mjs';
import {
  buildPrioritySourceProviderCandidates,
  prioritySourceProviderSpecs,
} from '../scripts/_shared/source-provider-priority-catalog.mjs';
import {
  buildSourceProviderActivationRecords,
} from '../scripts/_shared/source-registry-safe-writer.mjs';

test('priority provider fixture specs verify parser, healthcheck and failure fixtures', () => {
  for (const spec of prioritySourceProviderSpecs()) {
    const result = verifyPriorityProviderFixtureSpec(spec);
    assert.equal(result.ok, true, `${spec.providerName} should be fixture-verifiable`);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.verifiedFixtureKinds, [
      'positive_document',
      'no_result',
      'timeout_or_rate_limit',
      'ticker_only_rejection',
    ]);
  }
});

test('fixture probes move priority providers from needs_fixture to staged lifecycle records', () => {
  const candidates = buildPrioritySourceProviderCandidates({ generatedAt: '2026-05-22T00:00:00.000Z' });
  const probes = buildPriorityProviderFixtureProbes(candidates, {
    generatedAt: '2026-05-22T00:00:00.000Z',
  });
  assert.equal(probes.verifiedCount, candidates.length);
  assert.equal(probes.missingCount, 0);
  assert.equal(probes.mutationBoundary.providerActivationWrites, 0);
  assert.equal(probes.mutationBoundary.canonicalWrites, 0);

  const activation = buildSourceProviderActivationRecords(candidates, {
    mode: 'test',
    probesByCandidateId: probes.probesByCandidateId,
  });
  assert.equal(activation.records.every((record) => record.status === 'staged'), true);
  assert.equal(activation.records.every((record) => record.fixtureStatus === 'fixture_verified'), true);
  assert.equal(activation.records.every((record) => record.parserStatus === 'schema_declared'), true);
  assert.equal(activation.records.every((record) => record.healthcheckStatus === 'declared'), true);
  assert.equal(activation.records.every((record) => record.activationTier === 'staged_readonly'), true);
  assert.equal(activation.summary.needsFixtureCount || 0, 0);
  assert.equal(activation.boundaries.sourceRegistryWrites, candidates.length);
  assert.equal(activation.boundaries.providerActivationWrites, 0);
  assert.equal(activation.boundaries.readinessPromotionWrites, 0);
  assert.equal(activation.boundaries.portfolioActionWrites, 0);
});

test('without fixture probes priority providers remain needs_fixture', () => {
  const candidates = buildPrioritySourceProviderCandidates();
  const activation = buildSourceProviderActivationRecords(candidates, { mode: 'test' });
  assert.equal(activation.records.every((record) => record.status === 'needs_fixture'), true);
  assert.equal(activation.boundaries.providerActivationWrites, 0);
});
