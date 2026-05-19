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
  'KPI', 'MD', 'MD&A', 'CAPEX', 'OPEX', 'R&D',
  'ARR', 'NRR', 'MRR', 'ACV', 'TCV', 'RPO', 'NDR',
  'EV', 'EU', 'US', 'UK', 'NA', 'EDP', 'SLA', 'TPU', 'IO', 'OS', 'FX',
  'AND', 'OR', 'NOT', 'IT', 'IS', 'OK', 'MW', 'GW', 'KWH', 'MWH', 'GWH',
  'YOY', 'QOQ', 'WOW', 'DOD', 'NATO',
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

function validateAdaptiveNarrativeStructure(analysis = {}, blockers = []) {
  const structure = analysis.narrativeStructure || analysis.narrativePlan?.narrativeStructure;
  if (!structure) return;
  const coverage = Number(structure.requiredRoleCoverage ?? 0);
  if (!(coverage >= 1)) {
    add(blockers, 'adaptive_narrative_role_coverage_incomplete', `Adaptive narrative role coverage is incomplete: ${coverage}.`, {
      missingRoles: asArray(structure.missingRoles),
    });
  }
  if (asArray(structure.validationErrors).length && structure.provider === 'llm') {
    add(blockers, 'adaptive_narrative_outline_invalid', 'LLM narrative outline failed validation and cannot be used.', {
      errors: asArray(structure.validationErrors),
    });
  }
  const titles = asArray(structure.sections).map((section) => String(section.title || '').trim().toLowerCase()).filter(Boolean);
  if (titles.length !== new Set(titles).size) {
    add(blockers, 'adaptive_narrative_duplicate_titles', 'Adaptive narrative structure contains duplicate section titles.');
  }
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
      reaction.sampleSize,
      reaction.sample_size,
      ...asArray(reaction.controls).flatMap((control) => (
        String(control).match(/[-+]?\d+(?:\.\d+)?/g) || []
      )),
    ]),
    /* themeContext numbers — subtopic momentum/accel/rank, peer zscores,
     * regime multipliers, knowledge edge confidence/evidence_count, event
     * counts/intensity, hawkes intensity */
    ...asArray(ctx.subtopics).flatMap((s) => [s.momentum_score, s.acceleration, s.rank_in_parent, s.article_count, s.share_pct]),
    ...asArray(ctx.peerSymbols?.positive).flatMap((p) => [p.sensitivity_zscore, p.avg_return, p.baseline_return, p.sample_size, p.hit_rate, p.return_vol]),
    ...asArray(ctx.peerSymbols?.negative).flatMap((p) => [p.sensitivity_zscore, p.avg_return, p.baseline_return, p.sample_size, p.hit_rate, p.return_vol]),
    ...asArray(ctx.regimeBySymbol).flatMap((g) => asArray(g.regimes).flatMap((r) => [r.regime_multiplier, r.avg_return, r.sample_size, r.hit_rate])),
    ...asArray(ctx.knowledgeConnections).flatMap((c) => [c.confidence, c.evidenceCount, c.sourceDiversity]),
    ...asArray(ctx.events).flatMap((e) => [e.eventId, e.id, e.articleCount, e.sourceCount, e.sourceDiversity, e.hawkesIntensity, e.normalizedTemperature, e.topSourceShare]),
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
    ...(asArray(bundle.metadata?.deepResearch?.packs?.historicalAnalogPack?.analogues)).flatMap((a) => [
      a.similarityScore,
      a.metadata?.vsPreviousPeriodPct,
      a.metadata?.vsYearAgoPct,
      a.metadata?.trendAcceleration,
      a.metadata?.lifecycleConfidence,
      ...(String(a.analogName || a.name || a.title || '').match(/[-+]?\d+(?:\.\d+)?/g) || []),
      ...asArray(a.similarityDrivers).flatMap((text) => (String(text).match(/[-+]?\d+(?:\.\d+)?/g) || [])),
    ]),
    ...(Object.values(bundle.metadata?.deepResearch?.packProfiles || {})).flatMap((profile) => [
      profile.rowCount,
      profile.sourceRefCount,
      asArray(profile.sourceKinds).length,
      asArray(profile.subjectBindings).length,
      profile.kpiCoverage,
      profile.kpiMappedCount,
      profile.kpiObservationCount,
      profile.kpiGapCount,
    ]),
    bundle.metadata?.deepResearch?.dataDepthScore,
    bundle.metadata?.deepResearch?.causalChainScore,
    bundle.metadata?.deepResearch?.historicalContextScore,
    bundle.metadata?.deepResearch?.kpiRegistry?.coverage,
    bundle.metadata?.deepResearch?.kpiRegistry?.mappedCount,
    bundle.metadata?.deepResearch?.kpiRegistry?.definitionCount,
    bundle.metadata?.deepResearch?.kpiRegistry?.observationCount,
    bundle.metadata?.deepResearch?.kpiRegistry?.missingCount,
    bundle.metadata?.deepResearch?.kpiRegistry?.jobCount,
    bundle.metadata?.deepResearch?.gaps?.length || 0,
    ...(asArray(bundle.metadata?.deepResearch?.investmentReadiness?.marketValidation?.rows)).flatMap((row) => [
      row.sampleSize,
      row.relativeReturnPct,
      row.tStat,
      row.decisionGradeRowCount,
      row.screeningGradeRowCount,
      row.regimeSupportCount,
      row.regimeDistinctCount,
      row.regimeHorizonCount,
    ]),
    bundle.metadata?.deepResearch?.investmentReadiness?.marketValidation?.decisionGradeRowCount,
    bundle.metadata?.deepResearch?.investmentReadiness?.marketValidation?.screeningGradeRowCount,
    bundle.metadata?.deepResearch?.investmentReadiness?.marketValidation?.controlledRowCount,
    bundle.metadata?.deepResearch?.investmentReadiness?.marketValidation?.regimeSupportRowCount,
    bundle.metadata?.deepResearch?.investmentReadiness?.marketValidation?.maxSampleSize,
    bundle.metadata?.deepResearch?.investmentReadiness?.marketValidation?.maxAbsTStat,
    ...(asArray(bundle.metadata?.deepResearch?.packs?.issuerThesisPack?.cards)).flatMap((card) => [
      card.expectationSpreadPct,
      card.metadata?.expectationSpreadPct,
      ...(String(card.expectationBridge || card.metadata?.expectationBridge || '').match(/[-+]?\d+(?:\.\d+)?/g) || []),
      ...(String(card.valuationBridge || card.metadata?.valuationBridge || '').match(/[-+]?\d+(?:\.\d+)?/g) || []),
      ...(String(card.fundamentalBridge || card.metadata?.fundamentalBridge || '').match(/[-+]?\d+(?:\.\d+)?/g) || []),
      ...(String(card.marketBridge || card.metadata?.marketBridge || '').match(/[-+]?\d+(?:\.\d+)?/g) || []),
    ]),
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
  const ctx = bundle.metadata?.themeContext || {};
  for (const item of [
    ...asArray(ctx.peerSymbols?.positive),
    ...asArray(ctx.peerSymbols?.negative),
    ...asArray(ctx.regimeBySymbol),
  ]) {
    if (item?.symbol) tickers.add(String(item.symbol).toUpperCase());
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
      .replace(/\b(\d+)\s*-\s*(\d+)\b/g, '$1 $2')
      .replace(/\b\d{4}\/\d{2}\/\d{2}\b/g, ' ')
      .replace(/"[^"]*"/g, ' ')                // double-quoted titles
      .replace(/\b[A-Za-z][A-Za-z0-9_-]*\d+(?:\.\d+)+(?:[A-Za-z0-9_.-]*)\b/g, ' ') // product/model versions like V3.3
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
    ...(analysis.dataDepth || []),
    ...(analysis.causalChain || []),
    ...(analysis.historicalAnalogues || []),
    ...(analysis.evidenceSynthesis || []),
    ...(analysis.timeline || []),
    ...(analysis.marketTransmission || []),
    ...(analysis.scenarios || []),
    ...(analysis.risks || []),
    ...(analysis.analyticalAssessment || []),
    ...(analysis.decisionUse || []),
    ...(analysis.feedbackLearning || []),
    ...(analysis.analystConclusion || []),
    ...(analysis.alternativeExplanations || []),
    ...(analysis.informationGaps || []),
    ...(analysis.watchNext || []),
    ...(analysis.sourceQueries || []),
    ...(analysis.analystNotes || []),
    ...asArray(analysis.longFormSections).flatMap((section) => asArray(section.paragraphs)),
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

function normalizeClientMemoText(value = '') {
  return String(value || '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*\|/.test(line))
    .join('\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function markdownSection(markdown = '', heading = '') {
  const escaped = String(heading).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(markdown || '').match(new RegExp(`(?:^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i'));
  return match ? match[1].trim() : '';
}

function tokenSet(value = '') {
  return new Set(normalizeClientMemoText(value)
    .split(/\s+/)
    .filter((token) => token.length > 3 && !['this', 'that', 'with', 'from', 'should', 'would', 'could'].includes(token)));
}

function sectionSimilarity(a = '', b = '') {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size || 1;
  return intersection / union;
}

function repeatedClientPhrases(markdown = {}, minWords = 10) {
  const text = normalizeClientMemoText(markdown);
  const words = text.split(/\s+/).filter(Boolean);
  const seen = new Map();
  const repeats = [];
  for (let i = 0; i <= words.length - minWords; i += 1) {
    const phrase = words.slice(i, i + minWords).join(' ');
    if (phrase.length < 70) continue;
    const previous = seen.get(phrase) || 0;
    if (previous === 1) repeats.push(phrase);
    seen.set(phrase, previous + 1);
  }
  return repeats;
}

function phraseCount(value = '', pattern) {
  return (String(value || '').match(pattern) || []).length;
}

function sectionWordCount(markdown = '', heading = '') {
  return normalizeClientMemoText(markdownSection(markdown, heading)).split(/\s+/).filter(Boolean).length;
}

function sectionWordCountByKey(markdown = '', analysis = {}, key = '', fallbackHeading = '') {
  const section = asArray(analysis.longFormSections).find((item) => item.key === key);
  const heading = section?.title || fallbackHeading;
  if (heading) {
    const words = sectionWordCount(markdown, heading);
    if (words > 0) return { heading, words };
  }
  const directWords = asArray(section?.paragraphs)
    .map((paragraph) => paragraph.text || paragraph.label || paragraph.summary || paragraph.rationale || '')
    .join(' ');
  return {
    heading: heading || fallbackHeading || key,
    words: normalizeClientMemoText(directWords).split(/\s+/).filter(Boolean).length,
  };
}

function validateRenderedArtifacts(renderedArtifacts = {}, blockers, warnings, analysis = {}) {
  const startBlockerCount = blockers.length;
  const startWarningCount = warnings.length;
  const html = String(renderedArtifacts.html || '');
  const markdown = String(renderedArtifacts.markdown || '');
  if (!html || !markdown) {
    add(blockers, 'missing_rendered_artifact', 'Rendered HTML and Markdown artifacts are required for export validation.');
    return 0;
  }
  const combined = `${html}\n${markdown}`;
  const forbidden = [
    /\bnumeric detail\b/i,
    /\bNaN\b/,
    /\bundefined\b/i,
    /\bnull%?\b/i,
    /\[object Object\]/i,
    /\bInvalid Date\b/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(combined)) {
      add(blockers, 'render_placeholder_leak', `Rendered report contains placeholder or invalid value: ${pattern}`);
    }
  }
  const adaptiveSections = asArray(analysis.narrativeStructure?.sections || analysis.narrativePlan?.narrativeStructure?.sections)
    .filter((section) => section?.title);
  const requiredSections = adaptiveSections.length
    ? adaptiveSections.map((section) => [section.title])
    : [
    ['Executive Judgment', 'Executive View', 'Executive Brief'],
    ['Core View', 'Working Thesis', 'Context and What Changed'],
    ['Context', 'Context and What Changed'],
    ['What Changed', 'Context and What Changed'],
    ['Evidence Assessment', 'Research Depth'],
    ['Economic Mechanism', 'Causal Chain'],
    ['Historical Analogues', 'Evidence Assessment'],
    ['Market Implication', 'Market and Transmission', 'Market Implication and Scenarios'],
    ['Scenario Matrix', 'Market Implication and Scenarios'],
    ['Counter-Thesis', 'Alternative Explanations', 'Counter-Thesis, Risks, and Caveats'],
    ['Risks and Counterpoints', 'Counter-Thesis, Risks, and Caveats'],
    ['Watch Next', 'What to Watch and Research Agenda'],
    ['What Would Change Our Mind', 'Decision Use', 'What to Watch and Research Agenda'],
    ['Research Agenda', 'What to Watch and Research Agenda'],
    ['Analyst Conclusion'],
    ];
  for (const alternatives of requiredSections) {
    if (!alternatives.some((section) => html.includes(`<h2>${section}</h2>`))) {
      add(blockers, 'html_missing_required_section', `Rendered HTML is missing section: ${alternatives[0]}`);
    }
    if (!alternatives.some((section) => markdown.includes(`## ${section}`))) {
      add(blockers, 'markdown_missing_required_section', `Rendered Markdown is missing section: ${alternatives[0]}`);
    }
  }
  const clientForbidden = [
    /\bevidence-backed\b/i,
    /\brefs\s+\d+\b/i,
    /\bsource queue\b/i,
    /\bresearch pack(?:s)?\b/i,
    /\bMetric Ledger\b/i,
    /\bQuery Manifest\b/i,
    /\bKPI spine\b/i,
    /\b(?:fundamentalPack|filingPack|transcriptPack|industryPack|marketPack|causalPack|historicalAnalogPack)\b/i,
    /\bartifact\s+[SABCD]\b/i,
    /\bfinal\s+[SABCD]\b/i,
    /\bstatus\s+warning\b/i,
    /\bevent intensity was\s+0\b/i,
    /\bmarket reaction row\(s\) are attached\b/i,
    /\bHawkes-profile analogue\s+\d+/i,
    /\bOn \d{4}-\d{2}-\d{2},\s+"/i,
    /\bclaim:[A-Z0-9_-]+/i,
    /\bmetric:[A-Z0-9_-]+/i,
    /\bevidence:[A-Z0-9_-]+/i,
    /\bfigure:[A-Z0-9_-]+/i,
    /\bcaveat:[A-Z0-9_-]+/i,
  ];
  for (const pattern of clientForbidden) {
    if (pattern.test(`${html}\n${markdown}`)) {
      add(blockers, 'client_memo_audit_leak', `Client memo leaks audit/log notation: ${pattern}`);
    }
  }
  const combinedWatchResearch = markdownSection(markdown, 'What to Watch and Research Agenda');
  const watchNextRaw = markdownSection(markdown, 'Watch Next');
  const researchAgendaRaw = markdownSection(markdown, 'Research Agenda');
  const watchNext = combinedWatchResearch ? '' : watchNextRaw;
  const researchAgenda = combinedWatchResearch ? '' : researchAgendaRaw;
  const counterThesis = markdownSection(markdown, 'Counter-Thesis');
  const risks = markdownSection(markdown, 'Risks and Counterpoints');
  if (watchNextRaw && researchAgendaRaw && sectionSimilarity(watchNextRaw, researchAgendaRaw) > 0.72) {
    add(blockers, 'duplicate_memo_sections', 'Watch Next and Research Agenda overlap too much; monitoring language must be separate from executable research tasks.');
  }
  if (!markdownSection(markdown, 'Counter-Thesis, Risks, and Caveats') && counterThesis && risks && sectionSimilarity(counterThesis, risks) > 0.72) {
    add(blockers, 'duplicate_memo_sections', 'Counter-Thesis and Risks overlap too much; alternative interpretation must be separate from method/data risks.');
  }
  const mentionBudgets = [
    ['core_thesis_repeat', /\bnarrative rotation, not thesis failure\b/gi, 1],
    ['full_driver_list_repeat', /\bcapex, cloud revenue, accelerator orders, data-center utilization, and power-demand proxies\b/gi, 1],
    ['direct_transcript_gap_repeat', /\bdirect call-transcript evidence is still missing\b/gi, 2],
    ['scope_warning_repeat', /\bresearch-prioritization memo, not a final investment memo\b/gi, 1],
  ];
  for (const [type, pattern, max] of mentionBudgets) {
    const count = phraseCount(markdown, pattern);
    if (count > max) {
      add(blockers, 'mention_budget_exceeded', `Client memo repeats ${type} ${count} times; maximum is ${max}.`);
    }
  }
  if (combinedWatchResearch) {
    if (!/\b(watch|monitor|external confirmation)\b/i.test(combinedWatchResearch)) {
      add(blockers, 'section_contract_violation', 'Combined watch/research section must preserve external monitoring language.');
    }
    if (!/\b(collect|pull|extract|recompute|backfill|task|run|validate)\b/i.test(combinedWatchResearch)) {
      add(blockers, 'section_contract_violation', 'Combined watch/research section must include executable collection or validation tasks.');
    }
  } else {
    if (/\b(collect|pull|extract|recompute|backfill|task)\b/i.test(watchNext)) {
      add(blockers, 'section_contract_violation', 'Watch Next contains executable task language; move collection work to Research Agenda.');
    }
    if (researchAgenda && !/\b(collect|pull|extract|recompute|backfill|task|run|validate)\b/i.test(researchAgenda)) {
      add(blockers, 'section_contract_violation', 'Research Agenda must contain executable collection or validation tasks.');
    }
  }
  if (markdownSection(markdown, 'Context and What Changed')) {
    const longFormMinimums = [
      ['executiveJudgment', 'Executive Judgment', 120],
      ['contextAndWhatChanged', 'Context and What Changed', 180],
      ['evidenceAssessment', 'Evidence Assessment', 180],
      ['economicMechanism', 'Economic Mechanism', 180],
      ['marketImplicationAndScenarios', 'Market Implication and Scenarios', 160],
      ['counterRisksCaveats', 'Counter-Thesis, Risks, and Caveats', 150],
      ['watchAndResearchAgenda', 'What to Watch and Research Agenda', 150],
    ];
    for (const [key, fallbackHeading, minimum] of longFormMinimums) {
      const { heading, words } = sectionWordCountByKey(markdown, analysis, key, fallbackHeading);
      if (words < minimum) {
        add(blockers, 'long_form_section_too_short', `${heading} is too short for long-form memo mode: ${words}/${minimum} words.`);
      }
    }
  }
  const repeatedPhrases = repeatedClientPhrases(markdown);
  if (repeatedPhrases.length) {
    add(blockers, 'repeated_client_phrase', 'Client memo repeats long phrases across sections.', { phrase: repeatedPhrases[0] });
  }
  if (renderedArtifacts.auditAppendixHtml) {
    const audit = String(renderedArtifacts.auditAppendixHtml || '');
    for (const section of ['Appendix: Audit Trail', 'Metric Ledger', 'Evidence Base', 'Validation', 'Query Manifest']) {
      if (!audit.includes(section)) {
        add(blockers, 'audit_appendix_missing_required_section', `Audit appendix is missing section: ${section}`);
      }
    }
  }
  if (!/<img\b|figure-placeholder/.test(html)) {
    add(warnings, 'html_without_figure_surface', 'Rendered HTML does not expose a figure surface.');
  }
  if (blockers.length > startBlockerCount) return 0;
  if (warnings.length > startWarningCount) return 0.85;
  return 1;
}

function metricValue(bundle, metricId) {
  return Number(asArray(bundle.metrics).find((metric) => metric.metricId === metricId)?.value);
}

function closeNumber(a, b, epsilon = 0.001) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= epsilon;
}

function validateDeepResearchContract(bundle, blockers, warnings) {
  const deep = bundle.metadata?.deepResearch;
  if (!deep) return;
  const packs = deep.packs || {};
  const gaps = asArray(deep.gaps);
  const causalEdges = asArray(packs.causalPack?.edges);
  const analogues = asArray(packs.historicalAnalogPack?.analogues);
  const dataDepth = Number(deep.dataDepthScore);
  if (!closeNumber(metricValue(bundle, 'MET-DEEP-DATA-DEPTH'), dataDepth)) {
    add(blockers, 'deep_metric_mismatch', 'MET-DEEP-DATA-DEPTH does not match metadata.deepResearch.dataDepthScore.');
  }
  if (!closeNumber(metricValue(bundle, 'MET-DEEP-GAPS'), gaps.length)) {
    add(blockers, 'deep_metric_mismatch', 'MET-DEEP-GAPS does not match metadata.deepResearch.gaps length.');
  }
  if (!closeNumber(metricValue(bundle, 'MET-DEEP-CAUSAL-EDGES'), causalEdges.length)) {
    add(blockers, 'deep_metric_mismatch', 'MET-DEEP-CAUSAL-EDGES does not match causal edge count.');
  }
  if (!closeNumber(metricValue(bundle, 'MET-DEEP-HISTORICAL-ANALOGS'), analogues.length)) {
    add(blockers, 'deep_metric_mismatch', 'MET-DEEP-HISTORICAL-ANALOGS does not match historical analogue count.');
  }
  const kpiCoverageMetric = asArray(bundle.metrics).find((metric) => metric.metricId === 'MET-DEEP-KPI-COVERAGE');
  if (kpiCoverageMetric && !closeNumber(Number(kpiCoverageMetric.value), Number(deep.kpiRegistry?.coverage ?? 0))) {
    add(blockers, 'deep_metric_mismatch', 'MET-DEEP-KPI-COVERAGE does not match metadata.deepResearch.kpiRegistry.coverage.');
  }

  const profiles = deep.packProfiles || {};
  for (const [packName, profile] of Object.entries(profiles)) {
    const isAvailable = String(profile.status || packs[packName]?.status || '').toLowerCase() === 'available';
    const rowCount = Number(profile.rowCount || 0);
    const sourceKinds = asArray(profile.sourceKinds);
    if (isAvailable && rowCount <= 0 && !['marketPack', 'feedbackPack'].includes(packName)) {
      add(blockers, 'deep_available_pack_without_rows', `${packName} is marked available without backing rows.`);
    }
    if (isAvailable && rowCount > 0 && sourceKinds.length === 0) {
      add(blockers, 'deep_pack_without_provenance', `${packName} is marked available without source provenance.`);
    }
  }

  for (const [index, edge] of causalEdges.entries()) {
    if (!edge.sourceNode || !edge.targetNode || !edge.mechanism || !edge.edgeType) {
      add(blockers, 'deep_causal_edge_incomplete', 'Causal edge is missing source, target, mechanism, or edgeType.', { index });
    }
    const isHypothesis = /hypothesis|graph|relation/i.test(`${edge.edgeType} ${edge.mechanism}`);
    const hasCaveat = asArray(edge.caveatIds).length > 0 || asArray(bundle.caveats).some((caveat) => /causality|hypothesis/i.test(`${caveat.type} ${caveat.text}`));
    if (isHypothesis && !hasCaveat) {
      add(blockers, 'deep_causal_hypothesis_without_caveat', 'Graph-derived causal hypotheses must carry a caveat.', { index });
    }
  }

  for (const [index, analogue] of analogues.entries()) {
    const required = [
      analogue.analogName,
      analogue.period,
      asArray(analogue.similarityDrivers).length,
      asArray(analogue.differences).length,
      analogue.marketOutcome,
      analogue.whatBrokeTheAnalogy,
      asArray(analogue.invalidatingIndicators).length,
    ];
    if (required.some((item) => !item)) {
      add(blockers, 'deep_historical_analogue_incomplete', 'Historical analogue is missing drivers, differences, outcome, break condition, or invalidators.', { index });
    }
  }

  if (Number(deep.limitations?.transcriptProxyCount || 0) > 0) {
    const hasProxyCaveat = asArray(bundle.caveats).some((caveat) => /transcript.*proxy|management-commentary context/i.test(`${caveat.type} ${caveat.text}`));
    if (!hasProxyCaveat) {
      add(blockers, 'deep_transcript_proxy_without_caveat', 'Transcript proxy evidence must be explicitly caveated.');
    } else {
      add(warnings, 'deep_transcript_proxy', 'Transcript pack uses SEC/filing proxy evidence until a call transcript adapter is available.');
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
  const exportIntegrity = options.renderedArtifacts
    ? validateRenderedArtifacts(options.renderedArtifacts, blockers, warnings, options.analysis)
    : undefined;

  const hasStale = asArray(bundle.dataFreshness).some((item) => ['stale', 'degraded'].includes(String(item.freshnessStatus || '').toLowerCase()));
  const hasStaleCaveat = asArray(bundle.caveats).some((item) => /stale|freshness|degraded/i.test(`${item.type} ${item.text}`));
  if (hasStale && !hasStaleCaveat) add(blockers, 'stale_without_caveat', 'Stale or degraded data is present without a disclosure caveat.');

  const lowDiversity = Boolean(bundle.sourceSummary?.lowDiversityFlag || bundle.sourceSummary?.low_diversity_flag);
  const hasDiversityCaveat = asArray(bundle.caveats).some((item) => /source|diversity|concentration/i.test(`${item.type} ${item.text}`));
  if (lowDiversity && !hasDiversityCaveat) add(blockers, 'low_source_diversity_without_caveat', 'Low source diversity is present without a caveat.');

  validateAnalysisReferences(bundle, options.analysis, blockers);
  validateAnalysisText(bundle, options.analysis, blockers, warnings);
  validateAdaptiveNarrativeStructure(options.analysis, blockers);
  validateRemediationPath(bundle, options.analysis, blockers);
  validateDeepResearchContract(bundle, blockers, warnings);

  let validation = {
    ok: blockers.length === 0,
    status: blockers.length ? 'blocked' : warnings.length ? 'warning' : 'passed',
    generatedAt: new Date().toISOString(),
    blockers,
    warnings,
    ...(exportIntegrity == null ? {} : { exportIntegrity }),
  };
  const quality = computeReportQuality(bundle, validation, options.analysis);
  if (!quality.publishable && !blockers.length) {
    const publishabilityWarnings = asArray(quality.publishabilityReasons).map((reason) => ({
      type: 'not_publishable',
      message: reason,
    }));
    validation = {
      ...validation,
      status: 'warning',
      warnings: [...warnings, ...publishabilityWarnings],
    };
  }
  return {
    ...validation,
    quality: computeReportQuality(bundle, validation, options.analysis),
  };
}
