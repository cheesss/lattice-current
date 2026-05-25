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

function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function rowFor(matrix = [], evidenceClass) {
  return asArray(matrix).find((row) => row.evidenceClass === evidenceClass) || {};
}

function evidenceRowsFromMatrix(matrix = []) {
  return asArray(matrix).flatMap((row) => asArray(row.evidenceIds).map((evidenceId) => ({
    evidenceId,
    evidenceClass: row.evidenceClass,
    acceptedUse: row.acceptedUse || 'supporting_context',
    promotionEligible: Number(row.promotionEligibleCount || 0) > 0 && row.acceptedUse === 'promotion_candidate',
    sourceGroups: row.sourceGroups || [],
    caveats: row.caveats || [],
  })));
}

function evidenceIdsFor(matrix = [], classes = []) {
  return uniqueStrings(asArray(classes).flatMap((klass) => rowFor(matrix, klass).evidenceIds || []), 50);
}

function buildClaims({ subject = {}, matrix = [], caveats = [], contradictionWarnings = [], valuationBridge = null } = {}) {
  const mechanismIds = evidenceIdsFor(matrix, ['mechanism_validation', 'grid_interconnection']);
  const issuerIds = evidenceIdsFor(matrix, ['issuer_exposure', 'issuer_commentary_or_official_issuer_bridge']);
  const negativeIds = evidenceIdsFor(matrix, ['negative_control']);
  const holdoutIds = evidenceIdsFor(matrix, ['holdout_validation']);
  const marketIds = evidenceIdsFor(matrix, ['controlled_market_validation']);
  const mechanismNode = subject.mechanismNode || subject.bottleneckNode || subject.subjectLabel || 'the mechanism bottleneck';
  const issuerBridgeNode = subject.issuerBridgeNode || subject.connector || subject.subjectLabel || 'the issuer operating bridge';
  const issuerUniverse = uniqueStrings(subject.issuerUniverse || [], 10).join(', ') || 'the issuer universe';
  const claims = [
    {
      claimId: 'TVM-CLM-001',
      section: 'Executive Judgment',
      claimText: 'The thesis is reviewable as a validation candidate because accepted mechanism, issuer bridge, negative-control, holdout, and controlled market evidence are present.',
      evidenceIds: uniqueStrings([mechanismIds, issuerIds, negativeIds, holdoutIds, marketIds], 80),
      evidenceClass: 'closure_summary',
      confidence: 'medium',
      caveats,
      allowedInClientMemo: true,
      allowedInAuditAppendix: true,
    },
    {
      claimId: 'TVM-CLM-002',
      section: 'Mechanism Evidence',
      claimText: `${mechanismNode} evidence supports the process bottleneck, but remains supporting context rather than promotion evidence.`,
      evidenceIds: mechanismIds,
      evidenceClass: 'mechanism_validation',
      confidence: 'medium',
      caveats: [],
      allowedInClientMemo: true,
      allowedInAuditAppendix: true,
    },
    {
      claimId: 'TVM-CLM-003',
      section: 'Issuer Bridge',
      claimText: `${issuerUniverse} are connected through accepted operating bridge evidence tied to ${issuerBridgeNode}, backlog, guidance, capacity, customer demand, or project execution.`,
      evidenceIds: issuerIds,
      evidenceClass: 'issuer_exposure',
      confidence: 'medium',
      caveats: [],
      allowedInClientMemo: true,
      allowedInAuditAppendix: true,
    },
    {
      claimId: 'TVM-CLM-004',
      section: 'Negative Control',
      claimText: 'Negative control is checked-no-direct, meaning no direct invalidator was found in the bounded lane; it does not prove the thesis.',
      evidenceIds: negativeIds,
      evidenceClass: 'negative_control',
      confidence: 'medium',
      caveats: [],
      allowedInClientMemo: true,
      allowedInAuditAppendix: true,
    },
    {
      claimId: 'TVM-CLM-005',
      section: 'Holdout Validation',
      claimText: 'Independent holdout evidence supports the issuer bridge without relying on the same document as issuer exposure.',
      evidenceIds: holdoutIds,
      evidenceClass: 'holdout_validation',
      confidence: 'medium',
      caveats: [],
      allowedInClientMemo: true,
      allowedInAuditAppendix: true,
    },
    {
      claimId: 'TVM-CLM-006',
      section: 'Controlled Market Validation',
      claimText: 'Controlled market validation is research-use support only until regime coverage, t-stat sanity, and human memo review are complete.',
      evidenceIds: marketIds,
      evidenceClass: 'controlled_market_validation',
      confidence: 'low',
      caveats: uniqueStrings(['sanity_check_extreme_tstat', 'DECISION_GRADE_MARKET_WITH_ZERO_REGIME_SUPPORT', caveats], 20),
      allowedInClientMemo: true,
      allowedInAuditAppendix: true,
    },
    {
      claimId: 'TVM-CLM-007',
      section: 'What Is Still Missing',
      claimText: valuationBridge
        ? `Valuation and expectation bridge status is ${valuationBridge.valuationBridgeStatus || 'valuation_bridge_missing'}, so investment memo readiness and portfolio action remain blocked.`
        : 'Valuation and expectation bridge is missing, so investment memo readiness and portfolio action remain blocked.',
      evidenceIds: [],
      evidenceClass: 'valuation_or_expectation_bridge',
      confidence: 'diagnostic',
      caveats: uniqueStrings(['valuation_or_expectation_bridge_missing_investment_readiness_blocked', contradictionWarnings.map((warning) => warning.code)], 20),
      allowedInClientMemo: true,
      allowedInAuditAppendix: true,
      requiresEvidence: false,
    },
  ];
  if (valuationBridge) {
    claims.push({
      claimId: 'TVM-CLM-008',
      section: 'Valuation / Expectation Bridge',
      claimText: 'Valuation and expectation bridge is a diagnostic context section only; it does not support investment memo readiness in this dry-run.',
      evidenceIds: [],
      evidenceClass: 'valuation_or_expectation_bridge',
      confidence: 'diagnostic',
      caveats: uniqueStrings([valuationBridge.caveats, valuationBridge.marketRegimeSupport?.caveats], 40),
      allowedInClientMemo: true,
      allowedInAuditAppendix: true,
      requiresEvidence: false,
    });
  }
  return claims;
}

