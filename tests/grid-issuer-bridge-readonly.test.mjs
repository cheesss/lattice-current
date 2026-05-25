import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGridIssuerBridgeRawEvidence,
  collectGridIssuerBridgeReadonly,
  DEFAULT_GRID_ISSUER_BRIDGE_SOURCE_ALLOWLIST,
  findGridIssuerBridgeProximity,
  gridIssuerBridgeAcceptanceDetail,
} from '../scripts/_shared/external-data/grid-issuer-bridge-readonly.mjs';

test('grid issuer bridge collector accepts PWR-style power delivery filing fixture', () => {
  const result = collectGridIssuerBridgeReadonly({
    seedId: 'track-b-pwr',
    maxSources: 1,
  });
  assert.equal(result.rawEvidence.length, 1);
  assert.equal(result.rawEvidence[0].issuer, 'PWR');
  assert.equal(result.rawEvidence[0].sourceGroup, 'official_filing');
  assert.equal(result.rawEvidence[0].accepted, true);
  assert.equal(result.rawEvidence[0].promotionEligible, true);
  assert.equal(result.rawEvidence[0].evidenceUse, 'promotion_candidate');
  assert.match(result.rawEvidence[0].matchedSnippet, /Power Delivery/i);
  assert.ok(result.rawEvidence[0].matchedOperatingTerms.includes('backlog'));
});

test('grid issuer bridge collector accepts ACM/J-style official issuer fixtures', () => {
  const result = collectGridIssuerBridgeReadonly({
    seedId: 'track-b-grid-issuer',
    maxSources: 3,
  });
  const acceptedIssuers = result.rawEvidence.filter((row) => row.accepted).map((row) => row.issuer);
  assert.deepEqual(acceptedIssuers, ['PWR', 'ACM', 'J']);
  assert.ok(result.sourceGroupsUsed.includes('issuer_ir'));
  assert.ok(result.sourceGroupsUsed.includes('issuer_transcript'));
});

test('grid issuer bridge proximity rejects far apart exposure and operating terms', () => {
  const text = `power delivery ${'unrelated company overview '.repeat(90)} backlog`;
  const proximity = findGridIssuerBridgeProximity(text, { windowChars: 1000 });
  assert.equal(proximity.matched, false);
  const row = buildGridIssuerBridgeRawEvidence({
    sourceId: 'far-apart',
    issuer: 'PWR',
    issuerRoleClass: 'grid_epc_capacity_owner',
    sourceGroup: 'official_filing',
    documentTitle: 'PWR filing',
    allowedForTrack: 'issuer_bridge_track',
    fixtureText: text,
  });
  assert.equal(row.accepted, false);
  assert.match(row.rejectionReason, /not_proximate/);
});

test('grid issuer bridge rejects generic infrastructure description and ticker-only rows', () => {
  const generic = buildGridIssuerBridgeRawEvidence({
    sourceId: 'generic-infra',
    issuer: 'PWR',
    issuerRoleClass: 'grid_epc_capacity_owner',
    sourceGroup: 'official_filing',
    documentTitle: 'PWR company overview',
    allowedForTrack: 'issuer_bridge_track',
    genericInfrastructureDescription: true,
    fixtureText: 'The company participates in infrastructure markets and has diversified operations.',
  });
  assert.equal(generic.accepted, false);

  const tickerOnly = gridIssuerBridgeAcceptanceDetail({
    issuer: 'PWR',
    issuerRoleClass: 'grid_epc_capacity_owner',
    sourceGroup: 'official_filing',
    tickerOnly: true,
    extractedTextSnippet: 'PWR was mentioned near power delivery backlog, but the row is ticker-only.',
  });
  assert.equal(tickerOnly.accepted, false);
  assert.ok(tickerOnly.rejectionReasons.includes('ticker_only'));
});

test('grid issuer bridge records fixture requirements instead of activating providers', () => {
  const source = {
    ...DEFAULT_GRID_ISSUER_BRIDGE_SOURCE_ALLOWLIST[0],
    sourceId: 'fixture-required',
    fixtureText: '',
  };
  const row = buildGridIssuerBridgeRawEvidence(source, {
    seedId: 'track-b-pwr',
  });
  assert.equal(row.accepted, false);
  assert.equal(row.failureClassification, 'FIXTURE_REQUIRED');
  assert.equal(row.promotionEligible, false);
});
