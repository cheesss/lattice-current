import crypto from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const REPORT_CANDIDATE_STAGING_VERSION = 'report-candidate-staging-v1';

const CLOSED_NEGATIVE_CONTROL = new Set(['SURVIVED', 'CHECKED_NO_DIRECT']);
const CLOSED_ISSUER_BRIDGE = new Set(['closed', 'partial']);
const CLOSED_MARKET_VALIDATION = new Set(['controlled_ready', 'decision_use_caveat', 'human_review_caveated']);
const CLOSED_VALUATION_BRIDGE = new Set(['present', 'human_review_caveated']);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stableHash(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 12);
}

function zeroBoundary(extra = {}) {
  return {
    providerActivationWrites: 0,
    sourceRegistryWrites: 0,
    canonicalWrites: 0,
    readinessPromotionWrites: 0,
    reportCandidateWrites: 0,
    portfolioActionWrites: 0,
    approvalQueueWrites: 0,
    ...(extra || {}),
  };
}

function latestIteration(repairLoop = {}) {
  return asArray(repairLoop?.iterations).at(-1) || {};
}

function latestActionResult(repairLoop = {}) {
  return latestIteration(repairLoop)?.actionResult || {};
}

function normalizeHoldout(value) {
  if (value === true) return true;
  return /confirmed|true/i.test(compact(value));
}

function normalizeMarketValidation({ repairLoop = {}, finalReport = {}, actionResult = {} } = {}) {
  const direct = compact(
    repairLoop.marketValidationAfter
    || repairLoop.marketValidationStatus
    || finalReport.marketValidationStatus
    || actionResult.gateImpact?.marketValidationStatus
    || actionResult.reportSubjectDryRun?.marketValidationStatus
    || '',
  );
  if (direct) return direct;
  if (actionResult.decisionUseCaveat || actionResult.reportSubjectDryRun?.decisionUse === 'research_validation_memo') {
    return 'decision_use_caveat';
  }
  return 'missing';
}

function extractSubject({ repairLoop = {}, finalReport = {} } = {}) {
  repairLoop = repairLoop || {};
  finalReport = finalReport || {};
  const actionResult = latestActionResult(repairLoop);
  const subject = actionResult.reportSubjectDryRun
    || actionResult.dryRunReportSubject
    || repairLoop.dryRunReportSubject
    || finalReport.subject
    || {};
  const selectedSeed = latestIteration(repairLoop)?.inputState?.selectedSeed
    || repairLoop.inputState?.selectedSeed
    || {};
  return {
    subjectId: compact(subject.subjectId || finalReport.subjectId || selectedSeed.childSeedId || repairLoop.runId || 'latest-autonomous-subject'),
    subjectLabel: compact(subject.subjectLabel || finalReport.subjectLabel || selectedSeed.bottleneckNode || finalReport.title || 'Autonomous research subject'),
    parentSeedId: compact(subject.parentSeedId || selectedSeed.parentSeedId || ''),
    childSeedId: compact(subject.childSeedId || selectedSeed.childSeedId || ''),
    trackId: compact(subject.trackId || selectedSeed.trackId || 'issuer_bridge_track'),
    bottleneckNode: compact(subject.bottleneckNode || selectedSeed.bottleneckNode || subject.connector || ''),
    issuerUniverse: asArray(subject.issuerUniverse || selectedSeed.issuerUniverse || selectedSeed.issuerCandidates).map(compact).filter(Boolean),
    reportPath: compact(finalReport.reportPath || finalReport.clientMemoPath || repairLoop.clientMemoPath || repairLoop.finalInvestmentReportDryRunPath || ''),
  };
}

