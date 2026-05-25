import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_TDNET_ISSUER_EXPOSURE_FIXTURES,
  buildTdnetIssuerExposureRawEvidence,
  collectTdnetIssuerExposureReadonly,
  tdnetIssuerExposureAcceptanceDetail,
} from '../scripts/_shared/external-data/tdnet-readonly.mjs';
import {
  acceptSeedEvidenceRows,
} from '../scripts/_shared/seed-evidence-acceptance.mjs';

const positiveFixture = DEFAULT_TDNET_ISSUER_EXPOSURE_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'positive_operating_bridge_fixture');
const noResultFixture = DEFAULT_TDNET_ISSUER_EXPOSURE_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'no_result_fixture');
const timeoutFixture = DEFAULT_TDNET_ISSUER_EXPOSURE_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'timeout_or_source_unavailable_fixture');
const tickerOnlyFixture = DEFAULT_TDNET_ISSUER_EXPOSURE_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'ticker_only_rejection_fixture');
const metadataOnlyFixture = DEFAULT_TDNET_ISSUER_EXPOSURE_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'raw_metadata_only_rejection_fixture');

test('TDnet readonly parser extracts official issuer operating bridge evidence', () => {
  const row = buildTdnetIssuerExposureRawEvidence(positiveFixture, {
    seedId: 'seed-tdnet',
    taskId: 'tdnet-issuer',
    generatedAt: '2026-05-23T00:00:00.000Z',
  });
  const detail = tdnetIssuerExposureAcceptanceDetail(row);

  assert.equal(row.providerName, 'tdnet');
  assert.equal(row.evidenceClass, 'issuer_exposure');
  assert.equal(row.sourceGroup, 'official_tdnet_disclosure');
  assert.equal(row.failureClassification, 'ACCEPTED');
  assert.equal(row.accepted, true);
  assert.equal(detail.accepted, true);
  assert.equal(row.matchedSubjectTerms.includes('ABF'), true);
  assert.equal(row.matchedOperatingTerms.includes('capacity'), true);
  assert.match(row.operatingBridgeSnippet, /customer demand/i);
  assert.equal(row.sourceIndependence, 'issuer_official_disclosure');
  assert.equal(row.mutationBoundary.readinessPromotionWrites, 0);
});

test('TDnet readonly parser rejects ticker-only and raw metadata-only fixtures', () => {
  const result = collectTdnetIssuerExposureReadonly({
    seedId: 'seed-tdnet',
    generatedAt: '2026-05-23T00:00:00.000Z',
    sourceAllowlist: [tickerOnlyFixture, metadataOnlyFixture],
  });
  const tickerOnly = result.rawEvidence.find((row) => row.fixtureKind === 'ticker_only_rejection_fixture');
  const metadataOnly = result.rawEvidence.find((row) => row.fixtureKind === 'raw_metadata_only_rejection_fixture');

  assert.equal(result.acceptedCandidateCount, 0);
  assert.equal(tickerOnly.failureClassification, 'TICKER_ONLY');
  assert.equal(tickerOnly.accepted, false);
  assert.equal(tickerOnly.promotionEligible, false);
  assert.match(tickerOnly.rejectionReason, /ticker_only/i);
  assert.equal(metadataOnly.failureClassification, 'WEAK_EVIDENCE');
  assert.equal(metadataOnly.accepted, false);
  assert.equal(metadataOnly.promotionEligible, false);
  assert.match(metadataOnly.rejectionReason, /raw_metadata_only/);
  assert.equal(result.acceptanceSafety.rawEvidenceAutoPromotes, false);
});

test('TDnet readonly fixture suite covers no-result and timeout classifications', () => {
  const result = collectTdnetIssuerExposureReadonly({
    seedId: 'seed-tdnet',
    generatedAt: '2026-05-23T00:00:00.000Z',
    sourceAllowlist: [positiveFixture, noResultFixture, timeoutFixture, tickerOnlyFixture, metadataOnlyFixture],
  });

  assert.equal(result.rawEvidence.length, 5);
  assert.equal(result.fixtureKindsCovered.includes('positive_operating_bridge_fixture'), true);
  assert.equal(result.fixtureKindsCovered.includes('no_result_fixture'), true);
  assert.equal(result.fixtureKindsCovered.includes('timeout_or_source_unavailable_fixture'), true);
  assert.equal(result.failureClassifications.ACCEPTED, 1);
  assert.equal(result.failureClassifications.NO_RESULT, 1);
  assert.equal(result.failureClassifications.TIMEOUT, 1);
  assert.equal(result.mutationBoundary.providerActivationWrites, 0);
  assert.equal(result.mutationBoundary.reportCandidateWrites, 0);
});

test('TDnet readonly rows enter acceptance only after bridge rules pass', () => {
  const collected = collectTdnetIssuerExposureReadonly({
    seedId: 'seed-tdnet',
    task: {
      taskId: 'tdnet-issuer',
      seedId: 'seed-tdnet',
      evidenceClass: 'issuer_exposure',
      providerRoute: 'tdnet',
      acceptanceCriteria: {
        requiredTerms: ['ABF substrate', 'capacity'],
        bridgeTerms: ['customer demand', 'sales'],
      },
    },
    generatedAt: '2026-05-23T00:00:00.000Z',
    sourceAllowlist: [positiveFixture, tickerOnlyFixture, metadataOnlyFixture],
  });
  const accepted = acceptSeedEvidenceRows(collected.rawEvidence, {
    tasks: [{
      taskId: 'tdnet-issuer',
      seedId: 'seed-tdnet',
      evidenceClass: 'issuer_exposure',
      providerRoute: 'tdnet',
      acceptanceCriteria: { requiredTerms: ['ABF substrate', 'capacity'] },
    }],
    now: new Date('2026-05-23T00:00:00.000Z'),
  });

  assert.equal(accepted.acceptedEvidenceStoredCount, 1);
  assert.equal(accepted.acceptedEvidence[0].promotionEligible, true);
  assert.equal(accepted.rawEvidence.find((row) => row.fixtureKind === 'ticker_only_rejection_fixture').accepted, false);
  assert.equal(accepted.rawEvidence.find((row) => row.fixtureKind === 'raw_metadata_only_rejection_fixture').accepted, false);
});
