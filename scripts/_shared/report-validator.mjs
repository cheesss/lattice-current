import { REPORT_CHART_TYPES, validateFigureSpecs } from './report-chart-planner.mjs';
import { computeReportQuality } from './report-quality.mjs';

const FORBIDDEN_INVESTMENT_PHRASES = [
  /\bbuy\b/i,
  /\bsell\b/i,
  /\bstrong buy\b/i,
  /\bprice target\b/i,
  /매수/,
  /매도/,
  /목표가/,
];

const COMMON_UPPERCASE_WORDS = new Set([
  'LLM', 'API', 'JSON', 'HTML', 'PDF', 'PPTX', 'DB', 'UI', 'NAS', 'VIX',
  'EVID', 'MET', 'FIG', 'CAV', 'CLM', 'WATCH', 'ETF', 'SEC', 'SLA',
  'AI', 'ML',
  /* Common business / domain abbreviations that appear in article titles
   * and analyst prose. Not tickers. */
  'CEO', 'CTO', 'CFO', 'COO', 'PPA', 'IPO', 'GDP', 'CPI', 'GPU', 'CPU',
  'EV', 'EU', 'US', 'UK', 'NA', 'EDP', 'SLA', 'TPU', 'IO', 'OS',
  'AND', 'OR', 'NOT', 'IT', 'IS', 'OK', 'MW', 'GW', 'KWH', 'MWH', 'GWH',
  'YOY', 'QOQ', 'WOW', 'DOD',
]);

/* ISO-date detection — used to skip "2026-05-04" tokenization */
const ISO_DATE_REGEX = /\b\d{4}-\d{2}-\d{2}\b/g;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function idSet(rows, key) {
  return new Set(asArray(rows).map((row) => row[key]).filter(Boolean));
}

function add(list, type, message, extra = {}) {
  list.push({ type, message, ...extra });
}

function claimHasSupport(claim) {
  return [
    claim.supportingEvidenceIds,
    claim.supportingMetricIds,
    claim.supportingFigureIds,
    claim.caveatIds,
  ].some((ids) => Array.isArray(ids) && ids.length > 0);
}

