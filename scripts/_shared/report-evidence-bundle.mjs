import crypto from 'node:crypto';

export const REPORT_TYPES = Object.freeze({
  THEME: 'theme_report',
  EVENT_SIGNAL: 'event_signal_report',
  REGIME: 'regime_transmission_report',
  CROSS_THEME: 'cross_theme_bottleneck_report',
  SYMBOL: 'symbol_signal_report',
  SYSTEM_QUALITY: 'system_quality_report',
});

export const REPORT_TYPE_LABELS = Object.freeze({
  [REPORT_TYPES.THEME]: 'Theme Change Report',
  [REPORT_TYPES.EVENT_SIGNAL]: 'Event Signal Report',
  [REPORT_TYPES.REGIME]: 'Regime and Transmission Report',
  [REPORT_TYPES.CROSS_THEME]: 'Cross-Theme Bottleneck Report',
  [REPORT_TYPES.SYMBOL]: 'Symbol and Sector Signal Report',
  [REPORT_TYPES.SYSTEM_QUALITY]: 'System Quality Report',
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function slugify(value) {
  return String(value || 'report')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'report';
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashObject(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

export function createReportId({ reportType, subject, asOf = new Date().toISOString() } = {}) {
  const subjectKey = subject?.subjectId || subject?.displayName || 'report';
  const hash = hashObject({ reportType, subjectKey, asOf }).slice(0, 10);
  return `RPT-${slugify(reportType)}-${slugify(subjectKey)}-${hash}`;
}

function normalizeId(prefix, value, index) {
  const raw = String(value || '').trim();
  if (raw) return raw;
  return `${prefix}-${String(index + 1).padStart(3, '0')}`;
}

function normalizeEvidence(item, index) {
  return {
    evidenceId: normalizeId('EVID', item.evidenceId || item.id, index),
    kind: item.kind || 'unknown',
    sourceId: item.sourceId || item.source_id || null,
    publisher: item.publisher || item.source || null,
    title: item.title || 'Untitled evidence',
    publishedAt: item.publishedAt || item.published_at || null,
    ingestedAt: item.ingestedAt || item.ingested_at || null,
    url: item.url || null,
    sourceQualityScore: Number.isFinite(Number(item.sourceQualityScore ?? item.source_quality_score))
      ? Number(item.sourceQualityScore ?? item.source_quality_score)
      : null,
    sourceDiversityGroup: item.sourceDiversityGroup || item.source_diversity_group || null,
    evidenceGrade: item.evidenceGrade || item.evidence_grade || null,
    freshnessStatus: item.freshnessStatus || item.freshness_status || 'unknown',
    atomicFacts: asArray(item.atomicFacts || item.atomic_facts),
    limitations: asArray(item.limitations),
    metadata: item.metadata || {},
  };
}

function normalizeMetric(item, index) {
  return {
    metricId: normalizeId('MET', item.metricId || item.id, index),
    kind: item.kind || 'metric',
    name: item.name || item.metricName || item.metric_name || `metric_${index + 1}`,
    value: Number.isFinite(Number(item.value)) ? Number(item.value) : item.value,
    unit: item.unit || null,
    window: item.window || null,
    asOf: item.asOf || item.as_of || null,
    calculationVersion: item.calculationVersion || item.calculation_version || null,
    inputHash: item.inputHash || item.input_hash || null,
    limitations: asArray(item.limitations),
    metadata: item.metadata || {},
  };
}

function normalizeMarketReaction(item, index) {
  return {
    reactionId: normalizeId('MRKT', item.reactionId || item.id, index),
    symbol: item.symbol || null,
    benchmark: item.benchmark || null,
    eventWindow: item.eventWindow || item.event_window || null,
    relativeReturnPct: Number.isFinite(Number(item.relativeReturnPct ?? item.relative_return_pct))
      ? Number(item.relativeReturnPct ?? item.relative_return_pct)
      : null,
    uplift: Number.isFinite(Number(item.uplift)) ? Number(item.uplift) : null,
    tStat: Number.isFinite(Number(item.tStat ?? item.t_stat)) ? Number(item.tStat ?? item.t_stat) : null,
    alpha: Number.isFinite(Number(item.alpha)) ? Number(item.alpha) : null,
    controls: asArray(item.controls),
    validationStatus: item.validationStatus || item.validation_status || 'unknown',
    metricIds: asArray(item.metricIds || item.metric_ids),
    limitations: asArray(item.limitations),
    metadata: item.metadata || {},
  };
}

function normalizeFigure(item, index) {
  return {
    figureId: normalizeId('FIG', item.figureId || item.id, index),
    title: item.title || `Figure ${index + 1}`,
    chartType: item.chartType || item.chart_type || 'unknown',
    visualVocabularyCategory: item.visualVocabularyCategory || item.visual_vocabulary_category || null,
    analyticQuestion: item.analyticQuestion || item.analytic_question || '',
    dataRefIds: asArray(item.dataRefIds || item.data_ref_ids),
    supportedClaimIds: asArray(item.supportedClaimIds || item.supported_claim_ids),
    caveatIds: asArray(item.caveatIds || item.caveat_ids),
    dataAsOf: item.dataAsOf || item.data_as_of || null,
    renderAssetId: item.renderAssetId || item.render_asset_id || null,
    metadata: item.metadata || {},
  };
}

function normalizeCaveat(item, index) {
  return {
    caveatId: normalizeId('CAV', item.caveatId || item.id, index),
    severity: item.severity || 'medium',
    type: item.type || item.caveatType || item.caveat_type || 'general',
    text: item.text || 'Caveat not specified.',
    appliesToClaimIds: asArray(item.appliesToClaimIds || item.applies_to_claim_ids),
    blocker: Boolean(item.blocker),
    metadata: item.metadata || {},
  };
}

function normalizeWatchIndicator(item, index) {
  return {
    watchId: normalizeId('WATCH', item.watchId || item.id, index),
    label: item.label || item.indicator || `Watch item ${index + 1}`,
    threshold: item.threshold ?? null,
    direction: item.direction || null,
    source: item.source || null,
    horizon: item.horizon || null,
    claimIds: asArray(item.claimIds || item.claim_ids),
    metadata: item.metadata || {},
  };
}

function normalizeClaim(item, index) {
  return {
    claimId: normalizeId('CLM', item.claimId || item.id, index),
    claimType: item.claimType || item.claim_type || 'analytic_judgment',
    canonicalText: item.canonicalText || item.canonical_text || item.text || `Claim ${index + 1}`,
    generatedText: item.generatedText || item.generated_text || null,
    confidenceLevel: item.confidenceLevel || item.confidence_level || 'medium',
    supportingEvidenceIds: asArray(item.supportingEvidenceIds || item.supporting_evidence_ids),
    supportingMetricIds: asArray(item.supportingMetricIds || item.supporting_metric_ids),
    supportingFigureIds: asArray(item.supportingFigureIds || item.supporting_figure_ids),
    contraryEvidenceIds: asArray(item.contraryEvidenceIds || item.contrary_evidence_ids),
    caveatIds: asArray(item.caveatIds || item.caveat_ids),
    scope: item.scope || null,
    validationStatus: item.validationStatus || item.validation_status || 'candidate',
    metadata: item.metadata || {},
  };
}

function buildAutoCaveats({ dataFreshness, sourceSummary, metrics, claims }) {
  const caveats = [];
  const firstClaimId = claims[0]?.claimId;
  if (asArray(dataFreshness).some((item) => ['stale', 'degraded'].includes(String(item.freshnessStatus || item.freshness_status || '').toLowerCase()))) {
    caveats.push({
      caveatId: 'CAV-AUTO-STALE',
      severity: 'high',
      type: 'stale_data',
      text: 'One or more source datasets are stale or degraded; the report must not present those values as current.',
      appliesToClaimIds: firstClaimId ? [firstClaimId] : [],
      blocker: false,
    });
  }
  if (sourceSummary?.lowDiversityFlag || sourceSummary?.low_diversity_flag) {
    caveats.push({
      caveatId: 'CAV-AUTO-SOURCE-DIVERSITY',
      severity: 'medium',
      type: 'source_diversity',
      text: 'Source diversity is low, so the signal may reflect concentrated coverage rather than independent confirmation.',
      appliesToClaimIds: firstClaimId ? [firstClaimId] : [],
      blocker: false,
    });
  }
  if (asArray(metrics).some((metric) => asArray(metric.limitations).some((limitation) => /near[_ -]?zero|baseline/i.test(String(limitation))))) {
    caveats.push({
      caveatId: 'CAV-AUTO-BASELINE',
      severity: 'medium',
      type: 'baseline_distortion',
      text: 'A comparison metric is sensitive to a small or near-zero baseline and should be read as a triage signal, not precise magnitude.',
      appliesToClaimIds: firstClaimId ? [firstClaimId] : [],
      blocker: false,
    });
  }
  return caveats;
}

function inferSubject(reportType, subject = {}) {
  return {
    subjectType: subject.subjectType || subject.type || reportType.replace(/_report$/, ''),
    subjectId: subject.subjectId || subject.id || slugify(subject.displayName || subject.name || reportType),
    displayName: subject.displayName || subject.name || subject.subjectId || subject.id || REPORT_TYPE_LABELS[reportType] || reportType,
    metadata: subject.metadata || {},
  };
}

export function createEvidenceBundle(input = {}) {
  const reportType = input.reportType || input.type || REPORT_TYPES.THEME;
  const asOf = input.asOf || input.as_of || new Date().toISOString();
  const subject = inferSubject(reportType, input.subject || {});
  const coverageWindow = input.coverageWindow || input.coverage_window || { start: null, end: asOf };
  const evidence = asArray(input.evidence || input.evidenceItems).map(normalizeEvidence);
  const metrics = asArray(input.metrics || input.metricFacts).map(normalizeMetric);
  const marketReactions = asArray(input.marketReactions || input.market_reactions).map(normalizeMarketReaction);
  const figures = asArray(input.figures).map(normalizeFigure);
  const baseClaims = asArray(input.claims || input.claimCandidates).map(normalizeClaim);
  const claims = baseClaims.length ? baseClaims : [normalizeClaim({
    claimId: 'CLM-001',
    claimType: 'summary',
    canonicalText: `${subject.displayName} has an evidence bundle, but no analytical claim has been generated yet.`,
    supportingEvidenceIds: evidence[0]?.evidenceId ? [evidence[0].evidenceId] : [],
    supportingMetricIds: metrics[0]?.metricId ? [metrics[0].metricId] : [],
    caveatIds: [],
    confidenceLevel: evidence.length || metrics.length ? 'low' : 'insufficient',
  }, 0)];
  const dataFreshness = asArray(input.dataFreshness || input.data_freshness).map((item, index) => ({
    freshnessId: normalizeId('FRESH', item.freshnessId || item.id, index),
    dataset: item.dataset || 'unknown',
    lastUpdatedAt: item.lastUpdatedAt || item.last_updated_at || null,
    slaHours: Number.isFinite(Number(item.slaHours ?? item.sla_hours)) ? Number(item.slaHours ?? item.sla_hours) : null,
    freshnessStatus: item.freshnessStatus || item.freshness_status || 'unknown',
    metadata: item.metadata || {},
  }));
  const inputCaveats = asArray(input.caveats).map(normalizeCaveat);
  const caveats = [
    ...inputCaveats,
    ...buildAutoCaveats({
      dataFreshness,
      sourceSummary: input.sourceSummary || input.source_summary || {},
      metrics,
      claims,
    }).filter((auto) => !inputCaveats.some((existing) => existing.caveatId === auto.caveatId)),
  ].map(normalizeCaveat);
  const watchIndicators = asArray(input.watchIndicators || input.watch_next || input.watchNext).map(normalizeWatchIndicator);
  const bundle = {
    bundleId: input.bundleId || input.bundle_id || `EB-${hashObject({ reportType, subject, asOf }).slice(0, 12)}`,
    reportId: input.reportId || input.report_id || createReportId({ reportType, subject, asOf }),
    reportType,
    reportTypeLabel: REPORT_TYPE_LABELS[reportType] || reportType,
    subject,
    coverageWindow,
    asOf,
    generatedAt: input.generatedAt || input.generated_at || new Date().toISOString(),
    dataFreshness,
    sourceSummary: input.sourceSummary || input.source_summary || {},
    claims,
    evidence,
    metrics,
    marketReactions,
    figures,
    caveats,
    watchIndicators,
    queryManifest: {
      manifestId: input.queryManifest?.manifestId || input.query_manifest?.manifest_id || `QMAN-${hashObject(input.queryManifest || input.query_manifest || {}).slice(0, 10)}`,
      ...(input.queryManifest || input.query_manifest || {}),
    },
    metadata: input.metadata || {},
  };
  return {
    ...bundle,
    bundleHash: hashObject(bundle),
  };
}

export function buildThemeReportBundle(input = {}) {
  const subjectName = input.subject?.displayName || input.theme?.label || input.theme?.key || 'Theme';
  const accelerationValue = Number(input.theme?.acceleration);
  const accelerationLimitations = [
    ...asArray(input.theme?.accelerationLimitations),
    ...(Number.isFinite(accelerationValue) && Math.abs(accelerationValue) > 100 ? ['baseline_distortion'] : []),
  ];
  const metrics = [
    ...(input.metrics || []),
    ...(input.theme?.yoy !== undefined ? [{ metricId: 'MET-THEME-YOY', kind: 'theme_trend', name: 'YoY', value: input.theme.yoy, unit: 'percent', window: input.period || null }] : []),
    ...(input.theme?.acceleration !== undefined ? [{
      metricId: 'MET-THEME-ACCELERATION',
      kind: 'theme_trend',
      name: 'acceleration',
      value: input.theme.acceleration,
      unit: 'percent',
      window: input.period || null,
      limitations: [...new Set(accelerationLimitations)],
      metadata: input.theme?.accelerationMetadata || {},
    }] : []),
    ...(input.theme?.sourceDiversity !== undefined ? [{ metricId: 'MET-THEME-SOURCE-DIVERSITY', kind: 'source_quality', name: 'source_diversity', value: input.theme.sourceDiversity, unit: 'score' }] : []),
  ];
  const metricIds = metrics.map((metric, index) => metric.metricId || `MET-${String(index + 1).padStart(3, '0')}`);
  const claims = input.claims || [{
    claimId: 'CLM-001',
    claimType: 'theme_change',
    canonicalText: `${subjectName} should be read through the current theme metrics and caveats before being treated as a structural signal.`,
    supportingMetricIds: metricIds.slice(0, 3),
    caveatIds: accelerationLimitations.length ? ['CAV-AUTO-BASELINE'] : [],
    confidenceLevel: metricIds.length >= 2 ? 'medium' : 'low',
    validationStatus: 'candidate',
  }];
  return createEvidenceBundle({
    ...input,
    reportType: REPORT_TYPES.THEME,
    subject: {
      subjectType: 'theme',
      subjectId: input.subject?.subjectId || input.theme?.key || slugify(subjectName),
      displayName: subjectName,
      ...(input.subject || {}),
    },
    metrics,
    claims,
  });
}

export function buildCrossThemeBottleneckReportBundle(input = {}) {
  const candidate = input.candidate || {};
  const displayName = candidate.name || candidate.supplier || candidate.connector || input.subject?.displayName || 'Cross-theme candidate';
  const discovery = candidate.discovery || {};
  const metrics = [
    ...(input.metrics || []),
    { metricId: 'MET-XTC-SCORE', kind: 'cross_theme_score', name: 'candidate_score', value: candidate.score ?? 0, unit: 'score' },
    { metricId: 'MET-XTC-EVIDENCE', kind: 'cross_theme_score', name: 'evidence_score', value: candidate.evidenceScore ?? candidate.evidence ?? 0, unit: 'score' },
    { metricId: 'MET-XTC-SEED-SIMILARITY', kind: 'cross_theme_score', name: 'seed_similarity', value: candidate.seedSimilarity ?? 0, unit: 'score' },
    { metricId: 'MET-XTC-DISCOVERY-FIT', kind: 'cross_theme_score', name: 'discovery_fit', value: candidate.discoveryFit ?? discovery.discoveryFit ?? 0, unit: 'score' },
    { metricId: 'MET-XTC-CONSTRAINT-CRITICALITY', kind: 'cross_theme_score', name: 'constraint_criticality', value: candidate.constraintCriticality ?? discovery.constraintScore ?? 0, unit: 'score' },
    { metricId: 'MET-XTC-GEOPOLITICAL-RELEVANCE', kind: 'cross_theme_score', name: 'geopolitical_relevance', value: candidate.geopoliticalRelevance ?? discovery.geopoliticalRelevance ?? 0, unit: 'score' },
  ];
  const caveats = [
    ...(input.caveats || []),
    ...(Number(candidate.seedSimilarity || 0) > 0.25 ? [{
      caveatId: 'CAV-XTC-SEED-LOCKIN',
      severity: 'medium',
      type: 'seed_lock_in',
      text: 'The candidate resembles calibration or user-provided examples; ranking must be supported by independent evidence before promotion.',
      appliesToClaimIds: ['CLM-001'],
    }] : []),
    ...(candidate.lane === 'needs_evidence' ? [{
      caveatId: 'CAV-XTC-NEEDS-EVIDENCE',
      severity: 'high',
      type: 'pending_validation',
      text: 'The connector is a candidate and still needs direct evidence expansion before canonical promotion.',
      appliesToClaimIds: ['CLM-001'],
      blocker: false,
    }] : []),
  ];
  return createEvidenceBundle({
    ...input,
    reportType: REPORT_TYPES.CROSS_THEME,
    subject: {
      subjectType: 'cross_theme_candidate',
      subjectId: input.subject?.subjectId || candidate.id || slugify(displayName),
      displayName,
      ...(input.subject || {}),
      metadata: {
        ...(input.subject?.metadata || {}),
        candidateId: candidate.id || input.subject?.metadata?.candidateId || null,
        themes: asArray(candidate.themes),
        connector: candidate.connector || null,
        supplier: candidate.supplier || null,
        discovery,
      },
    },
    metrics,
    caveats,
    claims: input.claims || [{
      claimId: 'CLM-001',
      claimType: 'cross_theme_candidate',
      canonicalText: `${displayName} is a candidate connector across ${asArray(candidate.themes).join(' x ') || 'multiple themes'}; it should be evaluated as a discovery bottleneck only when discovery fit, constraint criticality, direct evidence, and source diversity align.`,
      supportingMetricIds: ['MET-XTC-SCORE', 'MET-XTC-EVIDENCE', 'MET-XTC-SEED-SIMILARITY', 'MET-XTC-DISCOVERY-FIT', 'MET-XTC-CONSTRAINT-CRITICALITY'],
      caveatIds: caveats.map((item) => item.caveatId),
      confidenceLevel: Number(candidate.evidenceScore ?? candidate.evidence ?? 0) >= 0.75 ? 'medium' : 'low',
      validationStatus: 'candidate',
    }],
    watchIndicators: input.watchIndicators || [{
      watchId: 'WATCH-XTC-SOURCE-QUERY',
      label: 'Collect direct supplier/component evidence from at least two independent source groups.',
      threshold: 2,
      direction: 'at_or_above',
      source: 'source-query',
      horizon: 'next cycle',
      claimIds: ['CLM-001'],
    }],
  });
}

export function buildEventSignalReportBundle(input = {}) {
  const event = input.event || {};
  const displayName = event.title || input.subject?.displayName || 'Event signal';
  const metrics = [
    ...(input.metrics || []),
    { metricId: 'MET-EVENT-TEMP', kind: 'event_intensity', name: 'hawkes_temperature', value: event.temperature ?? event.hawkesTemperature ?? 0, unit: 'score', window: event.window || input.period || null },
    { metricId: 'MET-EVENT-ARTICLES', kind: 'evidence_volume', name: 'article_count', value: event.articleCount ?? event.articles ?? asArray(input.evidence).length, unit: 'articles', window: event.window || input.period || null },
    { metricId: 'MET-EVENT-SOURCES', kind: 'source_quality', name: 'distinct_sources', value: event.sourceCount ?? event.sources ?? input.sourceSummary?.distinctSources ?? 0, unit: 'sources' },
  ];
  const hasValidatedMarket = asArray(input.marketReactions).some((reaction) => String(reaction.validationStatus || reaction.validation_status || '').toLowerCase() === 'validated');
  const caveats = [
    ...(input.caveats || []),
    ...(!hasValidatedMarket ? [{
      caveatId: 'CAV-EVENT-PENDING-MARKET-VALIDATION',
      severity: 'medium',
      type: 'pending_validation',
      text: 'The event has not yet completed market-reaction validation, so it should be treated as an intelligence signal rather than durable alpha.',
      appliesToClaimIds: ['CLM-001'],
    }] : []),
  ];
  return createEvidenceBundle({
    ...input,
    reportType: REPORT_TYPES.EVENT_SIGNAL,
    subject: {
      subjectType: 'event_cluster',
      subjectId: input.subject?.subjectId || event.id || slugify(displayName),
      displayName,
      ...(input.subject || {}),
    },
    metrics,
    caveats,
    claims: input.claims || [{
      claimId: 'CLM-001',
      claimType: 'event_signal',
      canonicalText: `${displayName} is a reportable event signal; the conclusion depends on evidence freshness, source diversity, and market-validation status.`,
      supportingEvidenceIds: asArray(input.evidence).slice(0, 4).map((item, index) => item.evidenceId || item.id || `EVID-${String(index + 1).padStart(3, '0')}`),
      supportingMetricIds: ['MET-EVENT-TEMP', 'MET-EVENT-ARTICLES', 'MET-EVENT-SOURCES'],
      caveatIds: caveats.map((item) => item.caveatId),
      confidenceLevel: hasValidatedMarket ? 'medium' : 'low',
      validationStatus: hasValidatedMarket ? 'validated' : 'candidate',
    }],
    watchIndicators: input.watchIndicators || [{
      watchId: 'WATCH-EVENT-VALIDATION',
      label: 'Run or refresh event-market validation before treating the signal as durable.',
      threshold: 'validation_status=validated',
      direction: 'equals',
      source: 'event-market-validation',
      horizon: 'next validation cycle',
      claimIds: ['CLM-001'],
    }],
  });
}

export function buildRegimeTransmissionReportBundle(input = {}) {
  const regime = input.regime || {};
  const displayName = regime.label || input.subject?.displayName || 'Macro regime transmission';
  const metrics = [
    ...(input.metrics || []),
    { metricId: 'MET-REGIME-CONFIDENCE', kind: 'regime_state', name: 'regime_confidence', value: regime.confidence ?? 0, unit: 'score' },
    { metricId: 'MET-REGIME-VIX', kind: 'macro_input', name: 'vix', value: regime.vix ?? regime.VIX ?? 0, unit: 'index' },
    { metricId: 'MET-REGIME-OIL', kind: 'macro_input', name: 'oil', value: regime.oil ?? 0, unit: 'price' },
    { metricId: 'MET-REGIME-TRANSMISSION', kind: 'transmission', name: 'transmission_edges', value: regime.edgeCount ?? regime.edges ?? 0, unit: 'edges' },
  ];
  const caveats = [
    ...(input.caveats || []),
    {
      caveatId: 'CAV-REGIME-CAUSALITY',
      severity: 'medium',
      type: 'causality_boundary',
      text: 'Transmission edges separate correlation, temporal lag, and validated event-market links; the report must not present all edges as causal.',
      appliesToClaimIds: ['CLM-001'],
    },
  ];
  return createEvidenceBundle({
    ...input,
    reportType: REPORT_TYPES.REGIME,
    subject: {
      subjectType: 'regime',
      subjectId: input.subject?.subjectId || slugify(displayName),
      displayName,
      ...(input.subject || {}),
    },
    metrics,
    caveats,
    claims: input.claims || [{
      claimId: 'CLM-001',
      claimType: 'regime_transmission',
      canonicalText: `${displayName} summarizes current macro inputs and transmission links, with causal interpretation constrained by edge type and validation status.`,
      supportingMetricIds: ['MET-REGIME-CONFIDENCE', 'MET-REGIME-VIX', 'MET-REGIME-OIL', 'MET-REGIME-TRANSMISSION'],
      caveatIds: ['CAV-REGIME-CAUSALITY'],
      confidenceLevel: Number(regime.confidence ?? 0) >= 70 ? 'medium' : 'low',
      validationStatus: 'candidate',
    }],
    watchIndicators: input.watchIndicators || [{
      watchId: 'WATCH-REGIME-EDGE-TYPES',
      label: 'Promote only transmission paths with explicit edge type and fresh macro inputs.',
      threshold: 'edge_type_present && macro_fresh',
      direction: 'equals',
      source: 'event-market-transmission',
      horizon: 'next refresh',
      claimIds: ['CLM-001'],
    }],
  });
}

export function buildSymbolSignalReportBundle(input = {}) {
  const symbol = input.symbol || {};
  const displayName = symbol.name || symbol.ticker || input.subject?.displayName || 'Symbol signal';
  const ticker = symbol.ticker || symbol.symbol || input.subject?.metadata?.ticker || displayName;
  const metrics = [
    ...(input.metrics || []),
    { metricId: 'MET-SYMBOL-EXPOSURE', kind: 'symbol_exposure', name: 'theme_exposure_score', value: symbol.exposureScore ?? 0, unit: 'score' },
    { metricId: 'MET-SYMBOL-RELATIVE-RETURN', kind: 'market_reaction', name: 'relative_return', value: symbol.relativeReturnPct ?? 0, unit: 'percent' },
    { metricId: 'MET-SYMBOL-VALIDATION', kind: 'validation', name: 'validation_quality', value: symbol.validationQuality ?? 0, unit: 'score' },
  ];
  const hasWeakValidation = Number(symbol.validationQuality ?? 0) < 0.65;
  const caveats = [
    ...(input.caveats || []),
    ...(hasWeakValidation ? [{
      caveatId: 'CAV-SYMBOL-WEAK-VALIDATION',
      severity: 'medium',
      type: 'weak_controls',
      text: 'Symbol exposure is not a standalone investment recommendation and needs stronger validation before decision use.',
      appliesToClaimIds: ['CLM-001'],
    }] : []),
  ];
  return createEvidenceBundle({
    ...input,
    reportType: REPORT_TYPES.SYMBOL,
    subject: {
      subjectType: 'symbol',
      subjectId: input.subject?.subjectId || slugify(ticker),
      displayName,
      ...(input.subject || {}),
      metadata: { ...(input.subject?.metadata || {}), ticker },
    },
    metrics,
    caveats,
    claims: input.claims || [{
      claimId: 'CLM-001',
      claimType: 'symbol_signal',
      canonicalText: `${displayName} is linked to the supplied theme and market-reaction evidence, but the report is an intelligence brief rather than a trading recommendation.`,
      supportingEvidenceIds: asArray(input.evidence).slice(0, 3).map((item, index) => item.evidenceId || item.id || `EVID-${String(index + 1).padStart(3, '0')}`),
      supportingMetricIds: ['MET-SYMBOL-EXPOSURE', 'MET-SYMBOL-RELATIVE-RETURN', 'MET-SYMBOL-VALIDATION'],
      caveatIds: caveats.map((item) => item.caveatId),
      confidenceLevel: hasWeakValidation ? 'low' : 'medium',
      validationStatus: hasWeakValidation ? 'candidate' : 'validated',
    }],
    metadata: {
      ...(input.metadata || {}),
      allowedTickers: [...new Set([ticker, ...(asArray(input.metadata?.allowedTickers))].filter(Boolean))],
    },
    watchIndicators: input.watchIndicators || [{
      watchId: 'WATCH-SYMBOL-VALIDATION',
      label: 'Recheck relative performance and validation quality before using the symbol as an exposure proxy.',
      threshold: 'validation_quality>=0.65',
      direction: 'at_or_above',
      source: 'symbol-validation',
      horizon: 'next market close',
      claimIds: ['CLM-001'],
    }],
  });
}

export function buildSystemQualityReportBundle(input = {}) {
  const ops = input.ops || {};
  const displayName = input.subject?.displayName || 'System quality and trust';
  const metrics = [
    ...(input.metrics || []),
    { metricId: 'MET-OPS-FRESH-DATASETS', kind: 'ops_quality', name: 'fresh_datasets', value: ops.freshDatasets ?? 0, unit: 'datasets' },
    { metricId: 'MET-OPS-STALE-DATASETS', kind: 'ops_quality', name: 'stale_datasets', value: ops.staleDatasets ?? 0, unit: 'datasets' },
    { metricId: 'MET-OPS-PENDING-VALIDATION', kind: 'ops_quality', name: 'pending_validation', value: ops.pendingValidation ?? 0, unit: 'items' },
    { metricId: 'MET-OPS-ECE', kind: 'model_trust', name: 'ece', value: ops.ece ?? 0, unit: 'score' },
  ];
  const hasStaleOrPending = Number(ops.staleDatasets ?? 0) > 0 || Number(ops.pendingValidation ?? 0) > 0;
  const caveats = [
    ...(input.caveats || []),
    ...(hasStaleOrPending ? [{
      caveatId: 'CAV-OPS-TRUST-GATE',
      severity: 'high',
      type: 'pending_validation',
      text: 'Some outputs should stay trust-gated until stale datasets and validation backlog are repaired.',
      appliesToClaimIds: ['CLM-001'],
    }] : []),
  ];
  return createEvidenceBundle({
    ...input,
    reportType: REPORT_TYPES.SYSTEM_QUALITY,
    subject: {
      subjectType: 'system_quality',
      subjectId: input.subject?.subjectId || 'system-quality',
      displayName,
      ...(input.subject || {}),
    },
    metrics,
    caveats,
    claims: input.claims || [{
      claimId: 'CLM-001',
      claimType: 'system_quality',
      canonicalText: `${displayName} identifies which report inputs are safe to trust and which remain trust-gated by stale data or pending validation.`,
      supportingMetricIds: ['MET-OPS-FRESH-DATASETS', 'MET-OPS-STALE-DATASETS', 'MET-OPS-PENDING-VALIDATION', 'MET-OPS-ECE'],
      caveatIds: caveats.map((item) => item.caveatId),
      confidenceLevel: 'medium',
      validationStatus: hasStaleOrPending ? 'candidate' : 'validated',
    }],
    watchIndicators: input.watchIndicators || [{
      watchId: 'WATCH-OPS-REPAIR',
      label: 'Repair stale datasets and validation backlog before promoting affected report sections.',
      threshold: 'stale_datasets=0 && pending_validation=0',
      direction: 'equals',
      source: 'ops-status',
      horizon: 'next daemon cycle',
      claimIds: ['CLM-001'],
    }],
  });
}

export function buildSampleReportBundle(type = REPORT_TYPES.THEME, options = {}) {
  if (type === REPORT_TYPES.EVENT_SIGNAL) {
    return buildEventSignalReportBundle({
      event: {
        id: 'sample-hormuz-shipping',
        title: options.subject || 'Hormuz shipping disruption signal',
        temperature: 0.91,
        articleCount: 42,
        sourceCount: 11,
      },
      evidence: [
        { evidenceId: 'EVID-001', kind: 'news_article', publisher: 'Sample Maritime Source', title: 'Shipping operators reroute after corridor disruption', freshnessStatus: 'fresh', evidenceGrade: 'E1', sourceQualityScore: 0.8 },
        { evidenceId: 'EVID-002', kind: 'news_article', publisher: 'Sample Energy Source', title: 'Energy desks monitor freight and oil risk after disruption', freshnessStatus: 'fresh', evidenceGrade: 'E1', sourceQualityScore: 0.78 },
      ],
      marketReactions: [{ reactionId: 'MRKT-001', symbol: 'CL=F', benchmark: 'SPY', relativeReturnPct: 3.2, uplift: 0.031, tStat: 2.4, alpha: 0.012, validationStatus: 'validated', controls: ['VIX', 'Dollar'] }],
      sourceSummary: { distinctSources: 11, sourceDiversityScore: 0.78, lowDiversityFlag: false },
      dataFreshness: [{ dataset: 'event_clusters', freshnessStatus: 'fresh', lastUpdatedAt: new Date().toISOString(), slaHours: 12 }],
    });
  }
  if (type === REPORT_TYPES.REGIME) {
    return buildRegimeTransmissionReportBundle({
      regime: {
        label: options.subject || 'Inflation shock transmission',
        confidence: 84,
        vix: 16.9,
        oil: 101.9,
        edgeCount: 74,
      },
      evidence: [{ evidenceId: 'EVID-001', kind: 'transmission_graph', publisher: 'Lattice Transmission', title: 'Energy and shipping links dominate current transmission map', freshnessStatus: 'fresh', evidenceGrade: 'calculated' }],
      sourceSummary: { distinctSources: 9, sourceDiversityScore: 0.72, lowDiversityFlag: false },
      dataFreshness: [{ dataset: 'event_market_transmission', freshnessStatus: 'fresh', lastUpdatedAt: new Date().toISOString(), slaHours: 6 }],
    });
  }
  if (type === REPORT_TYPES.CROSS_THEME) {
    return buildCrossThemeBottleneckReportBundle({
      candidate: {
        id: 'sample-linde-cryogenics',
        name: options.subject || 'Linde cryogenic cooling',
        themes: ['space', 'fusion-energy', 'quantum-computing'],
        score: 0.82,
        evidenceScore: 0.54,
        seedSimilarity: 0.31,
        lane: 'needs_evidence',
      },
      evidence: [{
        evidenceId: 'EVID-001',
        kind: 'candidate_graph',
        publisher: 'Lattice Research OS',
        title: 'Candidate graph overlap across space, fusion, and quantum cooling pathways',
        freshnessStatus: 'fresh',
        evidenceGrade: 'candidate',
      }],
      sourceSummary: { distinctSources: 1, sourceDiversityScore: 0.25, lowDiversityFlag: true },
      dataFreshness: [{ dataset: 'cross_theme_candidates', freshnessStatus: 'fresh', lastUpdatedAt: new Date().toISOString(), slaHours: 24 }],
    });
  }
  if (type === REPORT_TYPES.SYMBOL) {
    return buildSymbolSignalReportBundle({
      symbol: {
        ticker: 'RKLB',
        name: options.subject || 'Rocket Lab exposure signal',
        exposureScore: 0.74,
        relativeReturnPct: 6.1,
        validationQuality: 0.72,
      },
      evidence: [{ evidenceId: 'EVID-001', kind: 'theme_symbol_mapping', publisher: 'Lattice Exposure Map', title: 'Space theme maps to launch and satellite infrastructure exposure', freshnessStatus: 'fresh', evidenceGrade: 'calculated' }],
      marketReactions: [{ reactionId: 'MRKT-001', symbol: 'RKLB', benchmark: 'SPY', relativeReturnPct: 6.1, uplift: 0.044, tStat: 2.1, alpha: 0.016, validationStatus: 'validated', controls: ['VIX', 'SPY'] }],
      sourceSummary: { distinctSources: 5, sourceDiversityScore: 0.69, lowDiversityFlag: false },
      dataFreshness: [{ dataset: 'symbol_exposure', freshnessStatus: 'fresh', lastUpdatedAt: new Date().toISOString(), slaHours: 24 }],
    });
  }
  if (type === REPORT_TYPES.SYSTEM_QUALITY) {
    return buildSystemQualityReportBundle({
      ops: {
        freshDatasets: 8,
        staleDatasets: 1,
        pendingValidation: 12,
        ece: 0.059,
      },
      evidence: [{ evidenceId: 'EVID-001', kind: 'ops_status', publisher: 'Lattice Ops', title: 'Ops status snapshot for report trust gating', freshnessStatus: 'fresh', evidenceGrade: 'calculated' }],
      sourceSummary: { distinctSources: 4, sourceDiversityScore: 0.7, lowDiversityFlag: false },
      dataFreshness: [
        { dataset: 'ops_status', freshnessStatus: 'fresh', lastUpdatedAt: new Date().toISOString(), slaHours: 2 },
        { dataset: 'validation_snapshot', freshnessStatus: 'stale', lastUpdatedAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(), slaHours: 24 },
      ],
    });
  }
  return buildThemeReportBundle({
    theme: {
      key: slugify(options.subject || 'cloud-infrastructure'),
      label: options.subject || 'Cloud Infrastructure',
      yoy: 100,
      acceleration: -843.68,
      sourceDiversity: 0.61,
    },
    period: 'weekly',
    evidence: [{
      evidenceId: 'EVID-001',
      kind: 'news_article',
      publisher: 'Sample Source',
      title: 'Data center electricity demand becomes visible in utility load',
      publishedAt: new Date().toISOString(),
      freshnessStatus: 'fresh',
      evidenceGrade: 'E1',
      sourceQualityScore: 0.75,
    }],
    sourceSummary: { distinctSources: 6, sourceDiversityScore: 0.61, lowDiversityFlag: false },
    dataFreshness: [{ dataset: 'theme_trend_aggregates', freshnessStatus: 'fresh', lastUpdatedAt: new Date().toISOString(), slaHours: 24 }],
    watchIndicators: [{
      watchId: 'WATCH-THEME-CONFIRMATION',
      label: 'Confirm the theme with fresh sources, subtopic breadth, and non-baseline-distorted metrics before promotion.',
      threshold: 'fresh_sources && subtopic_breadth && stable_baseline',
      direction: 'equals',
      source: 'theme-trend-aggregates',
      horizon: 'next period refresh',
      claimIds: ['CLM-001'],
    }],
  });
}
