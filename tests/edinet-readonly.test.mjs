import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_EDINET_ISSUER_EXPOSURE_FIXTURES,
  buildEdinetIssuerExposureRawEvidence,
  collectEdinetIssuerExposureReadonly,
  edinetIssuerExposureAcceptanceDetail,
} from '../scripts/_shared/external-data/edinet-readonly.mjs';
import {
  acceptSeedEvidenceRows,
} from '../scripts/_shared/seed-evidence-acceptance.mjs';

const positiveFixture = DEFAULT_EDINET_ISSUER_EXPOSURE_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'positive_operating_bridge_fixture');
const tickerOnlyFixture = DEFAULT_EDINET_ISSUER_EXPOSURE_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'ticker_only_rejection_fixture');
const metadataOnlyFixture = DEFAULT_EDINET_ISSUER_EXPOSURE_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'raw_metadata_only_rejection_fixture');

test('EDINET readonly parser extracts official issuer operating bridge evidence', () => {
  const row = buildEdinetIssuerExposureRawEvidence(positiveFixture, {
    seedId: 'seed-edinet',
    taskId: 'edinet-issuer',
    generatedAt: '2026-05-23T00:00:00.000Z',
  });
  const detail = edinetIssuerExposureAcceptanceDetail(row);

  assert.equal(row.providerName, 'edinet');
  assert.equal(row.evidenceClass, 'issuer_exposure');
  assert.equal(row.sourceGroup, 'official_edinet_filing');
  assert.equal(row.failureClassification, 'ACCEPTED');
  assert.equal(row.accepted, true);
  assert.equal(detail.accepted, true);
  assert.equal(row.matchedSubjectTerms.includes('ABF'), true);
  assert.equal(row.matchedOperatingTerms.includes('capacity'), true);
  assert.match(row.operatingBridgeSnippet, /customer demand/i);
  assert.equal(row.sourceIndependence, 'issuer_official_filing');
  assert.equal(row.mutationBoundary.readinessPromotionWrites, 0);
});

test('EDINET readonly parser rejects ticker-only and raw metadata-only fixtures', () => {
  const result = collectEdinetIssuerExposureReadonly({
    seedId: 'seed-edinet',
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

test('EDINET readonly rows enter acceptance only after bridge rules pass', () => {
  const collected = collectEdinetIssuerExposureReadonly({
    seedId: 'seed-edinet',
    task: {
      taskId: 'edinet-issuer',
      seedId: 'seed-edinet',
      evidenceClass: 'issuer_exposure',
      providerRoute: 'edinet',
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
      taskId: 'edinet-issuer',
      seedId: 'seed-edinet',
      evidenceClass: 'issuer_exposure',
      providerRoute: 'edinet',
      acceptanceCriteria: { requiredTerms: ['ABF substrate', 'capacity'] },
    }],
    now: new Date('2026-05-23T00:00:00.000Z'),
  });

  assert.equal(accepted.acceptedEvidenceStoredCount, 1);
  assert.equal(accepted.acceptedEvidence[0].promotionEligible, true);
  assert.equal(accepted.rawEvidence.find((row) => row.fixtureKind === 'ticker_only_rejection_fixture').accepted, false);
  assert.equal(accepted.rawEvidence.find((row) => row.fixtureKind === 'raw_metadata_only_rejection_fixture').accepted, false);
});