function renderValuationSection(valuationBridge = null) {
  if (!valuationBridge) return '';
  const rows = asArray(valuationBridge.issuerValuationBridgeTable).map((row) => (
    `- ${row.issuer}: ${row.valuationBridgeStatus}; expectation reflection ${row.pricedInRiskDiagnostic?.reflectionStatus || 'not_evaluated'}; valuation metrics ${row.valuationMetricCoverage}; consensus ${row.consensusMetricCoverage}; missing ${uniqueStrings(row.missingFields || [], 8).join(', ') || 'none'}`
  )).join('\n') || '- No issuer valuation rows are available.';
  const analogue = valuationBridge.historicalAnalogueBridge || {};
  const analogueIds = uniqueStrings(analogue.bestAnalogueIds || [], 6).join(', ') || 'none';
  const reflection = valuationBridge.expectationReflectionStatus || 'insufficient_comparison_data';
  const status = valuationBridge.valuationBridgeStatus || 'valuation_bridge_missing';
  const regimeStatus = valuationBridge.marketValidationRegimeStatus || valuationBridge.marketRegimeSupport?.marketValidationRegimeStatus || 'regime_missing';
  const diagnostic = valuationBridge.investmentMemoReadinessDiagnostic?.status || 'not_ready';
  const missing = uniqueStrings(valuationBridge.missingValuationFields || [], 12).join(', ') || 'none';
  const caveats = uniqueStrings(valuationBridge.caveats || [], 12).join(', ') || 'none';
  const missingStatement = status === 'valuation_bridge_missing'
    ? 'Valuation / expectation bridge remains missing; this memo cannot support investment action.'
    : 'Valuation / expectation bridge remains diagnostic and cannot support investment action without human investment memo review.';
  return `
## J. Valuation / Expectation Bridge
${missingStatement}

Issuer-level context:
${rows}

Bridge status: ${status}
Expectation status: ${valuationBridge.expectationBridgeStatus || 'expectation_bridge_missing'}
Expectation reflection status: ${reflection}
Historical analogues used: ${analogueIds}
Analogue median 90d excess move: ${analogue.analogueMedianExcessMove90d ?? 'not_computable'}
Analogue caveat: historical analogue comparison is diagnostic only and cannot authorize investment action.
Market validation regime status: ${regimeStatus}
Investment memo readiness diagnostic: ${diagnostic}
Missing valuation fields: ${missing}
Caveats: ${caveats}
${BUY_SELL_DISCLAIMER}
`;
}