function knownNumericStrings(bundle) {
  /* Phase 3: include numbers from the rich themeContext / event details /
   * sensitivity row / candidate row so typed prose can cite them safely.
   * Without this, every entity-specific number (subtopic momentum, knowledge
   * edge confidence, hawkes intensity) would be flagged as unknown. */
  const ctx = bundle.metadata?.themeContext || {};
  const sym = bundle.metadata?.sensitivity || {};
  const cand = bundle.metadata?.candidate || {};
  const event = bundle.metadata?.event || {};
  const numbers = [
    ...asArray(bundle.metrics).map((metric) => metric.value),
    ...asArray(bundle.marketReactions).flatMap((reaction) => [
      reaction.relativeReturnPct,
      reaction.uplift,
      reaction.tStat,
      reaction.alpha,
    ]),
    /* themeContext numbers — subtopic momentum/accel/rank, peer zscores,
     * regime multipliers, knowledge edge confidence/evidence_count, event
     * counts/intensity, hawkes intensity */
    ...asArray(ctx.subtopics).flatMap((s) => [s.momentum_score, s.acceleration, s.rank_in_parent, s.article_count, s.share_pct]),
    ...asArray(ctx.peerSymbols?.positive).flatMap((p) => [p.sensitivity_zscore, p.avg_return, p.baseline_return, p.sample_size, p.hit_rate, p.return_vol]),
    ...asArray(ctx.peerSymbols?.negative).flatMap((p) => [p.sensitivity_zscore, p.avg_return, p.baseline_return, p.sample_size, p.hit_rate, p.return_vol]),
    ...asArray(ctx.regimeBySymbol).flatMap((g) => asArray(g.regimes).flatMap((r) => [r.regime_multiplier, r.avg_return, r.sample_size, r.hit_rate])),
    ...asArray(ctx.knowledgeConnections).flatMap((c) => [c.confidence, c.evidenceCount, c.sourceDiversity]),
    ...asArray(ctx.events).flatMap((e) => [e.articleCount, e.sourceCount, e.sourceDiversity, e.hawkesIntensity, e.normalizedTemperature, e.topSourceShare]),
    ...asArray(ctx.hawkesSeries).flatMap((h) => [h.hawkes_intensity, h.normalized_temperature, h.article_count]),
    /* Symbol report sensitivity row */
    sym.sensitivity_zscore, sym.sample_size, sym.avg_return, sym.baseline_return, sym.hit_rate, sym.return_vol,
    /* Cross-theme candidate row */
    cand.score, cand.evidence_summary?.evidenceQuality, cand.evidence_summary?.sourceDiversity, cand.evidence_summary?.seedSimilarity,
    /* Event report event row */
    event.article_count, event.source_count, event.source_diversity,
    /* Threshold constants the typed prose uses to define invalidators.
     * Policy thresholds, not data — but declared explicitly so the analyst
     * can audit them. */
    1, 1.5, 2, 3, 4, 5, 7, 10, 14, 21, 30, 0.4, 0.5, 0.55, 0.6, 0.7, 0.8,
    /* Subject-id numeric tokens (event id, candidate id) appear in prose
     * because the typed builder cites the actual event/candidate. */
    bundle.subject?.subjectId,
    bundle.metadata?.event?.id,
    bundle.metadata?.candidate?.id,
    /* Aggregate count of context items — already in MET-* metrics but listed
     * by raw integer in some sentences */
    asArray(ctx.events).length, asArray(ctx.subtopics).length, asArray(ctx.knowledgeConnections).length,
    ctx.peerSymbols?.counts?.total || 0, ctx.peerSymbols?.counts?.positive || 0, ctx.peerSymbols?.counts?.negative || 0,
    asArray(bundle.evidence).length, asArray(bundle.marketReactions).length, asArray(bundle.caveats).length,
    asArray(ctx.events).filter((e) => e.isSurge).length,
    /* P5: cross-asset paths + historical analogues */
    ...(asArray(bundle.metadata?.crossAssetPaths?.paths)).flatMap((p) => [p.score, p.hop1?.confidence, p.hop2?.confidence, p.pathLength]),
    ...(asArray(bundle.metadata?.historicalAnalogues?.analogues)).flatMap((a) => [a.similarity, a.profile?.mean, a.profile?.max, a.profile?.surge]),
    bundle.metadata?.crossAssetPaths?.paths?.length || 0,
    bundle.metadata?.historicalAnalogues?.analogues?.length || 0,
  ].filter((value) => Number.isFinite(Number(value)));
  const out = new Set();
  for (const value of numbers) {
    const number = Number(value);
    out.add(String(number));
    out.add(number.toFixed(0));
    out.add(number.toFixed(1));
    out.add(number.toFixed(2));
    out.add(number.toFixed(3));
    out.add(`${number.toFixed(0)}%`);
    out.add(`${number.toFixed(1)}%`);
    out.add(`${number.toFixed(2)}%`);
    /* Signed forms — '+5.22%' / '-5.22%' */
    if (number > 0) {
      out.add(`+${number.toFixed(0)}%`);
      out.add(`+${number.toFixed(1)}%`);
      out.add(`+${number.toFixed(2)}%`);
      out.add(`+${number.toFixed(0)}`);
      out.add(`+${number.toFixed(1)}`);
      out.add(`+${number.toFixed(2)}`);
    }
    if (number < 0) out.add(String(Math.abs(number)));
  }
  return out;
}

function allowedTickerStrings(bundle) {
  const tickers = new Set();
  for (const reaction of asArray(bundle.marketReactions)) {
    if (reaction.symbol) tickers.add(String(reaction.symbol).toUpperCase());
    if (reaction.benchmark) tickers.add(String(reaction.benchmark).toUpperCase());
  }
  for (const item of asArray(bundle.metadata?.allowedTickers)) {
    tickers.add(String(item).toUpperCase());
  }
  const evidenceText = [
    bundle.subject?.displayName,
    ...asArray(bundle.claims).map((claim) => claim.canonicalText),
    ...asArray(bundle.evidence).flatMap((item) => [item.title, item.publisher]),
  ].join(' ');
  for (const token of (evidenceText.match(/\b[A-Z][A-Z0-9.]{1,8}\b/g) || [])) {
    tickers.add(token.replace(/\.$/, '').toUpperCase());
  }
  return tickers;
}

