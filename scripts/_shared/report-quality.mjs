import { computeCrossThemeDiscoveryQuality } from './cross-theme-discovery-quality.mjs';

function ratio(numerator, denominator, emptyValue = 1) {
  const den = Number(denominator || 0);
  if (den <= 0) return emptyValue;
  return Math.max(0, Math.min(1, Number(numerator || 0) / den));
}

function hasClaimSupport(claim = {}) {
  return [
    claim.supportingEvidenceIds,
    claim.supportingMetricIds,
    claim.supportingFigureIds,
    claim.caveatIds,
  ].some((ids) => Array.isArray(ids) && ids.length > 0);
}

function caveatCovers(caveats = [], typePattern) {
  return caveats.some((caveat) => typePattern.test(String(caveat.type || '')) || typePattern.test(String(caveat.text || '')));
}

function gradeFromScore(score) {
  return score >= 0.95 ? 'S' : score >= 0.88 ? 'A' : score >= 0.78 ? 'B' : score >= 0.65 ? 'C' : 'D';
}

function gradeRank(grade) {
  return { S: 4, A: 3, B: 2, C: 1, D: 0 }[grade] ?? 0;
}

function minGrade(...grades) {
  return grades.filter(Boolean).sort((a, b) => gradeRank(a) - gradeRank(b))[0] || 'D';
}