function renderMarketRegimeSection(valuationBridge = null, marketRow = {}) {
  const support = valuationBridge?.marketRegimeSupport || {};
  const status = support.marketValidationRegimeStatus || valuationBridge?.marketValidationRegimeStatus || marketRow.regimeSupportStatus || 'regime_missing';
  const eventBuckets = support.eventCountByRegime || marketRow.eventCountByRegime || {};
  const directionBuckets = support.directionSupportByRegime || marketRow.directionSupportByRegime || {};
  const bucketSummary = Object.entries(eventBuckets).slice(0, 4).map(([bucket, count]) => `${bucket}: ${count}`).join('; ') || 'none';
  const directionSummary = Object.entries(directionBuckets).slice(0, 4).map(([bucket, direction]) => `${bucket}: ${direction}`).join('; ') || 'none';
  const tstatStatus = support.tstatSanityStatus || marketRow.tstatSanityStatus || 'not_computable';
  const researchUse = Boolean(support.marketValidationResearchUseAllowed ?? marketRow.marketValidationResearchUseAllowed);
  const investmentUse = Boolean(support.marketValidationInvestmentUseAllowed ?? marketRow.marketValidationInvestmentUseAllowed);
  const decisionUse = Boolean(support.marketValidationDecisionUseAllowed ?? marketRow.marketValidationDecisionUseAllowed);
  const caveatText = uniqueStrings([support.caveats, marketRow.caveats], 20).join(', ') || 'none';
  return `## K. Market Regime Support
Regime support status is ${status}. Event/control evidence is grouped by local market regimes only; no web or source-query market commentary is used.

Event buckets: ${bucketSummary}
Direction support: ${directionSummary}
Regime consistency score: ${support.regimeConsistencyScore ?? marketRow.regimeConsistencyScore ?? 'not_computable'}
Regime coverage score: ${support.regimeCoverageScore ?? marketRow.regimeCoverageScore ?? 'not_computable'}
Unknown regime share: ${support.unknownRegimeShare ?? 'not_computable'}
T-stat sanity: ${tstatStatus}
Caveats: ${caveatText}

Research use allowed: ${researchUse}
Investment memo use allowed before human review: ${investmentUse}
Decision use allowed: ${decisionUse}

This market section can inform thesis validation only. Investment memo readiness still requires human review because market regime support, t-stat sanity, valuation context, and contradiction checks remain diagnostic rather than portfolio-action criteria.`;
}

