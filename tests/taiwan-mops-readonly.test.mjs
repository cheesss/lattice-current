import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_TAIWAN_MOPS_ISSUER_EXPOSURE_FIXTURES,
  buildTaiwanMopsIssuerExposureRawEvidence,
  collectTaiwanMopsIssuerExposureReadonly,
  taiwanMopsIssuerExposureAcceptanceDetail,
} from '../scripts/_shared/external-data/taiwan-mops-readonly.mjs';
import {
  acceptSeedEvidenceRows,
} from '../scripts/_shared/seed-evidence-acceptance.mjs';

const positiveFixture = DEFAULT_TAIWAN_MOPS_ISSUER_EXPOSURE_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'positive_operating_bridge_fixture');
const noResultFixture = DEFAULT_TAIWAN_MOPS_ISSUER_EXPOSURE_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'no_result_fixture');
const timeoutFixture = DEFAULT_TAIWAN_MOPS_ISSUER_EXPOSURE_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'timeout_or_source_unavailable_fixture');
const tickerOnlyFixture = DEFAULT_TAIWAN_MOPS_ISSUER_EXPOSURE_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'ticker_only_rejection_fixture');
const metadataOnlyFixture = DEFAULT_TAIWAN_MOPS_ISSUER_EXPOSURE_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'raw_metadata_only_rejection_fixture');

test('Taiwan MOPS readonly parser extracts official issuer operating bridge evidence', () => {
  const row = buildTaiwanMopsIssuerExposureRawEvidence(positiveFixture, {
    seedId: 'seed-mops',
    taskId: 'mops-issuer',
    generatedAt: '2026-05-23T00:00:00.000Z',
  });
  const detail = taiwanMopsIssuerExposureAcceptanceDetail(row);

  assert.equal(row.providerName, 'taiwan_mops');
  assert.equal(row.evidenceClass, 'issuer_exposure');
  assert.equal(row.sourceGroup, 'official_taiwan_mops_filing');
  assert.equal(row.failureClassification, 'ACCEPTED');
  assert.equal(row.accepted, true);
  assert.equal(detail.accepted, true);
  assert.equal(row.matchedSubjectTerms.includes('ABF'), true);
  assert.equal(row.matchedOperatingTerms.includes('capacity'), true);
  assert.match(row.operatingBridgeSnippet, /customer demand/i);
  assert.equal(row.sourceIndependence, 'issuer_official_filing');
  assert.equal(row.mutationBoundary.readinessPromotionWrites, 0);
});

test('Taiwan MOPS readonly parser rejects ticker-only and raw metadata-only fixtures', () => {
  const result = collectTaiwanMopsIssuerExposureReadonly({
    seedId: 'seed-mops',
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

test('Taiwan MOPS readonly fixture suite covers no-result and timeout classifications', () => {
  const result = collectTaiwanMopsIssuerExposureReadonly({
    seedId: 'seed-mops',
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

test('Taiwan MOPS readonly rows enter acceptance only after bridge rules pass', () => {
  const collected = collectTaiwanMopsIssuerExposureReadonly({
    seedId: 'seed-mops',
    task: {
      taskId: 'mops-issuer',
      seedId: 'seed-mops',
      evidenceClass: 'issuer_exposure',
      providerRoute: 'taiwan_mops',
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
      taskId: 'mops-issuer',
      seedId: 'seed-mops',
      evidenceClass: 'issuer_exposure',
      providerRoute: 'taiwan_mops',
      acceptanceCriteria: { requiredTerms: ['ABF substrate', 'capacity'] },
    }],
    now: new Date('2026-05-23T00:00:00.000Z'),
  });

  assert.equal(accepted.acceptedEvidenceStoredCount, 1);
  assert.equal(accepted.acceptedEvidence[0].promotionEligible, true);
  assert.equal(accepted.rawEvidence.find((row) => row.fixtureKind === 'ticker_only_rejection_fixture').accepted, false);
  assert.equal(accepted.rawEvidence.find((row) => row.fixtureKind === 'raw_metadata_only_rejection_fixture').accepted, false);
});
