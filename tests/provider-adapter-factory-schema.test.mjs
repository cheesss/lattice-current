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
  assert.match(proposal.healthCheckCommand, /collect-free-external-data/);
  assert.match(proposal.testCommand, /provider-adapter-patent-api/);
  assert.equal(proposal.activationAllowed, false);
  assert.equal(proposal.safetyChecklist.providerActivationAllowed, false);
});