function renderClientMemo({ subject = {}, matrix = [], caveats = [], claims = [], contradictionWarnings = [], valuationBridge = null } = {}) {
  const mechanism = rowFor(matrix, 'mechanism_validation');
  const grid = rowFor(matrix, 'grid_interconnection');
  const issuer = rowFor(matrix, 'issuer_exposure');
  const issuerBridge = rowFor(matrix, 'issuer_commentary_or_official_issuer_bridge');
  const negative = rowFor(matrix, 'negative_control');
  const holdout = rowFor(matrix, 'holdout_validation');
  const market = rowFor(matrix, 'controlled_market_validation');
  const sourceBreadth = rowFor(matrix, 'source_breadth');
  const valuation = rowFor(matrix, 'valuation_or_expectation_bridge');
  const issuerUniverse = uniqueStrings(subject.issuerUniverse || [], 10).join(', ') || 'the issuer universe';
  const mechanismNode = subject.mechanismNode || subject.bottleneckNode || subject.subjectLabel || 'the mechanism bottleneck';
  const issuerBridgeNode = subject.issuerBridgeNode || subject.connector || subject.subjectLabel || 'the issuer operating bridge';
  const warningCodes = uniqueStrings(contradictionWarnings.map((warning) => warning.code), 20).join(', ') || 'none';

  return `# Thesis Validation Memo: ${subject.subjectLabel || 'Selected cross-theme bottleneck'}

This is a thesis validation memo, not an investment decision memo.
The thesis has evidence support, but valuation / expectation bridge is not closed.
Controlled market validation is research-use support only until regime support and t-stat sanity are reviewed.
${BUY_SELL_DISCLAIMER}

## A. Executive Judgment
The current status is validation candidate / research validation memo. The thesis is reviewable because accepted mechanism evidence, issuer bridge evidence, negative-control review, holdout validation, and controlled market validation are present in the dry-run matrix. It is not decision-ready because the valuation / expectation bridge remains open and the market validation carries caveats.

## B. Thesis
The working thesis is that source-theme demand can transmit through ${mechanismNode} into ${issuerBridgeNode}. Track A validates the process bottleneck; Track B connects that process to ${issuerUniverse} through accepted issuer operating evidence rather than ticker-only mentions.

## C. Mechanism Evidence
Track A has ${mechanism.acceptedCount || 0} accepted mechanism evidence rows and ${grid.acceptedCount || 0} adjacent process rows. This mechanism evidence is supporting context, not promotion evidence. It supports the existence of a process bottleneck but does not by itself create investment readiness.

## D. Issuer Bridge
Track B has ${issuer.acceptedCount || 0} accepted issuer exposure rows and ${issuerBridge.acceptedCount || 0} official issuer bridge rows, with ${issuer.promotionEligibleCount || 0} promotion-eligible bridge rows. The bridge is operating-evidence based, not ticker-only: it ties the issuer universe to ${issuerBridgeNode}, backlog, demand, capacity, qualification, guidance, or project execution.

## E. Negative Control
Negative-control status is ${negative.status || 'missing'}. This means the bounded lane did not find a direct invalidator; it does not mean the thesis is proven.

## F. Holdout Validation
Holdout validation is ${holdout.status || 'missing'} with ${holdout.acceptedCount || 0} accepted holdout rows. The holdout lane is independent of issuer self-report and does not reuse the same document to close both issuer exposure and holdout.

## G. Controlled Market Validation
Controlled market validation status is ${market.status || 'missing'}, with benchmark/control/source-breadth checks represented in the audit appendix. Market validation is caveated validation support, not an action signal. Caveats include ${uniqueStrings(market.caveats || ['sanity_check_extreme_tstat'], 10).join(', ') || 'none'}.

## H. What Is Still Missing
The valuation_or_expectation_bridge row is ${valuation.status || 'missing'}, so investment memo readiness remains blocked. Remaining blockers are valuation / expectation bridge, stronger regime support, market sanity review, investment memo readiness, and portfolio action criteria.

## I. Next Work
Build the valuation / expectation bridge before any investment memo. The next work should test backlog-to-revenue translation, margin sensitivity, consensus and multiple expectations, and whether the controlled market validation remains sane under regime-aware checks.

${renderValuationSection(valuationBridge)}

${renderMarketRegimeSection(valuationBridge, market)}

## Status Notes
- Not decision-ready: true
- Investment memo ready: false
- Decision ready: false
- Portfolio action allowed: false
- Source breadth row: ${sourceBreadth.status || 'missing'}
- Caveats: ${uniqueStrings(caveats, 20).join(', ') || 'none'}
- Contradiction warnings: ${warningCodes}
`;
}

