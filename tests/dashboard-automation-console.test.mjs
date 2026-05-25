import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildAutomationConsolePayload,
  loadAutomationConsolePayload,
} from '../scripts/_shared/automation-console-surface.mjs';

test('automation console payload summarizes runtime, activation, backfill, evidence and readiness', () => {
  const payload = buildAutomationConsolePayload({
    runtimeStatus: {
      runtimeStatus: { staleDaemon: false, daemonTaskCount: 3 },
      mutationBoundaries: {
        providerActivationWrites: 0,
        sourceRegistryWrites: 1,
        canonicalWrites: 0,
        readinessPromotionWrites: 0,
        reportCandidateWrites: 0,
        portfolioActionWrites: 0,
      },
    },
    sourceProviderActivation: {
      records: [
        { candidateId: 'a', providerName: 'A', evidenceClass: 'issuer_exposure', status: 'needs_credentials', activationBlocker: 'credentials_or_api_key_required' },
        { candidateId: 'b', providerName: 'B', evidenceClass: 'supplier_capacity', status: 'staged', fixtureStatus: 'fixture_verified', parserStatus: 'schema_declared', healthcheckStatus: 'declared' },
      ],
    },
    providerFixtureProbes: {
      version: 'source-provider-fixture-probes-v1',
      verifiedCount: 1,
      missingCount: 0,
      probeResults: [
        { candidateId: 'b', providerName: 'B', fixtureProbeStatus: 'verified' },
      ],
    },
    stagedProviderLiveExecution: {
      generatedAt: '2026-05-20T00:00:00.000Z',
      executeLive: true,
      providerCollectorRegistry: {
        ok: true,
        collectorCount: 4,
        providerCount: 4,
        providersWithCollectors: ['company_ir_direct_pdf', 'grid_official_readonly'],
      },
      stagedProviderCount: 1,
      executableTaskCount: 1,
      targetCount: 1,
      executedTargetCount: 1,
      rawEvidenceStoredCount: 3,
      acceptedEvidenceStoredCount: 2,
      acceptedPromotionEvidenceStoredCount: 1,
      coveredEvidenceClasses: ['issuer_exposure'],
      failureClassificationCounts: { ACCEPTED: 2, WEAK_EVIDENCE: 1 },
      nextActionHint: 're_evaluate_negative_holdout_issuer_market_gates',
    },
    providerQualityFeedback: {
      generatedAt: '2026-05-20T00:00:00.000Z',
      recordCount: 2,
      summary: {
        rawCount: 3,
        acceptedCount: 2,
        promotionCount: 1,
        acceptedRate: 0.6667,
        failureClassificationCounts: { ACCEPTED: 2, WEAK_EVIDENCE: 1 },
        remediationCounts: { create_fixture_requirement: 1 },
        repeatedFailureProviderCount: 1,
        collectorRequirementCount: 1,
        cooldownOrQuarantineCount: 0,
      },
      repeatedFailureProviders: [{ providerName: 'B', evidenceClass: 'issuer_exposure' }],
      collectorRequirements: [{ providerName: 'edinet', evidenceClass: 'issuer_exposure' }],
      recommendedRemediationAction: 'create_fixture_requirement',
    },
    sourceQualityScore: {
      generatedAt: '2026-05-20T00:00:00.000Z',
      recordCount: 3,
      summary: {
        averageOverallEvidenceQualityScore: 0.42,
        averageExtractionQualityScore: 0.35,
        acceptedEligibleCount: 1,
        promotionEligibleCount: 1,
        routeMismatchCount: 1,
        extractionWeakCount: 1,
        officialButGenericCount: 1,
        terminalBlockerCount: 2,
        failureReasonCounts: {
          OFFICIAL_BUT_GENERIC: 1,
          SOURCE_SEED_ROUTE_MISMATCH: 1,
        },
      },
      terminalBlockers: [
        { providerName: 'sec_10k', evidenceClass: 'issuer_exposure', blockType: 'source_seed_route_mismatch' },
      ],
    },
    sourceDiversityFeedback: {
      generatedAt: '2026-05-20T00:00:00.000Z',
      sourceBucketDistribution: {
        counts: { official_filing: 2, company_ir: 1, generated_report: 1 },
        shares: { official_filing: 0.5, company_ir: 0.25, generated_report: 0.25 },
        entropy: 1.5,
        missingBuckets: ['trade_media'],
      },
      underrepresentedEvidenceClasses: [{ evidenceClass: 'material_input' }],
      sourceBucketQuotaWarnings: [{ warning: 'generated_artifact_bucket_over_quota' }],
      reportCooldowns: [{ subjectKey: 'recent report' }],
      recommendedNextAction: 'create_targeted_backfill_task',
    },
    automationFeedbackRemediation: {
      generatedAt: '2026-05-20T00:00:00.000Z',
      summary: {
        fixtureRequirementCount: 1,
        providerGapProposalCount: 0,
        targetedBackfillTaskCount: 1,
        quarantineRecommendationCount: 0,
        sourceBucketActionCount: 1,
        valuationCoverageActionCount: 1,
        nextSafeAction: 'create_fixture_requirement',
      },
      nextSafeActions: [
        { action: 'create_fixture_requirement', count: 1 },
        { action: 'create_targeted_backfill_task', count: 1 },
      ],
      providerFixtureRequirements: [{ providerName: 'edinet', evidenceClass: 'issuer_exposure' }],
      targetedBackfillTasks: [{ evidenceClass: 'material_input' }],
      convertedGateTasks: [{ taskId: 'gate-market', evidenceClass: 'market_validation' }],
      cooldownGateTasks: [{ taskId: 'cooldown-negative', nextGateAction: 'run_limited_negative_control' }],
      collectorRequirementTasks: [{ providerName: 'edinet', evidenceClass: 'issuer_exposure' }],
      sourceBucketActions: [{ actionType: 'apply_source_bucket_quota' }],
      valuationCoverageActions: [{ actionType: 'expand_trusted_local_valuation_context_coverage', coverageBiasRisk: 'high' }],
    },
    automationFeedbackCodeRepair: {
      generatedAt: '2026-05-20T00:00:00.000Z',
      mode: 'plan_only',
      requestCount: 1,
      executedCount: 0,
      ok: true,
      runs: [
        {
          request: { requestId: 'code-repair-edinet-issuer-exposure', providerName: 'edinet', evidenceClass: 'issuer_exposure' },
          executed: false,
          status: 'planned',
        },
      ],
    },
    backfillQueue: {
      taskCount: 2,
      queuedCounts: { queued: 1, provider_gap_proposal_required: 1 },
      rawEvidenceStoredCount: 2,
      acceptedEvidenceStoredCount: 1,
      acceptedPromotionEvidenceStoredCount: 1,
      coveredEvidenceClasses: ['issuer_exposure'],
    },
    evidenceGateConsolidation: {
      generatedAt: '2026-05-20T00:00:00.000Z',
      stateCount: 1,
      candidateSeed: { seedId: 'msd-child-positive', trackId: 'issuer_bridge_track' },
      primaryState: {
        seedId: 'msd-child-positive',
        trackId: 'issuer_bridge_track',
        closedGates: ['accepted_promotion_evidence', 'issuer_bridge'],
        missingGates: ['market_validation_missing'],
        nextGateAction: 'run_limited_controlled_market_validation',
        whyNotReportCandidate: 'missing gates: market_validation_missing',
        gateClosureProgress: 0.75,
      },
      suggestedBackfillTaskCount: 1,
      nextGateTask: {
        taskId: 'gate-market',
        seedId: 'msd-child-positive',
        trackId: 'issuer_bridge_track',
        evidenceClass: 'market_validation',
        providerRoute: 'local-market-validation',
        status: 'queued_local_market_validation',
      },
      activeGateRunnerStatus: {
        status: 'gate_task_ready',
        selectedAction: 'run_limited_controlled_market_validation',
        suggestedBackfillTaskCount: 1,
      },
      localFixtureRequirementCount: 1,
      localFixtureRequirements: [
        {
          requirementId: 'local-fixture-market',
          requirementType: 'local_controlled_market_validation',
          seedId: 'msd-child-positive',
          trackId: 'issuer_bridge_track',
          gate: 'market_validation_missing',
          status: 'local_market_or_valuation_fixture_required',
          issuerUniverse: ['NOC'],
        },
      ],
      operatorRequiredActions: ['provide_local_market_or_valuation_fixture'],
      stagedForOperatorReview: false,
      stopReason: 'missing_seed_centric_report_gates',
      nextGateAction: 'run_limited_controlled_market_validation',
      whyNotReportCandidate: 'missing gates: market_validation_missing',
    },
    valuationExpectationBridge: {
      generatedAt: '2026-05-20T00:00:00.000Z',
      valuationBridgeStatus: 'valuation_bridge_missing',
      expectationBridgeStatus: 'expectation_bridge_missing',
      marketValidationRegimeStatus: 'regime_missing',
      marketValidationResearchUseAllowed: false,
      investmentMemoReady: false,
      decisionReady: false,
      portfolioActionAllowed: false,
      missingValuationFields: ['peerRelativeMultiple'],
      nextRecommendedAction: 'collect_missing_valuation_expectation_context',
    },
    historicalAnalogueBridge: {
      generatedAt: '2026-05-20T00:00:00.000Z',
      analogueCount: 3,
      usableAnalogueCount: 2,
      bestAnalogueIds: ['solid_rocket_motor_capacity_2022', 'defense_composite_motor_case_capacity_2023'],
      reflectionStatus: 'comparison_ready',
      missingInputs: [],
      pricedInRisk: false,
    },
    valuationContextAutoLinker: {
      generatedAt: '2026-05-20T00:00:00.000Z',
      candidateSeed: { seedId: 'msd-child-positive', trackId: 'issuer_bridge_track' },
      gateEligible: true,
      issuerCoverage: {
        issuerCount: 2,
        contextRowCount: 1,
        missingIssuerFundamentals: ['NOC'],
        rejectedIssuers: [],
        peerBasketSources: ['trusted_local_valuation_cache'],
      },
      missingIssuerFundamentals: ['NOC'],
      reflectionStatus: 'under_reflected_candidate',
      pricedInRisk: false,
      nextRequiredFixture: {
        requirementId: 'valuation-context-noc',
        requirementType: 'local_valuation_expectation_context',
        issuer: 'NOC',
        status: 'local_market_or_valuation_fixture_required',
        reason: 'missing_trusted_local_valuation_context',
      },
      fixtureRequirementCount: 1,
      valuationCoverageBias: {
        coverageBiasRisk: 'high',
        warnings: ['valuation_context_availability_can_drive_seed_rotation'],
        missingIssuers: ['NOC'],
        coveredIssuers: ['LHX'],
        recommendedAction: 'expand_trusted_local_valuation_context_coverage',
      },
    },
    valuationContextRotation: {
      generatedAt: '2026-05-20T00:00:00.000Z',
      activeCandidateSeed: { seedId: 'msd-child-positive', trackId: 'issuer_bridge_track' },
      valuationBlockedCandidates: [
        {
          seedId: 'msd-child-positive',
          trackId: 'issuer_bridge_track',
          blockType: 'valuation_blocked_pending_cache',
          missingIssuerFundamentals: ['NOC'],
          fixtureRequirementCount: 1,
        },
      ],
      missingIssuerFundamentalsBySeed: {
        'msd-child-positive::issuer_bridge_track': ['NOC'],
      },
      nextEligibleSeed: null,
      rotationReason: 'valuation_context_cache_required',
      valuationContextRequirements: [
        {
          requirementId: 'valuation-context-noc',
          requirementType: 'local_valuation_expectation_context',
          seedId: 'msd-child-positive',
          trackId: 'issuer_bridge_track',
          issuer: 'NOC',
          status: 'local_market_or_valuation_fixture_required',
          reason: 'missing_trusted_local_valuation_context',
        },
      ],
      stopReason: 'valuation_context_cache_required',
      valuationCoverageBias: {
        coverageBiasRisk: 'high',
        warnings: ['valuation_context_availability_can_drive_seed_rotation'],
        missingIssuers: ['NOC'],
        coveredIssuers: ['LHX'],
        recommendedAction: 'expand_trusted_local_valuation_context_coverage',
      },
    },
    valuationContextRequirementExecutor: {
      generatedAt: '2026-05-20T00:01:00.000Z',
      taskCount: 1,
      valuationRequirementTasks: [
        {
          taskId: 'valuation-context-noc-task',
          requirementId: 'valuation-context-noc',
          seedId: 'msd-child-positive',
          trackId: 'issuer_bridge_track',
          issuer: 'NOC',
          status: 'valuation_context_source_unavailable',
          failureReason: 'trusted_local_price_context_missing',
        },
      ],
      valuationContextRowsCreated: 0,
      missingIssuerFundamentalsAfterExecution: ['NOC'],
      valuationContextSourceStatus: 'valuation_context_source_unavailable',
      valuationContextExecutionFailureReason: 'trusted_local_market_or_valuation_context_missing',
      activeValuationBlockedSeed: { seedId: 'msd-child-positive', trackId: 'issuer_bridge_track' },
      nextSeedRotationAction: 'wait_for_trusted_local_valuation_context_or_new_seed',
      dbContextRead: { enabled: true, source: 'postgres', status: 'no_context_rows', marketQuoteRowCount: 0, companyFundamentalRowCount: 0 },
    },
    reportCandidateStaging: {
      stagingStatus: 'staged_for_operator_review',
      stageCount: 1,
      reviewOnly: true,
      automaticPromotionAllowed: false,
      reportCandidateWriteAllowed: false,
      candidates: [
        {
          reportCandidateStageId: 'report-candidate-staged-abc',
          reviewStatus: 'pending',
          stageStatus: 'report_candidate_staged',
          subject: {
            subjectId: 'dryrun-msd-child-positive',
            subjectLabel: 'rocket motor casing composite capacity',
            childSeedId: 'msd-child-positive',
            bottleneckNode: 'rocket motor casing composite capacity',
          },
          gateSnapshot: {
            acceptedEvidenceCount: 7,
            acceptedPromotionEvidenceCount: 2,
            independentSourceBreadth: 5,
            negativeControlStatus: 'CHECKED_NO_DIRECT',
            holdoutConfirmed: true,
            issuerBridgeStatus: 'closed',
            marketValidationStatus: 'controlled_ready',
          },
        },
      ],
    },
    repairLoop: {
      mode: 'execute-safe',
      stopReason: 'operator_review_required_provider_gap',
      selectedAction: 'create_provider_gap_proposal',
      rawEvidenceAfter: 2,
      acceptedEvidenceAfter: 1,
      acceptedPromotionEvidenceAfter: 1,
      visualStatusAfter: 'human_review_required',
      reportCandidateAllowedAfter: false,
      valuationBridgeStatus: 'missing',
      expectationBridgeStatus: 'blocked',
      localValuationCacheMissingIssuers: ['PWR'],
    },
    finalReport: {
      investmentMemoReady: false,
      decisionReady: false,
      portfolioActionAllowed: false,
      finalBlocker: 'human_review_required',
    },
    sectorPositivePaths: {
      ok: true,
      sectorCount: 6,
      validationFixtureOnlyCount: 6,
      validationErrors: [],
      sectors: [
        {
          sectorId: 'healthcare_glp1_manufacturing',
          bottleneckNode: 'sterile fill-finish line capacity for injectable GLP-1 drugs',
          validationFixtureOnly: true,
          portfolioActionAllowed: false,
        },
      ],
    },
  });
  assert.equal(payload.endpoint, '/api/research-seeds/automation-console');
  assert.equal(payload.sourceProviderActivation.counts.needsCredentials, 1);
  assert.equal(payload.providerFixtureProbes.verifiedCount, 1);
  assert.equal(payload.providerFixtureProbes.missingCount, 0);
  assert.equal(payload.providerCollectorRegistry.collectorCount >= 4, true);
  assert.equal(payload.providerCollectorRegistry.providersWithCollectors.includes('company_ir_direct_pdf'), true);
  assert.equal(payload.stagedProviderLiveExecution.targetCount, 1);
  assert.equal(payload.stagedProviderLiveExecution.acceptedPromotionEvidenceCount, 1);
  assert.equal(payload.providerQualityFeedback.acceptedRate, 0.6667);
  assert.equal(payload.providerQualityFeedback.repeatedFailureProviderCount, 1);
  assert.equal(payload.providerQualityFeedback.collectorRequirementCount, 1);
  assert.equal(payload.providerQualityFeedback.recommendedRemediationAction, 'create_fixture_requirement');
  assert.equal(payload.sourceQualityScore.available, true);
  assert.equal(payload.sourceQualityScore.recordCount, 3);
  assert.equal(payload.sourceQualityScore.routeMismatchCount, 1);
  assert.equal(payload.sourceQualityScore.officialButGenericCount, 1);
  assert.equal(payload.sourceQualityScore.terminalBlockerCount, 2);
  assert.equal(payload.sourceDiversityFeedback.sourceBucketDistribution.entropy, 1.5);
  assert.equal(payload.sourceDiversityFeedback.underrepresentedEvidenceClasses[0].evidenceClass, 'material_input');
  assert.equal(payload.sourceDiversityFeedback.recommendedNextAction, 'create_targeted_backfill_task');
  assert.equal(payload.automationFeedbackRemediation.nextSafeAction, 'create_fixture_requirement');
  assert.equal(payload.automationFeedbackRemediation.fixtureRequirementCount, 1);
  assert.equal(payload.automationFeedbackRemediation.targetedBackfillTaskCount, 1);
  assert.equal(payload.automationFeedbackRemediation.convertedGateTasks.length, 1);
  assert.equal(payload.automationFeedbackRemediation.cooldownGateTasks.length, 1);
  assert.equal(payload.automationFeedbackRemediation.collectorRequirementTasks.length, 1);
  assert.equal(payload.automationFeedbackRemediation.valuationCoverageActionCount, 1);
  assert.equal(payload.automationFeedbackRemediation.valuationCoverageActions[0].coverageBiasRisk, 'high');
  assert.equal(payload.automationFeedbackCodeRepair.available, true);
  assert.equal(payload.automationFeedbackCodeRepair.mode, 'plan_only');
  assert.equal(payload.automationFeedbackCodeRepair.requestCount, 1);
  assert.equal(payload.backfillQueue.taskCount, 2);
  assert.equal(payload.evidenceGateConsolidation.available, true);
  assert.equal(payload.evidenceGateConsolidation.candidateSeed.seedId, 'msd-child-positive');
  assert.equal(payload.evidenceGateConsolidation.nextGateAction, 'run_limited_controlled_market_validation');
  assert.equal(payload.evidenceGateConsolidation.suggestedBackfillTaskCount, 1);
  assert.equal(payload.evidenceGateConsolidation.nextGateTask.taskId, 'gate-market');
  assert.equal(payload.evidenceGateConsolidation.activeGateRunnerStatus.status, 'gate_task_ready');
  assert.equal(payload.activeGateRunnerStatus.status, 'gate_task_ready');
  assert.equal(payload.evidenceGateConsolidation.localFixtureRequirementCount, 1);
  assert.equal(payload.evidenceGateConsolidation.localFixtureRequirements[0].requirementType, 'local_controlled_market_validation');
  assert.equal(payload.operatorRequiredActions.includes('provide_local_market_or_valuation_fixture'), true);
  assert.equal(payload.valuationExpectationBridge.available, true);
  assert.equal(payload.valuationExpectationBridge.valuationBridgeStatus, 'valuation_bridge_missing');
  assert.equal(payload.historicalAnalogueBridge.available, true);
  assert.equal(payload.historicalAnalogueBridge.usableAnalogueCount, 2);
  assert.equal(payload.historicalAnalogueBridge.reflectionStatus, 'comparison_ready');
  assert.equal(payload.valuationContextAutoLinker.available, true);
  assert.equal(payload.valuationContextAutoLinker.gateEligible, true);
  assert.equal(payload.valuationContextAutoLinker.issuerCoverage.contextRowCount, 1);
  assert.deepEqual(payload.valuationContextAutoLinker.missingIssuerFundamentals, ['NOC']);
  assert.equal(payload.valuationContextAutoLinker.nextRequiredFixture.issuer, 'NOC');
  assert.equal(payload.valuationContextAutoLinker.valuationCoverageBias.coverageBiasRisk, 'high');
  assert.equal(payload.valuationContextRotation.available, true);
  assert.equal(payload.valuationContextRotation.valuationBlockedCandidateCount, 1);
  assert.equal(payload.valuationContextRotation.valuationContextRequirementCount, 1);
  assert.equal(payload.valuationContextRotation.rotationReason, 'valuation_context_cache_required');
  assert.equal(payload.valuationContextRotation.valuationCoverageBias.recommendedAction, 'expand_trusted_local_valuation_context_coverage');
  assert.equal(payload.valuationContextRequirementExecutor.available, true);
  assert.equal(payload.valuationContextRequirementExecutor.taskCount, 1);
  assert.equal(payload.valuationContextRequirementExecutor.valuationContextSourceStatus, 'valuation_context_source_unavailable');
  assert.equal(payload.valuationContextRequirementExecutor.nextSeedRotationAction, 'wait_for_trusted_local_valuation_context_or_new_seed');
  assert.equal(payload.valuationContextRequirementExecutor.nextExecutableGateAction, 'build_trusted_valuation_context');
  assert.equal(payload.valuationContextRequirementExecutor.dbContextRead.status, 'no_context_rows');
  assert.equal(payload.operatorRequiredActions.includes('provide_local_valuation_context'), true);
  assert.equal(payload.evidenceState.acceptedEvidenceCount, 3);
  assert.equal(payload.evidenceState.acceptedPromotionEvidenceCount, 2);
  assert.equal(payload.readiness.portfolioActionAllowed, false);
  assert.equal(payload.readiness.valuationBridgeStatus, 'missing');
  assert.deepEqual(payload.readiness.missingIssuerFundamentals, ['PWR']);
  assert.equal(payload.reportCandidateStaging.stageCount, 1);
  assert.equal(payload.reportCandidateStaging.reportCandidateWriteAllowed, false);
  assert.equal(payload.approvalWorkflow.actionCounts.credential_input, 1);
  assert.equal(payload.approvalWorkflow.actionCounts.report_candidate_staged_review, 1);
  assert.equal(payload.approvalWorkflow.mutationBoundary.reportCandidateWrites, 0);
  assert.equal(payload.daemonRuntimeStatus.stale, false);
  assert.equal(payload.codexRepairLaneStatus.mode, 'plan_only');
  assert.equal(payload.operatorRequiredActions.includes('enter_provider_credentials'), true);
  assert.equal(payload.operatorRequiredActions.includes('credential_input'), true);
  assert.equal(payload.operatorRequiredActions.includes('report_candidate_staged_review'), true);
  assert.equal(payload.audit.backfillQueue.taskCount, 2);
  assert.equal(payload.audit.reportCandidateStaging.stageCount, 1);
  assert.equal(payload.audit.providerFixtureProbes.probeResults.length, 1);
  assert.equal(payload.audit.stagedProviderLiveExecution.executedTargetCount, 1);
  assert.equal(payload.sectorPositivePaths.sectorCount, 6);
  assert.equal(payload.sectorPositivePaths.sectors[0].validationFixtureOnly, true);
});

