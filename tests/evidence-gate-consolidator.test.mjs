import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EVIDENCE_GATE_CONSOLIDATOR_VERSION,
  buildEvidenceGateConsolidation,
} from '../scripts/_shared/evidence-gate-consolidator.mjs';
import {
  buildReportCandidateStaging,
} from '../scripts/_shared/report-candidate-staging.mjs';

function promotionRow(seedId, overrides = {}) {
  return {
    evidenceId: `accepted:${seedId}:${overrides.sourceGroup || 'official_filing'}`,
    seedId,
    evidenceClass: 'issuer_exposure',
    evidenceUse: 'promotion_candidate',
    promotionEligible: true,
    sourceGroup: overrides.sourceGroup || 'official_filing',
    providerName: overrides.providerName || 'sec_10k',
    sourceUrl: overrides.sourceUrl || `https://example.com/${seedId}`,
    ...overrides,
  };
}

function acceptedGateRow(seedId, evidenceClass, overrides = {}) {
  return {
    evidenceId: `accepted:${seedId}:${evidenceClass}:${overrides.sourceGroup || 'official_grid'}`,
    seedId,
    trackId: overrides.trackId || 'issuer_bridge_track',
    evidenceClass,
    sourceGroup: overrides.sourceGroup || 'official_grid',
    providerName: overrides.providerName || evidenceClass,
    sourceUrl: overrides.sourceUrl || `https://example.com/${seedId}/${evidenceClass}`,
    ...overrides,
  };
}

test('accepted promotion evidence scattered across seeds does not open report candidate', () => {
  const consolidation = buildEvidenceGateConsolidation({
    stagedProviderLiveExecution: {
      acceptedEvidence: [
        promotionRow('seed-a', { sourceGroup: 'official_filing' }),
        promotionRow('seed-b', { sourceGroup: 'company_ir' }),
      ],
      acceptedPromotionEvidence: [
        promotionRow('seed-a', { sourceGroup: 'official_filing' }),
        promotionRow('seed-b', { sourceGroup: 'company_ir' }),
      ],
    },
  }, { now: '2026-05-24T00:00:00.000Z' });

  assert.equal(consolidation.version, EVIDENCE_GATE_CONSOLIDATOR_VERSION);
  assert.equal(consolidation.stagedForOperatorReview, false);
  assert.equal(consolidation.gateClosureStates.length, 2);
  assert.equal(consolidation.gateClosureStates.every((state) => state.reportCandidateAllowedDiagnostic === false), true);

  const staging = buildReportCandidateStaging({ evidenceGateConsolidation: consolidation });
  assert.equal(staging.stagingStatus, 'blocked_no_stage');
  assert.equal(staging.seedCentricGateClosure, true);
  assert.equal(staging.mutationBoundary.reportCandidateWrites, 0);
});

test('missing market validation produces local controlled market validation task', () => {
  const consolidation = buildEvidenceGateConsolidation({
    stagedProviderLiveExecution: {
      acceptedEvidence: [promotionRow('seed-market')],
      acceptedPromotionEvidence: [promotionRow('seed-market')],
    },
    repairLoop: {
      acceptedEvidenceAfter: 4,
      acceptedPromotionEvidenceAfter: 1,
      negativeControlAfter: 'CHECKED_NO_DIRECT',
      holdoutAfter: true,
      issuerBridgeAfter: 'closed',
      valuationBridgeStatus: 'human_review_caveated',
      iterations: [
        {
          evidenceCountsAfter: {
            acceptedEvidenceCount: 4,
            acceptedPromotionEvidenceCount: 1,
            independentSourceBreadth: 2,
          },
        },
      ],
    },
  }, { now: '2026-05-24T00:00:00.000Z' });

  assert.equal(consolidation.primaryState.nextGateAction, 'run_limited_controlled_market_validation');
  assert.equal(consolidation.primaryState.missingGates.includes('market_validation_missing'), true);
  assert.equal(consolidation.suggestedBackfillTasks.length, 1);
  assert.equal(consolidation.suggestedBackfillTasks[0].evidenceClass, 'market_validation');
  assert.equal(consolidation.suggestedBackfillTasks[0].status, 'queued_local_market_validation');
  assert.equal(consolidation.localFixtureRequirementCount, 1);
  assert.equal(consolidation.localFixtureRequirements[0].requirementType, 'local_controlled_market_validation');
  assert.equal(consolidation.operatorRequiredActions.includes('provide_local_market_or_valuation_fixture'), true);
  assert.equal(consolidation.mutationBoundary.reportCandidateWrites, 0);
});

