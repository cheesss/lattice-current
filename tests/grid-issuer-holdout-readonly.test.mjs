import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGridIssuerHoldoutRawEvidence,
  collectGridIssuerHoldoutReadonly,
  findGridIssuerHoldoutProximity,
  gridIssuerHoldoutAcceptanceDetail,
  summarizeGridIssuerHoldoutScope,
} from '../scripts/_shared/external-data/grid-issuer-holdout-readonly.mjs';

test('utility capex plan with transmission and substation bridge is accepted holdout evidence', () => {
  const row = buildGridIssuerHoldoutRawEvidence({
    sourceId: 'utility-capex',
    sourceGroup: 'utility_capex_plan',
    sourceFamily: 'utility_capital_plan',
    sourceUrl: 'https://utility.example.test/capex',
    documentTitle: 'Utility capex plan',
    allowedForTrack: 'issuer_bridge_track',
    fixtureText: 'The approved capital plan includes transmission expansion, substation upgrade projects, and grid modernization. The approved budget and capex plan support a multi-year project pipeline for load growth.',
  }, { seedId: 'track-b' });
  assert.equal(row.accepted, true);
  assert.equal(row.holdoutStatus, 'CONFIRMED');
  assert.equal(row.evidenceUse, 'supporting_context');
  assert.equal(row.promotionEligible, false);
  assert.match(row.acceptanceReason, /independent_official_holdout_source/);
});

test('ISO/RTO planning fixture is accepted holdout evidence', () => {
  const row = buildGridIssuerHoldoutRawEvidence({
    sourceId: 'iso-rto-plan',
    sourceGroup: 'official_grid_operator_planning',
    sourceFamily: 'iso_rto_transmission_expansion_plan',
    sourceUrl: 'https://grid.example.test/plan',
    documentTitle: 'Grid operator planning report',
    allowedForTrack: 'issuer_bridge_track',
    fixtureText: 'The regional transmission expansion plan lists network upgrades and interconnection upgrades in the project pipeline. Load growth and reliability investment drive the approved project needs.',
  }, { seedId: 'track-b' });
  assert.equal(row.accepted, true);
  assert.equal(row.holdoutStatus, 'CONFIRMED');
  assert.ok(row.matchedExposureTerms.includes('transmission'));
  assert.ok(row.matchedDemandTerms.includes('project pipeline'));
});

test('generic electricity demand text is rejected', () => {
  const detail = gridIssuerHoldoutAcceptanceDetail({
    sourceGroup: 'utility_capex_plan',
    allowedForTrack: 'issuer_bridge_track',
    extractedTextSnippet: 'Electricity demand is rising and utility infrastructure is important.',
  });
  assert.equal(detail.accepted, false);
  assert.ok(detail.rejectionReasons.includes('generic_demand_without_project_bridge'));
});

test('issuer filing reused as holdout is rejected as non-independent', () => {
  const row = buildGridIssuerHoldoutRawEvidence({
    sourceId: 'pwr-10k',
    sourceGroup: 'official_filing',
    sourceFamily: 'sec_10k',
    sourceUrl: 'https://www.sec.gov/Archives/issuer-bridge-doc',
    documentTitle: 'PWR 10-K',
    allowedForTrack: 'issuer_bridge_track',
    fixtureText: 'Power delivery backlog and utility infrastructure demand are discussed with guidance.',
  }, {
    seedId: 'track-b',
    issuerBridgeSourceUrls: ['https://www.sec.gov/Archives/issuer-bridge-doc'],
  });
  assert.equal(row.accepted, false);
  assert.equal(row.failureClassification, 'SOURCE_NOT_INDEPENDENT_FROM_ISSUER_BRIDGE');
  assert.match(row.rejectionReason, /issuer_source_group_not_allowed_for_holdout|same_source_url_as_issuer_bridge/);
});

test('contradiction fixture creates CONTRADICTED scope', () => {
  const row = buildGridIssuerHoldoutRawEvidence({
    sourceId: 'utility-deferral',
    sourceGroup: 'utility_ir_or_regulatory_filing',
    sourceFamily: 'utility_regulatory_filing',
    sourceUrl: 'https://utility.example.test/deferral',
    documentTitle: 'Utility regulatory filing deferral',
    allowedForTrack: 'issuer_bridge_track',
    fixtureText: 'The utility announced a capex deferral and project cancellation for transmission expansion and substation upgrade work after a rate-case rejection.',
  }, { seedId: 'track-b' });
  const scope = summarizeGridIssuerHoldoutScope([row]);
  assert.equal(row.holdoutStatus, 'CONTRADICTED');
  assert.equal(row.accepted, false);
  assert.equal(scope.holdoutStatus, 'CONTRADICTED');
  assert.equal(scope.contradictionFound, true);
});

test('proximity match requires exposure and demand terms in the same window', () => {
  const near = findGridIssuerHoldoutProximity('Transmission expansion is funded in the approved budget and capex plan.', { windowChars: 120 });
  assert.equal(near.matched, true);
  const far = findGridIssuerHoldoutProximity(`Electric grid planning needs are listed. ${'x '.repeat(500)} The approved budget appears elsewhere.`, { windowChars: 120 });
  assert.equal(far.matched, false);
});

test('collector returns confirmed holdout scope from default official fixtures', () => {
  const collected = collectGridIssuerHoldoutReadonly({ seedId: 'track-b', maxSources: 6 });
  assert.equal(collected.version, 'grid-issuer-holdout-readonly-v1');
  assert.equal(collected.scope.holdoutStatus, 'CONFIRMED');
  assert.equal(collected.scope.holdoutConfirmed, true);
  assert.ok(collected.scope.acceptedHoldoutEvidenceCount >= 1);
  assert.ok(collected.sourceGroupsUsed.includes('utility_capex_plan'));
  assert.ok(collected.sourceGroupsUsed.includes('official_grid_operator_planning'));
});
