import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildAutomationFeedbackRemediation,
  writeAutomationFeedbackRemediationArtifact,
} from '../scripts/_shared/automation-feedback-remediation.mjs';

test('automation feedback remediation materializes fixture requirements from provider quality feedback', () => {
  const payload = buildAutomationFeedbackRemediation({
    providerQualityFeedback: {
      collectorRequirements: [
        {
          providerName: 'edinet',
          evidenceClass: 'issuer_exposure',
          priority: 1,
          recommendedRemediation: 'create_fixture_requirement',
        },
      ],
      repeatedFailureProviders: [
        {
          providerName: 'company_ir_direct_pdf',
          evidenceClass: 'issuer_exposure',
          recommendedRemediation: 'create_fixture_requirement',
        },
      ],
    },
  });

  assert.equal(payload.summary.fixtureRequirementCount, 2);
  assert.equal(payload.summary.nextSafeAction, 'create_fixture_requirement');
  assert.equal(payload.providerFixtureRequirements[0].requiredFixtures.includes('ticker_only_rejection_fixture'), true);
  assert.equal(payload.providerFixtureRequirements[0].acceptanceSafety.rawEvidenceAutoPromotes, false);
  assert.equal(payload.mutationBoundary.providerActivationWrites, 0);
  assert.equal(payload.mutationBoundary.readinessPromotionWrites, 0);
});

test('automation feedback remediation materializes targeted backfill and source bucket actions', () => {
  const payload = buildAutomationFeedbackRemediation({
    sourceDiversityFeedback: {
      underrepresentedEvidenceClasses: [
        { evidenceClass: 'material_input', observedCount: 0, acceptedPromotionCount: 0 },
        { evidenceClass: 'technical_qualification', observedCount: 1, acceptedPromotionCount: 0 },
      ],
      overrepresentedWarnings: [
        { evidenceClass: 'power_constraint', warning: 'overrepresented_bottleneck_class', recommendedAction: 'apply_source_bucket_quota' },
      ],
      sourceBucketDistribution: {
        missingBuckets: ['patent_or_paper'],
      },
    },
  });

  assert.equal(payload.summary.targetedBackfillTaskCount, 2);
  assert.equal(payload.targetedBackfillTasks.find((task) => task.evidenceClass === 'material_input').providerRoute.includes('official_filing'), true);
  assert.equal(payload.targetedBackfillTasks.every((task) => task.acceptanceCriteria.rawMetadataOnlyAccepted === false), true);
  assert.equal(payload.summary.sourceBucketActionCount, 2);
  assert.equal(payload.sourceBucketActions.some((action) => action.actionType === 'select_alternative_source_bucket'), true);
  assert.equal(payload.safetyPolicy.acceptedEvidenceRequiredForPromotion, true);
});

test('automation feedback remediation creates provider gap and quarantine recommendations without activation', () => {
  const payload = buildAutomationFeedbackRemediation({
    providerQualityFeedback: {
      repeatedFailureProviders: [
        {
          providerName: 'taiwan_mops',
          evidenceClass: 'issuer_exposure',
          recommendedRemediation: 'create_provider_gap_proposal',
        },
      ],
      quarantinedOrCooldownProviders: [
        {
          providerName: 'grid_official_readonly',
          evidenceClass: 'mechanism_validation',
          cooldownUntil: '2026-05-24T00:00:00.000Z',
        },
      ],
    },
  });

  assert.equal(payload.summary.providerGapProposalCount, 1);
  assert.equal(payload.providerGapProposals[0].reviewGatedActivation, true);
  assert.equal(payload.summary.quarantineRecommendationCount, 1);
  assert.equal(payload.quarantineRecommendations[0].activationAllowed, false);
  assert.equal(payload.mutationBoundary.sourceRegistryWrites, 0);
  assert.equal(payload.mutationBoundary.reportCandidateWrites, 0);
});

test('automation feedback remediation converts gate tasks before broad provider repair', () => {
  const payload = buildAutomationFeedbackRemediation({
    providerQualityFeedback: {
      collectorRequirements: [
        {
          providerName: 'edinet',
          evidenceClass: 'issuer_exposure',
          priority: 1,
          recommendedRemediation: 'create_fixture_requirement',
        },
      ],
    },
    evidenceGateConsolidation: {
      suggestedBackfillTasks: [
        {
          taskId: 'gate-negative-control',
          seedId: 'seed-gate',
          trackId: 'issuer_bridge_track',
          evidenceClass: 'negative_control',
          providerRoute: 'negative-control-official-route-alternate-query-family',
          status: 'queued',
          mutationBoundary: { reportCandidateWrites: 0 },
        },
      ],
      gateClosureStates: [
        {
          seedId: 'seed-cooldown',
          trackId: 'issuer_bridge_track',
          acceptedPromotionEvidenceCount: 1,
          nextGateAction: 'run_limited_negative_control',
          gateTaskSuppressionReason: 'same_gate_action_without_strong_progress_after_alternate_task',
          lastGateAttemptFingerprint: 'abc123',
        },
      ],
    },
  });

  assert.equal(payload.summary.convertedGateTaskCount, 1);
  assert.equal(payload.summary.cooldownGateTaskCount, 1);
  assert.equal(payload.summary.collectorRequirementTaskCount, 1);
  assert.equal(payload.summary.nextSafeAction, 'convert_gate_task_to_bounded_backfill');
  assert.equal(payload.convertedGateTasks[0].actionType, 'convert_gate_task_to_bounded_backfill');
  assert.equal(payload.cooldownGateTasks[0].status, 'cooldown_artifact_only');
  assert.equal(payload.collectorRequirementTasks[0].actionType, 'create_collector_requirement');
  assert.equal(payload.mutationBoundary.reportCandidateWrites, 0);
});