function renderAuditAppendix({ matrix = [], claims = [], evidenceTable = [], caveats = [], contradictionWarnings = [], remainingBlockers = [], metadata = {}, rawEvidenceCount = 0, acceptedEvidenceCount = 0, valuationBridge = null } = {}) {
  return {
    evidenceContractMatrixSummary: matrix.map((row) => ({
      evidenceClass: row.evidenceClass,
      status: row.status,
      acceptedCount: row.acceptedCount,
      promotionEligibleCount: row.promotionEligibleCount,
      blocking: row.blocking,
      caveats: row.caveats || [],
      nextActionIfMissing: row.nextActionIfMissing || null,
      regimeSupportStatus: row.regimeSupportStatus,
      regimeConsistencyScore: row.regimeConsistencyScore,
      regimeCoverageScore: row.regimeCoverageScore,
      marketValidationResearchUseAllowed: row.marketValidationResearchUseAllowed,
      marketValidationInvestmentUseAllowed: row.marketValidationInvestmentUseAllowed,
      marketValidationDecisionUseAllowed: row.marketValidationDecisionUseAllowed,
      extremeTstatWarning: row.extremeTstatWarning,
      tstatSanityStatus: row.tstatSanityStatus,
    })),
    acceptedEvidenceTable: evidenceTable,
    rawEvidenceCountSummary: {
      rawEvidenceCount,
      acceptedEvidenceCount,
      rejectedOrRawOnlyCount: Math.max(0, Number(rawEvidenceCount || 0) - Number(acceptedEvidenceCount || 0)),
    },
    sourceBreadthSummary: rowFor(matrix, 'source_breadth'),
    negativeControlStatus: rowFor(matrix, 'negative_control').status || 'missing',
    holdoutStatus: rowFor(matrix, 'holdout_validation').status || 'missing',
    marketValidationResult: rowFor(matrix, 'controlled_market_validation'),
    marketRegimeSupportMapping: valuationBridge?.marketRegimeSupport || rowFor(matrix, 'controlled_market_validation'),
    valuationExpectationBridge: valuationBridge || rowFor(matrix, 'valuation_or_expectation_bridge'),
    caveats,
    contradictionWarnings,
    remainingBlockers,
    claimEvidenceMap: claims.map((claim) => ({
      claimId: claim.claimId,
      section: claim.section,
      evidenceClass: claim.evidenceClass,
      evidenceIds: claim.evidenceIds || [],
      caveats: claim.caveats || [],
    })),
    mutationBoundary: {
      reportCandidateWrites: metadata.reportCandidateWrites || 0,
      readinessPromotionWrites: metadata.readinessPromotionWrites || 0,
      providerActivationWrites: metadata.providerActivationWrites || 0,
      canonicalWrites: metadata.canonicalWrites || 0,
      sourceRegistryWrites: metadata.sourceRegistryWrites || 0,
      approvalQueueWrites: metadata.approvalQueueWrites || 0,
    },
  };
}

export function buildThesisValidationMemoDryRun(input = {}) {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const subject = input.reportSubjectDryRun || input.dryRunReportSubject || {};
  const matrix = asArray(input.evidenceContractMatrix);
  const caveats = uniqueStrings(input.caveats || input.closureCaveats || subject.caveats || [], 40);
  const contradictionWarnings = asArray(input.contradictionWarnings);
  const remainingBlockers = uniqueStrings(input.remainingBlockers || subject.remainingBlockers || ['investment_memo_readiness_blocked_until_valuation_or_expectation_bridge'], 40);
  const evidenceTable = evidenceRowsFromMatrix(matrix);
  const valuationBridge = input.valuationBridge || input.valuationExpectationBridge || null;
  const claims = buildClaims({ subject, matrix, caveats, contradictionWarnings, valuationBridge });
  const metadata = {
    memoType: 'thesis_validation_memo',
    decisionUse: 'research_validation',
    generatedAt,
    subjectId: subject.subjectId || null,
    subjectLabel: subject.subjectLabel || null,
    parentSeedId: subject.parentSeedId || null,
    childSeedId: subject.childSeedId || null,
    trackId: subject.trackId || null,
    issuerUniverse: subject.issuerUniverse || [],
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
    valuationBridgeClosed: false,
    visualStatus: 'validation_candidate',
  };
  const clientMemoMarkdown = renderClientMemo({ subject, matrix, caveats, claims, contradictionWarnings, valuationBridge });
  const auditAppendix = renderAuditAppendix({
    matrix,
    claims,
    evidenceTable,
    caveats,
    contradictionWarnings,
    remainingBlockers,
    metadata,
    rawEvidenceCount: input.rawEvidenceCount || 0,
    acceptedEvidenceCount: input.acceptedEvidenceCount || evidenceTable.length,
    valuationBridge,
  });
  return {
    ok: true,
    memoType: metadata.memoType,
    metadata,
    clientMemoMarkdown,
    claims,
    auditAppendix,
    caveats,
    remainingBlockers,
    valuationBridge,
    nextRecommendedAction: 'build_valuation_or_expectation_bridge',
  };
}