function extractGateSnapshot({ repairLoop = {}, finalReport = {} } = {}) {
  repairLoop = repairLoop || {};
  finalReport = finalReport || {};
  const actionResult = latestActionResult(repairLoop);
  const counts = latestIteration(repairLoop)?.evidenceCountsAfter || repairLoop.evidenceCountsAfter || {};
  const diagnostic = Boolean(
    repairLoop.reportCandidateAllowedDiagnostic === true
    || finalReport.reportCandidateAllowedDiagnostic === true
    || actionResult.reportCandidateAllowedDiagnostic === true
    || actionResult.gateImpact?.reportCandidateAllowedDiagnostic === true
  );
  return {
    reportCandidateAllowedDiagnostic: diagnostic,
    acceptedEvidenceCount: Number(
      repairLoop.acceptedEvidenceAfter
      ?? counts.acceptedEvidenceCount
      ?? finalReport.acceptedEvidenceCount
      ?? finalReport.evidenceState?.acceptedEvidenceCount
      ?? 0,
    ),
    acceptedPromotionEvidenceCount: Number(
      repairLoop.acceptedPromotionEvidenceAfter
      ?? counts.acceptedPromotionEvidenceCount
      ?? finalReport.acceptedPromotionEvidenceCount
      ?? finalReport.evidenceState?.acceptedPromotionEvidenceCount
      ?? 0,
    ),
    independentSourceBreadth: Number(
      counts.independentSourceBreadth
      ?? repairLoop.independentSourceBreadth
      ?? finalReport.independentSourceBreadth
      ?? 0,
    ),
    negativeControlStatus: compact(repairLoop.negativeControlAfter || finalReport.negativeControlStatus || actionResult.gateImpact?.negativeControlStatus || ''),
    holdoutConfirmed: normalizeHoldout(repairLoop.holdoutAfter ?? finalReport.holdoutConfirmed ?? actionResult.gateImpact?.holdoutConfirmed),
    issuerBridgeStatus: compact(repairLoop.issuerBridgeAfter || finalReport.issuerBridgeStatus || actionResult.gateImpact?.issuerBridgeStatus || ''),
    marketValidationStatus: normalizeMarketValidation({ repairLoop, finalReport, actionResult }),
    closureStatus: compact(actionResult.closureStatus || finalReport.closureStatus || ''),
    remainingBlockers: [
      ...asArray(repairLoop.blockerAfter),
      ...asArray(repairLoop.finalBlocker),
      ...asArray(repairLoop.readinessAfter?.blockers),
      ...asArray(actionResult.remainingBlockers),
      ...asArray(finalReport.remainingBlockers),
    ].map(compact).filter(Boolean),
  };
}

function subjectFromGateState(state = {}, { finalReport = {}, repairLoop = {} } = {}) {
  const fallback = extractSubject({ repairLoop, finalReport });
  return {
    subjectId: compact(state.seedId || fallback.subjectId || 'latest-autonomous-subject'),
    subjectLabel: compact(state.subjectLabel || state.bottleneckNode || fallback.subjectLabel || 'Autonomous research subject'),
    parentSeedId: compact(state.parentSeedId || fallback.parentSeedId || ''),
    childSeedId: compact(state.seedId || fallback.childSeedId || ''),
    trackId: compact(state.trackId || fallback.trackId || 'issuer_bridge_track'),
    bottleneckNode: compact(state.bottleneckNode || fallback.bottleneckNode || ''),
    issuerUniverse: fallback.issuerUniverse || [],
    reportPath: fallback.reportPath || '',
  };
}

function gateSnapshotFromConsolidationState(state = {}) {
  return {
    reportCandidateAllowedDiagnostic: state.reportCandidateAllowedDiagnostic === true,
    acceptedEvidenceCount: Number(state.acceptedEvidenceCount || 0),
    acceptedPromotionEvidenceCount: Number(state.acceptedPromotionEvidenceCount || 0),
    independentSourceBreadth: Number(state.independentSourceBreadth || 0),
    negativeControlStatus: compact(state.negativeControlStatus || ''),
    holdoutConfirmed: state.holdoutConfirmed === true,
    issuerBridgeStatus: compact(state.issuerBridgeStatus || ''),
    marketValidationStatus: compact(state.marketValidationStatus || 'missing'),
    valuationBridgeStatus: compact(state.valuationBridgeStatus || 'missing'),
    closureStatus: state.reportCandidateAllowedDiagnostic ? 'seed_centric_gate_closure_passed' : 'seed_centric_gate_closure_blocked',
    remainingBlockers: asArray(state.missingGates).map(compact).filter(Boolean),
    seedCentricGateClosure: true,
    nextGateAction: state.nextGateAction || null,
    gateClosureProgress: state.gateClosureProgress || 0,
  };
}

function blockerBlocksStaging(blocker, { seedCentric = false } = {}) {
  if (seedCentric && /valuation_bridge_missing|local_market_or_valuation_fixture_required/i.test(blocker)) return true;
  return /provider_blocked|route_mismatch|broad_known_narrative|accepted_evidence_missing|accepted_promotion_evidence_missing|independent_source_breadth_missing|issuer_bridge_missing|holdout_missing|negative_control|market_validation_missing/i.test(blocker)
    && !/valuation|expectation|investment_memo_readiness|human_review/i.test(blocker);
}

