import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGridIssuerNegativeRawEvidence,
  collectGridIssuerNegativeControlReadonly,
  DEFAULT_GRID_ISSUER_NEGATIVE_SOURCE_ALLOWLIST,
  summarizeGridIssuerNegativeScope,
} from '../scripts/_shared/external-data/grid-issuer-negative-control-readonly.mjs';

test('grid issuer negative-control collector closes CHECKED_NO_DIRECT with sufficient official scope', () => {
  const result = collectGridIssuerNegativeControlReadonly({
    seedId: 'track-b-negative',
    maxSources: 3,
  });
  assert.equal(result.rawEvidence.length, 3);
  assert.equal(result.scope.negativeControlStatus, 'CHECKED_NO_DIRECT');
  assert.equal(result.scope.checkedIssuerCount, 3);
  assert.equal(result.scope.checkedSourceGroupCount, 3);
  assert.ok(result.scope.checkedQueryFamilyCount >= 4);
  assert.equal(result.scope.directInvalidatorFound, false);
});

test('grid issuer negative-control marks limited scope when official coverage is insufficient', () => {
  const result = collectGridIssuerNegativeControlReadonly({
    seedId: 'track-b-negative-limited',
    sourceAllowlist: DEFAULT_GRID_ISSUER_NEGATIVE_SOURCE_ALLOWLIST.slice(0, 1),
    maxSources: 1,
  });
  assert.equal(result.scope.negativeControlStatus, 'CHECKED_NO_DIRECT_LIMITED_SCOPE');
  assert.equal(result.scope.checkedIssuerCount, 1);
});

test('grid issuer negative-control rejects weak metadata as inconclusive', () => {
  const row = buildGridIssuerNegativeRawEvidence({
    sourceId: 'weak-row',
    issuer: 'PWR',
    sourceGroup: 'official_filing',
    sourceFamily: 'sec_10k',
    sourceUrl: 'https://www.sec.gov/weak',
    documentTitle: 'Weak metadata',
    allowedForTrack: 'issuer_bridge_track',
    fixtureText: '',
  });
  const scope = summarizeGridIssuerNegativeScope([row]);
  assert.equal(row.accepted, false);
  assert.equal(scope.negativeControlStatus, 'INCONCLUSIVE');
});

test('grid issuer negative-control classifies direct invalidators as rejected', () => {
  const row = buildGridIssuerNegativeRawEvidence({
    sourceId: 'direct-invalidator',
    issuer: 'PWR',
    sourceGroup: 'official_filing',
    sourceFamily: 'sec_10q',
    sourceUrl: 'https://www.sec.gov/direct-invalidator',
    documentTitle: 'PWR direct invalidator fixture',
    queryFamilies: ['power delivery backlog decline', 'utility capex slowdown'],
    allowedForTrack: 'issuer_bridge_track',
    fixtureText: 'Management said power delivery backlog is declining due to demand slowdown and utility capex is being deferred materially.',
  });
  const scope = summarizeGridIssuerNegativeScope([row]);
  assert.equal(row.accepted, true);
  assert.equal(scope.negativeControlStatus, 'REJECTED');
  assert.equal(scope.directInvalidatorFound, true);
});

test('grid issuer negative-control classifies direct risk signals as weakened', () => {
  const row = buildGridIssuerNegativeRawEvidence({
    sourceId: 'risk-invalidator',
    issuer: 'ACM',
    sourceGroup: 'issuer_transcript',
    sourceFamily: 'earnings_transcript',
    sourceUrl: 'https://investors.example/risk',
    documentTitle: 'ACM risk signal transcript',
    queryFamilies: ['project delays hurting margin', 'fixed-price contract margin pressure'],
    allowedForTrack: 'issuer_bridge_track',
    fixtureText: 'Project delays and fixed-price contract margin pressure are hurting margin in some utility infrastructure execution work.',
  });
  const scope = summarizeGridIssuerNegativeScope([row]);
  assert.equal(row.accepted, true);
  assert.equal(scope.negativeControlStatus, 'WEAKENED');
  assert.equal(scope.weakRiskSignalCount, 1);
});
