import crypto from 'node:crypto';

export const OPERATOR_APPROVAL_WORKFLOW_VERSION = 'operator-approval-workflow-v1';

const DEFAULT_TTL_DAYS = 7;

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
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
    ...extra,
  };
}

function stableActionId(actionType, key) {
  const digest = crypto.createHash('sha1').update(`${actionType}:${key}`).digest('hex').slice(0, 12);
  return `operator-action-${actionType}-${digest}`;
}

function expiryFrom(now = new Date(), ttlDays = DEFAULT_TTL_DAYS) {
  const at = new Date(now);
  at.setUTCDate(at.getUTCDate() + ttlDays);
  return at.toISOString();
}

function rawActivationRecords(sourceProviderActivation = {}) {
  return asArray(
    sourceProviderActivation.records
    || sourceProviderActivation.audit?.rawRecords
    || sourceProviderActivation.sourceProviderActivation?.audit?.rawRecords,
  );
}

function addAction(actions, input = {}, now = new Date()) {
  const actionType = compact(input.actionType || 'operator_review');
  const subjectKey = compact(input.subjectKey || input.providerName || input.reportId || actionType);
  actions.push({
    operatorActionId: stableActionId(actionType, subjectKey),
    actionType,
    reviewStatus: input.reviewStatus || 'pending',
    subjectKey,
    providerName: input.providerName || null,
    evidenceClass: input.evidenceClass || null,
    reason: compact(input.reason || 'operator review required'),
    requiredBy: input.requiredBy || 'automation_console',
    mutationBoundary: zeroBoundary(input.mutationBoundary || {}),
    expiresAt: input.expiresAt || expiryFrom(now, input.ttlDays || DEFAULT_TTL_DAYS),
    auditRef: input.auditRef || null,
  });
}

export function buildOperatorApprovalWorkflow({
  sourceProviderActivation = {},
  repairLoop = {},
  finalReport = {},
  reportCandidateStaging = {},
  sectorPositivePaths = {},
} = {}, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const actions = [];
  repairLoop = repairLoop || {};
  finalReport = finalReport || {};
  sectorPositivePaths = sectorPositivePaths || {};
  const records = rawActivationRecords(sourceProviderActivation);

  for (const record of records) {
    if (record.status === 'needs_fixture') {
      addAction(actions, {
        actionType: 'provider_fixture_approval',
        subjectKey: record.candidateId || `${record.providerName}:${record.evidenceClass}`,
        providerName: record.providerName,
        evidenceClass: record.evidenceClass,
        reason: record.activationBlocker || record.evaluation?.activationBlocker || 'fixture_required_before_activation',
        auditRef: { candidateId: record.candidateId, status: record.status },
      }, now);
    }
    if (record.status === 'needs_credentials') {
      addAction(actions, {
        actionType: 'credential_input',
        subjectKey: record.candidateId || `${record.providerName}:${record.evidenceClass}`,
        providerName: record.providerName,
        evidenceClass: record.evidenceClass,
        reason: 'credentials_or_api_key_required',
        auditRef: { candidateId: record.candidateId, status: record.status },
      }, now);
    }
    if (record.status === 'provider_gap_proposal_required') {
      addAction(actions, {
        actionType: 'provider_gap_review',
        subjectKey: record.candidateId || `${record.providerName}:${record.evidenceClass}`,
        providerName: record.providerName,
        evidenceClass: record.evidenceClass,
        reason: 'provider_gap_requires_review_gated_adapter_proposal',
        auditRef: { candidateId: record.candidateId, status: record.status },
      }, now);
    }
  }

  const stopReason = compact(repairLoop.stopReason || finalReport.stopReason || finalReport.decisionDiagnostic?.stopReason || '');
  const visualStatus = compact(repairLoop.visualStatusAfter || finalReport.visualStatus || finalReport.status || '');
  const reportKey = compact(finalReport.reportId || finalReport.reportPath || finalReport.artifactPath || repairLoop.runId || 'latest-final-report');
  for (const stagedCandidate of asArray(reportCandidateStaging?.candidates)) {
    if (stagedCandidate.reviewStatus && stagedCandidate.reviewStatus !== 'pending') continue;
    const subject = stagedCandidate.subject || {};
    addAction(actions, {
      actionType: 'report_candidate_staged_review',
      subjectKey: stagedCandidate.reportCandidateStageId || subject.subjectId || reportKey,
      reason: stagedCandidate.stageReason || 'report candidate staged for human promote/reject decision',
      auditRef: {
        reportCandidateStageId: stagedCandidate.reportCandidateStageId,
        subjectId: subject.subjectId,
        childSeedId: subject.childSeedId,
        reportPath: subject.reportPath,
      },
    }, now);
    addAction(actions, {
      actionType: 'report_promote_or_reject_decision',
      subjectKey: stagedCandidate.reportCandidateStageId || subject.subjectId || reportKey,
      reason: 'human decision required before report_candidate status write',
      auditRef: {
        reportCandidateStageId: stagedCandidate.reportCandidateStageId,
        subjectId: subject.subjectId,
        childSeedId: subject.childSeedId,
        reportPath: subject.reportPath,
      },
    }, now);
  }
  if (/human|operator|review/i.test(stopReason) || /human_review_required|review-ready|decision-review/i.test(visualStatus)) {
    addAction(actions, {
      actionType: 'final_memo_review',
      subjectKey: reportKey,
      reason: stopReason || visualStatus || 'human review required before final memo decision',
      auditRef: { reportKey, visualStatus },
    }, now);
    addAction(actions, {
      actionType: 'report_promote_or_reject_decision',
      subjectKey: reportKey,
      reason: 'human decision required; automation cannot promote report candidate or portfolio action',
      auditRef: { reportKey, visualStatus },
    }, now);
  }

  const sectorSummary = sectorPositivePaths?.summary || sectorPositivePaths;
  if (asArray(sectorSummary?.sectors).some((sector) => sector.realEvidenceStatus === 'blocked_until_real_official_evidence')) {
    addAction(actions, {
      actionType: 'real_evidence_route_review',
      subjectKey: 'sector-positive-path-real-evidence-routes',
      reason: 'sector positive-path fixtures need real official route evidence before production use',
      auditRef: { sectorCount: sectorSummary?.sectorCount || asArray(sectorSummary?.sectors).length },
    }, now);
  }

  const actionCounts = {};
  for (const action of actions) actionCounts[action.actionType] = (actionCounts[action.actionType] || 0) + 1;
  return {
    ok: true,
    version: OPERATOR_APPROVAL_WORKFLOW_VERSION,
    generatedAt: now.toISOString(),
    reviewOnly: true,
    actionCount: actions.length,
    actionCounts,
    actions,
    mutationBoundary: zeroBoundary(),
    allowedOperatorActions: [
      'provider_fixture_approval',
      'credential_input',
      'provider_gap_review',
      'report_candidate_staged_review',
      'high_risk_source_override',
      'final_memo_review',
      'report_promote_or_reject_decision',
    ],
    automationCannotPerform: [
      'portfolio_action',
      'investment_memo_approval',
      'paid_provider_activation_without_credentials',
      'canonical_graph_write',
    ],
  };
}
