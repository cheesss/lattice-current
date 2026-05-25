import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProviderAdapterProposalsFromReviewItems,
} from '../scripts/_shared/provider-adapter-factory.mjs';

test('provider adapter proposal exposes required activation schema fields', () => {
  const proposals = buildProviderAdapterProposalsFromReviewItems([
    {
      seedId: 'seed-a',
      providers: ['patent_api'],
      providerGaps: ['provider_gap_patent_api'],
      evidenceClassesBlocked: ['technical_qualification'],
      sampleQueries: ['solid rocket motor qualification patent supplier'],
      theme: { key: 'defense-industrial' },
    },
  ]);

  assert.equal(proposals.length, 1);
  const proposal = proposals[0];
  assert.equal(proposal.providerName, 'patent_api');
  assert.equal(proposal.fillsEvidenceClass, 'technical_qualification');
  assert.equal(typeof proposal.authRequired, 'boolean');
  assert.equal(typeof proposal.apiKeyRequired, 'boolean');
  assert.ok(proposal.rateLimit);
  assert.equal(typeof proposal.rateLimit.policy, 'string');
  assert.ok(proposal.parserOutputSchema);
  assert.equal(Array.isArray(proposal.parserOutputSchema.requiredFields), true);
  assert.equal(proposal.parserOutputSchema.requiredFields.includes('desiredEvidenceClass'), true);
  assert.equal(Array.isArray(proposal.failureModes), true);
  assert.equal(proposal.failureModes.includes('provider_rate_limited'), true);
  assert.equal(Array.isArray(proposal.allowlistFiles), true);
  assert.equal(Array.isArray(proposal.fixtureRequirements), true);
  assert.ok(proposal.fixtureRequirement);
  assert.match(proposal.healthCheckCommand, /collect-free-external-data/);
  assert.match(proposal.testCommand, /provider-adapter-patent-api/);
  assert.equal(proposal.reviewGatedActivation, true);
  assert.equal(proposal.activationAllowed, false);
  assert.equal(proposal.safetyChecklist.providerActivationAllowed, false);
});

test('priority non-US and company IR providers expose fixture-backed adapter schema', () => {
  const proposals = buildProviderAdapterProposalsFromReviewItems([
    {
      seedId: 'seed-abf',
      providers: ['taiwan_mops', 'company_ir_direct_pdf', 'edinet', 'tdnet', 'dart'],
      providerGaps: [
        'provider_gap_taiwan_mops',
        'provider_gap_company_ir_direct_pdf',
        'provider_gap_edinet',
        'provider_gap_tdnet',
        'provider_gap_dart',
      ],
      evidenceClassesBlocked: ['issuer_exposure', 'primary_filing'],
      sampleQueries: ['ABF substrate capacity official annual report'],
      theme: { key: 'semiconductor' },
    },
  ]);
  const providers = proposals.map((proposal) => proposal.providerName).sort();
  assert.deepEqual(providers, ['company_ir_direct_pdf', 'dart', 'edinet', 'taiwan_mops', 'tdnet'].sort());
  for (const proposal of proposals) {
    assert.equal(proposal.authRequired, false);
    assert.equal(proposal.apiKeyRequired, false);
    assert.equal(proposal.reviewGatedActivation, true);
    assert.equal(proposal.activationAllowed, false);
    assert.ok(proposal.fixtureRequirement);
    assert.ok(proposal.parserOutputSchema.requiredFields.includes('desiredEvidenceClass'));
    assert.equal(proposal.safetyChecklist.providerActivationAllowed, false);
    assert.equal(proposal.failureModes.includes('NO_RESULT'), true);
    assert.equal(proposal.failureModes.includes('TIMEOUT'), true);
    assert.equal(proposal.failureModes.includes('TICKER_ONLY'), true);
    assert.equal(proposal.failureModes.includes('provider_rate_limited'), true);
  }
});