test('trusted local valuation and regime artifact can close market and valuation gates without readiness promotion', () => {
  const consolidation = buildEvidenceGateConsolidation({
    stagedProviderLiveExecution: {
      acceptedEvidence: [
        promotionRow('seed-bridge', { sourceGroup: 'official_filing', providerName: 'sec_10k' }),
        promotionRow('seed-bridge', { sourceGroup: 'company_ir', providerName: 'issuer_ir' }),
      ],
      acceptedPromotionEvidence: [
        promotionRow('seed-bridge', { sourceGroup: 'official_filing', providerName: 'sec_10k' }),
      ],
    },
    repairLoop: {
      acceptedEvidenceAfter: 5,
      acceptedPromotionEvidenceAfter: 1,
      negativeControlAfter: 'CHECKED_NO_DIRECT',
      holdoutAfter: true,
      issuerBridgeAfter: 'closed',
      iterations: [
        {
          evidenceCountsAfter: {
            acceptedEvidenceCount: 5,
            acceptedPromotionEvidenceCount: 1,
            independentSourceBreadth: 3,
          },
        },
      ],
    },
    valuationExpectationBridge: {
      valuationBridgeStatus: 'valuation_bridge_caveated',
      expectationBridgeStatus: 'expectation_bridge_caveated',
      marketValidationStatus: 'controlled_ready',
      marketRegimeSupport: {
        marketValidationRegimeStatus: 'regime_caveated',
        marketValidationResearchUseAllowed: true,
      },
      investmentMemoReady: false,
      decisionReady: false,
      portfolioActionAllowed: false,
    },
  }, { now: '2026-05-24T00:00:00.000Z' });

  assert.equal(consolidation.stagedForOperatorReview, true);
  assert.equal(consolidation.stagedState.marketValidationStatus, 'human_review_caveated');
  assert.equal(consolidation.stagedState.valuationBridgeStatus, 'human_review_caveated');
  assert.equal(consolidation.localFixtureRequirementCount, 0);
  assert.equal(consolidation.mutationBoundary.readinessPromotionWrites, 0);
  assert.equal(consolidation.mutationBoundary.reportCandidateWrites, 0);
});

test('valuation missing does not request historical analogue fixture when analogue bridge is comparison ready', () => {
  const consolidation = buildEvidenceGateConsolidation({
    stagedProviderLiveExecution: {
      acceptedEvidence: [promotionRow('seed-valued')],
      acceptedPromotionEvidence: [promotionRow('seed-valued')],
    },
    repairLoop: {
      acceptedEvidenceAfter: 3,
      acceptedPromotionEvidenceAfter: 1,
      negativeControlAfter: 'CHECKED_NO_DIRECT',
      holdoutAfter: true,
      issuerBridgeAfter: 'closed',
      marketValidationAfter: 'controlled_ready',
      iterations: [
        {
          evidenceCountsAfter: {
            acceptedEvidenceCount: 3,
            acceptedPromotionEvidenceCount: 1,
            independentSourceBreadth: 2,
          },
        },
      ],
    },
    historicalAnalogueBridge: {
      reflectionStatus: 'comparison_ready',
      usableAnalogueCount: 3,
      bestAnalogueIds: ['a', 'b', 'c'],
    },
  }, { now: '2026-05-24T00:00:00.000Z' });

  assert.equal(consolidation.primaryState.missingGates.includes('valuation_bridge_missing'), true);
  assert.equal(consolidation.localFixtureRequirements.some((row) => row.requirementType === 'local_valuation_expectation_bridge'), true);
  assert.equal(consolidation.localFixtureRequirements.some((row) => row.requirementType === 'historical_analogue_bridge'), false);
});