test('automation feedback remediation turns valuation coverage bias into an explicit safe action', () => {
  const payload = buildAutomationFeedbackRemediation({
    valuationContextRotation: {
      valuationCoverageBias: {
        coverageBiasRisk: 'high',
        warnings: [
          'valuation_context_availability_can_drive_seed_rotation',
          'next_eligible_seed_selected_from_cache_available_subset',
        ],
        missingIssuers: ['LHX', 'NOC'],
        coveredIssuers: ['PWR'],
      },
    },
  });

  assert.equal(payload.summary.valuationCoverageActionCount, 1);
  assert.equal(payload.summary.nextSafeAction, 'expand_trusted_local_valuation_context_coverage');
  assert.equal(payload.valuationCoverageActions[0].actionType, 'expand_trusted_local_valuation_context_coverage');
  assert.equal(payload.valuationCoverageActions[0].coverageBiasRisk, 'high');
  assert.deepEqual(payload.valuationCoverageActions[0].missingIssuers, ['LHX', 'NOC']);
  assert.equal(payload.valuationCoverageActions[0].mutationBoundary.readinessPromotionWrites, 0);
  assert.equal(payload.valuationCoverageActions[0].mutationBoundary.reportCandidateWrites, 0);
});

test('automation feedback remediation materializes source quality repair actions', () => {
  const payload = buildAutomationFeedbackRemediation({
    providerQualityFeedback: {
      repeatedFailureProviders: [
        {
          providerName: 'sec_10k',
          evidenceClass: 'issuer_exposure',
          recommendedRemediation: 'split_route_or_decompose_seed',
          dominantFailureClass: 'SOURCE_SEED_ROUTE_MISMATCH',
          sourceQualityBlocker: 'source route is not semantically aligned with bottleneck seed',
        },
        {
          providerName: 'company_ir_direct_pdf',
          evidenceClass: 'issuer_exposure',
          recommendedRemediation: 'create_operating_bridge_fixture_requirement',
          dominantFailureClass: 'NO_OPERATING_BRIDGE',
          sourceQualityBlocker: 'official source lacks operating bridge',
        },
        {
          providerName: 'valuation_cache',
          evidenceClass: 'market_validation',
          recommendedRemediation: 'create_valuation_bridge_requirement',
          dominantFailureClass: 'VALUATION_BRIDGE_MISSING',
          sourceQualityBlocker: 'local valuation cache missing',
        },
      ],
    },
  });

  assert.equal(payload.summary.fixtureRequirementCount, 3);
  assert.equal(payload.summary.nextSafeAction, 'split_mechanism_and_issuer_tracks');
  assert.equal(payload.nextSafeActions.some((row) => row.action === 'create_operating_bridge_fixture_requirement'), true);
  assert.equal(payload.nextSafeActions.some((row) => row.action === 'create_valuation_bridge_requirement'), true);
  const bridge = payload.providerFixtureRequirements.find((row) => row.providerName === 'company_ir_direct_pdf');
  assert.equal(bridge.failureClass, 'NO_OPERATING_BRIDGE');
  assert.equal(bridge.allowedRepairKind, 'parser_fixture');
  assert.equal(bridge.acceptanceSafety.officialGenericAccepted, false);
  assert.equal(bridge.acceptanceSafety.operatingBridgeRequired, true);
  assert.equal(bridge.forbiddenOutcome.includes('lower_acceptance_gate'), true);
  assert.equal(payload.mutationBoundary.readinessPromotionWrites, 0);
});

test('automation feedback remediation writes artifact', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-feedback-remediation-'));
  try {
    const payload = buildAutomationFeedbackRemediation({
      sourceDiversityFeedback: {
        underrepresentedEvidenceClasses: [{ evidenceClass: 'provider_data_gap' }],
      },
    });
    const artifactPath = await writeAutomationFeedbackRemediationArtifact(
      payload,
      path.join(tmp, 'automation-feedback-remediation.latest.json'),
    );
    const saved = JSON.parse(await readFile(artifactPath, 'utf8'));
    assert.equal(saved.version, 'automation-feedback-remediation-v1');
    assert.equal(saved.targetedBackfillTasks[0].status, 'provider_gap_proposal_required');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
