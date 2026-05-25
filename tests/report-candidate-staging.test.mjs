import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REPORT_CANDIDATE_STAGING_VERSION,
  buildReportCandidateStaging,
} from '../scripts/_shared/report-candidate-staging.mjs';

function closedRepairLoop(overrides = {}) {
  return {
    runId: 'repair-loop-positive',
    reportCandidateAllowedDiagnostic: true,
    acceptedEvidenceAfter: 7,
    acceptedPromotionEvidenceAfter: 2,
    negativeControlAfter: 'CHECKED_NO_DIRECT',
    holdoutAfter: true,
    issuerBridgeAfter: 'closed',
    marketValidationAfter: 'controlled_ready',
    readinessAfter: {
      blockers: ['investment_memo_readiness_blocked_until_valuation_or_expectation_bridge'],
    },
    iterations: [
      {
        evidenceCountsAfter: {
          acceptedEvidenceCount: 7,
          acceptedPromotionEvidenceCount: 2,
          independentSourceBreadth: 5,
        },
        inputState: {
          selectedSeed: {
            childSeedId: 'msd-child-positive',
            parentSeedId: 'msd-parent-positive',
            bottleneckNode: 'rocket motor casing composite capacity',
            issuerUniverse: ['NOC', 'LHX'],
          },
        },
        actionResult: {
          reportCandidateAllowedDiagnostic: true,
          closureStatus: 'closure_passed_with_caveats',
          reportSubjectDryRun: {
            subjectId: 'dryrun-msd-child-positive',
            subjectLabel: 'rocket motor casing composite capacity as autonomous cross-theme bottleneck',
            childSeedId: 'msd-child-positive',
            parentSeedId: 'msd-parent-positive',
            bottleneckNode: 'rocket motor casing composite capacity',
            issuerUniverse: ['NOC', 'LHX'],
          },
        },
      },
    ],
    ...overrides,
  };
}

test('closed diagnostic report-candidate gate creates staged review without promotion writes', () => {
  const payload = buildReportCandidateStaging({
    repairLoop: closedRepairLoop(),
  }, { now: '2026-05-22T00:00:00.000Z' });

  assert.equal(payload.version, REPORT_CANDIDATE_STAGING_VERSION);
  assert.equal(payload.stagingStatus, 'staged_for_operator_review');
  assert.equal(payload.stageCount, 1);
  assert.equal(payload.candidates[0].stageStatus, 'report_candidate_staged');
  assert.equal(payload.candidates[0].reviewStatus, 'pending');
  assert.equal(payload.candidates[0].subject.childSeedId, 'msd-child-positive');
  assert.equal(payload.candidates[0].gateSnapshot.acceptedPromotionEvidenceCount, 2);
  assert.equal(payload.candidates[0].automaticPromotionAllowed, false);
  assert.equal(payload.reportCandidateWriteAllowed, false);
  assert.equal(payload.mutationBoundary.reportCandidateWrites, 0);
  assert.equal(payload.mutationBoundary.readinessPromotionWrites, 0);
  assert.equal(payload.mutationBoundary.portfolioActionWrites, 0);
  assert.equal(payload.mutationBoundary.reportCandidateStagedArtifactWrites, 1);
});

test('staging is blocked when an evidence gate is missing', () => {
  const payload = buildReportCandidateStaging({
    repairLoop: closedRepairLoop({
      acceptedPromotionEvidenceAfter: 0,
      iterations: [
        {
          evidenceCountsAfter: {
            acceptedEvidenceCount: 7,
            acceptedPromotionEvidenceCount: 0,
            independentSourceBreadth: 5,
          },
          actionResult: { reportCandidateAllowedDiagnostic: false },
        },
      ],
    }),
  }, { now: '2026-05-22T00:00:00.000Z' });

  assert.equal(payload.stagingStatus, 'blocked_no_stage');
  assert.equal(payload.stageCount, 0);
  assert.equal(payload.blockers.includes('accepted_promotion_evidence_missing'), true);
  assert.equal(payload.mutationBoundary.reportCandidateWrites, 0);
});

test('provider-blocked or unresolved route-mismatch blockers prevent staging', () => {
  for (const blocker of ['provider_blocked', 'route_mismatch']) {
    const payload = buildReportCandidateStaging({
      repairLoop: closedRepairLoop({
        readinessAfter: {
          blockers: [blocker],
        },
      }),
    }, { now: '2026-05-22T00:00:00.000Z' });
    assert.equal(payload.stagingStatus, 'blocked_no_stage');
    assert.equal(payload.blockers.includes(blocker), true);
  }
});
