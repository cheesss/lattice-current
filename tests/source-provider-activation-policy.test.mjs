import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateSourceProviderActivation,
  SOURCE_PROVIDER_STATUSES,
} from '../scripts/_shared/source-provider-activation-policy.mjs';

test('source/provider statuses include the fixed lifecycle', () => {
  for (const status of [
    'discovered_untrusted',
    'probe_running',
    'probe_failed',
    'staged',
    'active_limited',
    'active',
    'quarantined',
    'needs_credentials',
    'needs_fixture',
    'provider_gap_proposal_required',
  ]) {
    assert.equal(SOURCE_PROVIDER_STATUSES.includes(status), true);
  }
});

test('candidate without probe stays discovered_untrusted', () => {
  const result = evaluateSourceProviderActivation({
    providerName: 'trade-rss',
    evidenceClass: 'supplier_capacity',
    sourceUrl: 'https://example.com/feed.xml',
  });
  assert.equal(result.status, 'discovered_untrusted');
  assert.equal(result.fixtureStatus, 'fixture_missing');
  assert.equal(result.parserStatus, 'schema_missing');
  assert.equal(result.boundaries.canonicalWrites, 0);
  assert.equal(result.boundaries.readinessPromotionWrites, 0);
});

test('probe passing staging threshold becomes staged', () => {
  const result = evaluateSourceProviderActivation({
    providerName: 'official-html',
    evidenceClass: 'issuer_exposure',
    sourceUrl: 'https://example.com/investors',
    probe: {
      status: 'ok',
      connectorKind: 'html-list',
      qualityScore: 0.62,
      qualityBreakdown: { recentItemCount: 2, itemCount: 8 },
    },
  });
  assert.equal(result.status, 'staged');
  assert.equal(result.registryWriteKind, 'staged');
  assert.equal(result.activationBlocker, 'parser_schema_missing');
  assert.equal(result.boundaries.sourceRegistryWrites, 1);
  assert.equal(result.boundaries.providerActivationWrites, 0);
});

test('high quality read-only safe connector becomes active_limited', () => {
  const result = evaluateSourceProviderActivation({
    providerName: 'official-rss',
    evidenceClass: 'holdout_validation',
    sourceUrl: 'https://example.com/rss',
    probe: {
      status: 'ok',
      connectorKind: 'rss',
      qualityScore: 0.9,
      qualityBreakdown: { recentItemCount: 5, itemCount: 20 },
    },
  });
  assert.equal(result.status, 'active_limited');
  assert.equal(result.activationTier, 'limited_readonly');
  assert.equal(result.healthcheckStatus, 'missing');
  assert.equal(result.boundaries.providerActivationWrites, 1);
});

test('credentials and fixture requirements block activation', () => {
  const credential = evaluateSourceProviderActivation({
    providerName: 'EDINET',
    evidenceClass: 'issuer_exposure',
    apiKeyRequired: true,
  });
  assert.equal(credential.status, 'needs_credentials');
  assert.equal(credential.activationBlocker, 'credentials_or_api_key_required');

  const fixture = evaluateSourceProviderActivation({
    providerName: 'company_ir_direct_pdf',
    evidenceClass: 'issuer_exposure',
    fixtureRequired: true,
  });
  assert.equal(fixture.status, 'needs_fixture');
  assert.equal(fixture.activationBlocker, 'fixture_required_before_activation');
});

test('public official provider names are not treated as credential-only by name', () => {
  for (const providerName of ['EDINET', 'tdnet', 'dart', 'taiwan_mops']) {
    const result = evaluateSourceProviderActivation({
      providerName,
      evidenceClass: 'issuer_exposure',
      fixtureRequired: true,
      fixtureRequirement: `${providerName} parser fixture required`,
    });
    assert.equal(result.status, 'needs_fixture');
    assert.equal(result.fixtureStatus, 'fixture_declared');
    assert.equal(result.boundaries.providerActivationWrites, 0);
  }
});

test('fixture-backed providers require verified fixture before staged or active-limited use', () => {
  const unverified = evaluateSourceProviderActivation({
    providerName: 'company_ir_direct_pdf',
    evidenceClass: 'issuer_exposure',
    fixtureRequired: true,
    fixtureRequirement: 'direct PDF parser fixture',
    parserOutputSchema: { requiredFields: ['desiredEvidenceClass'] },
    healthCheckCommand: 'node check-fixture.mjs',
    probe: {
      status: 'ok',
      connectorKind: 'html-list',
      qualityScore: 0.9,
      qualityBreakdown: { recentItemCount: 5, itemCount: 10 },
    },
  });
  assert.equal(unverified.status, 'needs_fixture');
  assert.equal(unverified.activationAllowed, false);

  const verified = evaluateSourceProviderActivation({
    providerName: 'company_ir_direct_pdf',
    evidenceClass: 'issuer_exposure',
    sourceUrl: 'https://example.com/investors',
    fixtureRequired: true,
    fixtureRequirement: 'direct PDF parser fixture',
    parserOutputSchema: { requiredFields: ['desiredEvidenceClass'] },
    healthCheckCommand: 'node check-fixture.mjs',
    probe: {
      status: 'ok',
      fixtureStatus: 'verified',
      connectorKind: 'html-list',
      qualityScore: 0.62,
      qualityBreakdown: { recentItemCount: 2, itemCount: 8 },
    },
  });
  assert.equal(verified.status, 'staged');
  assert.equal(verified.fixtureStatus, 'fixture_verified');
});

test('provider gaps and failed probes do not become active', () => {
  const gap = evaluateSourceProviderActivation({
    providerName: 'taiwan_mops',
    evidenceClass: 'issuer_exposure',
    status: 'provider_gap_proposal_required',
  });
  assert.equal(gap.status, 'provider_gap_proposal_required');

  const failed = evaluateSourceProviderActivation({
    providerName: 'weak-feed',
    evidenceClass: 'supplier_capacity',
    sourceUrl: 'https://example.com/rss',
    probe: { status: 'failed', connectorKind: 'rss', qualityScore: 0.1 },
  });
  assert.equal(failed.status, 'quarantined');
});
