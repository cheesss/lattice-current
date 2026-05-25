import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSourceProviderManifestCandidates,
  buildSourceProviderManifestRegistry,
  providerSpecsFromManifestRegistry,
  validateSourceProviderManifest,
} from '../scripts/_shared/source-provider-manifest-registry.mjs';
import {
  buildPrioritySourceProviderCandidates,
  prioritySourceProviderSpecs,
} from '../scripts/_shared/source-provider-priority-catalog.mjs';
import {
  buildSourceProviderActivationRecords,
} from '../scripts/_shared/source-registry-safe-writer.mjs';

test('source provider manifest registry validates priority provider contracts', () => {
  const registry = buildSourceProviderManifestRegistry({ generatedAt: '2026-05-22T00:00:00.000Z' });
  assert.equal(registry.ok, true);
  assert.equal(registry.providerCount, 9);
  assert.deepEqual(registry.invalidProviders, []);
  assert.equal(registry.summary.validProviderCount, 9);
  assert.equal(registry.summary.fixtureRequiredCount, 9);
  assert.equal(registry.summary.readOnlyProviderCount, 9);
  assert.equal(registry.summary.priorityProviderCount, 5);
  assert.equal(registry.summary.safeBoundary.canonicalWrites, 0);
  assert.equal(registry.providers.every((provider) => provider.activationPolicy.reviewGatedActivation === true), true);
  assert.equal(registry.providers.every((provider) => provider.activationPolicy.readinessPromotionAllowed === false), true);
});

test('manifest-backed priority catalog preserves legacy provider output', () => {
  const manifestProviders = providerSpecsFromManifestRegistry(buildSourceProviderManifestRegistry())
    .filter((item) => item.priorityProvider !== false)
    .map((item) => item.providerName)
    .sort();
  const priorityProviders = prioritySourceProviderSpecs()
    .map((item) => item.providerName)
    .sort();
  assert.deepEqual(priorityProviders, manifestProviders);
  assert.deepEqual(priorityProviders, ['company_ir_direct_pdf', 'dart', 'edinet', 'taiwan_mops', 'tdnet'].sort());

  const catalogCandidates = buildPrioritySourceProviderCandidates({ generatedAt: '2026-05-22T00:00:00.000Z' });
  const manifestCandidates = buildSourceProviderManifestCandidates({ generatedAt: '2026-05-22T00:00:00.000Z' })
    .filter((item) => item.metadata.manifestFile === 'config/source-providers/priority-providers.json');
  assert.deepEqual(
    catalogCandidates.map((item) => `${item.providerName}:${item.evidenceClass}`).sort(),
    manifestCandidates.map((item) => `${item.providerName}:${item.evidenceClass}`).sort(),
  );
  assert.equal(catalogCandidates.every((item) => item.metadata.providerManifestRegistry === 'config_backed'), true);
});

test('missing fixture or credentials keep manifest candidates out of active provider use', () => {
  const activation = buildSourceProviderActivationRecords(buildSourceProviderManifestCandidates(), { mode: 'test' });
  assert.equal(activation.records.length > 5, true);
  assert.equal(activation.records.every((record) => record.status === 'needs_fixture'), true);
  assert.equal(activation.records.every((record) => record.activationAllowed === false), true);
  assert.equal(activation.boundaries.providerActivationWrites, 0);
  assert.equal(activation.boundaries.canonicalWrites, 0);
  assert.equal(activation.boundaries.readinessPromotionWrites, 0);
  assert.equal(activation.boundaries.portfolioActionWrites, 0);
});

test('provider manifest validator rejects unsafe activation policy', () => {
  const validation = validateSourceProviderManifest({
    providerName: 'unsafe_provider',
    fillsEvidenceClasses: ['issuer_exposure'],
    sourceType: 'official',
    providerRoute: 'unsafe',
    authRequired: false,
    apiKeyRequired: false,
    fixtureRequired: true,
    fixtureRequirement: 'fixture',
    parserOutputSchema: { requiredFields: ['desiredEvidenceClass'] },
    allowlist: ['example.com'],
    healthCheckCommand: 'node test',
    testCommand: 'node --test',
    failureModes: ['NO_RESULT', 'TIMEOUT', 'TICKER_ONLY'],
    activationPolicy: {
      reviewGatedActivation: true,
      canonicalWritesAllowed: true,
      readinessPromotionAllowed: false,
      portfolioActionAllowed: false,
    },
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.errors.includes('unsafe_activation_policy:canonical_writes'), true);
});
