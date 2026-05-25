import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { buildSourceProviderActivationSurface } from './source-registry-safe-writer.mjs';
import {
  buildSectorPositivePathSummary,
} from './sector-positive-path-registry.mjs';
import {
  buildSourceProviderManifestRegistry,
} from './source-provider-manifest-registry.mjs';
import {
  buildEvidenceExecutorRegistry,
} from './evidence-executor-registry.mjs';
import {
  buildSectorPackRegistry,
} from './sector-pack-registry.mjs';
import {
  buildProviderCollectorRegistry,
} from './provider-collector-registry.mjs';
import {
  buildOperatorApprovalWorkflow,
} from './operator-approval-workflow.mjs';

export const AUTOMATION_CONSOLE_SURFACE_VERSION = 'automation-console-surface-v1';

async function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function zeroBoundary(extra = {}) {
  return {
    providerActivationWrites: 0,
    sourceRegistryWrites: 0,
    canonicalWrites: 0,
    readinessPromotionWrites: 0,
    reportCandidateWrites: 0,
    portfolioActionWrites: 0,
    ...extra,
  };
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compactQueue(backfillArtifact = {}) {
  const counts = backfillArtifact?.queuedCounts || {};
  return {
    available: Boolean(backfillArtifact),
    generatedAt: backfillArtifact?.generatedAt || null,
    taskCount: backfillArtifact?.taskCount || 0,
    queued: counts.queued || 0,
    needsOperatorReview: counts.needs_operator_review || 0,
    providerGapProposalRequired: counts.provider_gap_proposal_required || 0,
    queuedLocalMarketValidation: counts.queued_local_market_validation || 0,
    rawEvidenceCount: backfillArtifact?.rawEvidenceStoredCount || 0,
    acceptedEvidenceCount: backfillArtifact?.acceptedEvidenceStoredCount || 0,
    acceptedPromotionEvidenceCount: backfillArtifact?.acceptedPromotionEvidenceStoredCount || 0,
    coveredEvidenceClasses: backfillArtifact?.coveredEvidenceClasses || [],
  };
}

function compactStagedProviderLiveExecution(artifact = {}) {
  return {
    available: Boolean(artifact),
    generatedAt: artifact?.generatedAt || null,
    executeLive: artifact?.executeLive === true,
    stagedProviderCount: artifact?.stagedProviderCount || 0,
    executableTaskCount: artifact?.executableTaskCount || 0,
    targetCount: artifact?.targetCount || 0,
    executedTargetCount: artifact?.executedTargetCount || 0,
    rawEvidenceCount: artifact?.rawEvidenceStoredCount || 0,
    acceptedEvidenceCount: artifact?.acceptedEvidenceStoredCount || 0,
    acceptedPromotionEvidenceCount: artifact?.acceptedPromotionEvidenceStoredCount || 0,
    coveredEvidenceClasses: artifact?.coveredEvidenceClasses || [],
    failureClassificationCounts: artifact?.failureClassificationCounts || {},
    nextActionHint: artifact?.nextActionHint || null,
  };
}

function compactRepairLoop(repairLoop = {}) {
  return {
    available: Boolean(repairLoop),
    runId: repairLoop?.runId || null,
    mode: repairLoop?.mode || null,
    generatedAt: repairLoop?.generatedAt || null,
    iterationCount: repairLoop?.iterationCount || repairLoop?.iterations?.length || 0,
    currentBlocker: repairLoop?.blockerAfter || repairLoop?.blockerBefore || null,
    selectedAction: repairLoop?.selectedAction || repairLoop?.iterations?.at?.(-1)?.selectedAction || null,
    stopReason: repairLoop?.stopReason || null,
    nextRecommendedAction: repairLoop?.nextRecommendedAction || repairLoop?.nextAction || null,
    rawEvidenceCount: repairLoop?.rawEvidenceAfter ?? repairLoop?.evidenceCountsAfter?.rawEvidenceCount ?? 0,
    acceptedEvidenceCount: repairLoop?.acceptedEvidenceAfter ?? repairLoop?.evidenceCountsAfter?.acceptedEvidenceCount ?? 0,
    acceptedPromotionEvidenceCount: repairLoop?.acceptedPromotionEvidenceAfter ?? repairLoop?.evidenceCountsAfter?.acceptedPromotionEvidenceCount ?? 0,
    negativeControlStatus: repairLoop?.negativeControlAfter || null,
    holdoutStatus: repairLoop?.holdoutAfter === true ? 'confirmed' : (repairLoop?.holdoutAfter || null),
    issuerBridgeStatus: repairLoop?.issuerBridgeAfter || null,
    marketValidationStatus: repairLoop?.marketValidationAfter || null,
    visualStatus: repairLoop?.visualStatusAfter || null,
    reportCandidateAllowed: repairLoop?.reportCandidateAllowedAfter === true,
  };
}

function compactReportCandidateStaging(reportCandidateStaging = {}) {
  return {
    available: Boolean(reportCandidateStaging),
    generatedAt: reportCandidateStaging?.generatedAt || null,
    stagingStatus: reportCandidateStaging?.stagingStatus || 'not_evaluated',
    stageCount: reportCandidateStaging?.stageCount || 0,
    reviewOnly: reportCandidateStaging?.reviewOnly !== false,
    automaticPromotionAllowed: reportCandidateStaging?.automaticPromotionAllowed === true,
    reportCandidateWriteAllowed: reportCandidateStaging?.reportCandidateWriteAllowed === true,
    blockers: reportCandidateStaging?.blockers || [],
    candidates: asArray(reportCandidateStaging?.candidates).map((candidate) => ({
      reportCandidateStageId: candidate.reportCandidateStageId,
      reviewStatus: candidate.reviewStatus || 'pending',
      stageStatus: candidate.stageStatus || 'report_candidate_staged',
      subjectId: candidate.subject?.subjectId || null,
      subjectLabel: candidate.subject?.subjectLabel || null,
      childSeedId: candidate.subject?.childSeedId || null,
      bottleneckNode: candidate.subject?.bottleneckNode || null,
      acceptedEvidenceCount: candidate.gateSnapshot?.acceptedEvidenceCount || 0,
      acceptedPromotionEvidenceCount: candidate.gateSnapshot?.acceptedPromotionEvidenceCount || 0,
      independentSourceBreadth: candidate.gateSnapshot?.independentSourceBreadth || 0,
      negativeControlStatus: candidate.gateSnapshot?.negativeControlStatus || null,
      holdoutConfirmed: candidate.gateSnapshot?.holdoutConfirmed === true,
      issuerBridgeStatus: candidate.gateSnapshot?.issuerBridgeStatus || null,
      marketValidationStatus: candidate.gateSnapshot?.marketValidationStatus || null,
    })),
  };
}

function compactEvidenceGateConsolidation(evidenceGateConsolidation = {}) {
  const primary = evidenceGateConsolidation?.primaryState || {};
  return {
    available: Boolean(evidenceGateConsolidation),
    generatedAt: evidenceGateConsolidation?.generatedAt || null,
    stateCount: evidenceGateConsolidation?.stateCount || 0,
    candidateSeed: evidenceGateConsolidation?.candidateSeed || null,
    activeCandidateSeed: evidenceGateConsolidation?.activeCandidateSeed || null,
    valuationBlockedCandidateCount: asArray(evidenceGateConsolidation?.valuationBlockedCandidates).length,
    valuationBlockedCandidates: asArray(evidenceGateConsolidation?.valuationBlockedCandidates).map((candidate) => ({
      seedId: candidate.seedId,
      trackId: candidate.trackId,
      blockType: candidate.blockType,
      missingIssuerFundamentals: candidate.missingIssuerFundamentals || [],
    })),
    nextEligibleSeed: evidenceGateConsolidation?.nextEligibleSeed || null,
    rotationReason: evidenceGateConsolidation?.rotationReason || null,
    closedGates: primary.closedGates || [],
    missingGates: primary.missingGates || [],
    nextGateAction: evidenceGateConsolidation?.nextGateAction || primary.nextGateAction || null,
    whyNotReportCandidate: evidenceGateConsolidation?.whyNotReportCandidate || primary.whyNotReportCandidate || null,
    gateClosureProgress: primary.gateClosureProgress || 0,
    suggestedBackfillTaskCount: evidenceGateConsolidation?.suggestedBackfillTaskCount || 0,
    nextGateTask: evidenceGateConsolidation?.nextGateTask
      ? {
        taskId: evidenceGateConsolidation.nextGateTask.taskId,
        seedId: evidenceGateConsolidation.nextGateTask.seedId,
        trackId: evidenceGateConsolidation.nextGateTask.trackId,
        evidenceClass: evidenceGateConsolidation.nextGateTask.evidenceClass,
        providerRoute: evidenceGateConsolidation.nextGateTask.providerRoute,
        status: evidenceGateConsolidation.nextGateTask.status,
      }
      : null,
    whyNoSuggestedBackfillTask: evidenceGateConsolidation?.whyNoSuggestedBackfillTask || null,
    gateTaskSuppressionReason: evidenceGateConsolidation?.gateTaskSuppressionReason || primary.gateTaskSuppressionReason || null,
    alternateGateTaskCreated: evidenceGateConsolidation?.alternateGateTaskCreated === true || primary.alternateGateTaskCreated === true,
    lastGateAttemptFingerprint: evidenceGateConsolidation?.lastGateAttemptFingerprint || primary.lastGateAttemptFingerprint || null,
    activeGateRunnerStatus: evidenceGateConsolidation?.activeGateRunnerStatus || {
      status: evidenceGateConsolidation?.suggestedBackfillTaskCount > 0 ? 'gate_task_ready' : (evidenceGateConsolidation?.stopReason || null),
      selectedAction: evidenceGateConsolidation?.nextGateAction || primary.nextGateAction || null,
      suggestedBackfillTaskCount: evidenceGateConsolidation?.suggestedBackfillTaskCount || 0,
      whyNoSuggestedBackfillTask: evidenceGateConsolidation?.whyNoSuggestedBackfillTask || null,
    },
    localFixtureRequirementCount: evidenceGateConsolidation?.localFixtureRequirementCount || 0,
    localFixtureRequirements: asArray(evidenceGateConsolidation?.localFixtureRequirements).map((requirement) => ({
      requirementId: requirement.requirementId,
      requirementType: requirement.requirementType,
      seedId: requirement.seedId,
      trackId: requirement.trackId,
      gate: requirement.gate,
      status: requirement.status,
      issuerUniverse: requirement.issuerUniverse || [],
    })),
    operatorRequiredActions: evidenceGateConsolidation?.operatorRequiredActions || [],
    stagedForOperatorReview: evidenceGateConsolidation?.stagedForOperatorReview === true,
    stopReason: evidenceGateConsolidation?.stopReason || null,
  };
}

function compactValuationContextRotation(rotation = {}) {
  return {
    available: Boolean(rotation),
    generatedAt: rotation?.generatedAt || null,
    activeCandidateSeed: rotation?.activeCandidateSeed || null,
    valuationBlockedCandidateCount: asArray(rotation?.valuationBlockedCandidates).length,
    valuationBlockedCandidates: asArray(rotation?.valuationBlockedCandidates).map((candidate) => ({
      seedId: candidate.seedId,
      trackId: candidate.trackId,
      blockType: candidate.blockType,
      missingIssuerFundamentals: candidate.missingIssuerFundamentals || [],
      fixtureRequirementCount: candidate.fixtureRequirementCount || 0,
    })),
    missingIssuerFundamentalsBySeed: rotation?.missingIssuerFundamentalsBySeed || {},
    nextEligibleSeed: rotation?.nextEligibleSeed || null,
    rotationReason: rotation?.rotationReason || null,
    valuationContextRequirementCount: asArray(rotation?.valuationContextRequirements).length,
    valuationContextRequirements: asArray(rotation?.valuationContextRequirements).map((requirement) => ({
      requirementId: requirement.requirementId,
      requirementType: requirement.requirementType,
      seedId: requirement.seedId,
      trackId: requirement.trackId,
      issuer: requirement.issuer,
      status: requirement.status,
      reason: requirement.reason,
    })),
    stopReason: rotation?.stopReason || null,
    valuationCoverageBias: rotation?.valuationCoverageBias || null,
  };
}

function compactValuationContextRequirementExecutor(executor = {}) {
  const rowsCreated = executor?.valuationContextRowsCreated || 0;
  const taskCount = executor?.taskCount || 0;
  return {
    available: Boolean(executor),
    generatedAt: executor?.generatedAt || null,
    taskCount,
    valuationRequirementTasks: asArray(executor?.valuationRequirementTasks).map((task) => ({
      taskId: task.taskId,
      requirementId: task.requirementId,
      seedId: task.seedId,
      trackId: task.trackId,
      issuer: task.issuer,
      status: task.status,
      failureReason: task.failureReason || null,
      sourceProvenance: task.sourceProvenance || null,
      caveated: task.caveated === true,
    })),
    valuationContextRowsCreated: rowsCreated,
    missingIssuerFundamentalsAfterExecution: executor?.missingIssuerFundamentalsAfterExecution || [],
    valuationContextSourceStatus: executor?.valuationContextSourceStatus || null,
    valuationContextExecutionFailureReason: executor?.valuationContextExecutionFailureReason || null,
    activeValuationBlockedSeed: executor?.activeValuationBlockedSeed || null,
    nextSeedRotationAction: executor?.nextSeedRotationAction || null,
    nextExecutableGateAction: rowsCreated > 0
      ? 're_evaluate_valuation_bridge'
      : taskCount > 0
        ? 'build_trusted_valuation_context'
        : null,
    dbContextRead: executor?.dbContextRead || null,
    cacheArtifactPath: executor?.cacheArtifactPath || null,
  };
}

function operatorRequiredActionsFrom(payload = {}) {
  const actions = [];
  const activation = payload.sourceProviderActivation || {};
  for (const action of payload.approvalWorkflow?.actions || []) actions.push(action.actionType);
  if ((activation.counts?.needsCredentials || 0) > 0) actions.push('enter_provider_credentials');
  if ((activation.counts?.needsFixture || 0) > 0) actions.push('approve_provider_fixture');
  if ((activation.counts?.providerGapProposalRequired || 0) > 0) actions.push('review_provider_gap_proposals');
  for (const action of payload.evidenceGateConsolidation?.operatorRequiredActions || []) actions.push(action);
  if ((payload.valuationContextRotation?.valuationContextRequirementCount || 0) > 0) actions.push('provide_local_valuation_context');
  if (payload.repairLoop?.stopReason && /operator|human|fixture|credential|provider/i.test(payload.repairLoop.stopReason)) {
    actions.push(payload.repairLoop.stopReason);
  }
  return [...new Set(actions)];
}

export function buildAutomationConsolePayload({
  runtimeStatus = null,
  sourceProviderActivation = null,
  providerFixtureProbes = null,
  stagedProviderLiveExecution = null,
  backfillQueue = null,
  evidenceGateConsolidation = null,
  valuationExpectationBridge = null,
  valuationContextAutoLinker = null,
  valuationContextRotation = null,
  valuationContextRequirementExecutor = null,
  historicalAnalogueBridge = null,
  reportCandidateStaging = null,
  reportSourceQuarantine = null,
  repairLoop = null,
  biasDiagnostics = null,
  finalReport = null,
  sectorPositivePaths = null,
  providerManifestRegistry = null,
  evidenceExecutorRegistry = null,
  sectorPackRegistry = null,
  providerCollectorRegistry = null,
  providerQualityFeedback = null,
  sourceQualityScore = null,
  sourceDiversityFeedback = null,
  automationFeedbackRemediation = null,
  automationFeedbackCodeRepair = null,
} = {}) {
  const sectorSummary = sectorPositivePaths || buildSectorPositivePathSummary();
  const providerManifestSummary = providerManifestRegistry || buildSourceProviderManifestRegistry();
  const executorRegistrySummary = evidenceExecutorRegistry || buildEvidenceExecutorRegistry();
  const sectorPackSummary = sectorPackRegistry || buildSectorPackRegistry();
  const collectorRegistrySummary = providerCollectorRegistry || buildProviderCollectorRegistry({
    sourceProviderRegistry: providerManifestSummary,
  });
  const stagedLive = compactStagedProviderLiveExecution(stagedProviderLiveExecution);
  const stagedReportCandidates = compactReportCandidateStaging(reportCandidateStaging);
  const gateConsolidation = compactEvidenceGateConsolidation(evidenceGateConsolidation);
  const valuationRotation = compactValuationContextRotation(valuationContextRotation);
  const valuationRequirementExecutor = compactValuationContextRequirementExecutor(valuationContextRequirementExecutor);
  const hasEvidenceArtifacts = Boolean(backfillQueue) || Boolean(stagedProviderLiveExecution);
  const backfillRawCount = backfillQueue?.rawEvidenceStoredCount ?? 0;
  const backfillAcceptedCount = backfillQueue?.acceptedEvidenceStoredCount ?? 0;
  const backfillPromotionCount = backfillQueue?.acceptedPromotionEvidenceStoredCount ?? 0;
  const payload = {
    ok: true,
    version: AUTOMATION_CONSOLE_SURFACE_VERSION,
    source: 'automation-console-surface',
    endpoint: '/api/research-seeds/automation-console',
    generatedAt: new Date().toISOString(),
    runtimeStatus: runtimeStatus?.runtimeStatus || runtimeStatus || {},
    sourceProviderActivation: sourceProviderActivation
      ? buildSourceProviderActivationSurface(sourceProviderActivation)
      : buildSourceProviderActivationSurface({ records: [] }),
    providerFixtureProbes: {
      available: Boolean(providerFixtureProbes),
      verifiedCount: providerFixtureProbes?.verifiedCount || 0,
      missingCount: providerFixtureProbes?.missingCount || 0,
      version: providerFixtureProbes?.version || null,
    },
    providerManifestRegistry: {
      available: true,
      ok: providerManifestSummary.ok === true,
      version: providerManifestSummary.version || null,
      providerCount: providerManifestSummary.providerCount || 0,
      validProviderCount: providerManifestSummary.summary?.validProviderCount || 0,
      fixtureRequiredCount: providerManifestSummary.summary?.fixtureRequiredCount || 0,
      readOnlyProviderCount: providerManifestSummary.summary?.readOnlyProviderCount || 0,
      invalidProviders: providerManifestSummary.invalidProviders || [],
    },
    evidenceExecutorRegistry: {
      available: true,
      ok: executorRegistrySummary.ok === true,
      version: executorRegistrySummary.version || null,
      executorCount: executorRegistrySummary.executorCount || 0,
      requiredClassCoverage: executorRegistrySummary.summary?.requiredClassCoverage || 0,
      missingClasses: executorRegistrySummary.missingClasses || [],
      invalidExecutors: executorRegistrySummary.invalidExecutors || [],
      promotionDisabledClasses: executorRegistrySummary.summary?.promotionDisabledClasses || [],
      localControlledMarketClasses: executorRegistrySummary.summary?.localControlledMarketClasses || [],
    },
    providerCollectorRegistry: {
      available: true,
      ok: collectorRegistrySummary.ok === true,
      version: collectorRegistrySummary.version || null,
      collectorCount: collectorRegistrySummary.collectorCount || 0,
      providerCount: collectorRegistrySummary.providerCount || 0,
      providersWithCollectors: collectorRegistrySummary.providersWithCollectors || [],
      invalidCollectors: collectorRegistrySummary.invalidCollectors || [],
      missingProviderManifests: collectorRegistrySummary.missingProviderManifests || [],
      evidenceClassesCovered: collectorRegistrySummary.summary?.evidenceClassesCovered || [],
    },
    backfillQueue: compactQueue(backfillQueue),
    stagedProviderLiveExecution: stagedLive,
    evidenceGateConsolidation: gateConsolidation,
    valuationExpectationBridge: {
      available: Boolean(valuationExpectationBridge),
      generatedAt: valuationExpectationBridge?.generatedAt || null,
      valuationBridgeStatus: valuationExpectationBridge?.valuationBridgeStatus || null,
      expectationBridgeStatus: valuationExpectationBridge?.expectationBridgeStatus || null,
      marketValidationRegimeStatus: valuationExpectationBridge?.marketValidationRegimeStatus
        || valuationExpectationBridge?.marketRegimeSupport?.marketValidationRegimeStatus
        || null,
      marketValidationResearchUseAllowed: valuationExpectationBridge?.marketValidationResearchUseAllowed === true
        || valuationExpectationBridge?.marketRegimeSupport?.marketValidationResearchUseAllowed === true,
      readyForHumanInvestmentMemoReview: valuationExpectationBridge?.readyForHumanInvestmentMemoReview === true,
      investmentMemoReady: valuationExpectationBridge?.investmentMemoReady === true,
      decisionReady: valuationExpectationBridge?.decisionReady === true,
      portfolioActionAllowed: valuationExpectationBridge?.portfolioActionAllowed === true,
      missingValuationFields: valuationExpectationBridge?.missingValuationFields || [],
      nextRecommendedAction: valuationExpectationBridge?.nextRecommendedAction || null,
    },
    historicalAnalogueBridge: {
      available: Boolean(historicalAnalogueBridge),
      generatedAt: historicalAnalogueBridge?.generatedAt || null,
      analogueCount: historicalAnalogueBridge?.analogueCount || 0,
      usableAnalogueCount: historicalAnalogueBridge?.usableAnalogueCount || 0,
      bestAnalogueIds: historicalAnalogueBridge?.bestAnalogueIds || [],
      reflectionStatus: historicalAnalogueBridge?.reflectionStatus || null,
      missingInputs: historicalAnalogueBridge?.missingInputs || [],
      pricedInRisk: historicalAnalogueBridge?.pricedInRisk === true,
      fixtureOnly: historicalAnalogueBridge?.fixtureOnly === true,
    },
    valuationContextAutoLinker: {
      available: Boolean(valuationContextAutoLinker),
      generatedAt: valuationContextAutoLinker?.generatedAt || null,
      candidateSeed: valuationContextAutoLinker?.candidateSeed || null,
      gateEligible: valuationContextAutoLinker?.gateEligible === true,
      issuerCoverage: valuationContextAutoLinker?.issuerCoverage || {
        issuerCount: 0,
        contextRowCount: 0,
        missingIssuerFundamentals: [],
        rejectedIssuers: [],
        peerBasketSources: [],
      },
      missingIssuerFundamentals: valuationContextAutoLinker?.missingIssuerFundamentals || [],
      peerBasketSources: valuationContextAutoLinker?.issuerCoverage?.peerBasketSources || [],
      reflectionStatus: valuationContextAutoLinker?.reflectionStatus || null,
      pricedInRisk: valuationContextAutoLinker?.pricedInRisk === true,
      nextRequiredFixture: valuationContextAutoLinker?.nextRequiredFixture
        ? {
          requirementId: valuationContextAutoLinker.nextRequiredFixture.requirementId,
          requirementType: valuationContextAutoLinker.nextRequiredFixture.requirementType,
          issuer: valuationContextAutoLinker.nextRequiredFixture.issuer,
          status: valuationContextAutoLinker.nextRequiredFixture.status,
          reason: valuationContextAutoLinker.nextRequiredFixture.reason,
        }
        : null,
      fixtureRequirementCount: valuationContextAutoLinker?.fixtureRequirementCount || 0,
      valuationCoverageBias: valuationContextAutoLinker?.valuationCoverageBias || null,
    },
    valuationContextRotation: valuationRotation,
    valuationContextRequirementExecutor: valuationRequirementExecutor,
    providerQualityFeedback: {
      available: Boolean(providerQualityFeedback),
      generatedAt: providerQualityFeedback?.generatedAt || null,
      recordCount: providerQualityFeedback?.recordCount || 0,
      acceptedRate: providerQualityFeedback?.summary?.acceptedRate || 0,
      rawCount: providerQualityFeedback?.summary?.rawCount || 0,
      acceptedCount: providerQualityFeedback?.summary?.acceptedCount || 0,
      promotionCount: providerQualityFeedback?.summary?.promotionCount || 0,
      failureClassificationCounts: providerQualityFeedback?.summary?.failureClassificationCounts || {},
      remediationCounts: providerQualityFeedback?.summary?.remediationCounts || {},
      repeatedFailureProviderCount: providerQualityFeedback?.summary?.repeatedFailureProviderCount || 0,
      collectorRequirementCount: providerQualityFeedback?.summary?.collectorRequirementCount || 0,
      cooldownOrQuarantineCount: providerQualityFeedback?.summary?.cooldownOrQuarantineCount || 0,
      repeatedFailureProviders: providerQualityFeedback?.repeatedFailureProviders || [],
      collectorRequirements: providerQualityFeedback?.collectorRequirements || [],
      quarantinedOrCooldownProviders: providerQualityFeedback?.quarantinedOrCooldownProviders || [],
      recommendedRemediationAction: providerQualityFeedback?.recommendedRemediationAction || null,
    },
    sourceQualityScore: {
      available: Boolean(sourceQualityScore),
      generatedAt: sourceQualityScore?.generatedAt || null,
      recordCount: sourceQualityScore?.recordCount || 0,
      averageOverallEvidenceQualityScore: sourceQualityScore?.summary?.averageOverallEvidenceQualityScore || 0,
      averageExtractionQualityScore: sourceQualityScore?.summary?.averageExtractionQualityScore || 0,
      acceptedEligibleCount: sourceQualityScore?.summary?.acceptedEligibleCount || 0,
      promotionEligibleCount: sourceQualityScore?.summary?.promotionEligibleCount || 0,
      routeMismatchCount: sourceQualityScore?.summary?.routeMismatchCount || 0,
      extractionWeakCount: sourceQualityScore?.summary?.extractionWeakCount || 0,
      officialButGenericCount: sourceQualityScore?.summary?.officialButGenericCount || 0,
      terminalBlockerCount: sourceQualityScore?.summary?.terminalBlockerCount || 0,
      failureReasonCounts: sourceQualityScore?.summary?.failureReasonCounts || {},
      terminalBlockers: sourceQualityScore?.terminalBlockers || [],
      lowQualityRecords: sourceQualityScore?.lowQualityRecords || [],
    },
    sourceDiversityFeedback: {
      available: Boolean(sourceDiversityFeedback),
      generatedAt: sourceDiversityFeedback?.generatedAt || null,
      sourceBucketDistribution: sourceDiversityFeedback?.sourceBucketDistribution || { counts: {}, shares: {}, entropy: 0, missingBuckets: [] },
      classDistribution: sourceDiversityFeedback?.classDistribution || {},
      underrepresentedEvidenceClasses: sourceDiversityFeedback?.underrepresentedEvidenceClasses || [],
      overrepresentedWarnings: sourceDiversityFeedback?.overrepresentedWarnings || [],
      sourceBucketQuotaWarnings: sourceDiversityFeedback?.sourceBucketQuotaWarnings || [],
      reportCooldowns: sourceDiversityFeedback?.reportCooldowns || [],
      sourceSelectionPolicy: sourceDiversityFeedback?.sourceSelectionPolicy || {},
      recommendedNextAction: sourceDiversityFeedback?.recommendedNextAction || null,
    },
    automationFeedbackRemediation: {
      available: Boolean(automationFeedbackRemediation),
      generatedAt: automationFeedbackRemediation?.generatedAt || null,
      fixtureRequirementCount: automationFeedbackRemediation?.summary?.fixtureRequirementCount || 0,
      providerGapProposalCount: automationFeedbackRemediation?.summary?.providerGapProposalCount || 0,
      targetedBackfillTaskCount: automationFeedbackRemediation?.summary?.targetedBackfillTaskCount || 0,
      convertedGateTaskCount: automationFeedbackRemediation?.summary?.convertedGateTaskCount || 0,
      cooldownGateTaskCount: automationFeedbackRemediation?.summary?.cooldownGateTaskCount || 0,
      collectorRequirementTaskCount: automationFeedbackRemediation?.summary?.collectorRequirementTaskCount || 0,
      valuationRequirementTaskCount: automationFeedbackRemediation?.summary?.valuationRequirementTaskCount || 0,
      valuationCoverageActionCount: automationFeedbackRemediation?.summary?.valuationCoverageActionCount || 0,
      quarantineRecommendationCount: automationFeedbackRemediation?.summary?.quarantineRecommendationCount || 0,
      sourceBucketActionCount: automationFeedbackRemediation?.summary?.sourceBucketActionCount || 0,
      nextSafeAction: automationFeedbackRemediation?.summary?.nextSafeAction || null,
      nextSafeActions: automationFeedbackRemediation?.nextSafeActions || [],
      providerFixtureRequirements: automationFeedbackRemediation?.providerFixtureRequirements || [],
      targetedBackfillTasks: automationFeedbackRemediation?.targetedBackfillTasks || [],
      convertedGateTasks: automationFeedbackRemediation?.convertedGateTasks || [],
      cooldownGateTasks: automationFeedbackRemediation?.cooldownGateTasks || [],
      collectorRequirementTasks: automationFeedbackRemediation?.collectorRequirementTasks || [],
      valuationRequirementTasks: automationFeedbackRemediation?.valuationRequirementTasks || [],
      valuationCoverageActions: automationFeedbackRemediation?.valuationCoverageActions || [],
      quarantineRecommendations: automationFeedbackRemediation?.quarantineRecommendations || [],
      sourceBucketActions: automationFeedbackRemediation?.sourceBucketActions || [],
      safetyPolicy: automationFeedbackRemediation?.safetyPolicy || {},
    },
    automationFeedbackCodeRepair: {
      available: Boolean(automationFeedbackCodeRepair),
      generatedAt: automationFeedbackCodeRepair?.generatedAt || null,
      mode: automationFeedbackCodeRepair?.mode || null,
      requestCount: automationFeedbackCodeRepair?.requestCount || 0,
      executedCount: automationFeedbackCodeRepair?.executedCount || 0,
      skippedRequestCount: automationFeedbackCodeRepair?.skippedRequestCount || 0,
      skippedRequests: asArray(automationFeedbackCodeRepair?.skippedRequests).slice(0, 10),
      parallel: automationFeedbackCodeRepair?.parallel === true,
      parallelWorkers: automationFeedbackCodeRepair?.parallelWorkers || 1,
      isolation: automationFeedbackCodeRepair?.isolation || null,
      workerStatuses: asArray(automationFeedbackCodeRepair?.parallelExecution?.workerStatuses).slice(0, 10),
      mergeConflicts: asArray(automationFeedbackCodeRepair?.parallelExecution?.mergeConflicts).slice(0, 10),
      patchesApplied: asArray(automationFeedbackCodeRepair?.parallelExecution?.patchesApplied).slice(0, 20),
      patchesRejected: asArray(automationFeedbackCodeRepair?.parallelExecution?.patchesRejected).slice(0, 20),
      patchesRolledBack: asArray(automationFeedbackCodeRepair?.parallelExecution?.patchesRolledBack).slice(0, 20),
      evidenceDeltaAfterMerge: automationFeedbackCodeRepair?.parallelExecution?.evidenceDeltaAfterMerge || null,
      postRollbackRefreshResult: automationFeedbackCodeRepair?.parallelExecution?.postRollbackRefreshResult || null,
      ok: automationFeedbackCodeRepair?.ok === true,
      runs: asArray(automationFeedbackCodeRepair?.runs).map((run) => ({
        requestId: run.request?.requestId || null,
        providerName: run.request?.providerName || null,
        evidenceClass: run.request?.evidenceClass || null,
        executed: run.executed === true,
        status: run.status || null,
        effectStatus: run.effectStatus || null,
        evidenceDelta: run.evidenceDelta || null,
        codexExitCode: run.codexResult?.code ?? null,
        changedFiles: run.codexResult?.parsed?.changedFiles || [],
      })),
      safetyPolicy: automationFeedbackCodeRepair?.safetyPolicy || {},
    },
    biasDiagnostics: {
      available: Boolean(biasDiagnostics),
      verdict: biasDiagnostics?.verdict || null,
      classDistribution: biasDiagnostics?.classDistribution || null,
      underrepresentedClasses: biasDiagnostics?.underrepresentedClasses || [],
      warnings: biasDiagnostics?.warnings || [],
    },
    repairLoop: compactRepairLoop(repairLoop),
    reportCandidateStaging: stagedReportCandidates,
    evidenceState: {
      rawEvidenceCount: hasEvidenceArtifacts ? backfillRawCount + stagedLive.rawEvidenceCount : repairLoop?.rawEvidenceAfter || 0,
      acceptedEvidenceCount: hasEvidenceArtifacts ? backfillAcceptedCount + stagedLive.acceptedEvidenceCount : repairLoop?.acceptedEvidenceAfter || 0,
      acceptedPromotionEvidenceCount: hasEvidenceArtifacts ? backfillPromotionCount + stagedLive.acceptedPromotionEvidenceCount : repairLoop?.acceptedPromotionEvidenceAfter || 0,
      coveredEvidenceClasses: [...new Set([...(backfillQueue?.coveredEvidenceClasses || []), ...(stagedLive.coveredEvidenceClasses || [])])],
    },
    readiness: {
      visualStatus: repairLoop?.visualStatusAfter || finalReport?.visualStatus || finalReport?.status || null,
      investmentMemoReady: finalReport?.investmentMemoReady === true,
      decisionReady: finalReport?.decisionReady === true,
      portfolioActionAllowed: finalReport?.portfolioActionAllowed === true,
      finalBlocker: repairLoop?.finalBlocker || repairLoop?.readinessAfter?.finalBlocker || finalReport?.finalBlocker || finalReport?.remainingBlocker || null,
      valuationBridgeStatus: repairLoop?.valuationBridgeStatus || finalReport?.valuationBridgeStatus || null,
      expectationBridgeStatus: repairLoop?.expectationBridgeStatus || finalReport?.expectationBridgeStatus || null,
      issuerCoverage: {
        localValuationCacheRowCount: repairLoop?.localValuationCacheRowCount ?? finalReport?.localValuationCacheRowCount ?? null,
        missingIssuerFundamentals: repairLoop?.localValuationCacheMissingIssuers || finalReport?.missingIssuerFundamentals || [],
      },
      missingIssuerFundamentals: repairLoop?.localValuationCacheMissingIssuers || finalReport?.missingIssuerFundamentals || [],
    },
    reportSourceQuarantine: {
      available: Boolean(reportSourceQuarantine),
      activeQuarantineCount: reportSourceQuarantine?.activeQuarantineCount || 0,
      quarantinedSubjectKeys: reportSourceQuarantine?.quarantinedSubjectKeys || [],
    },
    sectorPositivePaths: {
      available: true,
      ok: sectorSummary.ok === true,
      sectorCount: sectorSummary.sectorCount || 0,
      validationFixtureOnlyCount: sectorSummary.validationFixtureOnlyCount || 0,
      validationErrors: sectorSummary.validationErrors || [],
      sectors: sectorSummary.sectors || [],
    },
    sectorPackRegistry: {
      available: true,
      ok: sectorPackSummary.ok === true,
      version: sectorPackSummary.version || null,
      sectorCount: sectorPackSummary.sectorCount || 0,
      validationFixtureOnlyCount: sectorPackSummary.summary?.validationFixtureOnlyCount || 0,
      productionReadinessEvidenceCount: sectorPackSummary.summary?.productionReadinessEvidenceCount || 0,
      missingSectors: sectorPackSummary.missingSectors || [],
      invalidSectors: sectorPackSummary.invalidSectors || [],
    },
    mutationBoundary: {
      ...zeroBoundary(),
      ...(runtimeStatus?.mutationBoundaries || repairLoop?.mutationBoundaries || {}),
    },
    activeGateRunnerStatus: gateConsolidation.activeGateRunnerStatus,
    whyNoSuggestedBackfillTask: gateConsolidation.whyNoSuggestedBackfillTask,
    daemonRuntimeStatus: {
      observed: runtimeStatus?.runtimeStatus?.daemonObserved === true || Number(runtimeStatus?.runtimeStatus?.daemonTaskCount || 0) > 0,
      stale: runtimeStatus?.runtimeStatus?.staleDaemon === true,
      heartbeatFresh: runtimeStatus?.runtimeStatus?.daemonHeartbeatFresh === true,
      latestDaemonRun: runtimeStatus?.runtimeStatus?.latestDaemonRun || null,
      latestAutonomousRun: runtimeStatus?.runtimeStatus?.latestAutonomousRun || null,
      nextRecommendedAction: runtimeStatus?.nextRecommendedAction || null,
      stopReason: runtimeStatus?.stopReason || null,
      daemonNotRunning: runtimeStatus?.runtimeStatus?.daemonNotRunning === true || runtimeStatus?.stopReason === 'daemon_stale_or_not_running',
      dbClosureStatus: runtimeStatus?.runtimeStatus?.dbClosureStatus || null,
    },
    codexRepairLaneStatus: {
      available: Boolean(automationFeedbackCodeRepair),
      mode: automationFeedbackCodeRepair?.mode || null,
      parallel: automationFeedbackCodeRepair?.parallel === true,
      parallelWorkers: automationFeedbackCodeRepair?.parallelWorkers || 1,
      requestCount: automationFeedbackCodeRepair?.requestCount || 0,
      executedCount: automationFeedbackCodeRepair?.executedCount || 0,
      effectivePatchCount: asArray(automationFeedbackCodeRepair?.runs).filter((run) => /effective|accepted|promotion/i.test(String(run.effectStatus || ''))).length,
      ineffectivePatchCount: asArray(automationFeedbackCodeRepair?.runs).filter((run) => /ineffective|raw_only|no_delta/i.test(String(run.effectStatus || ''))).length,
    },
    audit: {
      runtimeStatus,
      sourceProviderActivation,
      providerFixtureProbes,
      stagedProviderLiveExecution,
      backfillQueue,
      evidenceGateConsolidation,
      reportCandidateStaging,
      reportSourceQuarantine,
      repairLoop,
      biasDiagnostics,
      finalReport,
      valuationExpectationBridge,
      valuationContextAutoLinker,
      valuationContextRotation,
      valuationContextRequirementExecutor,
      historicalAnalogueBridge,
      sectorPositivePaths: sectorSummary,
      providerManifestRegistry: providerManifestSummary,
      evidenceExecutorRegistry: executorRegistrySummary,
      sectorPackRegistry: sectorPackSummary,
      providerCollectorRegistry: collectorRegistrySummary,
      providerQualityFeedback,
      sourceQualityScore,
      sourceDiversityFeedback,
      automationFeedbackRemediation,
      automationFeedbackCodeRepair,
    },
  };
  payload.approvalWorkflow = buildOperatorApprovalWorkflow({
    sourceProviderActivation: payload.sourceProviderActivation,
    repairLoop,
    finalReport,
    reportCandidateStaging,
    sectorPositivePaths: payload.sectorPositivePaths,
  });
  payload.operatorRequiredActions = operatorRequiredActionsFrom(payload);
  return payload;
}

export async function loadAutomationConsolePayload({ runtimeRoot = path.join(process.cwd(), 'data', 'runtime') } = {}) {
  const [
    runtimeStatus,
    sourceProviderActivation,
    providerFixtureProbes,
    stagedProviderLiveExecution,
    backfillQueue,
    evidenceGateConsolidation,
    reportCandidateStaging,
    reportSourceQuarantine,
    repairLoop,
    biasDiagnostics,
    finalReport,
    valuationExpectationBridge,
    valuationContextAutoLinker,
    valuationContextRotation,
    valuationContextRequirementExecutor,
    historicalAnalogueBridge,
    sectorPositivePathRegistry,
    providerManifestRegistry,
    evidenceExecutorRegistry,
    sectorPackRegistry,
    providerCollectorRegistry,
    providerQualityFeedback,
    sourceQualityScore,
    sourceDiversityFeedback,
    automationFeedbackRemediation,
    automationFeedbackCodeRepair,
  ] = await Promise.all([
    readJson(path.join(runtimeRoot, 'automation-runtime-supervisor.latest.json')),
    readJson(path.join(runtimeRoot, 'source-provider-activation.latest.json')),
    readJson(path.join(runtimeRoot, 'source-provider-fixture-probes.latest.json')),
    readJson(path.join(runtimeRoot, 'staged-provider-live-executor.latest.json')),
    readJson(path.join(runtimeRoot, 'backfill-queue-executor.latest.json')),
    readJson(path.join(runtimeRoot, 'evidence-gate-consolidation.latest.json')),
    readJson(path.join(runtimeRoot, 'report-candidate-staging.latest.json')),
    readJson(path.join(runtimeRoot, 'report-source-quarantine.latest.json')),
    readJson(path.join(runtimeRoot, 'autonomous-research-repair-loop.latest.json')),
    readJson(path.join(runtimeRoot, 'seed-bias-diagnostics.latest.json')),
    readJson(path.join(runtimeRoot, 'final-investment-report-dry-run.latest.json')),
    readJson(path.join(runtimeRoot, 'valuation-expectation-bridge-dry-run.latest.json')),
    readJson(path.join(runtimeRoot, 'valuation-context-auto-linker.latest.json')),
    readJson(path.join(runtimeRoot, 'valuation-context-rotation.latest.json')),
    readJson(path.join(runtimeRoot, 'valuation-context-requirement-executor.latest.json')),
    readJson(path.join(runtimeRoot, 'historical-analogue-bridge.latest.json')),
    readJson(path.join(runtimeRoot, 'sector-positive-path-registry.latest.json')),
    readJson(path.join(runtimeRoot, 'provider-manifest-registry.latest.json')),
    readJson(path.join(runtimeRoot, 'evidence-executor-registry.latest.json')),
    readJson(path.join(runtimeRoot, 'sector-pack-registry.latest.json')),
    readJson(path.join(runtimeRoot, 'provider-collector-registry.latest.json')),
    readJson(path.join(runtimeRoot, 'provider-quality-feedback.latest.json')),
    readJson(path.join(runtimeRoot, 'source-quality-score.latest.json')),
    readJson(path.join(runtimeRoot, 'source-diversity-feedback.latest.json')),
    readJson(path.join(runtimeRoot, 'automation-feedback-remediation.latest.json')),
    readJson(path.join(runtimeRoot, 'automation-feedback-code-repair.latest.json')),
  ]);
  return buildAutomationConsolePayload({
    runtimeStatus,
    sourceProviderActivation,
    providerFixtureProbes,
    stagedProviderLiveExecution,
    backfillQueue,
    evidenceGateConsolidation,
    reportCandidateStaging,
    reportSourceQuarantine,
    repairLoop,
    biasDiagnostics,
    finalReport,
    valuationExpectationBridge,
    valuationContextAutoLinker,
    valuationContextRotation,
    valuationContextRequirementExecutor,
    historicalAnalogueBridge,
    sectorPositivePaths: sectorPositivePathRegistry?.summary || (sectorPositivePathRegistry ? buildSectorPositivePathSummary(sectorPositivePathRegistry) : null),
    providerManifestRegistry,
    evidenceExecutorRegistry,
    sectorPackRegistry,
    providerCollectorRegistry,
    providerQualityFeedback,
    sourceQualityScore,
    sourceDiversityFeedback,
    automationFeedbackRemediation,
    automationFeedbackCodeRepair,
  });
}