test('dashboard API and surface expose automation console route', () => {
  const apiSource = readFileSync(new URL('../scripts/event-dashboard-api.mjs', import.meta.url), 'utf8');
  const surfaceSource = readFileSync(new URL('../src/dashboard/surfaces/research-seeds.mjs', import.meta.url), 'utf8');
  assert.match(apiSource, /segments\[2\] === 'automation-console'/);
  assert.match(apiSource, /loadAutomationConsolePayload/);
  assert.match(surfaceSource, /\/api\/research-seeds\/automation-console/);
  assert.match(surfaceSource, /loadResearchAutomationConsole/);
});

test('automation console loader reads provider fixture probe artifact', async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'lattice-console-fixture-'));
  try {
    await writeFile(path.join(runtimeRoot, 'source-provider-activation.latest.json'), JSON.stringify({
      records: [
        { candidateId: 'p1', providerName: 'company_ir_direct_pdf', evidenceClass: 'issuer_exposure', status: 'staged', fixtureStatus: 'fixture_verified' },
      ],
    }), 'utf8');
    await writeFile(path.join(runtimeRoot, 'source-provider-fixture-probes.latest.json'), JSON.stringify({
      version: 'source-provider-fixture-probes-v1',
      verifiedCount: 1,
      missingCount: 0,
      probeResults: [{ candidateId: 'p1', fixtureProbeStatus: 'verified' }],
    }), 'utf8');
    await writeFile(path.join(runtimeRoot, 'staged-provider-live-executor.latest.json'), JSON.stringify({
      version: 'staged-provider-live-executor-v1',
      providerCollectorRegistry: {
        ok: true,
        collectorCount: 4,
        providerCount: 4,
      },
      targetCount: 1,
      executedTargetCount: 1,
      rawEvidenceStoredCount: 1,
      acceptedEvidenceStoredCount: 0,
      acceptedPromotionEvidenceStoredCount: 0,
      failureClassificationCounts: { WEAK_EVIDENCE: 1 },
    }), 'utf8');
    await writeFile(path.join(runtimeRoot, 'provider-quality-feedback.latest.json'), JSON.stringify({
      version: 'provider-quality-feedback-v1',
      recordCount: 1,
      summary: {
        rawCount: 1,
        acceptedCount: 0,
        promotionCount: 0,
        acceptedRate: 0,
        repeatedFailureProviderCount: 1,
        collectorRequirementCount: 1,
      },
      recommendedRemediationAction: 'create_fixture_requirement',
    }), 'utf8');
    await writeFile(path.join(runtimeRoot, 'source-quality-score.latest.json'), JSON.stringify({
      version: 'source-quality-score-v1',
      recordCount: 1,
      summary: {
        averageOverallEvidenceQualityScore: 0.25,
        averageExtractionQualityScore: 0.2,
        acceptedEligibleCount: 0,
        promotionEligibleCount: 0,
        routeMismatchCount: 0,
        extractionWeakCount: 1,
        officialButGenericCount: 1,
        terminalBlockerCount: 1,
        failureReasonCounts: { EXTRACTION_WEAK: 1, OFFICIAL_BUT_GENERIC: 1 },
      },
      terminalBlockers: [{ providerName: 'company_ir_direct_pdf', evidenceClass: 'issuer_exposure', blockType: 'document_extraction_weak' }],
    }), 'utf8');
    await writeFile(path.join(runtimeRoot, 'source-diversity-feedback.latest.json'), JSON.stringify({
      version: 'source-diversity-feedback-v1',
      sourceBucketDistribution: { counts: { company_ir: 1 }, shares: { company_ir: 1 }, entropy: 0, missingBuckets: [] },
      underrepresentedEvidenceClasses: [{ evidenceClass: 'material_input' }],
      recommendedNextAction: 'create_targeted_backfill_task',
    }), 'utf8');
    await writeFile(path.join(runtimeRoot, 'automation-feedback-remediation.latest.json'), JSON.stringify({
      version: 'automation-feedback-remediation-v1',
      summary: {
        fixtureRequirementCount: 1,
        providerGapProposalCount: 0,
        targetedBackfillTaskCount: 1,
        quarantineRecommendationCount: 0,
        sourceBucketActionCount: 0,
        nextSafeAction: 'create_fixture_requirement',
      },
      nextSafeActions: [{ action: 'create_fixture_requirement', count: 1 }],
      providerFixtureRequirements: [{ providerName: 'edinet', evidenceClass: 'issuer_exposure' }],
      targetedBackfillTasks: [{ evidenceClass: 'material_input' }],
    }), 'utf8');
    await writeFile(path.join(runtimeRoot, 'automation-feedback-code-repair.latest.json'), JSON.stringify({
      version: 'automation-feedback-code-repair-v1',
      mode: 'plan_only',
      requestCount: 1,
      executedCount: 0,
      ok: true,
      runs: [
        {
          request: { requestId: 'code-repair-edinet-issuer-exposure', providerName: 'edinet', evidenceClass: 'issuer_exposure' },
          executed: false,
          status: 'planned',
        },
      ],
    }), 'utf8');
    await writeFile(path.join(runtimeRoot, 'report-candidate-staging.latest.json'), JSON.stringify({
      version: 'report-candidate-staging-v1',
      stagingStatus: 'blocked_no_stage',
      stageCount: 0,
      blockers: ['accepted_promotion_evidence_missing'],
    }), 'utf8');
    await writeFile(path.join(runtimeRoot, 'evidence-gate-consolidation.latest.json'), JSON.stringify({
      version: 'evidence-gate-consolidator-v1',
      stateCount: 1,
      candidateSeed: { seedId: 'seed-console', trackId: 'issuer_bridge_track' },
      primaryState: {
        seedId: 'seed-console',
        trackId: 'issuer_bridge_track',
        closedGates: ['accepted_promotion_evidence'],
        missingGates: ['negative_control_not_closed'],
        nextGateAction: 'run_limited_negative_control',
        gateClosureProgress: 0.25,
      },
      suggestedBackfillTaskCount: 1,
      nextGateAction: 'run_limited_negative_control',
    }), 'utf8');
    await writeFile(path.join(runtimeRoot, 'valuation-context-auto-linker.latest.json'), JSON.stringify({
      version: 'valuation-context-auto-linker-v1',
      gateEligible: true,
      issuerCoverage: {
        issuerCount: 1,
        contextRowCount: 0,
        missingIssuerFundamentals: ['NOC'],
        rejectedIssuers: [],
        peerBasketSources: [],
      },
      missingIssuerFundamentals: ['NOC'],
      reflectionStatus: 'insufficient_comparison_data',
      fixtureRequirementCount: 1,
      nextRequiredFixture: {
        requirementId: 'valuation-context-noc',
        requirementType: 'local_valuation_expectation_context',
        issuer: 'NOC',
        status: 'local_market_or_valuation_fixture_required',
        reason: 'missing_trusted_local_valuation_context',
      },
    }), 'utf8');
    await writeFile(path.join(runtimeRoot, 'valuation-context-rotation.latest.json'), JSON.stringify({
      version: 'valuation-context-rotation-v1',
      activeCandidateSeed: { seedId: 'seed-console', trackId: 'issuer_bridge_track' },
      valuationBlockedCandidates: [
        { seedId: 'seed-console', trackId: 'issuer_bridge_track', blockType: 'valuation_blocked_pending_cache', missingIssuerFundamentals: ['NOC'], fixtureRequirementCount: 1 },
      ],
      missingIssuerFundamentalsBySeed: { 'seed-console::issuer_bridge_track': ['NOC'] },
      nextEligibleSeed: null,
      rotationReason: 'valuation_context_cache_required',
      valuationContextRequirements: [
        { requirementId: 'valuation-context-noc', requirementType: 'local_valuation_expectation_context', seedId: 'seed-console', trackId: 'issuer_bridge_track', issuer: 'NOC', status: 'local_market_or_valuation_fixture_required' },
      ],
    }), 'utf8');
    await writeFile(path.join(runtimeRoot, 'valuation-context-requirement-executor.latest.json'), JSON.stringify({
      version: 'valuation-context-requirement-executor-v1',
      taskCount: 1,
      valuationRequirementTasks: [
        { taskId: 'valuation-context-noc-task', requirementId: 'valuation-context-noc', seedId: 'seed-console', trackId: 'issuer_bridge_track', issuer: 'NOC', status: 'valuation_context_source_unavailable', failureReason: 'trusted_local_price_context_missing' },
      ],
      valuationContextRowsCreated: 0,
      missingIssuerFundamentalsAfterExecution: ['NOC'],
      valuationContextSourceStatus: 'valuation_context_source_unavailable',
      nextSeedRotationAction: 'wait_for_trusted_local_valuation_context_or_new_seed',
      dbContextRead: { enabled: true, source: 'postgres', status: 'db_unavailable', marketQuoteRowCount: 0, companyFundamentalRowCount: 0 },
    }), 'utf8');
    const payload = await loadAutomationConsolePayload({ runtimeRoot });
    assert.equal(payload.providerFixtureProbes.available, true);
    assert.equal(payload.providerFixtureProbes.verifiedCount, 1);
    assert.equal(payload.providerCollectorRegistry.available, true);
    assert.equal(payload.providerCollectorRegistry.collectorCount >= 4, true);
    assert.equal(payload.stagedProviderLiveExecution.available, true);
    assert.equal(payload.stagedProviderLiveExecution.rawEvidenceCount, 1);
    assert.equal(payload.providerQualityFeedback.available, true);
    assert.equal(payload.providerQualityFeedback.recommendedRemediationAction, 'create_fixture_requirement');
    assert.equal(payload.sourceQualityScore.available, true);
    assert.equal(payload.sourceQualityScore.extractionWeakCount, 1);
    assert.equal(payload.sourceQualityScore.terminalBlockerCount, 1);
    assert.equal(payload.sourceDiversityFeedback.available, true);
    assert.equal(payload.sourceDiversityFeedback.recommendedNextAction, 'create_targeted_backfill_task');
    assert.equal(payload.automationFeedbackRemediation.available, true);
    assert.equal(payload.automationFeedbackRemediation.nextSafeAction, 'create_fixture_requirement');
    assert.equal(payload.automationFeedbackRemediation.targetedBackfillTaskCount, 1);
    assert.equal(payload.automationFeedbackCodeRepair.available, true);
    assert.equal(payload.automationFeedbackCodeRepair.requestCount, 1);
    assert.equal(payload.reportCandidateStaging.available, true);
    assert.equal(payload.evidenceGateConsolidation.available, true);
    assert.equal(payload.evidenceGateConsolidation.nextGateAction, 'run_limited_negative_control');
    assert.equal(payload.valuationContextAutoLinker.available, true);
    assert.deepEqual(payload.valuationContextAutoLinker.missingIssuerFundamentals, ['NOC']);
    assert.equal(payload.valuationContextRotation.available, true);
    assert.equal(payload.valuationContextRotation.valuationBlockedCandidateCount, 1);
    assert.equal(payload.valuationContextRotation.valuationContextRequirementCount, 1);
    assert.equal(payload.valuationContextRequirementExecutor.available, true);
    assert.equal(payload.valuationContextRequirementExecutor.taskCount, 1);
    assert.equal(payload.valuationContextRequirementExecutor.valuationContextSourceStatus, 'valuation_context_source_unavailable');
    assert.equal(payload.valuationContextRequirementExecutor.nextExecutableGateAction, 'build_trusted_valuation_context');
    assert.equal(payload.valuationContextRequirementExecutor.dbContextRead.status, 'db_unavailable');
    assert.equal(payload.operatorRequiredActions.includes('provide_local_valuation_context'), true);
    assert.equal(payload.reportCandidateStaging.stagingStatus, 'blocked_no_stage');
    assert.equal(payload.audit.providerFixtureProbes.probeResults.length, 1);
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});
