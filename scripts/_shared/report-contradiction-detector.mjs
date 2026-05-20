const CRITICAL_EVIDENCE_CLASSES = new Set([
  'issuer_exposure',
  'negative_control',
  'market_validation',
  'mechanism_validation',
  'operating_kpi',
  'primary_filing',
  'issuer_commentary',
]);

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase().replace(/-/g, '_');
}

function normalizeEvidenceClass(value) {
  return normalizeToken(value || 'unknown');
}

function numberOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function addIssue(out, code, severity, message, blocker, nextAction) {
  out.push({ code, severity, message, blocker, nextAction });
}

function matrixRows(input = {}) {
  return [
    ...asArray(input.matrix),
    ...asArray(input.summary?.classRows),
    ...asArray(input.summary?.classLedger),
    ...asArray(input.quality?.evidenceContract?.matrix),
    ...asArray(input.quality?.evidenceContract?.rows),
    ...asArray(input.quality?.evidenceClassMatrix),
    ...asArray(input.actionability?.evidenceMatrix),
  ];
}

function rowClass(row = {}) {
  return normalizeEvidenceClass(row.evidenceClass || row.className || row.class || row.desiredEvidenceClass);
}

function rowStatus(row = {}) {
  return normalizeToken(row.status || row.state || row.visualStatus || row.coverage || row.evidenceTier || row.tier);
}

function isMissingRow(row = {}) {
  return ['missing', 'pending', 'context', 'weak_noise', 'weak_screen', 'blocked_missing_issuer_universe'].includes(rowStatus(row));
}

function criticalMissingClasses(input = {}) {
  const fromSummary = asArray(input.summary?.openClasses).map(normalizeEvidenceClass);
  const fromMatrix = matrixRows(input)
    .filter((row) => isMissingRow(row))
    .map(rowClass);
  return [...new Set([...fromSummary, ...fromMatrix].filter((cls) => CRITICAL_EVIDENCE_CLASSES.has(cls)))];
}

function isReviewReady(input = {}) {
  const summary = input.summary || {};
  const quality = input.quality || {};
  const status = normalizeToken(summary.visualStatus || summary.status || summary.visibleStatus);
  const states = [
    summary.evidenceState ||
    summary.decisionDiagnostic?.status,
    quality.decisionDiagnostic?.status ||
    quality.evidenceState,
  ].map(normalizeToken);
  return status === 'review_ready' || states.includes('decision_ready_review');
}

function investmentTier(input = {}) {
  return normalizeToken(
    input.quality?.productTier ||
    input.quality?.investmentReadiness?.tier ||
    input.quality?.deepResearch?.investmentReadiness?.tier ||
    input.summary?.productTier ||
    input.summary?.investmentReadiness?.tier,
  );
}

function actionabilityReady(actionability = {}) {
  const tier = normalizeToken(actionability.tier || actionability.status || actionability.actionabilityTier);
  if (!tier) return false;
  return [
    'analyst_action_review_ready',
    'decision_ready_review',
    'review_ready',
    'ready',
    'investment_ready',
  ].includes(tier);
}

function marketTier(input = {}) {
  return normalizeToken(
    input.marketValidation?.tier ||
    input.summary?.marketTier ||
    input.quality?.investmentReadiness?.marketValidation?.tier ||
    input.quality?.marketValidation?.tier,
  );
}

function regimeSupport(input = {}) {
  return numberOrNull(
    input.marketValidation?.regimeConsistency ??
    input.marketValidation?.regimeSupport ??
    input.marketValidation?.regimeSupportScore ??
    input.quality?.marketValidation?.regimeConsistency ??
    input.quality?.investmentReadiness?.marketValidation?.regimeConsistency,
  );
}

function issuerExposureAttached(input = {}) {
  const bridgeText = normalizeToken([
    input.issuerBridge?.status,
    input.issuerBridge?.bridgeStatus,
    input.issuerBridge?.closureState,
    input.issuerBridge?.exposureStatus,
  ].join(' '));
  if (bridgeText.includes('issuer_exposure_attached') || bridgeText.includes('direct_node_exposure_attached')) return true;
  return matrixRows(input).some((row) => {
    if (rowClass(row) !== 'issuer_exposure') return false;
    return ['promotion_collected', 'complete', 'direct', 'covered', 'promotion_eligible'].includes(rowStatus(row))
      || row.promotionEligibleCount > 0
      || row.promotionEligible === true;
  });
}

function issuerBridgeFollowUpRequired(issuerBridge = {}) {
  if (issuerBridge.followUpRequired === true) return true;
  const text = normalizeToken([
    issuerBridge.status,
    issuerBridge.bridgeStatus,
    issuerBridge.closureState,
    issuerBridge.nextAction,
    issuerBridge.reason,
  ].join(' '));
  return /follow.?up|required|pending|direct_bridge_pending|issuer_follow_up_ready/.test(text);
}

