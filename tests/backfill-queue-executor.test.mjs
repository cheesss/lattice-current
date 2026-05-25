import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildBackfillQueueExecutorPayload,
  runBackfillQueueExecutor,
} from '../scripts/_shared/backfill-queue-executor.mjs';

const TASKS = [
  {
    taskId: 'task-issuer',
    seedId: 'seed-1',
    evidenceClass: 'issuer_exposure',
    providerRoute: 'company_ir',
    status: 'queued',
    acceptanceCriteria: { requiredTerms: ['backlog'] },
  },
  {
    taskId: 'task-negative',
    seedId: 'seed-1',
    evidenceClass: 'negative_control',
    providerRoute: 'source_query',
    status: 'queued',
  },
  {
    taskId: 'task-gap',
    seedId: 'seed-1',
    evidenceClass: 'provider_data_gap',
    providerRoute: 'adapter_proposal_only',
    status: 'provider_gap_proposal_required',
  },
  {
    taskId: 'task-market',
    seedId: 'seed-1',
    evidenceClass: 'market_validation',
    providerRoute: 'local-market-validation',
    status: 'queued_local_market_validation',
  },
];

test('queued tasks store raw evidence but do not auto-accept weak/not-evaluated rows', () => {
  const payload = buildBackfillQueueExecutorPayload({ tasks: TASKS });
  assert.equal(payload.rawEvidenceStoredCount, 4);
  assert.equal(payload.acceptedEvidenceStoredCount, 0);
  assert.equal(payload.acceptedPromotionEvidenceStoredCount, 0);
  assert.equal(payload.safety.rawEvidencePromotedAutomatically, false);
  assert.equal(payload.taskResults.find((row) => row.taskId === 'task-issuer').statusAfter, 'executed_bounded_route_raw_only');
  assert.equal(payload.taskResults.find((row) => row.taskId === 'task-issuer').executedRoute, 'sec_filing');
  assert.equal(payload.taskResults.find((row) => row.taskId === 'task-market').executedRoute, 'local_controlled_market_data');
  assert.equal(payload.mutationBoundaries.providerActivationWrites, 0);
  assert.equal(payload.providerExecutionBoundary.providerActivationWrites, 0);
  assert.equal(payload.providerExecutionBoundary.sourceRegistryWrites, 0);
  assert.equal(payload.mutationBoundaries.readinessPromotionWrites, 0);
  assert.equal(payload.mutationBoundaries.reportCandidateWrites, 0);
  assert.deepEqual(payload.failureTaxonomy, ['SOURCE_UNAVAILABLE', 'TIMEOUT', 'WEAK_EVIDENCE', 'TICKER_ONLY', 'NO_RESULT', 'ACCEPTED', 'CONTRADICTORY']);
  assert.equal(payload.classExecutorPlan.issuer_exposure.includes('sec_filing'), true);
  assert.equal(payload.classExecutorPlan.market_validation.includes('local_controlled_market_data'), true);
});

test('accepted evidence fixture can promote only after acceptance rules pass', () => {
  const payload = buildBackfillQueueExecutorPayload({
    tasks: [TASKS[0]],
    rawEvidenceFixtures: [
      {
        taskId: 'task-issuer',
        seedId: 'seed-1',
        evidenceClass: 'issuer_exposure',
        source: 'official company filing',
        provider: 'SEC 10-K official annual report',
        title: 'PWR official 10-K power delivery backlog guidance',
        summary: 'Official 10-K company filing links issuer segment revenue, backlog, guidance, capacity and customer demand to power delivery project execution.',
        sourceUrl: 'https://www.sec.gov/example/pwr-10k',
        evidenceUse: 'promotion_candidate',
        acceptanceVerdict: 'collector_candidate',
      },
    ],
  });
  assert.equal(payload.acceptedEvidenceStoredCount, 1);
  assert.equal(payload.acceptedPromotionEvidenceStoredCount, 1);
  assert.equal(payload.taskResults[0].statusAfter, 'executed_bounded_route_pending_acceptance');
  assert.equal(payload.taskResults[0].terminalFailureClassification, 'ACCEPTED');
  assert.deepEqual(payload.coveredEvidenceClasses, ['issuer_exposure']);
});

test('staged provider fixture execution can create accepted supporting evidence without readiness promotion', () => {
  const payload = buildBackfillQueueExecutorPayload({
    tasks: [
      {
        taskId: 'task-holdout',
        seedId: 'seed-1',
        evidenceClass: 'holdout_validation',
        providerRoute: 'holdout-validation',
        status: 'queued',
        acceptanceCriteria: { sourceGroupMustDifferFromGeneration: true },
      },
    ],
    sourceProviderActivation: {
      records: [
        {
          candidateId: 'priority:company_ir_direct_pdf:holdout_validation',
          providerName: 'company_ir_direct_pdf',
          evidenceClass: 'holdout_validation',
          sourceType: 'official_company_ir',
          providerRoute: 'company_ir_direct_pdf',
          status: 'staged',
          fixtureStatus: 'fixture_verified',
          reviewGatedActivation: true,
        },
      ],
    },
  });
  assert.equal(payload.rawEvidenceStoredCount, 1);
  assert.equal(payload.acceptedEvidenceStoredCount, 1);
  assert.equal(payload.acceptedPromotionEvidenceStoredCount, 0);
  assert.equal(payload.readinessChanged, false);
  assert.equal(payload.acceptedEvidence[0].validationFixtureOnly, true);
  assert.equal(payload.acceptedEvidence[0].evidenceUse, 'supporting_context');
  assert.equal(payload.mutationBoundaries.providerActivationWrites, 0);
  assert.equal(payload.providerExecutionBoundary.providerActivationWrites, 0);
});

test('negative control and source-query market validation do not become promotion evidence', () => {
  const payload = buildBackfillQueueExecutorPayload({
    tasks: [TASKS[1], TASKS[3]],
    rawEvidenceFixtures: [
      {
        taskId: 'task-negative',
        seedId: 'seed-1',
        evidenceClass: 'negative_control',
        source: 'seed-bias-source-query-executor',
        evidenceUse: 'negative_control_candidate',
        negativeControlFinding: 'checked_no_direct invalidator from official source search',
        summary: 'No direct negative control contradiction found in bounded source query.',
        acceptanceVerdict: 'collector_candidate',
      },
      {
        taskId: 'task-market',
        seedId: 'seed-1',
        evidenceClass: 'market_validation',
        source: 'source-query',
        providerRoute: 'source_query',
        marketTier: 'decision_grade',
        evidenceUse: 'promotion_candidate',
        acceptanceVerdict: 'collector_candidate',
      },
    ],
  });
  assert.equal(payload.acceptedEvidence.some((row) => row.evidenceClass === 'negative_control'), true);
  assert.equal(payload.acceptedPromotionEvidence.some((row) => row.evidenceClass === 'negative_control'), false);
  assert.equal(payload.acceptedPromotionEvidence.some((row) => row.evidenceClass === 'market_validation'), false);
});

test('executor writes artifact for queue state', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-backfill-queue-'));
  const payload = await runBackfillQueueExecutor({ tasks: TASKS }, {
    artifactPath: path.join(tmp, 'backfill-queue-executor.latest.json'),
  });
  assert.equal(payload.artifactPath.endsWith('backfill-queue-executor.latest.json'), true);
  assert.equal(payload.providerGapTasks.length, 1);
});
