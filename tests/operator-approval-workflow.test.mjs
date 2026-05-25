import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOperatorApprovalWorkflow,
} from '../scripts/_shared/operator-approval-workflow.mjs';

test('operator approval workflow creates review-only actions for fixtures credentials and gaps', () => {
  const workflow = buildOperatorApprovalWorkflow({
    sourceProviderActivation: {
      records: [
        { candidateId: 'fixture-a', providerName: 'company_ir_direct_pdf', evidenceClass: 'issuer_exposure', status: 'needs_fixture' },
        { candidateId: 'credential-b', providerName: 'paid_provider', evidenceClass: 'market_validation', status: 'needs_credentials' },
        { candidateId: 'gap-c', providerName: 'taiwan_mops', evidenceClass: 'issuer_exposure', status: 'provider_gap_proposal_required' },
      ],
    },
  }, { now: '2026-05-22T00:00:00.000Z' });

  assert.equal(workflow.reviewOnly, true);
  assert.equal(workflow.actionCounts.provider_fixture_approval, 1);
  assert.equal(workflow.actionCounts.credential_input, 1);
  assert.equal(workflow.actionCounts.provider_gap_review, 1);
  assert.equal(workflow.mutationBoundary.providerActivationWrites, 0);
  assert.equal(workflow.mutationBoundary.reportCandidateWrites, 0);
  assert.equal(workflow.actions.every((action) => action.reviewStatus === 'pending'), true);
  assert.equal(workflow.actions.every((action) => action.expiresAt.startsWith('2026-05-29')), true);
});

test('operator approval workflow exposes human report review without promotion writes', () => {
  const workflow = buildOperatorApprovalWorkflow({
    repairLoop: {
      runId: 'repair-loop-1',
      stopReason: 'human_review_required',
      visualStatusAfter: 'human_review_required',
    },
    finalReport: {
      reportId: 'report-1',
      investmentMemoReady: false,
      decisionReady: false,
      portfolioActionAllowed: false,
    },
    sectorPositivePaths: {
      sectors: [
        { sectorId: 'grid_utility_infrastructure', realEvidenceStatus: 'blocked_until_real_official_evidence' },
      ],
    },
  }, { now: '2026-05-22T00:00:00.000Z' });

  assert.equal(workflow.actionCounts.final_memo_review, 1);
  assert.equal(workflow.actionCounts.report_promote_or_reject_decision, 1);
  assert.equal(workflow.actionCounts.real_evidence_route_review, 1);
  assert.equal(workflow.mutationBoundary.readinessPromotionWrites, 0);
  assert.equal(workflow.mutationBoundary.portfolioActionWrites, 0);
});

test('operator approval workflow exposes staged report candidate review without promotion writes', () => {
  const workflow = buildOperatorApprovalWorkflow({
    reportCandidateStaging: {
      candidates: [
        {
          reportCandidateStageId: 'report-candidate-staged-abc',
          reviewStatus: 'pending',
          stageReason: 'report candidate diagnostic gates closed',
          subject: {
            subjectId: 'dryrun-msd-child-positive',
            childSeedId: 'msd-child-positive',
            reportPath: 'data/reports/RPT/report.html',
          },
        },
      ],
    },
  }, { now: '2026-05-22T00:00:00.000Z' });

  assert.equal(workflow.actionCounts.report_candidate_staged_review, 1);
  assert.equal(workflow.actionCounts.report_promote_or_reject_decision, 1);
  assert.equal(workflow.allowedOperatorActions.includes('report_candidate_staged_review'), true);
  assert.equal(workflow.mutationBoundary.reportCandidateWrites, 0);
  assert.equal(workflow.mutationBoundary.readinessPromotionWrites, 0);
});
