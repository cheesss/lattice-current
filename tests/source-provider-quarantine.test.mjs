import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSourceProviderQuarantineSummary,
  isQuarantinedSourceProvider,
  quarantineSourceProviderCandidate,
} from '../scripts/_shared/source-provider-quarantine.mjs';

test('quarantine helper identifies failed and blocked provider lifecycle states', () => {
  assert.equal(isQuarantinedSourceProvider({ status: 'quarantined' }), true);
  assert.equal(isQuarantinedSourceProvider({ status: 'needs_credentials' }), true);
  assert.equal(isQuarantinedSourceProvider({ status: 'staged' }), false);
});

test('quarantine update preserves audit history', () => {
  const updated = quarantineSourceProviderCandidate({
    candidateId: 'source-1',
    providerName: 'Source 1',
    evidenceClass: 'issuer_exposure',
    statusHistory: [{ status: 'discovered_untrusted', at: '2026-01-01T00:00:00.000Z' }],
  }, 'probe_failed_or_low_quality');
  assert.equal(updated.status, 'quarantined');
  assert.equal(updated.quarantineReason, 'probe_failed_or_low_quality');
  assert.equal(updated.statusHistory.at(-1).status, 'quarantined');
});

test('quarantine summary groups by status and reason', () => {
  const summary = buildSourceProviderQuarantineSummary([
    { candidateId: 'a', providerName: 'A', evidenceClass: 'x', status: 'quarantined', quarantineReason: 'weak_quality' },
    { candidateId: 'b', providerName: 'B', evidenceClass: 'x', status: 'needs_fixture' },
    { candidateId: 'c', providerName: 'C', evidenceClass: 'x', status: 'staged' },
  ]);
  assert.equal(summary.totalRecords, 3);
  assert.equal(summary.quarantinedCount, 2);
  assert.equal(summary.byStatus.quarantined, 1);
  assert.equal(summary.byStatus.needs_fixture, 1);
});