export function validateThesisValidationMemoDryRun(memo = {}) {
  const blockers = [];
  const metadata = memo.metadata || {};
  const body = String(memo.clientMemoMarkdown || '');
  const bodyWithoutDisclaimer = body.replace(BUY_SELL_DISCLAIMER, '');
  const claims = asArray(memo.claims);
  const caveats = uniqueStrings([memo.caveats, metadata.caveats], 40);
  const audit = memo.auditAppendix || {};
  const boundaries = audit.mutationBoundary || metadata;

  const requireEqual = (field, actual, expected) => {
    if (actual !== expected) blockers.push({ type: `${field}_invalid`, message: `${field} must be ${expected}` });
  };
  requireEqual('notDecisionReady', metadata.notDecisionReady, true);
  requireEqual('investmentMemoReady', metadata.investmentMemoReady, false);
  requireEqual('decisionReady', metadata.decisionReady, false);
  requireEqual('portfolioActionAllowed', metadata.portfolioActionAllowed, false);
  requireEqual('reportCandidateWrites', Number(boundaries.reportCandidateWrites || 0), 0);
  requireEqual('readinessPromotionWrites', Number(boundaries.readinessPromotionWrites || 0), 0);
  requireEqual('providerActivationWrites', Number(boundaries.providerActivationWrites || 0), 0);

  if (/\b(buy|sell|position[-\s]?sizing|target price|overweight|underweight)\b/i.test(bodyWithoutDisclaimer)) {
    blockers.push({ type: 'portfolio_action_language', message: 'Client memo contains buy/sell/position-sizing or recommendation language outside the required disclaimer.' });
  }
  if (!/This is a thesis validation memo, not an investment decision memo\./.test(body)) {
    blockers.push({ type: 'missing_thesis_validation_boundary', message: 'Client memo must state that it is not an investment decision memo.' });
  }
  if (!/valuation \/ expectation bridge is not closed/i.test(body)) {
    blockers.push({ type: 'missing_valuation_gap_statement', message: 'Client memo must state the valuation / expectation bridge gap.' });
  }
  if (!/Controlled market validation is research-use support only until regime support and t-stat sanity are reviewed\./.test(body)) {
    blockers.push({ type: 'missing_market_caveat_statement', message: 'Client memo must state market caveats.' });
  }
  if (!/## K\. Market Regime Support/.test(body)) {
    blockers.push({ type: 'missing_market_regime_support_section', message: 'Client memo must include the Market Regime Support section.' });
  }
  if (!body.includes(BUY_SELL_DISCLAIMER)) {
    blockers.push({ type: 'missing_no_recommendation_statement', message: 'Client memo must state no buy/sell/position-sizing recommendation is made.' });
  }
  if (caveats.includes('sanity_check_extreme_tstat') && !body.includes('sanity_check_extreme_tstat')) {
    blockers.push({ type: 'missing_sanity_check_extreme_tstat', message: 'sanity_check_extreme_tstat caveat must appear in memo.' });
  }
  if (caveats.includes('DECISION_GRADE_MARKET_WITH_ZERO_REGIME_SUPPORT') && !body.includes('DECISION_GRADE_MARKET_WITH_ZERO_REGIME_SUPPORT')) {
    blockers.push({ type: 'missing_zero_regime_support_caveat', message: 'zero regime support caveat must appear in memo.' });
  }
  if (/valuation (supports|implies|justifies|is attractive|is cheap|upside)/i.test(body)) {
    blockers.push({ type: 'valuation_conclusion_without_bridge', message: 'Valuation conclusion is not allowed before the bridge is closed.' });
  }
  if (/\b(rawEvidenceIds|queryPayload|sourceQuery|grid-official:|grid-issuer-|local-market:|market-validation:)\b/i.test(body)) {
    blockers.push({ type: 'raw_payload_in_client_memo', message: 'Raw evidence IDs or query payloads must stay out of the client memo body.' });
  }
  for (const claim of claims) {
    const ids = asArray(claim.evidenceIds);
    if (claim.requiresEvidence !== false && !ids.length) {
      blockers.push({ type: 'claim_missing_accepted_evidence', claimId: claim.claimId, message: 'Claim requires accepted evidence IDs.' });
    }
    if (ids.some((id) => /^raw[:_-]|not_evaluated/i.test(String(id)))) {
      blockers.push({ type: 'claim_uses_raw_evidence', claimId: claim.claimId, message: 'Claim uses raw or not-evaluated evidence.' });
    }
    if (claim.evidenceClass === 'controlled_market_validation' && caveats.includes('sanity_check_extreme_tstat') && !asArray(claim.caveats).includes('sanity_check_extreme_tstat')) {
      blockers.push({ type: 'market_claim_missing_caveat', claimId: claim.claimId, message: 'Market claim must carry caveats.' });
    }
  }
  if (!Array.isArray(audit.claimEvidenceMap) || !audit.claimEvidenceMap.length) {
    blockers.push({ type: 'audit_missing_claim_evidence_map', message: 'Audit appendix must include claim/evidence mapping.' });
  }
  if (!Array.isArray(audit.evidenceContractMatrixSummary) || !audit.evidenceContractMatrixSummary.length) {
    blockers.push({ type: 'audit_missing_matrix', message: 'Audit appendix must include Evidence Contract Matrix summary.' });
  }
  if (!audit.marketRegimeSupportMapping) {
    blockers.push({ type: 'audit_missing_market_regime_support_mapping', message: 'Audit appendix must include market regime support mapping.' });
  }
  if (!Array.isArray(audit.acceptedEvidenceTable) || !audit.acceptedEvidenceTable.length) {
    blockers.push({ type: 'audit_missing_accepted_evidence_table', message: 'Audit appendix must include accepted evidence table.' });
  }
  return {
    ok: blockers.length === 0,
    blockers,
    warningCount: asArray(memo.contradictionWarnings).length,
  };
}