function gradeCeilingScore(grade) {
  return { S: 1, A: 0.949, B: 0.879, C: 0.779, D: 0.649 }[grade] ?? 0.649;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isCrossThemeDiscoveryReport(bundle = {}) {
  return bundle.reportType === 'cross_theme_bottleneck_report'
    || bundle.subject?.subjectType === 'cross_theme_candidate'
    || bundle.subject?.subject_type === 'cross_theme_candidate';
}

function crossThemeActionabilityScore(bundle = {}) {
  if (!isCrossThemeDiscoveryReport(bundle)) return null;
  const bridge = bundle.metadata?.deepResearch?.crossThemeActionBridge;
  if (!bridge) return null;
  const score = Math.max(0, Math.min(1, Number(bridge.score ?? 0)));
  const grade = gradeFromScore(score);
  return {
    score,
    grade,
    tier: bridge.tier || 'source_expansion_only',
    label: bridge.label || String(bridge.tier || 'source_expansion_only').replace(/_/g, ' '),
    metrics: {
      evidenceClassCoverage: bridge.metrics?.evidenceClassCoverage ?? bridge.evidenceClassCoverage ?? 0,
      issuerTranslationScore: bridge.metrics?.issuerTranslationScore ?? 0,
      marketTranslationScore: bridge.metrics?.marketTranslationScore ?? 0,
      actionPlanCompleteness: bridge.metrics?.actionPlanCompleteness ?? 0,
      issuerCount: bridge.metrics?.issuerCount ?? asArray(bridge.exposedIssuers).length,
      issuerBridgeCount: bridge.metrics?.issuerBridgeCount ?? 0,
      issuerOperatingAnchorCount: bridge.metrics?.issuerOperatingAnchorCount ?? 0,
      candidateIssuerCount: bridge.metrics?.candidateIssuerCount ?? asArray(bridge.autoDiscoveredIssuers).length,
      probableExposureCount: bridge.metrics?.probableExposureCount ?? asArray(bridge.autoDiscoveredIssuers).filter((row) => row.status === 'probable_exposure').length,
      bridgeAttachedCount: bridge.metrics?.bridgeAttachedCount ?? 0,
      issuerMappingGapCount: bridge.metrics?.issuerMappingGapCount ?? asArray(bridge.autoDiscoveredIssuers).filter((row) => row.candidateOnly).length,
      marketRowCount: bridge.metrics?.marketRowCount ?? bridge.marketTranslation?.rowCount ?? 0,
      negativeControlStatus: bridge.metrics?.negativeControlStatus || bridge.negativeControlStatus || 'unchecked',
      missingClasses: asArray(bridge.metrics?.missingClasses || bridge.missingClasses),
    },
    boundary: bridge.boundary || 'cross-theme discovery-to-action translation; separate from investment readiness',
  };
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function recentSourceQueryTierStats(approvalTiers = {}, limit = 10) {
  const rows = Object.values(approvalTiers || {})
    .filter((row) => row && typeof row === 'object')
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, limit);
  const totals = rows.reduce((acc, row) => ({
    attempts: acc.attempts + 1,
    persisted: acc.persisted + num(row.persistedBundleCount),
    promotion: acc.promotion + num(row.promotionBundleCount),
    context: acc.context + num(row.contextBundleCount),
    negative: acc.negative + num(row.negativeControlCount),
    noise: acc.noise + num(row.noiseCount),
  }), {
    attempts: 0,
    persisted: 0,
    promotion: 0,
    context: 0,
    negative: 0,
    noise: 0,
  });
  return {
    ...totals,
    useful: totals.promotion + totals.context + totals.negative,
    yield: ratio(totals.promotion + totals.context + totals.negative, totals.persisted, 0),
  };
}

function computeDecisionDiagnostic(bundle = {}, components = {}) {
  if (!bundle.metadata?.deepResearch && !isCrossThemeDiscoveryReport(bundle)) {
    return {
      status: 'not_applicable',
      label: 'Standard evidence memo',
      continueBackfill: false,
      stopBroadBackfill: false,
      nextAction: 'use standard report quality gates',
      evidenceSufficiency: 'not_applicable',
      invalidationStatus: 'not_applicable',
      missingEvidenceClasses: [],
      coveredEvidenceClasses: [],
      reasons: [],
      metrics: {},
    };
  }
  const crossThemeDiscoveryQuality = components.crossThemeDiscoveryQuality || null;
  const crossThemeActionability = components.crossThemeActionability || null;
  const investmentReadiness = components.investmentReadiness || bundle.metadata?.deepResearch?.investmentReadiness || {};
  const completionLedger = components.completionLedger
    || bundle.metadata?.deepResearch?.completionLedger
    || bundle.metadata?.deepResearch?.reportClosureLedger
    || bundle.metadata?.reportClosureLedger
    || null;
  const candidateEvidenceSummary = bundle.metadata?.candidate?.evidence_summary || bundle.metadata?.candidate?.evidenceSummary || {};
  const sourceQueryApprovalTiers = candidateEvidenceSummary.sourceQueryApprovalTiers || {};
  const recentSourceQuery = recentSourceQueryTierStats(sourceQueryApprovalTiers);
  const sourceQuery = {
    attempts: Object.keys(sourceQueryApprovalTiers || {}).length,
    promotion: num(candidateEvidenceSummary.sourceQueryEvidenceCount),
    persisted: num(candidateEvidenceSummary.sourceQueryPersistedCount),
    context: num(candidateEvidenceSummary.sourceQueryContextCount),
    negative: num(candidateEvidenceSummary.sourceQueryNegativeControlCount),
    noise: num(candidateEvidenceSummary.sourceQueryNoiseCount),
  };
  sourceQuery.useful = sourceQuery.promotion + sourceQuery.context + sourceQuery.negative;
  sourceQuery.yield = ratio(sourceQuery.useful, sourceQuery.persisted, 0);
  sourceQuery.noiseShare = ratio(sourceQuery.noise, sourceQuery.persisted, 0);

  const ledgerOpenClasses = asArray(completionLedger?.openClasses);
  const missingClasses = uniqueStrings(completionLedger
    ? ledgerOpenClasses
    : [
      ...asArray(crossThemeDiscoveryQuality?.metrics?.missingEvidenceClasses),
      ...asArray(crossThemeActionability?.metrics?.missingClasses),
    ]);
  const coveredClasses = uniqueStrings(crossThemeDiscoveryQuality?.metrics?.evidenceClassesCovered || []);
  const negativeControlStatus = completionLedger?.negativeControlStatus
    || crossThemeActionability?.metrics?.negativeControlStatus
    || 'unchecked';
  const marketValidationTier = completionLedger?.marketTier || investmentReadiness?.marketValidation?.tier || null;
  const marketReady = marketValidationTier === 'decision_grade';
  const negativeControlReady = ['supported_constraint', 'checked_no_direct', 'checked', 'negative_collected', 'checked_alternative_or_mitigation'].includes(negativeControlStatus);
  const invalidated = ['invalidated', 'invalidator', 'negative_control_reject'].includes(negativeControlStatus);
  const hasOpenValidationGap = missingClasses.length > 0
    || !marketReady
    || !negativeControlReady
    || asArray(investmentReadiness?.decisionValidationGaps).length > 0;
  const missingWithoutMarket = missingClasses.filter((evidenceClass) => evidenceClass !== 'market_validation');
  const marketOnlyGap = !marketReady
    && missingWithoutMarket.length === 0
    && negativeControlReady
    && asArray(investmentReadiness?.decisionValidationGaps)
      .every((gap) => /market validation/i.test(String(gap || '')));
  const sufficientSearchDepth = sourceQuery.persisted >= 60
    || recentSourceQuery.persisted >= 48
    || sourceQuery.attempts >= 5;
  const recentUseful = recentSourceQuery.useful;
  const recentPromotion = recentSourceQuery.promotion;
  const ledgerCounts = completionLedger?.counts || {};
  const ledgerUseful = num(ledgerCounts.promotion_collected)
    + num(ledgerCounts.context_collected)
    + num(ledgerCounts.negative_collected);

  let status = 'under_researched';
  let label = 'More evidence needed';
  let continueBackfill = true;
  let stopBroadBackfill = false;
  let nextAction = 'collect required evidence classes before treating the report as decision-ready';

  if (invalidated) {
    status = 'evidence_backed_reject';
    label = 'Negative-control reject';
    continueBackfill = false;
    stopBroadBackfill = true;
    nextAction = 'deprioritize promotion unless a named invalidator is rebutted by stronger direct evidence';
  } else if (!hasOpenValidationGap && coveredClasses.length >= 4) {
    status = 'decision_ready_review';
    label = 'Decision review ready';
    continueBackfill = false;
    stopBroadBackfill = true;
    nextAction = 'move to analyst review rather than more generic backfill';
  } else if (marketOnlyGap) {
    status = 'market_validation_pending';
    label = 'Market validation pending';
    continueBackfill = true;
    stopBroadBackfill = true;
    nextAction = 'run local controlled market validation before making an investment call';
  } else if (hasOpenValidationGap && sufficientSearchDepth && recentSourceQuery.persisted >= 48 && recentUseful === 0) {
    if (ledgerUseful > 0 || marketReady) {
      status = 'targeted_backfill_required';
      label = 'Targeted backfill needed';
      continueBackfill = true;
      stopBroadBackfill = true;
      nextAction = 'stop broad source-query; run class-specific provider, issuer, technical, historical, and negative-control collectors for unresolved classes';
    } else {
      status = 'evidence_exhausted_no_support';
      label = 'Search exhausted, not validated';
      continueBackfill = false;
      stopBroadBackfill = true;
      nextAction = 'stop broad source-query; require specialist provider or expert-source collection for the unresolved classes';
    }
  } else if (hasOpenValidationGap && sufficientSearchDepth) {
    status = 'targeted_backfill_required';
    label = 'Targeted backfill needed';
    continueBackfill = true;
    stopBroadBackfill = sourceQuery.noiseShare >= 0.75;
    nextAction = recentPromotion > 0
      ? 'continue only targeted official, issuer, market, and negative-control routes for open classes'
      : 'tighten query/provider routes because broad collection is mostly context or noise';
  }

  const reasons = [];
  if (missingClasses.length) reasons.push(`open evidence classes: ${missingClasses.slice(0, 5).join(', ')}`);
  if (!marketReady) reasons.push(`market validation is ${marketValidationTier || 'missing'}`);
  if (!negativeControlReady) reasons.push(`negative control is ${negativeControlStatus}`);
  if (sourceQuery.persisted > 0) reasons.push(`source-query yield ${Math.round(sourceQuery.yield * 100)}% with ${Math.round(sourceQuery.noiseShare * 100)}% noise`);
  if (recentSourceQuery.persisted > 0) reasons.push(`recent yield ${Math.round(recentSourceQuery.yield * 100)}%`);

  return {
    status,
    label,
    continueBackfill,
    stopBroadBackfill,
    nextAction,
    evidenceSufficiency: status === 'decision_ready_review'
      ? 'sufficient_for_analyst_review'
      : status === 'evidence_backed_reject'
        ? 'sufficient_to_reject'
        : status === 'evidence_exhausted_no_support'
          ? 'search_exhausted'
          : 'insufficient_for_investment_call',
    invalidationStatus: invalidated ? 'invalidated' : negativeControlStatus,
    missingEvidenceClasses: missingClasses,
    coveredEvidenceClasses: coveredClasses,
    reasons,
    metrics: {
      sourceQuery,
      recentSourceQuery,
      completionLedgerCounts: completionLedger?.counts || null,
      marketValidationTier,
      negativeControlStatus,
      missingClassCount: missingClasses.length,
      coveredClassCount: coveredClasses.length,
    },
  };
}

function researchUtilityScore(bundle = {}, components = {}) {
  if (!isCrossThemeDiscoveryReport(bundle)) return null;
  const deep = bundle.metadata?.deepResearch || {};
  const bridge = deep.crossThemeActionBridge || deep.packs?.crossThemeActionBridge || {};
  const issuerSummary = bridge.issuerBridgeSummary
    || deep.packs?.issuerDiscoveryPack?.summary
    || bundle.metadata?.issuerBridgeSummary
    || {};
  const autoRows = asArray(bridge.autoDiscoveredIssuers).length
    ? asArray(bridge.autoDiscoveredIssuers)
    : asArray(deep.packs?.issuerDiscoveryPack?.rows || bundle.metadata?.issuerDiscoveryMap);
  const crossThemeDiscoveryQuality = components.crossThemeDiscoveryQuality || computeCrossThemeDiscoveryQuality(bundle);
  const crossThemeActionability = components.crossThemeActionability || crossThemeActionabilityScore(bundle) || {};
  const decisionDiagnostic = components.decisionDiagnostic || null;
  const completionLedger = components.completionLedger
    || deep.completionLedger
    || deep.reportClosureLedger
    || bundle.metadata?.reportClosureLedger
    || {};
  const ledgerCounts = completionLedger.counts || {};
  const candidateEvidenceSummary = bundle.metadata?.candidate?.evidence_summary || bundle.metadata?.candidate?.evidenceSummary || {};
  const sourceQueryApprovalTiers = candidateEvidenceSummary.sourceQueryApprovalTiers || {};
  const recentSourceQuery = recentSourceQueryTierStats(sourceQueryApprovalTiers);

  const candidateIssuerCount = num(
    issuerSummary.candidateIssuerCount
      ?? crossThemeActionability.metrics?.candidateIssuerCount
      ?? autoRows.filter((row) => row.candidateOnly).length,
  );
  const probableExposureCount = num(
    issuerSummary.probableExposureCount
      ?? crossThemeActionability.metrics?.probableExposureCount
      ?? autoRows.filter((row) => row.status === 'probable_exposure').length,
  );
  const bridgeAttachedCount = num(
    issuerSummary.bridgeAttachedCount
      ?? crossThemeActionability.metrics?.bridgeAttachedCount,
  );
  const marketAttachedCount = num(
    issuerSummary.marketAttachedCount
      ?? crossThemeActionability.metrics?.marketRowCount,
  );
  const promotionEvidenceCount = num(ledgerCounts.promotion_collected)
    + num(candidateEvidenceSummary.sourceQueryEvidenceCount)
    + num(recentSourceQuery.promotion);
  const contextEvidenceCount = num(ledgerCounts.context_collected)
    + num(candidateEvidenceSummary.sourceQueryContextCount)
    + num(recentSourceQuery.context);
  const negativeEvidenceCount = num(ledgerCounts.negative_collected)
    + num(candidateEvidenceSummary.sourceQueryNegativeControlCount)
    + num(recentSourceQuery.negative);
  const weakNoiseCount = num(ledgerCounts.weak_noise)
    + num(candidateEvidenceSummary.sourceQueryNoiseCount)
    + num(recentSourceQuery.noise);
  const persistedCount = num(candidateEvidenceSummary.sourceQueryPersistedCount)
    + num(recentSourceQuery.persisted)
    + promotionEvidenceCount
    + contextEvidenceCount
    + negativeEvidenceCount
    + weakNoiseCount;
  const openClassCount = num(
    completionLedger.openClassCount
      ?? asArray(completionLedger.openClasses).length
      ?? crossThemeActionability.metrics?.missingClasses?.length,
  );
  const sourceDiversity = Math.max(
    0,
    Math.min(1, num(
      crossThemeDiscoveryQuality?.metrics?.sourceDiversity
        ?? bundle.sourceSummary?.sourceDiversityScore
        ?? deep.investmentReadiness?.sourceDiversity,
    )),
  );
  const candidateMapScore = Math.min(1, candidateIssuerCount / 6);
  const probableBridgeScore = Math.min(1, (probableExposureCount + bridgeAttachedCount * 2) / 5);
  const evidenceProgressScore = Math.min(1, (
    promotionEvidenceCount * 1
    + contextEvidenceCount * 0.65
    + negativeEvidenceCount * 0.55
    + weakNoiseCount * 0.06
    + persistedCount * 0.04
  ) / 5);
  const closurePenalty = Math.min(0.03, openClassCount * 0.005);
  const rawScore = Math.max(0, Math.min(1,
    0.13 * num(crossThemeDiscoveryQuality?.score)
      + 0.27 * candidateMapScore
      + 0.27 * probableBridgeScore
      + 0.22 * evidenceProgressScore
      + 0.06 * sourceDiversity
      + 0.05 * Number(Boolean(decisionDiagnostic?.nextAction || bridge.validationTasks?.length))
      - closurePenalty,
  ));
  let cappedScore = rawScore;
  const caps = [];
  if (!candidateIssuerCount && !contextEvidenceCount && !promotionEvidenceCount && !persistedCount) {
    cappedScore = Math.min(cappedScore, gradeCeilingScore('C'));
    caps.push('C');
  }
  if (!bridgeAttachedCount && !marketAttachedCount) {
    cappedScore = Math.min(cappedScore, gradeCeilingScore('B'));
    caps.push('B');
  }
  const rounded = Math.round(cappedScore * 1000) / 1000;
  const grade = gradeFromScore(rounded);
  const closureState = decisionDiagnostic?.status === 'market_validation_pending'
    ? 'market_validation_pending'
    : probableExposureCount > 0 && bridgeAttachedCount === 0
      ? 'direct_bridge_pending'
      : contextEvidenceCount > 0
        ? 'collecting_context_evidence'
        : weakNoiseCount > contextEvidenceCount + promotionEvidenceCount
          ? 'collecting_low_signal'
          : (decisionDiagnostic?.status || 'collecting');
  return {
    score: rounded,
    grade,
    label: `Research Priority ${grade}`,
    closureState,
    boundary: 'research utility only; candidate/context evidence does not raise investment actionability',
    nextAction: decisionDiagnostic?.nextAction
      || (probableExposureCount > 0
        ? 'attach direct SEC/IR/transcript/contract evidence for probable issuer exposure before actionability promotion'
        : 'continue class-specific evidence collection for unresolved evidence classes'),
    caps,
    metrics: {
      candidateIssuerCount,
      probableExposureCount,
      bridgeAttachedCount,
      marketAttachedCount,
      promotionEvidenceCount,
      contextEvidenceCount,
      negativeEvidenceCount,
      weakNoiseCount,
      persistedCount,
      openClassCount,
      sourceDiversity,
      candidateMapScore: Math.round(candidateMapScore * 1000) / 1000,
      probableBridgeScore: Math.round(probableBridgeScore * 1000) / 1000,
      evidenceProgressScore: Math.round(evidenceProgressScore * 1000) / 1000,
    },
  };
}

function requiresHistoricalAnalogueGate(bundle = {}) {
  if (bundle.reportType === 'system_quality_report') return false;
  if (isCrossThemeDiscoveryReport(bundle)) return false;
  return Boolean(bundle.metadata?.deepResearch);
}

function freshEvidenceCount(bundle = {}) {
  return asArray(bundle.evidence).filter((item) => {
    const status = String(item.freshnessStatus || item.freshness_status || '').toLowerCase();
    if (['stale', 'degraded'].includes(status)) return false;
    return ['fresh', 'recent', 'calculated', 'unknown', ''].includes(status);
  }).length;
}

function staleRequiresPublishGate(bundle = {}) {
  const hasStale = asArray(bundle.dataFreshness).some((item) => ['stale', 'degraded'].includes(String(item.freshnessStatus || '').toLowerCase()));
  if (!hasStale) return false;
  /* A stale upstream diagnostic should be disclosed, but it should not block
   * a deep report when the report has enough fresh provenance-bearing evidence
   * to support its claims. */
  return freshEvidenceCount(bundle) < 3;
}

function textWords(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length;
}

function blockHasRefs(block = {}) {
  return ['claimIds', 'evidenceIds', 'metricIds', 'figureIds', 'caveatIds']
    .some((key) => Array.isArray(block[key]) && block[key].length > 0);
}

function analysisSectionItems(analysis = {}, section) {
  const direct = asArray(analysis?.[section]);
  const longFormAliases = {
    context: ['contextAndWhatChanged'],
    whatChanged: ['contextAndWhatChanged'],
    evidenceSynthesis: ['evidenceAssessment'],
    marketTransmission: ['marketImplicationAndScenarios'],
    scenarios: ['marketImplicationAndScenarios'],
    risks: ['counterRisksCaveats'],
    alternativeExplanations: ['counterRisksCaveats'],
    watchNext: ['watchAndResearchAgenda'],
    researchAgenda: ['watchAndResearchAgenda'],
  };
  const aliases = new Set([section, ...(longFormAliases[section] || [])]);
  const longForm = asArray(analysis?.longFormSections)
    .filter((item) => aliases.has(item?.key))
    .flatMap((item) => asArray(item?.paragraphs || item?.blocks || item?.items)
      .map((entry) => (typeof entry === 'string' ? { text: entry } : entry)));
  return [...direct, ...longForm];
}

function sourceDiversityScore(bundle = {}) {
  if (bundle.reportType === 'cross_theme_bottleneck_report') {
    const crossThemeQuality = computeCrossThemeDiscoveryQuality(bundle);
    const crossThemeDiversity = Number(crossThemeQuality?.metrics?.sourceDiversity ?? 0);
    if (crossThemeDiversity > 0) return Math.max(0.35, Math.min(1, crossThemeDiversity));
  }
  const summary = bundle.sourceSummary || {};
  if (summary.lowDiversityFlag || summary.low_diversity_flag) return 0.35;
  const deepScore = Math.max(
    0,
    Math.min(1, Number(
      bundle.metadata?.deepResearch?.investmentReadiness?.sourceDiversity
      ?? bundle.metadata?.deepResearch?.limitations?.effectiveSourceDiversity
      ?? 0,
    )),
  );
  const distinct = Number(summary.distinctSources ?? summary.distinct_sources ?? 0);
  if (deepScore > 0) return Math.max(deepScore, distinct >= 5 ? 1 : 0);
  if (distinct >= 5) return 1;
  if (distinct >= 3) return 0.85;
  if (distinct >= 2) return 0.65;
  if (bundle.metadata?.deepResearch && asArray(bundle.evidence).length >= 2) return 0.55;
  return asArray(bundle.evidence).length >= 4 ? 0.45 : 0.25;
}

function marketContextScore(bundle = {}, analysis = {}) {
  const marketBlocks = analysisSectionItems(analysis, 'marketTransmission');
  if (!marketBlocks.length) return 0;
  const noMarketOnly = marketBlocks.every((block) => /no market reaction row|should not infer asset transmission/i.test(String(block.text || '')));
  const hasMarketRows = asArray(bundle.marketReactions).length > 0
    || asArray(bundle.metadata?.deepResearch?.investmentReadiness?.marketValidation?.rows).length > 0
    || Number(bundle.metadata?.deepResearch?.investmentReadiness?.marketValidation?.decisionGradeRowCount || 0) > 0;
  if (hasMarketRows && !noMarketOnly) return 1;
  if (bundle.reportType === 'system_quality_report') return 0.8;
  if (bundle.reportType === 'cross_theme_bottleneck_report') return noMarketOnly ? 0.65 : 0.8;
  return noMarketOnly ? 0.45 : 0.7;
}

function editorialPolishScore(analysis = {}) {
  const sections = [
    'keyJudgments',
    'thesis',
    'context',
    'whatChanged',
    'catalysts',
    'dataDepth',
    'causalChain',
    'historicalAnalogues',
    'evidenceSynthesis',
    'timeline',
    'marketTransmission',
    'scenarios',
    'risks',
    'alternativeExplanations',
    'informationGaps',
    'analyticalAssessment',
    'decisionUse',
    'whatWouldChangeMind',
    'researchAgenda',
    'feedbackLearning',
    'watchNext',
    'analystConclusion',
  ];
  const longFormItems = asArray(analysis.longFormSections)
    .flatMap((section) => asArray(section?.paragraphs || section?.blocks || section?.items)
      .map((block) => (typeof block === 'string' ? { text: block } : block)));
  const items = longFormItems.length
    ? longFormItems
    : sections.flatMap((section) => analysisSectionItems(analysis, section));
  const text = items
    .map((block) => block.text || block.label || block.summary || block.rationale || '')
    .join(' ')
    .toLowerCase();
  if (!text.trim()) return 0;
  const logTerms = [
    /claim-led analyst brief/g,
    /metric ledger/g,
    /evidence ledger/g,
    /source ledger/g,
    /figure ledger/g,
    /query manifest/g,
    /generated artifact/g,
    /source queue/g,
    /research packs?/g,
    /artifact\s+[sabcd]\b/g,
    /final\s+[sabcd]\b/g,
    /status warning/g,
    /kpi spine/g,
    /fundamentalpack/g,
    /filingpack/g,
    /transcriptpack/g,
    /industrypack/g,
    /marketpack/g,
    /this report should/g,
    /before adding narrative interpretation/g,
    /open the evidence ledger/g,
  ];
  const hits = logTerms.reduce((sum, pattern) => sum + ((text.match(pattern) || []).length), 0);
  return Math.max(0, Math.min(1, 1 - (hits / 8)));
}

function triageUsefulnessScore(bundle = {}, analysis = {}) {
  const synthesis = analysis.analystSynthesis || {};
  const signalCards = asArray(analysis.signalCards);
  const usefulDomains = new Set(signalCards.map((card) => card.domain).filter(Boolean));
  const requiredDomains = ['attention', 'fundamental', 'market', 'constraint', 'causal'];
  const domainCoverage = ratio(requiredDomains.filter((domain) => usefulDomains.has(domain)).length, requiredDomains.length, 0);
  const hasThesis = textWords(synthesis.oneSentenceThesis || asArray(analysis.thesis)[0]?.text) >= 12;
  const hasStrongest = asArray(synthesis.strongestEvidence).length > 0 || asArray(analysis.evidenceSynthesis).length > 0;
  const hasWeakest = asArray(synthesis.weakestEvidence).length > 0 || asArray(analysis.risks).length > 0;
  const hasMarket = asArray(synthesis.marketImplication).length > 0 || asArray(analysis.marketTransmission).length > 0;
  const hasCounter = asArray(synthesis.counterThesis).length > 0 || asArray(analysis.alternativeExplanations).length > 0;
  const hasInvalidator = asArray(synthesis.invalidators).length > 0 || asArray(analysis.decisionUse).some((item) => /invalidate|change|fail|cap/i.test(String(item.text || '')));
  const hasNextAction = asArray(synthesis.nextResearchActions).length > 0 || asArray(analysis.sourceQueries).length > 0;
  const decisionClarity = ratio([
    hasThesis,
    hasStrongest,
    hasWeakest,
    hasMarket,
    hasCounter,
    hasInvalidator,
    hasNextAction,
  ].filter(Boolean).length, 7, 0);
  const text = [
    ...asArray(analysis.keyJudgments),
    ...asArray(analysis.thesis),
    ...asArray(analysis.evidenceSynthesis),
    ...asArray(analysis.marketTransmission),
    ...asArray(analysis.decisionUse),
    ...asArray(analysis.analystConclusion),
  ].map((item) => item.text || '').join(' ');
  const logNoise = [
    /\brefs\s+\d+\b/i,
    /\bmetric ledger\b/i,
    /\bquery manifest\b/i,
    /\bclaim-led analyst brief\b/i,
    /\bdraft only\b/i,
  ].reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
  const logNoiseScore = Math.max(0, 1 - (logNoise / 3));
  const score = Math.round((
    0.30 * domainCoverage
    + 0.45 * decisionClarity
    + 0.15 * editorialPolishScore(analysis)
    + 0.10 * logNoiseScore
  ) * 1000) / 1000;
  const caps = [];
  if (domainCoverage < 0.8) caps.push('B');
  if (decisionClarity < 0.85) caps.push('B');
  if (logNoiseScore < 1) caps.push('C');
  const uncappedGrade = gradeFromScore(score);
  return {
    score,
    grade: minGrade(uncappedGrade, ...caps),
    uncappedGrade,
    caps,
    metrics: {
      domainCoverage,
      decisionClarity,
      logNoiseScore,
      signalCardCount: signalCards.length,
      hasThesis: Number(hasThesis),
      hasStrongest: Number(hasStrongest),
      hasWeakest: Number(hasWeakest),
      hasMarket: Number(hasMarket),
      hasCounter: Number(hasCounter),
      hasInvalidator: Number(hasInvalidator),
      hasNextAction: Number(hasNextAction),
    },
  };
}

function analystMemoQualityScore(bundle = {}, analysis = {}, triageUsefulness = {}, analysisQuality = {}) {
  const metrics = analysisQuality.metrics || {};
  const investmentReadiness = bundle.metadata?.deepResearch?.investmentReadiness || {};
  const productTier = investmentReadiness.tier || (bundle.metadata?.deepResearch ? 'deep_research_unknown' : 'standard_report');
  const historicalBlocks = analysisSectionItems(analysis, 'historicalAnalogues');
  const historicalInsufficient = historicalBlocks.some((item) => /no reliable|statistical profile matches|insufficient historical memory|placeholder/i.test(String(item.text || '')));
  const infoGapItems = analysisSectionItems(analysis, 'informationGaps');
  const rawInfoGapCount = infoGapItems.length;
  const readinessBlockers = asArray(investmentReadiness.blockers);
  const memoCandidateWithoutBlockers = productTier === 'investment_memo_candidate' && readinessBlockers.length === 0;
  const blockingInfoGapCount = infoGapItems.filter((item) => {
    const text = String(item.text || item.reason || item.label || '').toLowerCase();
    if (!text.trim()) return false;
    if (/no blocker-level information gap/.test(text)) return false;
    if (memoCandidateWithoutBlockers && /generic kpi|feedback signal count|electricity demand proxy|capex intensity proxy|graph-derived hypotheses|independent evidence supports them/.test(text)) return false;
    return true;
  }).length;
  const transcriptProxy = asArray(bundle.caveats).some((item) => /transcript_proxy|proxy evidence/i.test(`${item.type} ${item.text}`));
  const bodyText = [
    ...analysisSectionItems(analysis, 'keyJudgments'),
    ...analysisSectionItems(analysis, 'whatChanged'),
    ...analysisSectionItems(analysis, 'marketTransmission'),
    ...analysisSectionItems(analysis, 'historicalAnalogues'),
    ...analysisSectionItems(analysis, 'informationGaps'),
  ].map((item) => item.text || item.label || '').join(' ');
  const leakCount = [
    /\bevidence-backed\b/i,
    /\bevent intensity was\s+0\b/i,
    /\bmarket reaction row\(s\) are attached\b/i,
    /\bHawkes-profile analogue\s+\d+/i,
    /\bOn \d{4}-\d{2}-\d{2},\s+"/i,
  ].reduce((sum, pattern) => sum + (pattern.test(bodyText) ? 1 : 0), 0);
  const score = Math.round((
    0.25 * (metrics.editorialPolish ?? editorialPolishScore(analysis))
    + 0.20 * Math.min(1, (metrics.narrativeDepth ?? 0))
    + 0.20 * (metrics.marketContext ?? 0)
    + 0.15 * (metrics.evidenceDiversity ?? sourceDiversityScore(bundle))
    + 0.10 * (metrics.historicalContextScore ?? 0)
    + 0.10 * Math.max(0, 1 - leakCount / 3)
  ) * 1000) / 1000;
  const caps = [];
  if (productTier === 'signal_triage') caps.push('B');
  if (productTier === 'deep_research_unknown') caps.push('B');
  if (transcriptProxy) caps.push('B');
  if (historicalInsufficient && requiresHistoricalAnalogueGate(bundle)) caps.push('B');
  if (blockingInfoGapCount >= 3) caps.push('B');
  if (leakCount > 0) caps.push('C');
  if ((triageUsefulness.metrics?.decisionClarity ?? 0) < 0.85) caps.push('B');
  const uncappedGrade = gradeFromScore(score);
  const grade = minGrade(uncappedGrade, ...caps);
  return {
    score: Math.round(Math.min(score, gradeCeilingScore(grade)) * 1000) / 1000,
    grade,
    uncappedGrade,
    caps,
    metrics: {
      productTier,
      historicalInsufficient: Number(historicalInsufficient),
      infoGapCount: rawInfoGapCount,
      blockingInfoGapCount,
      transcriptProxy: Number(transcriptProxy),
      clientMemoLeakCount: leakCount,
    },
  };
}

function investmentReadinessQualityScore(bundle = {}) {
  const readiness = bundle.metadata?.deepResearch?.investmentReadiness || null;
  if (!bundle.metadata?.deepResearch) {
    return {
      score: 0.8,
      grade: 'B',
      uncappedGrade: 'B',
      caps: ['B'],
      metrics: { productTier: 'standard_report', blockerCount: 0 },
    };
  }
  const blockerCount = asArray(readiness?.blockers).length;
  const decisionValidationGapCount = asArray(readiness?.decisionValidationGaps).length;
  const marketValidation = readiness?.marketValidation || {};
  const tier = readiness?.tier || 'deep_research_unknown';
  const availableCore = Number(readiness?.availableCorePackCount || 0);
  const requiredCore = Math.max(1, Number(readiness?.requiredCorePackCount || 1));
  const directTranscriptSymbols = Number(readiness?.directTranscriptSymbolCount || 0);
  const directManagementCommentarySymbols = Number(readiness?.directManagementCommentarySymbolCount || directTranscriptSymbols || 0);
  const requiredTranscriptSymbols = Number(readiness?.requiredTranscriptSymbolCount || 0);
  const ontologyCoverage = readiness?.ontologyCoverage || {};
  const ontologyCriticalGapCount = Number(ontologyCoverage.investmentCriticalGapCount || 0);
  const ontologyKpiCoverage = Number(ontologyCoverage.requiredKpiCoverage ?? 1);
  const ontologyIssuerCoverage = Number(ontologyCoverage.issuerCommentaryCoverage ?? 1);
  const packRatio = Math.min(1, availableCore / requiredCore);
  const sampleScore = readiness?.sampleAdequacy === 'investment_memo'
    ? 1
    : ['triage', 'cross_theme_discovery'].includes(readiness?.sampleAdequacy)
      ? 0.65
      : 0.35;
  const diversityScore = Math.max(0, Math.min(1, Number(readiness?.sourceDiversity ?? 0)));
  const blockerScore = Math.max(0, 1 - blockerCount / 5);
  const validationScore = Math.max(0, Math.min(1, Number(marketValidation.score ?? (decisionValidationGapCount ? 0.35 : 1))));
  const score = Math.round((
    0.30 * packRatio
    + 0.20 * sampleScore
    + 0.18 * diversityScore
    + 0.17 * blockerScore
    + 0.15 * validationScore
  ) * 1000) / 1000;
  const caps = [];
  if (tier === 'signal_triage') caps.push('C');
  if (tier === 'thesis_validation') caps.push('B');
  if (tier === 'deep_research_unknown') caps.push('C');
  if (blockerCount >= 4) caps.push('C');
  if (Number(readiness?.transcriptProxyCount || 0) > 0 && directManagementCommentarySymbols === 0) caps.push('C');
  if (requiredTranscriptSymbols > 0 && directManagementCommentarySymbols < requiredTranscriptSymbols) caps.push('C');
  if (ontologyCriticalGapCount > 0) caps.push('C');
  if (ontologyKpiCoverage < 0.5) caps.push('C');
  if (decisionValidationGapCount > 0) caps.push('B');
  const uncappedGrade = gradeFromScore(score);
  const grade = minGrade(uncappedGrade, ...caps);
  return {
    score: Math.round(Math.min(score, gradeCeilingScore(grade)) * 1000) / 1000,
    grade,
    uncappedGrade,
    caps,
    metrics: {
      productTier: tier,
      blockerCount,
      decisionValidationGapCount,
      availableCore,
      requiredCore,
      packRatio,
      sampleScore,
      diversityScore,
      validationScore,
      marketValidationTier: marketValidation.tier || null,
      marketValidationMaxTStat: marketValidation.maxAbsTStat ?? null,
      directTranscriptSymbols,
      directManagementCommentarySymbols,
      requiredTranscriptSymbols,
      ontologyKey: ontologyCoverage.ontologyKey || null,
      ontologyKpiCoverage,
      ontologyCriticalGapCount,
      ontologyIssuerCoverage,
    },
  };
}

function computeAnalysisQuality(bundle = {}, analysis = {}) {
  const baseRequiredSections = [
    'keyJudgments',
    'thesis',
    'catalysts',
    'evidenceSynthesis',
    'timeline',
    'marketTransmission',
    'scenarios',
    'risks',
    'analyticalAssessment',
    'decisionUse',
    'watchNext',
    'analystConclusion',
  ];
  const requiredSections = bundle.metadata?.deepResearch
    ? [
      ...baseRequiredSections.slice(0, 3),
      'dataDepth',
      'causalChain',
      'historicalAnalogues',
      ...baseRequiredSections.slice(3, 10),
      'feedbackLearning',
      ...baseRequiredSections.slice(10),
    ]
    : baseRequiredSections;
  const presentSections = requiredSections.filter((section) => analysisSectionItems(analysis, section).length > 0).length;
  const sectionCompleteness = ratio(presentSections, requiredSections.length, 0);
  const allBlocks = requiredSections.flatMap((section) => analysisSectionItems(analysis, section));
  const referenceDensity = ratio(allBlocks.filter(blockHasRefs).length, allBlocks.length, 0);
  const wordCount = allBlocks.reduce((sum, block) => sum + textWords(block.text || block.label || block.summary || block.rationale), 0);
  const narrativeDepth = Math.min(1, wordCount / 650);
  const evidenceDiversity = sourceDiversityScore(bundle);
  const scenarioCompleteness = Math.min(1, analysisSectionItems(analysis, 'scenarios').length / 3);
  const riskCompleteness = Math.min(1, analysisSectionItems(analysis, 'risks').length / 2);
  const marketContext = marketContextScore(bundle, analysis);
  const editorialPolish = editorialPolishScore(analysis);
  const dataDepthMetric = asArray(bundle.metrics).find((metric) => metric.metricId === 'MET-DEEP-DATA-DEPTH');
  const causalMetric = asArray(bundle.metrics).find((metric) => metric.metricId === 'MET-DEEP-CAUSAL-EDGES');
  const analogMetric = asArray(bundle.metrics).find((metric) => metric.metricId === 'MET-DEEP-HISTORICAL-ANALOGS');
  const institutionalMetric = asArray(bundle.metrics).find((metric) => metric.metricId === 'MET-DEEP-INSTITUTIONAL-EVIDENCE-DENSITY');
  const hasStructuredGaps = Boolean(bundle.metadata?.deepResearch?.gaps?.length);
  const hasDeep = Boolean(bundle.metadata?.deepResearch);
  const dataDepthScore = hasDeep ? Math.max(0, Math.min(1, Number(dataDepthMetric?.value ?? 0))) : 1;
  const causalChainScore = hasDeep ? Math.max(0, Math.min(1, Number(causalMetric?.value ?? 0) / 3)) : 1;
  const historicalContextScore = hasDeep ? Math.max(0, Math.min(1, Number(analogMetric?.value ?? 0) / 2)) : 1;
  const institutionalEvidenceDensity = hasDeep ? Math.max(0, Math.min(1, Number(institutionalMetric?.value ?? bundle.metadata?.deepResearch?.packs?.institutionalEvidencePack?.coverageScore ?? 0))) : 1;
  const watchActionability = ratio(
    analysisSectionItems(analysis, 'watchNext').filter((item) => item.text || item.label).length,
    Math.max(1, Math.min(5, asArray(bundle.watchIndicators).length)),
    0,
  );
  const score =
    0.12 * sectionCompleteness
    + 0.07 * referenceDensity
    + 0.13 * narrativeDepth
    + 0.10 * evidenceDiversity
    + 0.09 * marketContext
    + 0.08 * scenarioCompleteness
    + 0.07 * riskCompleteness
    + 0.07 * watchActionability
    + 0.07 * editorialPolish
    + 0.06 * dataDepthScore
    + 0.06 * causalChainScore
    + 0.04 * historicalContextScore
    + 0.04 * institutionalEvidenceDensity;
  const rounded = Math.round(score * 1000) / 1000;
  const caveats = asArray(bundle.caveats);
  const caps = [];
  const gapCount = asArray(bundle.metadata?.deepResearch?.gaps).length;
  const analogCount = Number(analogMetric?.value ?? 0);
  if (caveats.some((item) => /aggregate_evidence_mismatch/i.test(`${item.type} ${item.text}`))) caps.push('B');
  if (bundle.sourceSummary?.lowDiversityFlag || bundle.sourceSummary?.low_diversity_flag) caps.push('B');
  if (staleRequiresPublishGate(bundle)) caps.push('B');
  if (asArray(bundle.evidence).length < 3 && bundle.reportType !== 'system_quality_report') caps.push('B');
  if (marketContext < 0.5 && !['system_quality_report'].includes(bundle.reportType)) caps.push('B');
  if (editorialPolish < 0.75) caps.push('B');
  if (bundle.metadata?.deepResearch && dataDepthScore < 0.6 && bundle.reportType !== 'system_quality_report') caps.push(dataDepthScore < 0.35 ? 'C' : 'B');
  if (bundle.metadata?.deepResearch && institutionalEvidenceDensity < 0.65 && bundle.reportType !== 'system_quality_report' && !isCrossThemeDiscoveryReport(bundle)) caps.push(institutionalEvidenceDensity < 0.4 ? 'C' : 'B');
  if (bundle.metadata?.deepResearch && gapCount >= 3 && bundle.reportType !== 'system_quality_report') caps.push('B');
  if (bundle.metadata?.deepResearch && analogCount <= 0 && requiresHistoricalAnalogueGate(bundle)) caps.push('B');
  if (bundle.metadata?.deepResearch && causalChainScore <= 0 && bundle.reportType !== 'system_quality_report') caps.push('B');
  if (bundle.metadata?.deepResearch && evidenceDiversity < 0.8 && bundle.reportType !== 'system_quality_report') {
    caps.push(evidenceDiversity < 0.5 ? 'C' : 'B');
  }
  if (/^unknown$/i.test(String(bundle.subject?.displayName || '').trim())) caps.push('B');
  const uncappedGrade = gradeFromScore(rounded);
  return {
    score: rounded,
    grade: minGrade(uncappedGrade, ...caps),
    uncappedGrade,
    caps,
    metrics: {
      sectionCompleteness,
      referenceDensity,
      narrativeDepth,
      evidenceDiversity,
      marketContext,
      scenarioCompleteness,
      riskCompleteness,
      watchActionability,
      editorialPolish,
      dataDepthScore,
      causalChainScore,
      historicalContextScore,
      institutionalEvidenceDensity,
      wordCount,
    },
  };
}

export function computeReportQuality(bundle = {}, validation = {}, analysis = {}) {
  const claims = bundle.claims || [];
  const figures = bundle.figures || [];
  const caveats = bundle.caveats || [];
  const watch = bundle.watchIndicators || [];
  const supportedClaims = claims.filter(hasClaimSupport).length;
  const evidenceCoverage = ratio(supportedClaims, claims.length);
  const blockerCount = (validation.blockers || []).length;
  const citationIntegrity = blockerCount > 0
    ? ratio(Math.max(0, claims.length - blockerCount), Math.max(1, claims.length))
    : 1;
  const hasStale = (bundle.dataFreshness || []).some((item) => ['stale', 'degraded'].includes(String(item.freshnessStatus || '').toLowerCase()));
  const freshnessDisclosure = hasStale ? Number(caveatCovers(caveats, /stale|freshness|degraded/i)) : 1;
  const chartRelevance = ratio(
    figures.filter((figure) => Array.isArray(figure.supportedClaimIds) && figure.supportedClaimIds.length && figure.analyticQuestion).length,
    figures.length,
  );
  const needsSourceCaveat = Boolean(bundle.sourceSummary?.lowDiversityFlag || bundle.sourceSummary?.low_diversity_flag);
  const caveatCompleteness = needsSourceCaveat
    ? Number(caveatCovers(caveats, /source|diversity|concentration/i))
    : 1;
  const analyticalRigor = ratio(
    claims.filter((claim) => ['high', 'medium', 'low', 'insufficient'].includes(String(claim.confidenceLevel || '').toLowerCase())).length,
    claims.length,
  );
  const actionability = ratio(
    watch.filter((item) => item.label && item.source && item.horizon).length,
    watch.length,
    claims.length ? 0.65 : 0,
  );
  const exportIntegrity = validation.exportIntegrity ?? 1;
  const score =
    0.25 * evidenceCoverage
    + 0.15 * citationIntegrity
    + 0.15 * freshnessDisclosure
    + 0.10 * chartRelevance
    + 0.10 * caveatCompleteness
    + 0.10 * analyticalRigor
    + 0.10 * actionability
    + 0.05 * exportIntegrity;
  const rounded = Math.round(score * 1000) / 1000;
  const artifactGrade = gradeFromScore(rounded);
  const analysisQuality = computeAnalysisQuality(bundle, analysis);
  const triageUsefulness = triageUsefulnessScore(bundle, analysis);
  const analystMemoQuality = analystMemoQualityScore(bundle, analysis, triageUsefulness, analysisQuality);
  const investmentReadinessQuality = investmentReadinessQualityScore(bundle);
  const crossThemeDiscoveryQuality = computeCrossThemeDiscoveryQuality(bundle);
  const crossThemeActionability = crossThemeActionabilityScore(bundle);
  const hasDeep = Boolean(bundle.metadata?.deepResearch);
  const investmentReadiness = bundle.metadata?.deepResearch?.investmentReadiness || null;
  const decisionDiagnostic = computeDecisionDiagnostic(bundle, {
    crossThemeDiscoveryQuality,
    crossThemeActionability,
    investmentReadiness,
  });
  const researchUtility = researchUtilityScore(bundle, {
    crossThemeDiscoveryQuality,
    crossThemeActionability,
    investmentReadiness,
    decisionDiagnostic,
  });
  const productTier = crossThemeDiscoveryQuality?.tier || investmentReadiness?.tier || (hasDeep ? 'deep_research_unknown' : 'standard_report');
  const deepMetrics = analysisQuality.metrics || {};
  const deepGapCount = asArray(bundle.metadata?.deepResearch?.gaps).length;
  const hasStaleOrDegraded = hasStale;
  const subjectDisplayName = String(bundle.subject?.displayName || '').trim();
  const publishabilityReasons = [];
  if (blockerCount > 0) publishabilityReasons.push('validation blockers remain');
  if (hasStaleOrDegraded && staleRequiresPublishGate(bundle)) publishabilityReasons.push('stale or degraded data is used without enough fresh supporting evidence');
  if (exportIntegrity < 1) publishabilityReasons.push('render/export integrity is incomplete');
  if (hasDeep && deepMetrics.dataDepthScore < 0.6) publishabilityReasons.push('deep data packs are below publishable depth');
  if (hasDeep && deepMetrics.institutionalEvidenceDensity < 0.65 && !isCrossThemeDiscoveryReport(bundle)) publishabilityReasons.push('institutional evidence tables are below publishable density');
  if (hasDeep && deepGapCount >= 3) publishabilityReasons.push(`${deepGapCount} structured data gaps remain`);
  if (hasDeep && deepMetrics.historicalContextScore <= 0 && requiresHistoricalAnalogueGate(bundle)) publishabilityReasons.push('no reliable historical analogue is attached');
  if (hasDeep && deepMetrics.evidenceDiversity < 0.8) publishabilityReasons.push('evidence diversity is below institutional target');
  if (!subjectDisplayName || /^unknown$/i.test(subjectDisplayName)) publishabilityReasons.push('report subject has not resolved to a stable display name');
  const publishable = publishabilityReasons.length === 0;
  const publishableCap = publishable ? null : (blockerCount > 0 || exportIntegrity < 1 ? 'D' : 'B');
  const finalGrade = minGrade(
    artifactGrade,
    analysisQuality.grade,
    triageUsefulness.grade,
    analystMemoQuality.grade,
    crossThemeDiscoveryQuality ? crossThemeDiscoveryQuality.grade : (hasDeep ? investmentReadinessQuality.grade : null),
    publishableCap,
  );
  const finalScore = Math.round(Math.min(
    rounded,
    analysisQuality.score,
    triageUsefulness.score,
    analystMemoQuality.score,
    crossThemeDiscoveryQuality ? crossThemeDiscoveryQuality.score : (hasDeep ? investmentReadinessQuality.score : 1),
    gradeCeilingScore(finalGrade),
  ) * 1000) / 1000;
  return {
    score: finalScore,
    grade: finalGrade,
    artifactQuality: {
      score: rounded,
      grade: artifactGrade,
      publishable: blockerCount === 0 && exportIntegrity >= 1,
    },
    triageUsefulness: {
      score: triageUsefulness.score,
      grade: triageUsefulness.grade,
      uncappedGrade: triageUsefulness.uncappedGrade,
      gradeCaps: triageUsefulness.caps,
      metrics: triageUsefulness.metrics,
    },
    analystUsefulness: {
      score: triageUsefulness.score,
      grade: triageUsefulness.grade,
      uncappedGrade: triageUsefulness.uncappedGrade,
      gradeCaps: triageUsefulness.caps,
      metrics: triageUsefulness.metrics,
    },
    analystMemoQuality: {
      score: analystMemoQuality.score,
      grade: analystMemoQuality.grade,
      uncappedGrade: analystMemoQuality.uncappedGrade,
      gradeCaps: analystMemoQuality.caps,
      metrics: analystMemoQuality.metrics,
    },
    investmentReadinessQuality: {
      score: investmentReadinessQuality.score,
      grade: investmentReadinessQuality.grade,
      uncappedGrade: investmentReadinessQuality.uncappedGrade,
      gradeCaps: investmentReadinessQuality.caps,
      metrics: investmentReadinessQuality.metrics,
    },
    ...(crossThemeDiscoveryQuality ? {
      crossThemeDiscoveryQuality: {
        score: crossThemeDiscoveryQuality.score,
        grade: crossThemeDiscoveryQuality.grade,
        tier: crossThemeDiscoveryQuality.tier,
        label: crossThemeDiscoveryQuality.label,
        gradeCaps: crossThemeDiscoveryQuality.caps,
        metrics: crossThemeDiscoveryQuality.metrics,
        bodyEvidence: crossThemeDiscoveryQuality.bodyEvidence,
        boundary: crossThemeDiscoveryQuality.boundary,
      },
      bottleneckReadiness: {
        tier: crossThemeDiscoveryQuality.tier,
        label: crossThemeDiscoveryQuality.label,
        score: crossThemeDiscoveryQuality.score,
        metrics: crossThemeDiscoveryQuality.metrics,
      },
      ...(crossThemeActionability ? {
        crossThemeActionability: {
          score: crossThemeActionability.score,
          grade: crossThemeActionability.grade,
          tier: crossThemeActionability.tier,
          label: crossThemeActionability.label,
          metrics: crossThemeActionability.metrics,
          boundary: crossThemeActionability.boundary,
        },
      } : {}),
      ...(researchUtility ? {
        researchUtility: {
          score: researchUtility.score,
          grade: researchUtility.grade,
          label: researchUtility.label,
          closureState: researchUtility.closureState,
          boundary: researchUtility.boundary,
          nextAction: researchUtility.nextAction,
          gradeCaps: researchUtility.caps,
          metrics: researchUtility.metrics,
        },
      } : {}),
    } : {}),
    artifactScore: rounded,
    artifactGrade,
    analysisScore: analysisQuality.score,
    analysisGrade: analysisQuality.grade,
    analysisUncappedGrade: analysisQuality.uncappedGrade,
    gradeCaps: [
      ...analysisQuality.caps,
      ...triageUsefulness.caps,
      ...analystMemoQuality.caps,
      ...(crossThemeDiscoveryQuality ? crossThemeDiscoveryQuality.caps : (hasDeep ? investmentReadinessQuality.caps : [])),
      ...(publishableCap ? [publishableCap] : []),
    ],
    productTier,
    investmentReadiness,
    decisionDiagnostic,
    publishable,
    publishabilityReasons,
    metrics: {
      evidenceCoverage,
      citationIntegrity,
      freshnessDisclosure,
      chartRelevance,
      caveatCompleteness,
      analyticalRigor,
      actionability,
      exportIntegrity,
      ...Object.fromEntries(Object.entries(analysisQuality.metrics).map(([key, value]) => [`analysis_${key}`, value])),
      ...Object.fromEntries(Object.entries(triageUsefulness.metrics).map(([key, value]) => [`triage_${key}`, value])),
      ...Object.fromEntries(Object.entries(analystMemoQuality.metrics).map(([key, value]) => [`memo_${key}`, value])),
      ...Object.fromEntries(Object.entries(investmentReadinessQuality.metrics).map(([key, value]) => [`investment_${key}`, value])),
      ...(crossThemeDiscoveryQuality
        ? Object.fromEntries(Object.entries(crossThemeDiscoveryQuality.metrics).map(([key, value]) => [`crossTheme_${key}`, value]))
        : {}),
      ...(crossThemeActionability
        ? Object.fromEntries(Object.entries(crossThemeActionability.metrics).map(([key, value]) => [`crossThemeAction_${key}`, value]))
        : {}),
      ...(researchUtility
        ? Object.fromEntries(Object.entries(researchUtility.metrics).map(([key, value]) => [`researchUtility_${key}`, value]))
        : {}),
      ...(researchUtility ? {
        researchUtility_score: researchUtility.score,
        researchUtility_grade: researchUtility.grade,
        researchUtility_closureState: researchUtility.closureState,
      } : {}),
      decisionDiagnosticStatus: decisionDiagnostic.status,
      decisionEvidenceSufficiency: decisionDiagnostic.evidenceSufficiency,
      decisionContinueBackfill: Number(decisionDiagnostic.continueBackfill),
      decisionStopBroadBackfill: Number(decisionDiagnostic.stopBroadBackfill),
    },
    targets: {
      evidenceCoverage: 0.98,
      citationIntegrity: 1,
      numericExactness: 1,
      staleDisclosure: 1,
      unsupportedClaimCount: 0,
      chartRelevance: 0.9,
      caveatCompleteness: 0.95,
      watchIndicatorActionability: 0.85,
      exportConsistency: 1,
      analysisSectionCompleteness: 1,
      analysisNarrativeDepth: 0.85,
      analysisMarketContext: 0.8,
      analysisEvidenceDiversity: 0.8,
      analysisEditorialPolish: 0.9,
      analysisDataDepth: 0.6,
      analysisCausalChain: 0.6,
      analysisHistoricalContext: 0.4,
      analysisInstitutionalEvidenceDensity: 0.65,
    },
  };
}
