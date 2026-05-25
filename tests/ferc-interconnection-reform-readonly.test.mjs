import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_FERC_INTERCONNECTION_REFORM_FIXTURES,
  buildFercInterconnectionReformRawEvidence,
  collectFercInterconnectionReformReadonly,
  fercInterconnectionReformAcceptanceDetail,
} from '../scripts/_shared/external-data/ferc-interconnection-reform-readonly.mjs';
import {
  acceptSeedEvidenceRows,
} from '../scripts/_shared/seed-evidence-acceptance.mjs';

const positiveFixture = DEFAULT_FERC_INTERCONNECTION_REFORM_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'positive_operating_bridge_fixture');
const noResultFixture = DEFAULT_FERC_INTERCONNECTION_REFORM_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'no_result_fixture');
const timeoutFixture = DEFAULT_FERC_INTERCONNECTION_REFORM_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'timeout_or_source_unavailable_fixture');
const tickerOnlyFixture = DEFAULT_FERC_INTERCONNECTION_REFORM_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'ticker_only_rejection_fixture');
const metadataOnlyFixture = DEFAULT_FERC_INTERCONNECTION_REFORM_FIXTURES
  .find((fixture) => fixture.fixtureKind === 'raw_metadata_only_rejection_fixture');

test('FERC interconnection reform parser extracts engineering-process operating bridge evidence', () => {
  const row = buildFercInterconnectionReformRawEvidence(positiveFixture, {
    seedId: 'seed-ferc',
    taskId: 'ferc-engineering',
    generatedAt: '2026-05-23T00:00:00.000Z',
  });
  const detail = fercInterconnectionReformAcceptanceDetail(row);

  assert.equal(row.providerName, 'ferc_interconnection_reform');
  assert.equal(row.evidenceClass, 'engineering_process');
  assert.equal(row.sourceGroup, 'official_government');
  assert.equal(row.failureClassification, 'ACCEPTED');
  assert.equal(row.accepted, true);
  assert.equal(detail.accepted, true);
  assert.equal(row.matchedSubjectTerms.includes('interconnection reform'), true);
  assert.equal(row.matchedOperatingTerms.includes('queue processing'), true);
  assert.match(row.operatingBridgeSnippet, /study delay/i);
  assert.equal(row.sourceIndependence, 'official_government_rulemaking');
  assert.equal(row.promotionEligible, false);
  assert.equal(row.evidenceUse, 'supporting_context');
  assert.equal(row.mutationBoundary.readinessPromotionWrites, 0);
});

test('FERC interconnection reform parser extracts permitting-regulatory operating bridge evidence', () => {
  const row = buildFercInterconnectionReformRawEvidence(positiveFixture, {
    seedId: 'seed-ferc',
    taskId: 'ferc-permitting',
    evidenceClass: 'permitting_regulatory',
    generatedAt: '2026-05-23T00:00:00.000Z',
  });
  const detail = fercInterconnectionReformAcceptanceDetail(row);

  assert.equal(row.providerName, 'ferc_interconnection_reform');
  assert.equal(row.evidenceClass, 'permitting_regulatory');
  assert.equal(row.desiredEvidenceClass, 'permitting_regulatory');
  assert.equal(row.failureClassification, 'ACCEPTED');
  assert.equal(row.accepted, true);
  assert.equal(detail.accepted, true);
  assert.equal(row.matchedSubjectTerms.includes('interconnection reform'), true);
  assert.equal(row.matchedOperatingTerms.includes('compliance filing'), true);
  assert.match(row.operatingBridgeSnippet, /tariff revisions/i);
  assert.equal(row.sourceIndependence, 'official_government_rulemaking');
  assert.equal(row.promotionEligible, false);
  assert.equal(row.evidenceUse, 'supporting_context');
});

test('FERC interconnection reform parser rejects ticker-only and raw metadata-only fixtures', () => {
  const result = collectFercInterconnectionReformReadonly({
    seedId: 'seed-ferc',
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

test('FERC interconnection reform fixture suite covers no-result and timeout classifications', () => {
  const result = collectFercInterconnectionReformReadonly({
    seedId: 'seed-ferc',
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

test('FERC interconnection reform rows enter acceptance as supporting context only', () => {
  const collected = collectFercInterconnectionReformReadonly({
    seedId: 'seed-ferc',
    task: {
      taskId: 'ferc-engineering',
      seedId: 'seed-ferc',
      evidenceClass: 'engineering_process',
      providerRoute: 'ferc_interconnection_reform',
      acceptanceCriteria: {
        requiredTerms: ['interconnection reform', 'network upgrade'],
        bridgeTerms: ['queue processing', 'study deadline'],
      },
    },
    generatedAt: '2026-05-23T00:00:00.000Z',
    sourceAllowlist: [positiveFixture, tickerOnlyFixture, metadataOnlyFixture],
  });
  const accepted = acceptSeedEvidenceRows(collected.rawEvidence, {
    tasks: [{
      taskId: 'ferc-engineering',
      seedId: 'seed-ferc',
      evidenceClass: 'engineering_process',
      providerRoute: 'ferc_interconnection_reform',
      acceptanceCriteria: { requiredTerms: ['interconnection reform', 'network upgrade'] },
    }],
    now: new Date('2026-05-23T00:00:00.000Z'),
  });

  assert.equal(accepted.acceptedEvidenceStoredCount, 1);
  assert.equal(accepted.acceptedEvidence[0].promotionEligible, false);
  assert.deepEqual(accepted.acceptedEvidence[0].coveredEvidenceClasses, []);
  assert.equal(accepted.rawEvidence.find((row) => row.fixtureKind === 'ticker_only_rejection_fixture').accepted, false);
  assert.equal(accepted.rawEvidence.find((row) => row.fixtureKind === 'raw_metadata_only_rejection_fixture').accepted, false);
});

test('FERC interconnection reform permitting-regulatory rows enter acceptance as supporting context only', () => {
  const collected = collectFercInterconnectionReformReadonly({
    seedId: 'seed-ferc',
    task: {
      taskId: 'ferc-permitting',
      seedId: 'seed-ferc',
      evidenceClass: 'permitting_regulatory',
      providerRoute: 'ferc_interconnection_reform',
      acceptanceCriteria: {
        requiredTerms: ['interconnection reform', 'site control'],
        bridgeTerms: ['compliance filing', 'tariff revisions'],
      },
    },
    generatedAt: '2026-05-23T00:00:00.000Z',
    sourceAllowlist: [positiveFixture, tickerOnlyFixture, metadataOnlyFixture],
  });
  const accepted = acceptSeedEvidenceRows(collected.rawEvidence, {
    tasks: [{
      taskId: 'ferc-permitting',
      seedId: 'seed-ferc',
      evidenceClass: 'permitting_regulatory',
      providerRoute: 'ferc_interconnection_reform',
      acceptanceCriteria: { requiredTerms: ['interconnection reform', 'site control'] },
    }],
    now: new Date('2026-05-23T00:00:00.000Z'),
  });

  assert.equal(collected.evidenceClass, 'permitting_regulatory');
  assert.equal(accepted.acceptedEvidenceStoredCount, 1);
  assert.equal(accepted.acceptedEvidence[0].promotionEligible, false);
  assert.deepEqual(accepted.acceptedEvidence[0].coveredEvidenceClasses, []);
  assert.equal(accepted.rawEvidence.find((row) => row.fixtureKind === 'ticker_only_rejection_fixture').accepted, false);
  assert.equal(accepted.rawEvidence.find((row) => row.fixtureKind === 'raw_metadata_only_rejection_fixture').accepted, false);
});