export function renderThesisValidationMemoHtml(memo = {}) {
  const markdown = String(memo.clientMemoMarkdown || '');
  const sections = markdown
    .split(/\n(?=##?\s)/)
    .map((section) => {
      const [first, ...rest] = section.split('\n');
      if (first.startsWith('# ')) return `<h1>${escapeHtml(first.replace(/^#\s*/, ''))}</h1><p>${escapeHtml(rest.join('\n')).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
      if (first.startsWith('## ')) return `<h2>${escapeHtml(first.replace(/^##\s*/, ''))}</h2><p>${escapeHtml(rest.join('\n')).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
      return `<p>${escapeHtml(section).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(memo.metadata?.subjectLabel || 'Thesis Validation Memo')}</title>
  <style>
    body { margin: 0; background: #0d0f1f; color: #e5edf8; font: 15px/1.6 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 980px; margin: 0 auto; padding: 40px 24px 72px; }
    h1, h2 { line-height: 1.2; color: #f8fafc; }
    h1 { font-size: 30px; margin-bottom: 24px; }
    h2 { font-size: 18px; margin-top: 30px; border-top: 1px solid rgba(148, 163, 184, .24); padding-top: 20px; }
    p { color: #cbd5e1; }
    .status { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 24px; }
    .chip { border: 1px solid rgba(56, 189, 248, .4); color: #bae6fd; border-radius: 6px; padding: 4px 8px; font-size: 12px; }
    .warn { border-color: rgba(251, 191, 36, .45); color: #fde68a; }
    details { margin-top: 28px; border: 1px solid rgba(148, 163, 184, .22); border-radius: 8px; padding: 14px 16px; background: rgba(15, 23, 42, .55); }
    pre { white-space: pre-wrap; word-break: break-word; color: #cbd5e1; }
  </style>
</head>
<body>
<main>
  <div class="status">
    <span class="chip">Thesis validation memo dry-run</span>
    <span class="chip warn">Not decision-ready</span>
    <span class="chip warn">Valuation bridge missing</span>
    <span class="chip warn">Market validation caveated</span>
  </div>
  ${sections}
  <details>
    <summary>Audit Appendix</summary>
    <pre>${escapeHtml(JSON.stringify(memo.auditAppendix || {}, null, 2))}</pre>
  </details>
</main>
</body>
</html>
`;
}
