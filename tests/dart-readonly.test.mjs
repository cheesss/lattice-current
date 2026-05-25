import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_DART_ISSUER_EXPOSURE_FIXTURES,
  buildDartIssuerExposureRawEvidence,
  collectDartIssuerExposureReadonly,
  dartIssuerExposureAcceptanceDetail,
} from '../scripts/_shared/external-data/dart-readonly.mjs';
import {
  acceptSeedEvidenceRows,
} from '../scripts/_shared/seed-evidence-acceptance.mjs';

const positiveFixture = DEFAULT_DART_ISSUER_EXPOSURE_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'positive_operating_bridge_fixture');
const tickerOnlyFixture = DEFAULT_DART_ISSUER_EXPOSURE_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'ticker_only_rejection_fixture');
const metadataOnlyFixture = DEFAULT_DART_ISSUER_EXPOSURE_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'raw_metadata_only_rejection_fixture');

test('DART readonly parser extracts official issuer operating bridge evidence', () => {
  const row = buildDartIssuerExposureRawEvidence(positiveFixture, {
    seedId: 'seed-dart',
    taskId: 'dart-issuer',
    generatedAt: '2026-05-23T00:00:00.000Z',
  });
  const detail = dartIssuerExposureAcceptanceDetail(row);

  assert.equal(row.providerName, 'dart');
  assert.equal(row.evidenceClass, 'issuer_exposure');
  assert.equal(row.sourceGroup, 'official_dart_filing');
  assert.equal(row.failureClassification, 'ACCEPTED');
  assert.equal(row.accepted, true);
  assert.equal(detail.accepted, true);
  assert.equal(row.matchedSubjectTerms.includes('HBM'), true);
  assert.equal(row.matchedOperatingTerms.includes('capacity'), true);
  assert.match(row.operatingBridgeSnippet, /customer demand/i);
  assert.equal(row.sourceIndependence, 'issuer_official_filing');
  assert.equal(row.mutationBoundary.readinessPromotionWrites, 0);
});

test('DART readonly parser rejects ticker-only and raw metadata-only fixtures', () => {
  const result = collectDartIssuerExposureReadonly({
    seedId: 'seed-dart',
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

test('DART readonly rows enter acceptance only after bridge rules pass', () => {
  const collected = collectDartIssuerExposureReadonly({
    seedId: 'seed-dart',
    task: {
      taskId: 'dart-issuer',
      seedId: 'seed-dart',
      evidenceClass: 'issuer_exposure',
      providerRoute: 'dart',
      acceptanceCriteria: {
        requiredTerms: ['HBM memory', 'capacity'],
        bridgeTerms: ['customer demand', 'sales'],
      },
    },
    generatedAt: '2026-05-23T00:00:00.000Z',
    sourceAllowlist: [positiveFixture, tickerOnlyFixture, metadataOnlyFixture],
  });
  const accepted = acceptSeedEvidenceRows(collected.rawEvidence, {
    tasks: [{
      taskId: 'dart-issuer',
      seedId: 'seed-dart',
      evidenceClass: 'issuer_exposure',
      providerRoute: 'dart',
      acceptanceCriteria: { requiredTerms: ['HBM memory', 'capacity'] },
    }],
    now: new Date('2026-05-23T00:00:00.000Z'),
  });

  assert.equal(accepted.acceptedEvidenceStoredCount, 1);
  assert.equal(accepted.acceptedEvidence[0].promotionEligible, true);
  assert.equal(accepted.rawEvidence.find((row) => row.fixtureKind === 'ticker_only_rejection_fixture').accepted, false);
  assert.equal(accepted.rawEvidence.find((row) => row.fixtureKind === 'raw_metadata_only_rejection_fixture').accepted, false);
});