function coveredClasses(input = {}) {
  return [...new Set([
    ...asArray(input.summary?.coveredClasses),
    ...asArray(input.summary?.evidenceClassesCovered),
    ...asArray(input.summary?.coveredEvidenceClasses),
    ...asArray(input.quality?.decisionDiagnostic?.coveredClasses),
    ...asArray(input.quality?.decisionDiagnostic?.coveredEvidenceClasses),
    ...asArray(input.quality?.evidenceClassesCovered),
    ...asArray(input.actionability?.metrics?.evidenceClassesCovered),
  ].map(normalizeEvidenceClass).filter(Boolean))];
}

function missingClassesInMatrix(input = {}) {
  return [...new Set(matrixRows(input).filter(isMissingRow).map(rowClass).filter(Boolean))];
}

function convictionScore(input = {}) {
  const raw = numberOrNull(
    input.summary?.conviction ??
    input.quality?.conviction ??
    input.quality?.metrics?.conviction ??
    input.quality?.decisionDiagnostic?.conviction,
  );
  if (raw === null) return null;
  return raw > 1 ? raw / 100 : raw;
}

function sourceBreadth(input = {}) {
  return numberOrNull(
    input.summary?.sourceBreadth ??
    input.summary?.sourceDiversity ??
    input.quality?.sourceSummary?.sourceDiversityScore ??
    input.quality?.sourceDiversity ??
    input.quality?.investmentReadiness?.sourceDiversity ??
    input.quality?.metrics?.evidenceDiversity,
  );
}

export function detectReportReadinessContradictions({
  summary = {},
  matrix = [],
  quality = {},
  actionability = {},
  issuerBridge = {},
  marketValidation = {},
} = {}) {
  const input = { summary, matrix, quality, actionability, issuerBridge, marketValidation };
  const out = [];
  const criticalMissing = criticalMissingClasses(input);

  if (isReviewReady(input) && criticalMissing.length) {
    addIssue(
      out,
      'REVIEW_READY_WITH_CRITICAL_EVIDENCE_MISSING',
      'critical',
      `Review-ready status conflicts with missing critical evidence: ${criticalMissing.slice(0, 4).join(', ')}.`,
      true,
      'downgrade closure status and run targeted evidence-class backfill',
    );
  }

  if (investmentTier(input) === 'investment_memo_candidate' && !actionabilityReady(actionability)) {
    addIssue(
      out,
      'INVESTMENT_MEMO_WITH_ACTIONABILITY_NOT_READY',
      'critical',
      'Investment memo candidate conflicts with non-ready portfolio/actionability bridge.',
      true,
      'keep report out of investment memo promotion until actionability bridge is ready',
    );
  }

  if (marketTier(input) === 'decision_grade' && regimeSupport(input) === 0) {
    addIssue(
      out,
      'DECISION_GRADE_MARKET_WITH_ZERO_REGIME_SUPPORT',
      'warning',
      'Decision-grade market validation has zero regime support.',
      false,
      'downgrade or caveat market validation until regime support is non-zero',
    );
  }

  if (issuerExposureAttached(input) && issuerBridgeFollowUpRequired(issuerBridge)) {
    addIssue(
      out,
      'ISSUER_EXPOSURE_ATTACHED_BUT_BRIDGE_FOLLOWUP_REQUIRED',
      'critical',
      'Issuer exposure is attached while the issuer bridge still requires follow-up.',
      true,
      'keep issuer bridge in follow-up state until direct exposure review is closed',
    );
  }

  const missingSet = new Set(missingClassesInMatrix(input));
  const coveredButMissing = coveredClasses(input).filter((cls) => missingSet.has(cls));
  if (coveredButMissing.length) {
    addIssue(
      out,
      'EVIDENCE_CLASS_COVERED_BUT_MATRIX_MISSING',
      'critical',
      `Evidence classes are marked covered but matrix still shows missing: ${coveredButMissing.slice(0, 4).join(', ')}.`,
      true,
      'reconcile covered-class metrics with the evidence contract matrix before promotion',
    );
  }

  const conviction = convictionScore(input);
  const breadth = sourceBreadth(input);
  if (conviction !== null && breadth !== null && conviction >= 0.7 && breadth < 0.5) {
    addIssue(
      out,
      'HIGH_CONVICTION_WITH_LOW_SOURCE_BREADTH',
      'warning',
      `High conviction ${conviction.toFixed(2)} conflicts with low source breadth ${breadth.toFixed(2)}.`,
      false,
      'cap conviction until independent source breadth clears the threshold',
    );
  }

  return out;
}

export const __test = {
  criticalMissingClasses,
  coveredClasses,
  issuerExposureAttached,
  issuerBridgeFollowUpRequired,
};