function evaluateStageGate(snapshot = {}, options = {}) {
  const blockers = [];
  if (!snapshot.reportCandidateAllowedDiagnostic) blockers.push('report_candidate_diagnostic_not_allowed');
  if (snapshot.acceptedEvidenceCount < 1) blockers.push('accepted_evidence_missing');
  if (snapshot.acceptedPromotionEvidenceCount < 1) blockers.push('accepted_promotion_evidence_missing');
  if (snapshot.independentSourceBreadth < 2) blockers.push('independent_source_breadth_missing');
  if (!CLOSED_NEGATIVE_CONTROL.has(snapshot.negativeControlStatus)) blockers.push('negative_control_not_closed');
  if (!snapshot.holdoutConfirmed) blockers.push('holdout_missing');
  if (options.seedCentric ? snapshot.issuerBridgeStatus !== 'closed' : !CLOSED_ISSUER_BRIDGE.has(snapshot.issuerBridgeStatus)) blockers.push('issuer_bridge_missing');
  if (!CLOSED_MARKET_VALIDATION.has(snapshot.marketValidationStatus)) blockers.push('market_validation_missing');
  if (options.seedCentric && !CLOSED_VALUATION_BRIDGE.has(snapshot.valuationBridgeStatus)) blockers.push('valuation_bridge_missing');
  for (const blocker of snapshot.remainingBlockers || []) {
    if (blockerBlocksStaging(blocker, options)) blockers.push(blocker);
  }
  return {
    ok: blockers.length === 0,
    blockers: [...new Set(blockers)],
  };
}

export function buildReportCandidateStaging({
  repairLoop = {},
  finalReport = {},
  existing = null,
  evidenceGateConsolidation = null,
} = {}, options = {}) {
  repairLoop = repairLoop || {};
  finalReport = finalReport || {};
  const now = options.now ? new Date(options.now) : new Date();
  const consolidationState = evidenceGateConsolidation?.stagedState
    || evidenceGateConsolidation?.primaryState
    || null;
  const seedCentric = Boolean(consolidationState);
  const subject = seedCentric
    ? subjectFromGateState(consolidationState, { repairLoop, finalReport })
    : extractSubject({ repairLoop, finalReport });
  const gateSnapshot = seedCentric
    ? gateSnapshotFromConsolidationState(consolidationState)
    : extractGateSnapshot({ repairLoop, finalReport });
  const gate = evaluateStageGate(gateSnapshot, { seedCentric });
  const stageId = `report-candidate-staged-${stableHash(`${subject.subjectId}:${subject.childSeedId}:${gateSnapshot.acceptedPromotionEvidenceCount}`)}`;
  const candidates = [];
  if (gate.ok) {
    candidates.push({
      reportCandidateStageId: stageId,
      reviewStatus: existing?.candidates?.find?.((item) => item.reportCandidateStageId === stageId)?.reviewStatus || 'pending',
      stageStatus: 'report_candidate_staged',
      stageReason: 'report candidate diagnostic gates closed; waiting for human promote/reject decision',
      stagedAt: now.toISOString(),
      subject,
      gateSnapshot,
      automaticPromotionAllowed: false,
      approvalRequired: true,
      mutationBoundary: zeroBoundary(),
      requiredHumanActions: [
        'report_candidate_staged_review',
        'report_promote_or_reject_decision',
      ],
      auditRef: {
        repairLoopRunId: repairLoop.runId || null,
        finalReportRunId: finalReport.runId || null,
        evidenceGateConsolidationVersion: evidenceGateConsolidation?.version || null,
        reportPath: subject.reportPath || null,
      },
    });
  }
  return {
    ok: true,
    version: REPORT_CANDIDATE_STAGING_VERSION,
    generatedAt: now.toISOString(),
    stagingStatus: gate.ok ? 'staged_for_operator_review' : 'blocked_no_stage',
    stageCount: candidates.length,
    candidates,
    gateSnapshot,
    seedCentricGateClosure: seedCentric,
    evidenceGateConsolidation: seedCentric ? {
      version: evidenceGateConsolidation.version || null,
      candidateSeed: evidenceGateConsolidation.candidateSeed || null,
      nextGateAction: evidenceGateConsolidation.nextGateAction || null,
      whyNotReportCandidate: evidenceGateConsolidation.whyNotReportCandidate || null,
    } : null,
    blockers: gate.blockers,
    reviewOnly: true,
    automaticPromotionAllowed: false,
    reportCandidateWriteAllowed: false,
    mutationBoundary: zeroBoundary({
      reportCandidateStagedArtifactWrites: candidates.length,
    }),
  };
}

export async function writeReportCandidateStagingArtifact(payload, filePath = path.join(process.cwd(), 'data', 'runtime', 'report-candidate-staging.latest.json')) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return path.resolve(filePath);
}