test('valuation missing requests historical analogue fixture when comparison is insufficient', () => {
  const consolidation = buildEvidenceGateConsolidation({
    stagedProviderLiveExecution: {
      acceptedEvidence: [promotionRow('seed-analogue-missing')],
      acceptedPromotionEvidence: [promotionRow('seed-analogue-missing')],
    },
    repairLoop: {
      acceptedEvidenceAfter: 3,
      acceptedPromotionEvidenceAfter: 1,
      negativeControlAfter: 'CHECKED_NO_DIRECT',
      holdoutAfter: true,
      issuerBridgeAfter: 'closed',
      marketValidationAfter: 'controlled_ready',
      iterations: [
        {
          evidenceCountsAfter: {
            acceptedEvidenceCount: 3,
            acceptedPromotionEvidenceCount: 1,
            independentSourceBreadth: 2,
          },
        },
      ],
    },
    historicalAnalogueBridge: {
      reflectionStatus: 'insufficient_comparison_data',
      usableAnalogueCount: 0,
    },
  }, { now: '2026-05-24T00:00:00.000Z' });

  assert.equal(consolidation.localFixtureRequirements.some((row) => row.requirementType === 'historical_analogue_bridge'), true);
  assert.equal(consolidation.operatorRequiredActions.includes('provide_historical_analogue_fixture'), true);
});

test('all seed-centric gates closed stages only for operator review', () => {
  const consolidation = buildEvidenceGateConsolidation({
    stagedProviderLiveExecution: {
      acceptedEvidence: [
        promotionRow('seed-ready', { sourceGroup: 'official_filing', providerName: 'sec_10k' }),
        promotionRow('seed-ready', { sourceGroup: 'company_ir', providerName: 'company_ir_direct_pdf' }),
      ],
      acceptedPromotionEvidence: [
        promotionRow('seed-ready', { sourceGroup: 'official_filing', providerName: 'sec_10k' }),
      ],
    },
    repairLoop: {
      acceptedEvidenceAfter: 5,
      acceptedPromotionEvidenceAfter: 1,
      negativeControlAfter: 'SURVIVED',
      holdoutAfter: true,
      issuerBridgeAfter: 'closed',
      marketValidationAfter: 'controlled_ready',
      valuationBridgeStatus: 'human_review_caveated',
      iterations: [
        {
          evidenceCountsAfter: {
            acceptedEvidenceCount: 5,
            acceptedPromotionEvidenceCount: 1,
            independentSourceBreadth: 3,
          },
        },
      ],
    },
  }, { now: '2026-05-24T00:00:00.000Z' });

  assert.equal(consolidation.stagedForOperatorReview, true);
  assert.equal(consolidation.stagedState.reportCandidateAllowedDiagnostic, true);
  assert.deepEqual(consolidation.stagedState.missingGates, []);

  const staging = buildReportCandidateStaging({ evidenceGateConsolidation: consolidation });
  assert.equal(staging.stagingStatus, 'staged_for_operator_review');
  assert.equal(staging.stageCount, 1);
  assert.equal(staging.reportCandidateWriteAllowed, false);
  assert.equal(staging.mutationBoundary.reportCandidateWrites, 0);
  assert.equal(staging.mutationBoundary.readinessPromotionWrites, 0);
  assert.equal(staging.mutationBoundary.portfolioActionWrites, 0);
});