function collectAnalysisText(analysis) {
  if (!analysis) return [];
  const texts = [];
  function walk(value, key = '') {
    if (typeof value === 'string') {
      if (['text', 'label', 'summary', 'rationale', 'note'].includes(key)) {
        texts.push(value);
      }
    } else if (Array.isArray(value)) {
      value.forEach((item) => walk(item, key));
    } else if (value && typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(value)) {
        walk(childValue, childKey);
      }
    }
  }
  walk(analysis);
  return texts;
}

function validateAnalysisText(bundle, analysis, blockers, warnings) {
  if (!analysis) return;
  const knownNumbers = knownNumericStrings(bundle);
  const allowedTickers = allowedTickerStrings(bundle);
  const texts = collectAnalysisText(analysis);
  for (const text of texts) {
    /* Phase 3: strip ISO dates, HTML entities, and quoted strings before
     * numeric tokenization. Quoted strings are evidence titles being cited
     * verbatim — numbers in them are part of the source, not generated
     * claims, so they should not be subject to bundle-metric validation. */
    const normalizedText = String(text)
      .replace(/&#\d+;|&[a-z]+;/gi, ' ')
      .replace(ISO_DATE_REGEX, ' ')
      .replace(/\b\d{4}\/\d{2}\/\d{2}\b/g, ' ')
      .replace(/"[^"]*"/g, ' ')                // double-quoted titles
      .replace(/“[^”]*”/g, ' ');               // smart-quoted titles
    for (const phrase of FORBIDDEN_INVESTMENT_PHRASES) {
      if (phrase.test(text)) {
        add(blockers, 'forbidden_investment_language', `Investment recommendation language is not allowed: ${phrase}`, { text });
      }
    }
    const numericTokens = normalizedText.match(/[-+]?\d+(?:\.\d+)?%?/g) || [];
    for (const token of numericTokens) {
      if (/^\d{4}$/.test(token)) continue;
      /* Tolerate small policy-threshold integers — these are deliberate
       * thresholds in invalidator clauses, not data claims. */
      const num = Number(token.replace(/%$/, ''));
      if (Number.isInteger(num) && num >= -2 && num <= 100 && knownNumbers.has(String(num))) continue;
      if (!knownNumbers.has(token)) {
        add(blockers, 'unknown_numeric_claim', `Generated numeric token is not present in bundle metrics: ${token}`, { text });
      }
    }
    const uppercaseTokens = normalizedText.match(/\b[A-Z][A-Z0-9.]{1,5}\b/g) || [];
    for (const token of uppercaseTokens) {
      const normalized = token.replace(/\.$/, '').toUpperCase();
      if (COMMON_UPPERCASE_WORDS.has(normalized)) continue;
      if (allowedTickers.size > 0 && !allowedTickers.has(normalized)) {
        add(warnings, 'unknown_uppercase_token', `Uppercase token is not in allowed ticker list: ${normalized}`, { text });
      }
    }
  }
}

function validateAnalysisReferences(bundle, analysis, blockers) {
  if (!analysis) return;
  const claimIds = idSet(bundle.claims, 'claimId');
  const evidenceIds = idSet(bundle.evidence, 'evidenceId');
  const metricIds = idSet(bundle.metrics, 'metricId');
  const figureIds = idSet(bundle.figures, 'figureId');
  const caveatIds = idSet(bundle.caveats, 'caveatId');
  const claimsById = new Map(asArray(bundle.claims).map((claim) => [claim.claimId, claim]));
  const buckets = [
    ...(analysis.keyJudgments || []),
    ...(analysis.whatChanged || []),
    ...(analysis.thesis || []),
    ...(analysis.catalysts || []),
    ...(analysis.evidenceSynthesis || []),
    ...(analysis.timeline || []),
    ...(analysis.marketTransmission || []),
    ...(analysis.scenarios || []),
    ...(analysis.risks || []),
    ...(analysis.analyticalAssessment || []),
    ...(analysis.decisionUse || []),
    ...(analysis.analystConclusion || []),
    ...(analysis.alternativeExplanations || []),
    ...(analysis.informationGaps || []),
    ...(analysis.watchNext || []),
    ...(analysis.sourceQueries || []),
    ...(analysis.analystNotes || []),
  ];
  for (const [index, item] of buckets.entries()) {
    const hasAny = ['claimIds', 'evidenceIds', 'metricIds', 'figureIds', 'caveatIds'].some((key) => Array.isArray(item[key]) && item[key].length);
    if (!hasAny) {
      add(blockers, 'analysis_without_references', 'LLM/Codex analysis block has no evidence references.', { index, text: item.text || item.label || null });
    }
    const referencedClaims = asArray(item.claimIds).map((id) => claimsById.get(id)).filter(Boolean);
    const analysisText = String(item.text || item.label || item.summary || item.rationale || '');
    const overstatesValidation = /\b(is validated|validated signal|confirmed|proves|promoted|canonical conclusion)\b/i.test(analysisText);
    const allRefsAreUnvalidated = referencedClaims.length > 0
      && referencedClaims.every((claim) => String(claim.validationStatus || '').toLowerCase() !== 'validated');
    if (overstatesValidation && allRefsAreUnvalidated) {
      add(blockers, 'overstated_validation_status', 'Analysis uses validated/confirmed language for a claim that is not validated.', { index, text: analysisText });
    }
    for (const id of asArray(item.claimIds)) if (!claimIds.has(id)) add(blockers, 'invalid_analysis_claim_ref', `Analysis references unknown claim id: ${id}`, { index });
    for (const id of asArray(item.evidenceIds)) if (!evidenceIds.has(id)) add(blockers, 'invalid_analysis_evidence_ref', `Analysis references unknown evidence id: ${id}`, { index });
    for (const id of asArray(item.metricIds)) if (!metricIds.has(id)) add(blockers, 'invalid_analysis_metric_ref', `Analysis references unknown metric id: ${id}`, { index });
    for (const id of asArray(item.figureIds)) if (!figureIds.has(id)) add(blockers, 'invalid_analysis_figure_ref', `Analysis references unknown figure id: ${id}`, { index });
    for (const id of asArray(item.caveatIds)) if (!caveatIds.has(id)) add(blockers, 'invalid_analysis_caveat_ref', `Analysis references unknown caveat id: ${id}`, { index });
  }
}

function validateRemediationPath(bundle, analysis, blockers) {
  const repairCaveats = asArray(bundle.caveats).filter((caveat) => (
    /pending|needs|source|evidence|stale|weak_controls|gap|seed_lock/i.test(`${caveat.type} ${caveat.text}`)
  ));
  if (!repairCaveats.length) return;
  const actionableWatch = asArray(bundle.watchIndicators).some((watch) => watch.label && watch.source && watch.horizon);
  const sourceQueries = asArray(analysis?.sourceQueries).filter((query) => query.text && asArray(query.caveatIds).length);
  if (!actionableWatch && !sourceQueries.length) {
    add(blockers, 'missing_remediation_path', 'Repair caveats require a watch indicator or source-query draft so the report is not a dead-end diagnostic.');
  }
}

function validateRenderedFigures(bundle, blockers) {
  for (const figure of asArray(bundle.figures)) {
    if (!figure.renderAssetId) {
      add(blockers, 'figure_without_render_asset', 'Rendered report figure is missing renderAssetId.', { figureId: figure.figureId });
    }
  }
}

export function validateReportBundle(bundle = {}, options = {}) {
  const blockers = [];
  const warnings = [];
  const claimIds = idSet(bundle.claims, 'claimId');
  const evidenceIds = idSet(bundle.evidence, 'evidenceId');
  const metricIds = idSet(bundle.metrics, 'metricId');
  const figureIds = idSet(bundle.figures, 'figureId');
  const caveatIds = idSet(bundle.caveats, 'caveatId');

  if (!bundle.bundleId) add(blockers, 'missing_bundle_id', 'Bundle is missing bundleId.');
  if (!bundle.reportId) add(blockers, 'missing_report_id', 'Bundle is missing reportId.');
  if (!bundle.reportType) add(blockers, 'missing_report_type', 'Bundle is missing reportType.');
  if (!bundle.subject?.subjectId) add(blockers, 'missing_subject', 'Bundle is missing subject identity.');

  for (const claim of asArray(bundle.claims)) {
    if (!claim.claimId) add(blockers, 'claim_without_id', 'Claim is missing claimId.');
    if (!claim.canonicalText) add(blockers, 'claim_without_text', 'Claim is missing canonicalText.', { claimId: claim.claimId });
    if (!claimHasSupport(claim)) add(blockers, 'unsupported_claim', 'Claim has no evidence, metric, figure, or caveat link.', { claimId: claim.claimId });
    for (const id of asArray(claim.supportingEvidenceIds)) if (!evidenceIds.has(id)) add(blockers, 'invalid_evidence_ref', `Claim references unknown evidence id: ${id}`, { claimId: claim.claimId });
    for (const id of asArray(claim.supportingMetricIds)) if (!metricIds.has(id)) add(blockers, 'invalid_metric_ref', `Claim references unknown metric id: ${id}`, { claimId: claim.claimId });
    for (const id of asArray(claim.supportingFigureIds)) if (!figureIds.has(id)) add(blockers, 'invalid_figure_ref', `Claim references unknown figure id: ${id}`, { claimId: claim.claimId });
    for (const id of asArray(claim.caveatIds)) if (!caveatIds.has(id)) add(blockers, 'invalid_caveat_ref', `Claim references unknown caveat id: ${id}`, { claimId: claim.claimId });
  }

  for (const caveat of asArray(bundle.caveats)) {
    for (const id of asArray(caveat.appliesToClaimIds)) {
      if (!claimIds.has(id)) add(blockers, 'invalid_caveat_claim_ref', `Caveat references unknown claim id: ${id}`, { caveatId: caveat.caveatId });
    }
  }

  const figureValidation = validateFigureSpecs(bundle.figures || []);
  blockers.push(...figureValidation.blockers);
  warnings.push(...figureValidation.warnings);
  for (const figure of asArray(bundle.figures)) {
    for (const id of asArray(figure.supportedClaimIds)) if (!claimIds.has(id)) add(blockers, 'invalid_figure_claim_ref', `Figure references unknown claim id: ${id}`, { figureId: figure.figureId });
    if (!REPORT_CHART_TYPES.includes(figure.chartType)) add(blockers, 'unsupported_chart_type', `Unsupported chart type: ${figure.chartType}`, { figureId: figure.figureId });
  }
  if (options.requireRenderedFigures) validateRenderedFigures(bundle, blockers);

  const hasStale = asArray(bundle.dataFreshness).some((item) => ['stale', 'degraded'].includes(String(item.freshnessStatus || '').toLowerCase()));
  const hasStaleCaveat = asArray(bundle.caveats).some((item) => /stale|freshness|degraded/i.test(`${item.type} ${item.text}`));
  if (hasStale && !hasStaleCaveat) add(blockers, 'stale_without_caveat', 'Stale or degraded data is present without a disclosure caveat.');

  const lowDiversity = Boolean(bundle.sourceSummary?.lowDiversityFlag || bundle.sourceSummary?.low_diversity_flag);
  const hasDiversityCaveat = asArray(bundle.caveats).some((item) => /source|diversity|concentration/i.test(`${item.type} ${item.text}`));
  if (lowDiversity && !hasDiversityCaveat) add(blockers, 'low_source_diversity_without_caveat', 'Low source diversity is present without a caveat.');

  validateAnalysisReferences(bundle, options.analysis, blockers);
  validateAnalysisText(bundle, options.analysis, blockers, warnings);
  validateRemediationPath(bundle, options.analysis, blockers);

  const validation = {
    ok: blockers.length === 0,
    status: blockers.length ? 'blocked' : warnings.length ? 'warning' : 'passed',
    generatedAt: new Date().toISOString(),
    blockers,
    warnings,
  };
  return {
    ...validation,
    quality: computeReportQuality(bundle, validation, options.analysis),
  };
}
