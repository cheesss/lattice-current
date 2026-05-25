const REQUIRED_STATEMENTS = [
  'This is a final investment report dry-run, not an approved investment memo.',
  'No buy/sell/position-sizing recommendation is made.',
  'Portfolio action is not allowed without human review.',
  'Decision-ready status remains false.',
];

const BUY_SELL_DISCLAIMER = 'No buy/sell/position-sizing recommendation is made.';

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values = [], limit = 100) {
  const seen = new Set();
  const out = [];
  for (const value of values.flatMap(asArray)) {
    const text = compact(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function rowFor(matrix = [], evidenceClass = '') {
  return asArray(matrix).find((row) => row.evidenceClass === evidenceClass) || {};
}

function rowEvidenceIds(matrix = [], evidenceClasses = []) {
  return uniqueStrings(evidenceClasses.flatMap((evidenceClass) => rowFor(matrix, evidenceClass).evidenceIds || []), 40);
}

function closurePassed(status = '') {
  return /^closure_passed/i.test(String(status || ''));
}

function marketRegimeHumanReviewable(status = '') {
  return ['regime_supported', 'regime_caveated_with_human_review'].includes(String(status || ''));
}

function bridgeHumanReviewable(status = '', accepted = []) {
  return accepted.includes(String(status || ''));
}

function gateChecklist(input = {}) {
  const matrix = asArray(input.evidenceContractMatrix || input.evidenceContractMatrixSummary);
  const contradictionWarnings = asArray(input.contradictionWarnings || input.closureContradictionWarnings);
  const marketRegimeStatus = input.marketValidationRegimeStatus || input.marketRegimeSupport?.marketValidationRegimeStatus || 'regime_missing';
  const checks = [
    {
      key: 'evidence_contract_matrix_closure',
      passed: closurePassed(input.evidenceContractClosureStatus),
      detail: input.evidenceContractClosureStatus || 'missing',
    },
    {
      key: 'accepted_promotion_evidence',
      passed: Number(input.acceptedPromotionEvidenceCount || input.acceptedPromotionEvidenceAfter || 0) >= 1,
      detail: String(input.acceptedPromotionEvidenceCount ?? input.acceptedPromotionEvidenceAfter ?? 0),
    },
    {
      key: 'independent_source_breadth',
      passed: Number(input.independentSourceBreadth || input.evidenceCountsAfter?.independentSourceBreadth || 0) >= 2,
      detail: String(input.independentSourceBreadth || input.evidenceCountsAfter?.independentSourceBreadth || 0),
    },
    {
      key: 'issuer_bridge',
      passed: String(input.issuerBridgeStatus || input.issuerBridgeAfter || '').toLowerCase() === 'closed',
      detail: input.issuerBridgeStatus || input.issuerBridgeAfter || 'missing',
    },
    {
      key: 'negative_control',
      passed: ['CHECKED_NO_DIRECT', 'SURVIVED'].includes(String(input.negativeControlStatus || input.negativeControlAfter || '')),
      detail: input.negativeControlStatus || input.negativeControlAfter || 'missing',
    },
    {
      key: 'holdout_validation',
      passed: Boolean(input.holdoutConfirmed ?? input.holdoutAfter),
      detail: String(input.holdoutConfirmed ?? input.holdoutAfter ?? false),
    },
    {
      key: 'valuation_bridge',
      passed: bridgeHumanReviewable(input.valuationBridgeStatus, ['valuation_bridge_closed', 'valuation_bridge_caveated_with_human_review']),
      detail: input.valuationBridgeStatus || 'missing',
    },
    {
      key: 'expectation_bridge',
      passed: bridgeHumanReviewable(input.expectationBridgeStatus, ['expectation_bridge_closed', 'expectation_bridge_caveated_with_human_review']),
      detail: input.expectationBridgeStatus || 'missing',
    },
    {
      key: 'controlled_market_validation',
      passed: ['controlled_ready', 'market_validation_caveated'].includes(String(input.marketValidationStatus || input.marketValidationAfter || '')),
      detail: input.marketValidationStatus || input.marketValidationAfter || 'missing',
    },
    {
      key: 'market_regime_support',
      passed: marketRegimeHumanReviewable(marketRegimeStatus),
      detail: marketRegimeStatus,
    },
    {
      key: 'contradiction_detector',
      passed: !contradictionWarnings.some((warning) => warning.blocker === true || warning.severity === 'critical'),
      detail: contradictionWarnings.length ? `${contradictionWarnings.length} warnings` : 'clean',
    },
    {
      key: 'provider_blocked',
      passed: input.blockType !== 'provider_blocked' && input.providerBlockedStatus !== true,
      detail: input.blockType || 'not_provider_blocked',
    },
    {
      key: 'route_mismatch',
      passed: !(input.routeMismatchDetected && !input.splitTracks) && input.blockType !== 'route_mismatch_unresolved',
      detail: input.routeMismatchDetected ? 'split_or_resolved' : 'not_detected',
    },
  ];
  return checks;
}

function buildClaimEvidenceMap(input = {}, matrix = []) {
  const claims = [
    {
      claimId: 'mechanism-evidence',
      section: 'C. Mechanism Evidence',
      claimText: 'Accepted mechanism evidence supports a process bottleneck, but mechanism evidence alone does not establish investment readiness.',
      evidenceClass: 'mechanism_validation',
      evidenceIds: rowEvidenceIds(matrix, ['mechanism_validation', 'grid_interconnection']),
      requiresEvidence: true,
      caveats: ['mechanism_evidence_not_investment_ready'],
    },
    {
      claimId: 'issuer-bridge',
      section: 'D. Issuer Bridge',
      claimText: 'Accepted issuer bridge evidence links the bottleneck to issuer operating exposure.',
      evidenceClass: 'issuer_exposure',
      evidenceIds: rowEvidenceIds(matrix, ['issuer_exposure', 'issuer_commentary_or_official_issuer_bridge']),
      requiresEvidence: true,
      caveats: [],
    },
    {
      claimId: 'negative-control',
      section: 'E. Negative Control',
      claimText: 'Negative-control evidence did not find a direct invalidator in the bounded lane.',
      evidenceClass: 'negative_control',
      evidenceIds: rowEvidenceIds(matrix, ['negative_control']),
      requiresEvidence: true,
      caveats: ['negative_control_not_proof'],
    },
    {
      claimId: 'holdout-validation',
      section: 'F. Holdout Validation',
      claimText: 'Holdout validation is confirmed by source groups outside the seed generation lane.',
      evidenceClass: 'holdout_validation',
      evidenceIds: rowEvidenceIds(matrix, ['holdout_validation']),
      requiresEvidence: true,
      caveats: [],
    },
    {
      claimId: 'controlled-market-validation',
      section: 'G. Controlled Market Validation',
      claimText: 'Controlled market validation is research-use support and remains caveated unless regime support is closed.',
      evidenceClass: 'controlled_market_validation',
      evidenceIds: rowEvidenceIds(matrix, ['controlled_market_validation']),
      requiresEvidence: true,
      caveats: uniqueStrings([input.marketValidationCaveats, input.marketValidationWarnings, input.marketRegimeSupport?.caveats], 20),
    },
    {
      claimId: 'market-regime-support',
      section: 'H. Market Regime Support',
      claimText: 'Market regime support is a human-review diagnostic over local controlled market windows, not decision-use evidence.',
      evidenceClass: 'controlled_market_validation',
      evidenceIds: rowEvidenceIds(matrix, ['controlled_market_validation']),
      requiresEvidence: true,
      caveats: uniqueStrings([input.marketRegimeSupport?.caveats, input.marketValidationCaveats], 20),
    },
    {
      claimId: 'valuation-expectation-bridge',
      section: 'I. Valuation / Expectation Bridge',
      claimText: 'Valuation and expectation bridge evidence is present only as human-review context, not a price or allocation view.',
      evidenceClass: 'valuation_or_expectation_bridge',
      evidenceIds: rowEvidenceIds(matrix, ['valuation_or_expectation_bridge']),
      requiresEvidence: Number(rowFor(matrix, 'valuation_or_expectation_bridge').acceptedCount || 0) > 0,
      caveats: uniqueStrings([input.remainingCaveats, input.missingValuationFields], 20),
    },
  ];
  return claims;
}

function renderSection(title, body) {
  return `## ${title}\n${body.trim()}`;
}

function filterResolvedCaveats(caveats = [], input = {}) {
  const marketRegimeStatus = input.marketValidationRegimeStatus || input.marketRegimeSupport?.marketValidationRegimeStatus || 'regime_missing';
  const valuationBridgeStatus = input.valuationBridgeStatus || 'valuation_bridge_missing';
  const expectationBridgeStatus = input.expectationBridgeStatus || 'expectation_bridge_missing';
  const resolvedPatterns = [];
  if (marketRegimeStatus === 'regime_supported') {
    resolvedPatterns.push(
      /zero_regime_support/i,
      /DECISION_GRADE_MARKET_WITH_ZERO_REGIME_SUPPORT/i,
      /unknown_regime_share_high/i,
      /market_validation_regime_support/i,
      /sanity_check_extreme_tstat/i,
    );
  }
  if (valuationBridgeStatus === 'valuation_bridge_closed' || valuationBridgeStatus === 'valuation_bridge_caveated_with_human_review') {
    resolvedPatterns.push(/valuation_bridge_not_closed/i);
  }
  if (
    (valuationBridgeStatus === 'valuation_bridge_closed' || valuationBridgeStatus === 'valuation_bridge_caveated_with_human_review')
    && (expectationBridgeStatus === 'expectation_bridge_closed' || expectationBridgeStatus === 'expectation_bridge_caveated_with_human_review')
  ) {
    resolvedPatterns.push(
      /VALUATION_OR_EXPECTATION_BRIDGE_MISSING/i,
      /valuation_or_expectation_bridge_missing/i,
      /issuer_expectation_context/i,
    );
  }
  return uniqueStrings(caveats, 100).filter((item) => !resolvedPatterns.some((pattern) => pattern.test(item)));
}

function normalizeSubjectLabel(label = '') {
  return compact(label || 'autonomous research subject')
    .replace(/\bcross-theme\s+cross-theme\b/gi, 'cross-theme');
}

function renderFinalReportMarkdown({ metadata, subject, checks, claims, input, blockers }) {
  const passedCount = checks.filter((check) => check.passed).length;
  const failedChecks = checks.filter((check) => !check.passed).map((check) => `${check.key}=${check.detail}`);
  const caveats = filterResolvedCaveats(
    uniqueStrings([input.remainingCaveats, input.closureCaveats, input.marketRegimeSupport?.caveats, failedChecks], 80),
    input,
  );
  const subjectLabel = normalizeSubjectLabel(subject.subjectLabel || input.dryRunReportSubject?.subjectLabel);
  return [
    renderSection('A. Executive Judgment', `
${REQUIRED_STATEMENTS.join('\n')}

Status: ${metadata.finalInvestmentReportDryRunStatus}. Decision use: ${metadata.decisionUse}. The dry-run is ${metadata.notDecisionReady ? 'not decision-ready' : 'unexpectedly decision-ready'}.

Gate summary: ${passedCount}/${checks.length} gates passed. Remaining blockers: ${blockers.length ? blockers.join('; ') : 'none'}.
`),
    renderSection('B. Thesis Summary', `
Subject under review: ${subjectLabel}.

The memo frames a thesis validation path for human review. It does not approve a portfolio action and does not convert research evidence into a recommendation.
`),
    renderSection('C. Mechanism Evidence', `
${claims.find((claim) => claim.claimId === 'mechanism-evidence')?.claimText}
Accepted evidence count: ${rowFor(input.evidenceContractMatrix || [], 'mechanism_validation').acceptedCount || 0}.
`),
    renderSection('D. Issuer Bridge', `
${claims.find((claim) => claim.claimId === 'issuer-bridge')?.claimText}
Issuer bridge status: ${input.issuerBridgeStatus || input.issuerBridgeAfter || 'missing'}.
`),
    renderSection('E. Negative Control', `
${claims.find((claim) => claim.claimId === 'negative-control')?.claimText}
Negative-control status: ${input.negativeControlStatus || input.negativeControlAfter || 'missing'}.
`),
    renderSection('F. Holdout Validation', `
${claims.find((claim) => claim.claimId === 'holdout-validation')?.claimText}
Holdout confirmed: ${String(input.holdoutConfirmed ?? input.holdoutAfter ?? false)}.
`),
    renderSection('G. Controlled Market Validation', `
Controlled market validation is included with caveats. Market validation status: ${input.marketValidationStatus || input.marketValidationAfter || 'missing'}.
Market caveat: local controlled market support is not decision-use evidence unless regime support, sample sanity, and event/control quality are closed.
`),
    renderSection('H. Market Regime Support', `
Market regime status: ${input.marketValidationRegimeStatus || input.marketRegimeSupport?.marketValidationRegimeStatus || 'regime_missing'}.
Regime coverage score: ${input.regimeCoverageScore ?? input.marketRegimeSupport?.regimeCoverageScore ?? 'not_computable'}.
Regime consistency score: ${input.regimeConsistencyScore ?? input.marketRegimeSupport?.regimeConsistencyScore ?? 'not_computable'}.
Decision-ready status remains false even when the regime diagnostic is human-reviewable.
`),
    renderSection('I. Valuation / Expectation Bridge', `
Valuation bridge status: ${input.valuationBridgeStatus || 'missing'}.
Expectation bridge status: ${input.expectationBridgeStatus || 'missing'}.
No price or allocation view is made; this section only records whether the valuation and expectation bridge is human-reviewable.
`),
    renderSection('J. Risks and Caveats', `
${caveats.length ? caveats.map((item) => `- ${item}`).join('\n') : '- No caveats recorded, but human review is still required.'}
`),
    renderSection('K. What Would Upgrade This to Investment Memo Readiness', `
- Accepted promotion evidence remains bound to every core causal claim.
- Negative-control and holdout lanes remain closed.
- Issuer bridge, valuation/expectation bridge, and controlled market regime support are reviewed by a human.
- Contradiction detector remains clean or only caveated non-blocking.
`),
    renderSection('L. Human Review Checklist', `
- Review accepted evidence snippets against the audit appendix.
- Review market regime support caveats.
- Confirm no raw evidence, rejected evidence, or raw market rows support client-facing claims.
- Decide whether the dry-run should become an approved investment memo outside the autonomous loop.
`),
  ].join('\n\n');
}

function renderHtml(markdown = '') {
  const escapeHtml = (value = '') => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const blocks = [];
  const paragraph = [];
  let listItems = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${paragraph.map(escapeHtml).join('<br>')}</p>`);
    paragraph.length = 0;
  };
  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(`<ul>${listItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`);
    listItems = [];
  };
  for (const rawLine of String(markdown || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push(`<h2>${escapeHtml(heading[1])}</h2>`);
      continue;
    }
    const list = line.match(/^-\s+(.+)$/);
    if (list) {
      flushParagraph();
      listItems.push(list[1]);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  const html = blocks.join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Final Investment Report Dry-run</title>
  <style>
    body{font-family:Inter,Segoe UI,Arial,sans-serif;background:#08081a;color:#f1f5f9;margin:0;padding:40px;line-height:1.55}
    main{max-width:980px;margin:0 auto}
    h1{font-size:28px;margin:0 0 24px}
    h2{font-size:18px;margin:28px 0 10px;color:#38bdf8}
    p{margin:0 0 14px}
    ul{margin:0 0 18px 18px;padding:0}
    li{margin:4px 0}
    .badge{display:inline-block;border:1px solid rgba(56,189,248,.4);padding:4px 8px;border-radius:6px;color:#38bdf8;font-size:12px;margin-bottom:18px}
  </style>
</head>
<body><main><span class="badge">human review required</span><h1>Final Investment Report Dry-run</h1>${html}</main></body></html>`;
}

export function buildFinalInvestmentReportDryRun(input = {}) {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const matrix = asArray(input.evidenceContractMatrix || input.evidenceContractMatrixSummary);
  const subject = input.dryRunReportSubject || input.reportSubjectDryRun || {};
  const checks = gateChecklist({ ...input, evidenceContractMatrix: matrix });
  const blockers = checks.filter((check) => !check.passed).map((check) => check.key);
  const allGatesClosed = blockers.length === 0;
  const metadata = {
    memoType: 'investment_memo_dry_run',
    decisionUse: 'human_review_required',
    generatedAt,
    subjectId: subject.subjectId || null,
    subjectLabel: normalizeSubjectLabel(subject.subjectLabel || null),
    notDecisionReady: true,
    investmentMemoReady: false,
    decisionReady: false,
    portfolioActionAllowed: false,
    reportCandidateWrites: 0,
    readinessPromotionWrites: 0,
    providerActivationWrites: 0,
    canonicalWrites: 0,
    sourceRegistryWrites: 0,
    approvalQueueWrites: 0,
    portfolioActionWrites: 0,
    finalInvestmentReportDryRunStatus: allGatesClosed ? 'human_review_required' : 'blocked',
    validatorStatus: 'not_run',
  };
  const claims = buildClaimEvidenceMap(input, matrix);
  const clientMemoMarkdown = renderFinalReportMarkdown({ metadata, subject, checks, claims, input: { ...input, evidenceContractMatrix: matrix }, blockers });
  const auditAppendix = {
    generatedAt,
    subject,
    gateChecklist: checks,
    remainingBlockers: blockers,
    evidenceContractMatrixSummary: matrix.map((row) => ({
      evidenceClass: row.evidenceClass,
      status: row.status,
      acceptedCount: row.acceptedCount,
      promotionEligibleCount: row.promotionEligibleCount,
      evidenceIds: row.evidenceIds || [],
      caveats: row.caveats || [],
    })),
    claimEvidenceMap: claims.map((claim) => ({
      claimId: claim.claimId,
      section: claim.section,
      evidenceClass: claim.evidenceClass,
      evidenceIds: claim.evidenceIds || [],
      caveats: claim.caveats || [],
      requiresEvidence: claim.requiresEvidence !== false,
    })),
    rawPayloadLocation: 'audit_appendix_only',
    mutationBoundary: {
      reportCandidateWrites: 0,
      readinessPromotionWrites: 0,
      providerActivationWrites: 0,
      canonicalWrites: 0,
      sourceRegistryWrites: 0,
      approvalQueueWrites: 0,
      portfolioActionWrites: 0,
    },
  };
  const report = {
    ok: true,
    memoType: metadata.memoType,
    metadata,
    finalInvestmentReportDryRunStatus: metadata.finalInvestmentReportDryRunStatus,
    decisionUse: metadata.decisionUse,
    clientMemoMarkdown,
    html: renderHtml(clientMemoMarkdown),
    claims,
    auditAppendix,
    gateChecklist: checks,
    remainingBlockers: blockers,
    nextRecommendedAction: allGatesClosed ? 'human_review_required' : 'operator_review_required_for_remaining_blockers',
  };
  const validation = validateFinalInvestmentReportDryRun(report);
  report.metadata.validatorStatus = validation.ok ? 'passed' : 'failed';
  report.validatorStatus = report.metadata.validatorStatus;
  report.validation = validation;
  if (!validation.ok) {
    report.finalInvestmentReportDryRunStatus = 'failed';
    report.metadata.finalInvestmentReportDryRunStatus = 'failed';
  }
  return report;
}

export function validateFinalInvestmentReportDryRun(report = {}) {
  const blockers = [];
  const metadata = report.metadata || {};
  const body = String(report.clientMemoMarkdown || '');
  const bodyWithoutDisclaimer = body.replace(BUY_SELL_DISCLAIMER, '');
  const audit = report.auditAppendix || {};
  const boundary = audit.mutationBoundary || metadata;
  const claims = asArray(report.claims);
  const checks = asArray(report.gateChecklist);
  const marketCheck = checks.find((check) => check.key === 'controlled_market_validation');
  const valuationCheck = checks.find((check) => check.key === 'valuation_bridge');

  const add = (type, message, extra = {}) => blockers.push({ type, message, ...extra });
  const requireEqual = (field, actual, expected) => {
    if (actual !== expected) add(`${field}_invalid`, `${field} must be ${expected}`);
  };

  requireEqual('memoType', metadata.memoType, 'investment_memo_dry_run');
  requireEqual('decisionUse', metadata.decisionUse, 'human_review_required');
  requireEqual('notDecisionReady', metadata.notDecisionReady, true);
  requireEqual('investmentMemoReady', metadata.investmentMemoReady, false);
  requireEqual('decisionReady', metadata.decisionReady, false);
  requireEqual('portfolioActionAllowed', metadata.portfolioActionAllowed, false);
  requireEqual('reportCandidateWrites', Number(boundary.reportCandidateWrites || 0), 0);
  requireEqual('readinessPromotionWrites', Number(boundary.readinessPromotionWrites || 0), 0);
  requireEqual('providerActivationWrites', Number(boundary.providerActivationWrites || 0), 0);
  requireEqual('portfolioActionWrites', Number(boundary.portfolioActionWrites || 0), 0);

  for (const statement of REQUIRED_STATEMENTS) {
    if (!body.includes(statement)) add('missing_required_statement', `Missing required statement: ${statement}`);
  }
  if (/\b(buy|sell|position[-\s]?sizing|target price|overweight|underweight)\b/i.test(bodyWithoutDisclaimer)) {
    add('portfolio_action_language', 'Buy/sell/position-sizing or recommendation language is not allowed.');
  }
  if (/\b(rawEvidenceIds|queryPayload|sourceQuery|local-market:|market-validation:|rawMarketRows|raw valuation rows)\b/i.test(body)) {
    add('raw_payload_in_client_memo', 'Raw evidence/query/market payload leaked into client memo.');
  }
  if (/valuation (supports|implies|justifies|is attractive|is cheap|upside)/i.test(body)) {
    add('valuation_conclusion_without_bridge', 'Valuation conclusion language is not allowed in dry-run.');
  }
  if (marketCheck && !marketCheck.passed && !/Market caveat:/i.test(body)) {
    add('missing_market_caveat', 'Market caveat is required when controlled market validation is not fully closed.');
  }
  if (valuationCheck && !valuationCheck.passed && /valuation conclusion/i.test(body)) {
    add('valuation_bridge_missing_but_conclusion_written', 'Valuation bridge is missing/caveated but memo writes a conclusion.');
  }
  for (const claim of claims) {
    const ids = asArray(claim.evidenceIds);
    if (claim.requiresEvidence !== false && !ids.length) {
      add('claim_missing_accepted_evidence', 'Claim requires accepted evidence IDs.', { claimId: claim.claimId });
    }
    if (ids.some((id) => /\b(raw|rejected|not_evaluated)\b/i.test(String(id)))) {
      add('claim_uses_raw_or_rejected_evidence', 'Claim uses raw or rejected evidence.', { claimId: claim.claimId });
    }
  }
  if (!audit.claimEvidenceMap?.length) {
    add('missing_claim_evidence_map', 'Audit appendix must include claim/evidence map.');
  }
  return {
    ok: blockers.length === 0,
    status: blockers.length ? 'failed' : 'passed',
    blockers,
  };
}

export function renderFinalInvestmentReportHtml(report = {}) {
  return report.html || renderHtml(report.clientMemoMarkdown || '');
}

export const __test = {
  gateChecklist,
  buildClaimEvidenceMap,
  REQUIRED_STATEMENTS,
};