test('same gate action without strong progress becomes operator review instead of repeat task', () => {
  const first = buildEvidenceGateConsolidation({
    stagedProviderLiveExecution: {
      acceptedEvidence: [promotionRow('seed-repeat')],
      acceptedPromotionEvidence: [promotionRow('seed-repeat')],
    },
    repairLoop: {
      acceptedEvidenceAfter: 2,
      acceptedPromotionEvidenceAfter: 1,
      negativeControlAfter: 'CHECKED_NO_DIRECT',
      holdoutAfter: true,
      issuerBridgeAfter: 'closed',
      valuationBridgeStatus: 'human_review_caveated',
      iterations: [
        {
          evidenceCountsAfter: {
            acceptedEvidenceCount: 2,
            acceptedPromotionEvidenceCount: 1,
            independentSourceBreadth: 2,
          },
        },
      ],
    },
  }, { now: '2026-05-24T00:00:00.000Z' });

  const second = buildEvidenceGateConsolidation({
    stagedProviderLiveExecution: {
      acceptedEvidence: [promotionRow('seed-repeat')],
      acceptedPromotionEvidence: [promotionRow('seed-repeat')],
    },
    repairLoop: {
      acceptedEvidenceAfter: 2,
      acceptedPromotionEvidenceAfter: 1,
      negativeControlAfter: 'CHECKED_NO_DIRECT',
      holdoutAfter: true,
      issuerBridgeAfter: 'closed',
      valuationBridgeStatus: 'human_review_caveated',
      iterations: [
        {
          evidenceCountsAfter: {
            acceptedEvidenceCount: 2,
            acceptedPromotionEvidenceCount: 1,
            independentSourceBreadth: 2,
          },
        },
      ],
    },
    existing: first,
  }, { now: '2026-05-24T01:00:00.000Z' });

  assert.equal(second.primaryState.repeatedWithoutStrongProgress, true);
  assert.equal(second.primaryState.stopReason, 'operator_review_required_no_gate_progress');
  assert.equal(second.suggestedBackfillTasks.length, 0);
  assert.equal(second.stopReason, 'local_market_or_valuation_fixture_required');
  assert.equal(second.localFixtureRequirementCount, 1);
  assert.equal(second.localFixtureRequirements[0].gate, 'market_validation_missing');
});

test('repeated negative-control gate creates one alternate official-source task before suppression', () => {
  const baseInput = {
    stagedProviderLiveExecution: {
      acceptedEvidence: [promotionRow('seed-negative-repeat')],
      acceptedPromotionEvidence: [promotionRow('seed-negative-repeat')],
    },
    repairLoop: {
      acceptedEvidenceAfter: 3,
      acceptedPromotionEvidenceAfter: 1,
      issuerBridgeAfter: 'closed',
      iterations: [
        {
          evidenceCountsAfter: {
            acceptedEvidenceCount: 3,
            acceptedPromotionEvidenceCount: 1,
            independentSourceBreadth: 2,
          },
        },
      ],
    },
  };
  const first = buildEvidenceGateConsolidation(baseInput, { now: '2026-05-24T00:00:00.000Z' });
  const second = buildEvidenceGateConsolidation({
    ...baseInput,
    existing: first,
  }, { now: '2026-05-24T01:00:00.000Z' });
  const third = buildEvidenceGateConsolidation({
    ...baseInput,
    existing: second,
  }, { now: '2026-05-24T02:00:00.000Z' });

  assert.equal(first.primaryState.nextGateAction, 'run_limited_negative_control');
  assert.equal(first.suggestedBackfillTasks.length, 1);
  assert.equal(second.primaryState.repeatedWithoutStrongProgress, true);
  assert.equal(second.primaryState.alternateGateTaskCreated, true);
  assert.equal(second.suggestedBackfillTasks.length, 1);
  assert.match(second.suggestedBackfillTasks[0].providerRoute, /alternate-query-family/);
  assert.equal(second.activeGateRunnerStatus.status, 'gate_task_ready');
  assert.equal(second.stopReason, 'missing_seed_centric_report_gates');
  assert.equal(third.primaryState.repeatedWithoutStrongProgress, true);
  assert.equal(third.primaryState.alternateGateTaskCreated, false);
  assert.equal(third.primaryState.gateTaskSuppressionReason, 'same_gate_action_without_strong_progress_after_alternate_task');
  assert.equal(third.suggestedBackfillTasks.length, 0);
  assert.equal(third.stopReason, 'operator_review_required_no_gate_progress');
});

