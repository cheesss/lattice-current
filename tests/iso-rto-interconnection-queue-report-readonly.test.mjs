import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_ISO_RTO_INTERCONNECTION_QUEUE_REPORT_FIXTURES,
  buildIsoRtoInterconnectionQueueReportRawEvidence,
  collectIsoRtoInterconnectionQueueReportReadonly,
  isoRtoInterconnectionQueueReportAcceptanceDetail,
} from '../scripts/_shared/external-data/iso-rto-interconnection-queue-report-readonly.mjs';
import {
  acceptSeedEvidenceRows,
} from '../scripts/_shared/seed-evidence-acceptance.mjs';

const positiveFixture = DEFAULT_ISO_RTO_INTERCONNECTION_QUEUE_REPORT_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'positive_operating_bridge_fixture');
const noResultFixture = DEFAULT_ISO_RTO_INTERCONNECTION_QUEUE_REPORT_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'no_result_fixture');
const timeoutFixture = DEFAULT_ISO_RTO_INTERCONNECTION_QUEUE_REPORT_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'timeout_or_source_unavailable_fixture');
const tickerOnlyFixture = DEFAULT_ISO_RTO_INTERCONNECTION_QUEUE_REPORT_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'ticker_only_rejection_fixture');
const metadataOnlyFixture = DEFAULT_ISO_RTO_INTERCONNECTION_QUEUE_REPORT_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'raw_metadata_only_rejection_fixture');

test('ISO/RTO interconnection queue parser extracts engineering-process operating bridge evidence', () => {
  const row = buildIsoRtoInterconnectionQueueReportRawEvidence(positiveFixture, {
    seedId: 'seed-iso-rto',
    taskId: 'iso-rto-engineering',
    generatedAt: '2026-05-23T00:00:00.000Z',
  });
  const detail = isoRtoInterconnectionQueueReportAcceptanceDetail(row);

  assert.equal(row.providerName, 'iso_rto_interconnection_queue_report');
  assert.equal(row.evidenceClass, 'engineering_process');
  assert.equal(row.sourceGroup, 'official_grid_operator');
  assert.equal(row.failureClassification, 'ACCEPTED');
  assert.equal(row.accepted, true);
  assert.equal(detail.accepted, true);
  assert.equal(row.matchedSubjectTerms.includes('interconnection queue report'), true);
  assert.equal(row.matchedOperatingTerms.includes('processing delay'), true);
  assert.match(row.operatingBridgeSnippet, /network upgrade delay/i);
  assert.equal(row.sourceIndependence, 'official_grid_operator_report');
  assert.equal(row.promotionEligible, false);
  assert.equal(row.evidenceUse, 'supporting_context');
  assert.equal(row.mutationBoundary.readinessPromotionWrites, 0);
});

test('ISO/RTO interconnection queue parser rejects ticker-only and raw metadata-only fixtures', () => {
  const result = collectIsoRtoInterconnectionQueueReportReadonly({
    seedId: 'seed-iso-rto',
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

test('ISO/RTO interconnection queue fixture suite covers no-result and timeout classifications', () => {
  const result = collectIsoRtoInterconnectionQueueReportReadonly({
    seedId: 'seed-iso-rto',
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

test('ISO/RTO interconnection queue rows enter acceptance as supporting context only', () => {
  const collected = collectIsoRtoInterconnectionQueueReportReadonly({
    seedId: 'seed-iso-rto',
    task: {
      taskId: 'iso-rto-engineering',
      seedId: 'seed-iso-rto',
      evidenceClass: 'engineering_process',
      providerRoute: 'iso_rto_interconnection_queue_report',
      acceptanceCriteria: {
        requiredTerms: ['interconnection queue', 'network upgrade'],
        bridgeTerms: ['processing delay', 'study timeline'],
      },
    },
    generatedAt: '2026-05-23T00:00:00.000Z',
    sourceAllowlist: [positiveFixture, tickerOnlyFixture, metadataOnlyFixture],
  });
  const accepted = acceptSeedEvidenceRows(collected.rawEvidence, {
    tasks: [{
      taskId: 'iso-rto-engineering',
      seedId: 'seed-iso-rto',
      evidenceClass: 'engineering_process',
      providerRoute: 'iso_rto_interconnection_queue_report',
      acceptanceCriteria: { requiredTerms: ['interconnection queue', 'network upgrade'] },
    }],
    now: new Date('2026-05-23T00:00:00.000Z'),
  });

  assert.equal(accepted.acceptedEvidenceStoredCount, 1);
  assert.equal(accepted.acceptedEvidence[0].promotionEligible, false);
  assert.deepEqual(accepted.acceptedEvidence[0].coveredEvidenceClasses, []);
  assert.equal(accepted.rawEvidence.find((row) => row.fixtureKind === 'ticker_only_rejection_fixture').accepted, false);
  assert.equal(accepted.rawEvidence.find((row) => row.fixtureKind === 'raw_metadata_only_rejection_fixture').accepted, false);
});