test('valuation-only blocked primary rotates behind actionable seed gate work', () => {
  const consolidation = buildEvidenceGateConsolidation({
    stagedProviderLiveExecution: {
      acceptedEvidence: [
        promotionRow('seed-valuation-blocked', { sourceGroup: 'official_filing' }),
        acceptedGateRow('seed-valuation-blocked', 'negative_control', { sourceGroup: 'official_negative', negativeControlStatus: 'CHECKED_NO_DIRECT' }),
        acceptedGateRow('seed-valuation-blocked', 'holdout_validation', { sourceGroup: 'utility_official' }),
        acceptedGateRow('seed-valuation-blocked', 'market_validation', { sourceGroup: 'local_market_cache', marketValidationStatus: 'controlled_ready' }),
        promotionRow('seed-actionable', { sourceGroup: 'company_ir' }),
        acceptedGateRow('seed-actionable', 'holdout_validation', { sourceGroup: 'official_holdout' }),
      ],
      acceptedPromotionEvidence: [
        promotionRow('seed-valuation-blocked', { sourceGroup: 'official_filing' }),
        promotionRow('seed-actionable', { sourceGroup: 'company_ir' }),
      ],
    },
  }, { now: '2026-05-24T00:00:00.000Z' });

  assert.equal(consolidation.primaryState.seedId, 'seed-actionable');
  assert.equal(consolidation.primaryState.nextGateAction, 'run_limited_negative_control');
  assert.equal(consolidation.valuationBlockedCandidates.length, 1);
  assert.equal(consolidation.valuationBlockedCandidates[0].seedId, 'seed-valuation-blocked');
  assert.equal(consolidation.valuationBlockedCandidates[0].blockType, 'valuation_blocked_pending_cache');
  assert.equal(consolidation.rotationReason, 'valuation_blocked_candidate_rotated_out');
  assert.equal(consolidation.suggestedBackfillTasks.some((task) => task.seedId === 'seed-valuation-blocked'), false);
});

test('all candidates valuation-blocked stops with cache requirement instead of repeated broad provider work', () => {
  const consolidation = buildEvidenceGateConsolidation({
    stagedProviderLiveExecution: {
      acceptedEvidence: [
        promotionRow('seed-cache-only', { sourceGroup: 'official_filing' }),
        acceptedGateRow('seed-cache-only', 'negative_control', { sourceGroup: 'official_negative', negativeControlStatus: 'CHECKED_NO_DIRECT' }),
        acceptedGateRow('seed-cache-only', 'holdout_validation', { sourceGroup: 'utility_official' }),
        acceptedGateRow('seed-cache-only', 'market_validation', { sourceGroup: 'local_market_cache', marketValidationStatus: 'controlled_ready' }),
      ],
      acceptedPromotionEvidence: [
        promotionRow('seed-cache-only', { sourceGroup: 'official_filing' }),
      ],
    },
  }, { now: '2026-05-24T00:00:00.000Z' });

  assert.equal(consolidation.primaryState.blockedPendingCache, true);
  assert.equal(consolidation.primaryState.blockType, 'valuation_blocked_pending_cache');
  assert.equal(consolidation.stopReason, 'valuation_context_cache_required');
  assert.equal(consolidation.suggestedBackfillTasks.length, 0);
  assert.equal(consolidation.operatorRequiredActions.includes('provide_local_market_or_valuation_fixture'), true);
});
