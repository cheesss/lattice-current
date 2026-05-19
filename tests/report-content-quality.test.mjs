import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSampleReportBundle, buildThemeReportBundle, REPORT_TYPES } from '../scripts/_shared/report-evidence-bundle.mjs';
import { planReportFigures } from '../scripts/_shared/report-chart-planner.mjs';
import { generateDeterministicAnalystDraft } from '../scripts/_shared/report-llm-analyst.mjs';
import {
  applyAdaptiveNarrativeStructureToPlan,
  buildNarrativeBlueprint,
  renderClientMemoFromBlueprint,
  validateNarrativeStructure,
} from '../scripts/_shared/report-narrative-plan.mjs';
import { renderReportHtml, renderReportMarkdown } from '../scripts/_shared/report-compiler.mjs';
import { buildSourceQueryDrafts } from '../scripts/_shared/report-artifacts.mjs';
import { buildSignalCards } from '../scripts/_shared/report-signal-cards.mjs';
import { validateReportBundle } from '../scripts/_shared/report-validator.mjs';
import { classifyCrossThemeEvidence, computeCrossThemeDiscoveryQuality, crossThemeEvidenceTerms } from '../scripts/_shared/cross-theme-discovery-quality.mjs';
import {
  adjacentResearchRowFitsBundle,
  attachDeepResearchPack,
  buildEvidenceClassExtractionRows,
  filterVisibleResearchRows,
} from '../scripts/_shared/report-deep-research-pack.mjs';

const REQUIRED_SECTIONS = [
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
  'analystConclusion',
  'watchNext',
];

function hasRefs(block) {
  return ['claimIds', 'evidenceIds', 'metricIds', 'figureIds', 'caveatIds']
    .some((key) => Array.isArray(block[key]) && block[key].length > 0);
}

function collectAnalysisText(analysis) {
  return Object.entries(analysis)
    .filter(([, value]) => Array.isArray(value))
    .flatMap(([section, blocks]) => blocks.map((block) => ({
      section,
      text: String(block.text || block.label || ''),
    })));
}

const MECHANICAL_NARRATIVE_PATTERN = /\b(theme_trend_aggregates|stock_sensitivity_matrix|canonical_events|n_controls|sample_size|avg_return|return_vol|hit_rate|regime_multiplier|source_diversity|evidence_count|seedSimilarity|evidence_quality|validation_status|evidence ledger|metric ledger|market-link row|Sensitivity row|database|standalone recommendation|long proxy|short \/ hedge|KPI spine|fundamentalPack|filingPack|transcriptPack|industryPack|marketPack)\b/i;

function buildTypedThemeBundle() {
  return buildThemeReportBundle({
    theme: {
      key: 'grid-power',
      label: 'Grid Power',
      yoy: 42,
      acceleration: 18,
      sourceDiversity: 0.67,
    },
    metrics: [
      { metricId: 'MET-THEME-ARTICLES', name: 'article_count', value: 18, unit: 'articles' },
      { metricId: 'MET-THEME-RECENT-EVIDENCE', name: 'recent_evidence_items', value: 4, unit: 'items' },
      { metricId: 'MET-EVENT-TIMELINE-COUNT', name: 'event_count', value: 1, unit: 'events' },
      { metricId: 'MET-SUBTOPIC-COUNT', name: 'subtopic_count', value: 1, unit: 'subtopics' },
      { metricId: 'MET-KNOWLEDGE-DEGREE', name: 'knowledge_degree', value: 1, unit: 'links' },
    ],
    evidence: [
      { evidenceId: 'EVID-001', kind: 'news_article', publisher: 'Sample Grid Source', title: 'Utilities flag transformer demand', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-EDGE-edge-1', kind: 'knowledge_edge', publisher: 'Lattice Graph', title: 'Grid power requires transformers', freshnessStatus: 'fresh' },
    ],
    metadata: {
      themeContext: {
        subtopics: [{ theme_label: 'Transformer capacity', parent_theme: 'Grid Power', lifecycle_stage: 'accelerating', rank_in_parent: 2, momentum_score: 64, acceleration: 18 }],
        peerSymbols: { counts: { positive: 1, negative: 0, total: 1 }, positive: [{ symbol: 'PWR' }], negative: [] },
        knowledgeConnections: [{ edgeId: 'edge-1', entityName: 'Grid transformers', entityType: 'component', relationType: 'requires', evidenceCount: 3, sourceDiversity: 0.67, confidence: 0.82 }],
        regimeBySymbol: [{ symbol: 'PWR', regimes: [{ regime: 'inflation', horizon: '7d', regime_multiplier: 1.4, sample_size: 32 }] }],
        events: [{ eventId: 'EVT-grid-1', eventDate: '2026-05-01T00:00:00.000Z', title: 'Transformer demand pressure broadens', articleCount: 12, sourceCount: 4, hawkesIntensity: 0.81, isSurge: true }],
      },
      diagnosticSignals: { hasAggregateOrphan: true },
    },
  });
}

function withSymbolSensitivity(bundle) {
  return {
    ...bundle,
    metadata: {
      ...bundle.metadata,
      sensitivity: {
        symbol: 'RKLB',
        theme: 'space infrastructure',
        sensitivity_zscore: 1.3,
        sample_size: 31,
        avg_return: 6.1,
        baseline_return: 1.2,
        hit_rate: 0.58,
        return_vol: 0.22,
        updated_at: '2026-05-01T00:00:00.000Z',
        horizon: '7d',
      },
    },
  };
}

function withCrossThemeCandidate(bundle) {
  return {
    ...bundle,
    metadata: {
      ...bundle.metadata,
      candidate: {
        supplier_name: 'Linde cryogenic cooling',
        themes: ['space', 'fusion-energy'],
        score: 0.82,
        status: 'needs_evidence',
        lane: 'needs_evidence',
        evidence_summary: { evidenceQuality: 0.54, sourceDiversity: 0.25, seedSimilarity: 0.31 },
      },
    },
  };
}

function withDeepResearch(bundle) {
  return {
    ...bundle,
    claims: [
      ...bundle.claims,
      { claimId: 'CLM-DEEP-RESEARCH', canonicalText: 'Deep research context is attached for the report subject.', supportingMetricIds: ['MET-DEEP-DATA-DEPTH'], confidenceLevel: 'low', validationStatus: 'candidate' },
    ],
    metrics: [
      ...bundle.metrics,
      { metricId: 'MET-DEEP-DATA-DEPTH', name: 'data_depth_score', value: 0.42, unit: 'score' },
      { metricId: 'MET-DEEP-GAPS', name: 'structured_gap_count', value: 1, unit: 'gaps' },
      { metricId: 'MET-DEEP-CAUSAL-EDGES', name: 'causal_edge_count', value: 1, unit: 'edges' },
      { metricId: 'MET-DEEP-HISTORICAL-ANALOGS', name: 'historical_analog_count', value: 1, unit: 'analogues' },
      { metricId: 'MET-DEEP-FEEDBACK', name: 'feedback_rows', value: 0, unit: 'items' },
      { metricId: 'MET-DEEP-KPI-COVERAGE', name: 'kpi_registry_coverage', value: 0.5, unit: 'score' },
    ],
    metadata: {
      ...bundle.metadata,
      deepResearch: {
        packs: {
          causalPack: { status: 'available', edges: [{ sourceNode: 'Grid Power', targetNode: 'PWR', mechanism: 'Grid Power may transmit through transformer demand toward PWR', edgeType: 'causal_hypothesis' }] },
          historicalAnalogPack: { status: 'available', analogues: [{ analogName: 'Prior grid equipment cycle', period: '2019 to 2021', similarityDrivers: ['similar capacity pressure'], differences: ['different macro regime'] }] },
          feedbackPack: { status: 'gap', rows: [] },
        },
        gaps: [{ packName: 'filingPack', query: 'Grid Power filing capacity guidance', reason: 'No filing evidence is attached.' }],
        kpiRegistry: {
          version: 'generic-kpi-collection-v1',
          coverage: 0.5,
          mappedCount: 4,
          observationCount: 2,
          missingCount: 2,
          gaps: [
            {
              themeId: 'grid-power',
              themeLabel: 'Grid Power',
              kpiKey: 'capacity_buildout_proxy',
              displayName: 'Capacity buildout proxy',
              dataPack: 'industryPack',
              severity: 'high',
              query: 'Grid Power Capacity buildout proxy industry evidence',
              reason: 'No fresh generic KPI observation is available for Capacity buildout proxy.',
            },
          ],
        },
      },
    },
  };
}

function withGenericIssuerThesis(bundle) {
  const repeatedLegacyRole = 'Conflict-exposed issuer; validate through revenue, margin, guidance, and market sensitivity';
  const cards = ['BDRY', 'FRO', 'NVDA', 'SMH', 'AMD'].map((symbol) => ({
    id: `issuer-thesis-${symbol}`,
    symbol,
    role: repeatedLegacyRole,
    thesisUse: 'research_prioritization',
    dataFlags: {
      hasFundamentals: symbol === 'NVDA' || symbol === 'AMD',
      hasValuation: symbol === 'BDRY' || symbol === 'NVDA',
      hasConsensus: symbol === 'NVDA' || symbol === 'AMD',
      hasIssuerCommentary: false,
      hasIssuerOperatingKpi: false,
      hasMarketReaction: symbol === 'BDRY' || symbol === 'FRO',
    },
  }));
  return {
    ...bundle,
    metadata: {
      ...bundle.metadata,
      deepResearch: {
        investmentReadiness: {
          tier: 'signal_triage',
          blockers: [
            'theme ontology critical KPI coverage 25%; missing Operating driver evidence, Fundamental and market bridge',
          ],
        },
        packs: {
          issuerThesisPack: {
            status: 'available',
            coverage: 0.42,
            cards,
            missingConsensusSymbols: ['BDRY', 'FRO', 'SMH'],
            missingValuationSymbols: ['FRO'],
          },
        },
      },
    },
  };
}

test('deterministic analyst draft produces a substantive evidence-bound report outline', () => {
  for (const type of Object.values(REPORT_TYPES)) {
    const bundle = planReportFigures(buildSampleReportBundle(type, { subject: `Quality ${type}` }));
    const analysis = generateDeterministicAnalystDraft(bundle);
    assert.equal(analysis.keyJudgments.length >= 3, true, `${type}: expected multiple key judgments`);
    assert.equal(analysis.scenarios.length >= 3, true, `${type}: expected base/stronger/weaker scenarios`);
    assert.equal(analysis.risks.length >= 2, true, `${type}: expected risk and counterpoint blocks`);
    for (const section of REQUIRED_SECTIONS) {
      assert.equal(Array.isArray(analysis[section]), true, `${type}: ${section} should be an array`);
      assert.equal(analysis[section].length > 0, true, `${type}: ${section} should not be empty`);
      assert.equal(analysis[section].every(hasRefs), true, `${type}: ${section} blocks should carry references`);
    }
    const validation = validateReportBundle(bundle, { analysis });
    assert.equal(validation.ok, true, `${type}: ${JSON.stringify(validation.blockers)}`);
  }
});

test('analyst narrative avoids raw data-log wording in main report sections', () => {
  const bundles = [
    planReportFigures(buildTypedThemeBundle()),
    planReportFigures(withSymbolSensitivity(buildSampleReportBundle(REPORT_TYPES.SYMBOL, { subject: 'Rocket Lab exposure signal' }))),
    planReportFigures(withCrossThemeCandidate(buildSampleReportBundle(REPORT_TYPES.CROSS_THEME, { subject: 'Linde cryogenic cooling' }))),
    planReportFigures(withDeepResearch(buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'Deep Grid Power' }))),
  ];
  for (const bundle of bundles) {
    const analysis = generateDeterministicAnalystDraft(bundle);
    const offenders = collectAnalysisText(analysis)
      .filter(({ text }) => MECHANICAL_NARRATIVE_PATTERN.test(text));
    assert.deepEqual(offenders, [], `${bundle.reportType}: ${JSON.stringify(offenders)}`);
  }
});

test('cross-theme discovery memo explains bottleneck insight rather than score log', () => {
  const bundle = planReportFigures({
    ...buildSampleReportBundle(REPORT_TYPES.CROSS_THEME, { subject: 'Solid rocket motor capacity' }),
    metadata: {
      candidate: {
        connector_name: 'solid rocket motor capacity',
        themes: ['defense-industrial', 'space'],
        score: 0.68,
        status: 'new',
        lane: 'needs_evidence',
        evidence_summary: {
          evidenceQuality: 0.22,
          sourceDiversity: 0.18,
          seedSimilarity: 0.08,
          discoveryFit: 0.91,
          constraintCriticality: 0.94,
          geopoliticalRelevance: 0.82,
          discovery: {
            role: 'constraint',
            discoveryFit: 0.91,
            constraintScore: 0.94,
            geopoliticalRelevance: 0.82,
            mechanism: 'missile and launch demand both depend on qualified motor production capacity',
            whyNow: 'procurement and launch cadence signals can turn motor capacity into a shared limiting variable',
            triggerTerms: ['solid rocket motor', 'interceptor production', 'launch cadence'],
            sourceQueries: ['solid rocket motor capacity missile launch supplier backlog'],
          },
        },
      },
    },
  });
  const analysis = generateDeterministicAnalystDraft(bundle);
  const text = collectAnalysisText(analysis).map((block) => block.text).join(' ');

  assert.match(text, /shared dependency|bottleneck thesis|limiting variable/i);
  assert.match(text, /capacity|substitute|supplier|technical/i);
  assert.match(text, /procurement and launch cadence/i);
  assert.doesNotMatch(text, /Connector score is/i);
  assert.equal(analysis.sourceQueries.some((query) => query.metadata?.gapKind === 'cross_theme_discovery'), true);
  assert.equal(analysis.sourceQueries.every((query) => query.metadata?.desiredEvidenceClass), true);
  assert.equal(analysis.sourceQueries.some((query) => query.metadata?.desiredEvidenceClass === 'supplier_capacity'), true);
});

test('cross-theme rendered memo uses bottleneck framing instead of generic theme framing', () => {
  const base = buildSampleReportBundle(REPORT_TYPES.CROSS_THEME, { subject: 'Solid rocket motor capacity' });
  const bundle = planReportFigures({
    ...base,
    evidence: [
      ...base.evidence,
      {
        evidenceId: 'EVID-SRM-DIRECT',
        kind: 'external-rss',
        evidenceGrade: 'direct',
        publisher: 'Business Wire',
        title: 'Pentagon Awards Systima, Part of Karman Space & Defense, $5 Million to Expand Solid Rocket Motor Nozzle Production Capacity',
        freshnessStatus: 'fresh',
      },
    ],
    metadata: {
      candidate: {
        connector_name: 'solid rocket motor capacity',
        themes: ['defense-industrial', 'space'],
        score: 0.68,
        status: 'new',
        lane: 'needs_evidence',
        evidence_summary: {
          evidenceQuality: 0.22,
          sourceDiversity: 0.18,
          seedSimilarity: 0.08,
          discoveryFit: 0.91,
          constraintCriticality: 0.94,
          geopoliticalRelevance: 0.82,
          discovery: {
            role: 'constraint',
            mechanism: 'missile replenishment and launch cadence both depend on qualified motor production capacity',
            whyNow: 'procurement and launch cadence signals can turn motor capacity into a shared limiting variable',
            triggerTerms: ['solid rocket motor', 'interceptor production', 'launch cadence'],
            sourceQueries: ['solid rocket motor capacity missile launch supplier backlog'],
          },
        },
      },
    },
  });
  const analysis = generateDeterministicAnalystDraft(bundle);
  const markdown = renderReportMarkdown(bundle, { analysis });

  assert.match(markdown, /Shared Bottleneck Candidate Across Defense-?Industrial and Space/i);
  assert.match(markdown, /cross-theme constraint discovery candidate/i);
  assert.match(markdown, /shared dependency question/i);
  assert.match(markdown, /Pentagon Awards Systima/i);
  assert.match(markdown, /capacity.*supplier concentration.*technical qualification.*substitution.*procurement/i);
  assert.doesNotMatch(markdown, /Possible Narrative Rotation|Thesis Failure|fragmented attention/i);
});

test('cross-theme report exposes discovery readiness separately from investment readiness', () => {
  const base = buildSampleReportBundle(REPORT_TYPES.CROSS_THEME, { subject: 'Solid rocket motor capacity' });
  const bundle = planReportFigures({
    ...base,
    evidence: [
      ...base.evidence,
      {
        evidenceId: 'EVID-SRM-DIRECT',
        kind: 'external-rss',
        evidenceGrade: 'direct',
        publisher: 'Business Wire',
        title: 'Pentagon Awards Systima, Part of Karman Space & Defense, $5 Million to Expand Solid Rocket Motor Nozzle Production Capacity',
        freshnessStatus: 'fresh',
      },
      {
        evidenceId: 'EVID-XBOW',
        kind: 'external-rss',
        evidenceGrade: 'indirect',
        publisher: 'PR Newswire',
        title: "X-Bow Readies Nation's Newest Solid Rocket Motor Facility for Production",
        freshnessStatus: 'fresh',
      },
      {
        evidenceId: 'EVID-FACTORY',
        kind: 'external-rss',
        evidenceGrade: 'indirect',
        publisher: 'Manufacturing Today',
        title: 'Aerospace subsidiary picks Virginia for $500M solid rocket motor factory',
        freshnessStatus: 'fresh',
      },
      {
        evidenceId: 'EVID-MARKET',
        kind: 'external-rss',
        evidenceGrade: 'indirect',
        publisher: 'Market Research',
        title: 'Solid Rocket Motor Market Size, Share and Growth Forecast by 2034',
        freshnessStatus: 'fresh',
      },
      {
        evidenceId: 'EVID-NOISE',
        kind: 'calculated',
        evidenceGrade: 'calculated',
        publisher: 'article',
        title: 'Google Cloud says growth was capacity constrained',
        freshnessStatus: 'fresh',
      },
    ],
    sourceSummary: { distinctSources: 4, sourceDiversityScore: 1, lowDiversityFlag: false },
    metadata: {
      candidate: {
        connector_name: 'solid rocket motor capacity',
        themes: ['defense-industrial', 'space'],
        score: 0.72,
        status: 'new',
        lane: 'needs_evidence',
        evidence_summary: {
          sourceQueryEvidenceCount: 3,
          directEvidenceCount: 1,
          sourceDiversityRaw: 4,
          evidenceQuality: 0.72,
          sourceDiversity: 1,
          seedSimilarity: 0,
          novelty: 1,
          discoveryFit: 0.98,
          constraintCriticality: 0.96,
          geopoliticalRelevance: 0.3,
          discovery: {
            role: 'constraint',
            mechanism: 'missile replenishment and launch cadence both depend on qualified motor production capacity',
            triggerTerms: ['solid rocket motor', 'interceptor production', 'launch vehicle', 'energetic materials'],
            sourceQueries: [
              '"solid rocket motor" "production capacity" missile interceptor Aerojet Northrop backlog',
              '"solid rocket motor" "qualified supplier" energetic materials missile production',
            ],
          },
        },
      },
      deepResearch: {
        investmentReadiness: {
          tier: 'signal_triage',
          blockers: [
            'theme ontology critical KPI coverage 0%; missing Defense backlog',
            'direct issuer management-commentary coverage 0/3 is below ontology threshold',
          ],
          sourceDiversity: 1,
          availableCorePackCount: 5,
          requiredCorePackCount: 4,
          sampleAdequacy: 'cross_theme_discovery',
          directManagementCommentarySymbolCount: 0,
          requiredTranscriptSymbolCount: 3,
          ontologyCoverage: {
            ontologyKey: 'cross_theme_combined',
            requiredKpiCoverage: 0,
            investmentCriticalGapCount: 8,
            issuerCommentaryCoverage: 0,
          },
        },
      },
    },
  });
  const analysis = generateDeterministicAnalystDraft(bundle);
  const html = renderReportHtml(bundle, { analysis });
  const validation = validateReportBundle(bundle, { analysis, renderedArtifacts: { html } });

  assert.equal(['C', 'D'].includes(validation.quality.investmentReadinessQuality.grade), true);
  assert.equal(validation.quality.investmentReadiness?.tier, 'signal_triage');
  assert.equal(['evidence_backed_bottleneck_candidate', 'review_ready_bottleneck'].includes(validation.quality.crossThemeDiscoveryQuality.tier), true);
  assert.equal(validation.quality.productTier, validation.quality.crossThemeDiscoveryQuality.tier);
  assert.match(html, /evidence tier/i);
  assert.match(html, /evidence-supported research candidate|review-ready evidence tier/i);
  assert.doesNotMatch(html, /bottleneck readiness/i);
});

test('cross-theme memo explains non-obviousness and keeps noisy deep-pack evidence out of the body', () => {
  const base = buildSampleReportBundle(REPORT_TYPES.CROSS_THEME, { subject: 'Solid rocket motor capacity' });
  const bundle = planReportFigures({
    ...base,
    evidence: [
      ...base.evidence,
      {
        evidenceId: 'EVID-SRM-DIRECT',
        kind: 'external-rss',
        evidenceGrade: 'direct',
        publisher: 'Business Wire',
        title: 'Pentagon Awards Systima, Part of Karman Space & Defense, $5 Million to Expand Solid Rocket Motor Nozzle Production Capacity',
        freshnessStatus: 'fresh',
      },
      {
        evidenceId: 'EVID-XBOW',
        kind: 'external-rss',
        evidenceGrade: 'indirect',
        publisher: 'PR Newswire',
        title: "X-Bow Readies Nation's Newest Solid Rocket Motor Facility for Production",
        freshnessStatus: 'fresh',
      },
      {
        evidenceId: 'EVID-NOISE',
        kind: 'calculated',
        evidenceGrade: 'calculated',
        publisher: 'article',
        title: 'Google Cloud says growth was capacity constrained',
        freshnessStatus: 'fresh',
      },
    ],
    metadata: {
      candidate: {
        connector_name: 'solid rocket motor capacity',
        themes: ['defense-industrial', 'space'],
        evidence_summary: {
          evidenceQuality: 0.72,
          sourceDiversity: 1,
          sourceQueryEvidenceCount: 2,
          directEvidenceCount: 1,
          sourceDiversityRaw: 3,
          seedSimilarity: 0,
          discoveryFit: 0.98,
          constraintCriticality: 0.96,
          discovery: {
            role: 'constraint',
            mechanism: 'missile replenishment and launch cadence both depend on qualified motor production capacity',
            triggerTerms: ['solid rocket motor', 'interceptor production', 'launch vehicle', 'energetic materials'],
            sourceQueries: ['solid rocket motor capacity missile launch supplier backlog'],
          },
        },
      },
    },
  });
  const markdown = renderReportMarkdown(bundle, { analysis: generateDeterministicAnalystDraft(bundle) });

  assert.match(markdown, /Why This Is Non-Obvious/i);
  assert.match(markdown, /Why A Normal Theme Dashboard Would Miss It/i);
  assert.match(markdown, /Evidence Ladder/i);
  assert.match(markdown, /Negative Controls/i);
  assert.match(markdown, /What Would Promote \/ Reject This Candidate/i);
  assert.match(markdown, /Systima|X-Bow/i);
  assert.doesNotMatch(markdown, /Google Cloud says growth was capacity constrained/i);
});

test('cross-theme discovery matrix promotes operating evidence while excluding summaries and market reports', () => {
  const base = buildSampleReportBundle(REPORT_TYPES.CROSS_THEME, { subject: 'Solid rocket motor capacity' });
  const bundle = planReportFigures({
    ...base,
    evidence: [
      {
        evidenceId: 'EVID-XBOW',
        kind: 'source_query_evidence',
        evidenceGrade: 'accepted',
        publisher: 'PR Newswire',
        title: "X-Bow Readies Nation's Newest Solid Rocket Motor Facility for Production",
        metadata: { desiredEvidenceClass: 'supplier_capacity' },
      },
      {
        evidenceId: 'EVID-LHX',
        kind: 'source_query_evidence',
        evidenceGrade: 'accepted',
        publisher: 'Defense Security Monitor',
        title: 'Pentagon to Invest $1 billion in L3Harris Rocket Motor Business',
        metadata: { desiredEvidenceClass: 'procurement_trigger' },
      },
      {
        evidenceId: 'EVID-FACTORY',
        kind: 'source_query_evidence',
        evidenceGrade: 'accepted',
        publisher: 'Manufacturing Today',
        title: 'Aerospace subsidiary picks Virginia for $500M solid rocket motor factory',
        metadata: { desiredEvidenceClass: 'supplier_capacity' },
      },
      {
        evidenceId: 'EVID-QUALIFIED',
        kind: 'source_query_evidence',
        evidenceGrade: 'accepted',
        publisher: 'Defense News',
        title: 'Qualified supplier bottleneck slows energetic materials solid rocket motor production',
        metadata: { desiredEvidenceClass: 'technical_qualification' },
      },
      {
        evidenceId: 'EVID-SUBSTITUTION',
        kind: 'source_query_evidence',
        evidenceGrade: 'accepted',
        publisher: 'GAO',
        title: 'Solid rocket motor production has limited qualified substitutes and no near-term supplier redundancy',
        metadata: { desiredEvidenceClass: 'negative_control' },
      },
      {
        evidenceId: 'EVID-DEEP-PACK-SUMMARY',
        kind: 'deep_research_summary',
        evidenceGrade: 'calculated',
        publisher: 'Lattice Research OS',
        title: 'Deep research pack summary: solid rocket motor capacity links defense industrial and space',
      },
      {
        evidenceId: 'EVID-MARKET',
        kind: 'external-rss',
        evidenceGrade: 'indirect',
        publisher: 'Market Research',
        title: 'Solid Rocket Motor Market Size, Share and Growth Forecast by 2034',
      },
    ],
    metadata: {
      candidate: {
        connector_name: 'solid rocket motor capacity',
        themes: ['defense-industrial', 'space'],
        evidence_summary: {
          seedSimilarity: 0,
          novelty: 1,
          discoveryFit: 0.98,
          constraintCriticality: 0.96,
          discovery: {
            role: 'constraint',
            mechanism: 'missile replenishment and launch cadence both depend on qualified motor production capacity',
            triggerTerms: ['solid rocket motor', 'interceptor production', 'launch vehicle'],
          },
        },
      },
    },
  });
  const quality = computeCrossThemeDiscoveryQuality(bundle);

  assert.equal(quality.metrics.sourceDiversity >= 0.8, true, JSON.stringify(quality.metrics));
  assert.equal(quality.metrics.directHighFitAnchorCount >= 3, true, JSON.stringify(quality.metrics));
  assert.equal(quality.metrics.negativeControlPass, 1);
  assert.equal(['evidence_backed_bottleneck_candidate', 'review_ready_bottleneck'].includes(quality.tier), true);
  assert.equal(quality.bodyEvidence.some((item) => item.evidenceId === 'EVID-DEEP-PACK-SUMMARY' && item.direct), false);
  assert.equal(quality.bodyEvidence.some((item) => item.evidenceId === 'EVID-MARKET' && item.direct), false);
});

test('strict endogenous adjacent evidence binding excludes unrelated domain provider rows', () => {
  const base = buildSampleReportBundle(REPORT_TYPES.CROSS_THEME, { subject: 'approved-supplier qualification lead time' });
  const bundle = planReportFigures({
    ...base,
    subject: {
      subjectType: 'cross_theme_candidate',
      subjectId: 'endogenous-adjacent-clean-energy-generated-approved-supplier-qualification-lead-time',
      displayName: 'approved-supplier qualification lead time',
      metadata: {
        themes: ['clean-energy'],
        discovery: {
          discoveryNamespace: 'strict_endogenous_adjacent',
          frontierDiscovery: true,
          connector: 'Clean Energy',
          triggerTerms: [
            'price availability bottleneck',
            'battery storage in capacity',
            'grid interconnection queue',
          ],
        },
      },
    },
    evidence: [
      {
        evidenceId: 'EVID-UNRELATED-AI',
        kind: 'sec_direct_management_commentary',
        evidenceGrade: 'direct',
        publisher: 'sec_direct_management_commentary',
        symbol: 'AMZN',
        title: 'AMZN clean energy and cloud capex capacity commentary',
        excerpt: 'Amazon reports clean energy purchasing and AI infrastructure capacity, but does not discuss the generated bottleneck node.',
        metadata: { desiredEvidenceClass: 'supplier_capacity' },
      },
      {
        evidenceId: 'EVID-ISSUER-SCOPE-NODE-ECHO',
        kind: 'sec_direct_management_commentary',
        evidenceGrade: 'direct',
        publisher: 'sec_direct_management_commentary',
        symbol: 'AMZN',
        title: 'AMZN approved supplier qualification lead time capacity commentary',
        excerpt: 'The filing row echoes approved supplier qualification lead time, but it is not direct issuer bridge evidence for the generated node.',
        metadata: { desiredEvidenceClass: 'supplier_capacity' },
      },
      {
        evidenceId: 'EVID-CLEAN-NODE',
        kind: 'source_query_evidence',
        evidenceGrade: 'accepted',
        publisher: 'utility-planning-source',
        title: 'Battery storage capacity market approved supplier qualification lead time bottleneck',
        metadata: { desiredEvidenceClass: 'substitution_limit', evidenceUse: 'promotion_candidate' },
      },
    ],
    metadata: {
      adjacentCandidate: {
        metadata: {
          discoveryNamespace: 'strict_endogenous_adjacent',
          frontierDiscovery: true,
          themes: ['clean-energy'],
        },
      },
      candidate: {
        connector_name: 'approved-supplier qualification lead time',
        themes: ['clean-energy'],
        evidence_summary: {
          seedSimilarity: 0,
          discovery: {
            triggerTerms: [
              'price availability bottleneck',
              'battery storage in capacity',
              'grid interconnection queue',
            ],
          },
        },
      },
    },
  });

  const terms = crossThemeEvidenceTerms(bundle);
  assert.equal(terms.connectorTerms.includes('Clean Energy'), false, JSON.stringify(terms));

  const quality = computeCrossThemeDiscoveryQuality(bundle);
  const unrelated = quality.bodyEvidence.find((row) => row.evidenceId === 'EVID-UNRELATED-AI');
  const issuerScopeEcho = quality.bodyEvidence.find((row) => row.evidenceId === 'EVID-ISSUER-SCOPE-NODE-ECHO');
  const direct = quality.bodyEvidence.find((row) => row.evidenceId === 'EVID-CLEAN-NODE');
  assert.equal(unrelated, undefined, JSON.stringify(quality.bodyEvidence));
  assert.equal(issuerScopeEcho, undefined, JSON.stringify(quality.bodyEvidence));
  assert.equal(Boolean(direct), true, JSON.stringify(quality.bodyEvidence));
});

test('strict endogenous evidence scoring ignores query metadata as proof text', () => {
  const base = buildSampleReportBundle(REPORT_TYPES.CROSS_THEME, { subject: 'interconnection study capacity' });
  const bundle = planReportFigures({
    ...base,
    subject: {
      subjectType: 'cross_theme_candidate',
      subjectId: 'endogenous-adjacent-ai-generated-interconnection-study-capacity',
      displayName: 'interconnection study capacity',
      metadata: {
        themes: ['ai-ml', 'clean-energy'],
        discovery: {
          discoveryNamespace: 'strict_endogenous_adjacent',
          frontierDiscovery: true,
          generatedLane: true,
          concreteBottleneckNodes: [{ node: 'interconnection study capacity' }],
        },
      },
    },
    evidence: [
      {
        evidenceId: 'EVID-QUERY-HINT-ONLY',
        kind: 'source_query_evidence',
        publisher: 'Generic News',
        title: 'Unrelated software vendor raises guidance',
        metadata: {
          desiredEvidenceClass: 'supplier_capacity',
          evidenceUse: 'promotion_candidate',
          promotionEligible: true,
          sourceTerms: ['interconnection study capacity qualification certification queue backlog'],
          factKeys: ['capacity_expansion'],
        },
      },
      {
        evidenceId: 'EVID-OFFICIAL-NODE',
        kind: 'public_planning_source',
        publisher: 'doe-i2x',
        title: 'DOE interconnection queue management and study-capacity evidence',
        atomicFacts: [{
          text: 'Distribution utilities lack the tools and capabilities to manage large interconnection queues, leading to delays and interconnection queue backlogs.',
        }],
        metadata: {
          sourceType: 'public_planning_source',
          sourceProvider: 'doe-i2x',
          desiredEvidenceClass: 'grid_interconnection',
          evidenceUse: 'promotion_candidate',
          promotionEligible: true,
        },
      },
    ],
    metadata: {
      strictEndogenousAdjacent: true,
      adjacentCandidate: {
        metadata: {
          discoveryNamespace: 'strict_endogenous_adjacent',
          frontierDiscovery: true,
        },
      },
    },
  });

  const quality = computeCrossThemeDiscoveryQuality(bundle);
  assert.equal(quality.bodyEvidence.some((row) => row.evidenceId === 'EVID-QUERY-HINT-ONLY'), false, JSON.stringify(quality.bodyEvidence));
  assert.equal(quality.bodyEvidence.some((row) => row.evidenceId === 'EVID-OFFICIAL-NODE'), true, JSON.stringify(quality.bodyEvidence));
});

test('cross-theme classifier promotes official FERC final-rule policy evidence for grid nodes', () => {
  const bundle = {
    subject: {
      subjectType: 'cross_theme_candidate',
      subjectId: 'endogenous-adjacent-ai-generated-interconnection-study-capacity',
      displayName: 'interconnection study capacity',
      metadata: {
        themes: ['ai-ml', 'clean-energy'],
        discovery: {
          discoveryNamespace: 'strict_endogenous_adjacent',
          frontierDiscovery: true,
          generatedLane: true,
          concreteBottleneckNodes: [{ node: 'interconnection study capacity' }],
        },
      },
    },
    metadata: {
      strictEndogenousAdjacent: true,
      adjacentCandidate: {
        metadata: {
          discoveryNamespace: 'strict_endogenous_adjacent',
          frontierDiscovery: true,
        },
      },
    },
  };

  const classified = classifyCrossThemeEvidence({
    evidenceId: 'EVID-FERC-POLICY',
    kind: 'public_planning_source',
    publisher: 'govinfo',
    title: 'Federal Register FERC Order 2023 interconnection final rule',
    excerpt: 'Federal Register FERC final rule requires transmission providers to use cluster studies as the interconnection study method and requires commercial readiness deposits for interconnection customers.',
    metadata: {
      sourceType: 'public_planning_source',
      sourceProvider: 'govinfo',
      desiredEvidenceClass: 'policy_funding',
      evidenceUse: 'promotion_candidate',
      promotionEligible: true,
    },
  }, bundle);

  assert.equal(classified.desiredEvidenceClass, 'policy_funding');
  assert.equal(classified.bodyEligible, true, JSON.stringify(classified));
  assert.equal(classified.promotionEligible, true, JSON.stringify(classified));
});

test('cross-theme classifier infers tested motors and chokepoints as discovery evidence classes', () => {
  const bundle = {
    subject: {
      subjectType: 'cross_theme_candidate',
      subjectId: '16776',
      displayName: 'solid rocket motor capacity',
    },
    metadata: {
      candidate: {
        connector_name: 'solid rocket motor capacity',
        themes: ['defense-industrial', 'space'],
      },
    },
  };
  const technical = classifyCrossThemeEvidence({
    evidenceId: 'EVID-TECH',
    publisher: 'Northrop Grumman',
    title: 'Northrop Grumman Successfully Tests a New Solid Rocket Motor Developed in Less Than a Year',
    metadata: { evidenceUse: 'promotion_candidate', promotionEligible: true },
  }, bundle);
  const substitution = classifyCrossThemeEvidence({
    evidenceId: 'EVID-SUB',
    publisher: 'TechCrunch',
    title: 'Anduril opens solid rocket motor factory amid ongoing chemical chokepoint',
    text: 'The factory addresses a supply-chain bottleneck for solid rocket motor production.',
    metadata: { evidenceUse: 'promotion_candidate', promotionEligible: true },
  }, bundle);

  assert.equal(technical.desiredEvidenceClass, 'technical_qualification');
  assert.equal(technical.promotionEligible, true);
  assert.equal(substitution.desiredEvidenceClass, 'substitution_limit');
  assert.equal(substitution.promotionEligible, true);
});

test('cross-theme source-query drafts cover the discovery evidence matrix', () => {
  const bundle = planReportFigures({
    ...buildSampleReportBundle(REPORT_TYPES.CROSS_THEME, { subject: 'Solid rocket motor capacity' }),
    metadata: {
      candidate: {
        connector_name: 'solid rocket motor capacity',
        themes: ['defense-industrial', 'space'],
        evidence_summary: {
          discovery: {
            role: 'constraint',
            mechanism: 'missile replenishment and launch cadence both depend on qualified motor production capacity',
            triggerTerms: ['solid rocket motor', 'interceptor production'],
            sourceQueries: ['solid rocket motor capacity missile launch supplier backlog'],
          },
        },
      },
    },
  });
  const analysis = generateDeterministicAnalystDraft(bundle);
  const classes = new Set(analysis.sourceQueries.map((query) => query.metadata?.desiredEvidenceClass));
  for (const evidenceClass of [
    'supplier_capacity',
    'technical_qualification',
    'procurement_trigger',
    'substitution_limit',
    'issuer_exposure',
    'negative_control',
  ]) {
    assert.equal(classes.has(evidenceClass), true, `${evidenceClass} missing from ${JSON.stringify([...classes])}`);
  }
  const drafts = buildSourceQueryDrafts(bundle, analysis);
  const issuerDraft = drafts.find((draft) => draft.desiredEvidenceClass === 'issuer_exposure');
  const negativeDraft = drafts.find((draft) => draft.desiredEvidenceClass === 'negative_control');
  assert.equal(Boolean(issuerDraft?.candidateId), true);
  assert.equal(issuerDraft.connector, 'solid rocket motor capacity');
  assert.match(issuerDraft.acceptanceCriteria, /issuer-level|backlog|management/i);
  assert.equal(issuerDraft.promotionEligible, true);
  assert.equal(Boolean(issuerDraft.providerRoutePlan), true);
  assert.equal(issuerDraft.providerRoutePlan.evidenceClass, 'issuer_exposure');
  assert.equal(Array.isArray(issuerDraft.providerRoutePlan.queryVariants), true);
  assert.equal(Array.isArray(issuerDraft.sourceProviders), true);
  assert.equal(negativeDraft.promotionEligible, false);
  assert.equal(negativeDraft.providerRoutePlan.negativeControlIntent, true);
});

test('cross-theme classifier keeps market reports and deep summaries below direct high-fit anchors', () => {
  const bundle = planReportFigures({
    ...buildSampleReportBundle(REPORT_TYPES.CROSS_THEME, { subject: 'Solid rocket motor capacity' }),
    metadata: {
      candidate: {
        connector_name: 'solid rocket motor capacity',
        themes: ['defense-industrial', 'space'],
        evidence_summary: {
          discovery: {
            role: 'constraint',
            triggerTerms: ['solid rocket motor', 'interceptor production'],
          },
        },
      },
    },
  });
  const directFacility = classifyCrossThemeEvidence({
    evidenceId: 'EVID-FACILITY',
    kind: 'source_query_evidence',
    evidenceGrade: 'accepted',
    publisher: 'PR Newswire',
    title: "X-Bow Readies Nation's Newest Solid Rocket Motor Facility for Production",
  }, bundle);
  const marketReport = classifyCrossThemeEvidence({
    evidenceId: 'EVID-MARKET',
    kind: 'external-rss',
    evidenceGrade: 'direct',
    publisher: 'Market Research',
    title: 'Solid Rocket Motor Market Size, Share and Growth Forecast by 2034',
  }, bundle);
  const packSummary = classifyCrossThemeEvidence({
    evidenceId: 'EVID-DEEP-PACK-SUMMARY',
    kind: 'deep_research_summary',
    evidenceGrade: 'direct',
    publisher: 'Lattice Research OS',
    title: 'Deep research pack summary: solid rocket motor capacity links defense industrial and space',
  }, bundle);

  assert.equal(directFacility.crossThemeFit.label, 'high');
  assert.equal(directFacility.direct, true);
  assert.equal(marketReport.crossThemeFit.label, 'medium');
  assert.equal(marketReport.direct, false);
  assert.equal(packSummary.crossThemeFit.label, 'medium');
  assert.equal(packSummary.direct, false);
});

test('cross-theme classifier keeps canonical context/noise memory out of promotion', () => {
  const bundle = planReportFigures({
    ...buildSampleReportBundle(REPORT_TYPES.CROSS_THEME, { subject: 'Solid rocket motor capacity' }),
    metadata: {
      candidate: {
        connector_name: 'solid rocket motor capacity',
        themes: ['defense-industrial', 'space'],
        evidence_summary: {
          discovery: {
            role: 'constraint',
            triggerTerms: ['solid rocket motor', 'interceptor production'],
          },
        },
      },
    },
  });
  const context = classifyCrossThemeEvidence({
    evidenceId: 'EVID-CONTEXT',
    kind: 'source_query_evidence',
    publisher: 'External RSS',
    title: 'Solid rocket motor industry update mentions defense suppliers',
    metadata: {
      evidenceUse: 'supporting_context',
      promotionEligible: false,
      desiredEvidenceClass: 'supplier_capacity',
    },
  }, bundle);
  const noise = classifyCrossThemeEvidence({
    evidenceId: 'EVID-NOISE',
    kind: 'source_query_evidence',
    publisher: 'External RSS',
    title: 'Defense supplier discusses unrelated autonomous systems',
    metadata: {
      evidenceUse: 'weak_noise',
      promotionEligible: false,
      desiredEvidenceClass: 'supplier_capacity',
    },
  }, bundle);

  assert.equal(context.crossThemeRole, 'context_only');
  assert.equal(context.promotionEligible, false);
  assert.equal(context.bodyEligible, false);
  assert.equal(context.direct, false);
  assert.equal(noise.crossThemeRole, 'weak_noise');
  assert.equal(noise.promotionEligible, false);
  assert.equal(noise.bodyEligible, false);
});

test('adjacent deep research pack filters no-fact broad theme papers', () => {
  const bundle = planReportFigures({
    ...buildSampleReportBundle(REPORT_TYPES.CROSS_THEME, {
      subject: 'Power, cooling, or utility infrastructure',
    }),
    subject: {
      subjectType: 'cross_theme_candidate',
      subjectId: 'adjacent-ai-ml-power-cooling-or-utility-infrastructure',
      displayName: 'Power, cooling, or utility infrastructure',
      metadata: {
        discovery: {
          adjacentCandidateKey: 'adjacent-ai-ml-power-cooling-or-utility-infrastructure',
          adjacentLane: 'power_cooling_or_utility_infrastructure',
        },
      },
    },
  });
  const broadPaper = {
    id: 'DPM',
    source_type: 'article',
    title: 'DPM++: Dynamic Masked Metric Learning for Occluded Person Re-identification',
    excerpt: 'Person re-identification and masked metric learning improve occluded samples in machine learning applications.',
    metadata: {
      evidenceUse: 'supporting_context',
      desiredEvidenceClass: 'power_constraint',
      scoring: {
        targetHit: true,
        queryHitCount: 2,
        classCueHit: false,
        strongClassCueHit: false,
      },
    },
  };
  const dataCenterPower = {
    id: 'GRID',
    source_type: 'external-rss',
    title: 'Distributed energy resources can accelerate data center interconnection',
    excerpt: 'Utilities and grid operators say data center load growth faces power availability and interconnection queue timing constraints.',
    metadata: {
      evidenceUse: 'supporting_context',
      desiredEvidenceClass: 'power_constraint',
      factsExtracted: [{ key: 'utility_or_grid_operator' }, { key: 'load_or_interconnection_timing' }],
      scoring: {
        targetHit: true,
        queryHitCount: 4,
        classCueHit: true,
        strongClassCueHit: true,
      },
    },
  };

  assert.equal(adjacentResearchRowFitsBundle(bundle, broadPaper), false);
  assert.equal(adjacentResearchRowFitsBundle(bundle, dataCenterPower), true);
  assert.deepEqual(filterVisibleResearchRows(bundle, [broadPaper, dataCenterPower]).map((row) => row.id), ['GRID']);
});

test('adjacent deep research pack requires lane vocabulary for generic technical papers', () => {
  const bundle = planReportFigures({
    ...buildSampleReportBundle(REPORT_TYPES.CROSS_THEME, {
      subject: 'Range operations or ground systems support',
    }),
    subject: {
      subjectType: 'cross_theme_candidate',
      subjectId: 'adjacent-space-range-operations-or-ground-systems-support',
      displayName: 'Range operations or ground systems support',
      metadata: {
        discovery: {
          adjacentCandidateKey: 'adjacent-space-range-operations-or-ground-systems-support',
          adjacentLane: 'range_operations_or_ground_systems_support',
        },
      },
    },
  });
  const broadValidation = {
    id: 'LLM-BENCH',
    source_type: 'article',
    title: 'When No Benchmark Exists: Validating Comparative LLM Safety Scoring Without Ground-Truth Labels',
    excerpt: 'A validation method for benchmark scoring in language models.',
    metadata: {
      evidenceUse: 'supporting_context',
      desiredEvidenceClass: 'technical_qualification',
    },
  };
  const rangeContract = {
    id: 'SSC-RANGE',
    source_type: 'external-rss',
    title: 'Space Systems Command awards launch range operations ground systems support contract',
    excerpt: 'The award covers launch range operations, ground systems, and mission support for national security space launch.',
    metadata: {
      evidenceUse: 'supporting_context',
      desiredEvidenceClass: 'mission_award',
      factsExtracted: [{ key: 'program_linkage' }],
    },
  };

  assert.equal(adjacentResearchRowFitsBundle(bundle, broadValidation), false);
  assert.equal(adjacentResearchRowFitsBundle(bundle, rangeContract), true);
});

test('adjacent deep research pack does not mark filtered fallback research as available', async () => {
  const bundle = planReportFigures({
    ...buildSampleReportBundle(REPORT_TYPES.CROSS_THEME, {
      subject: 'Material supply or substitution constraint',
    }),
    subject: {
      subjectType: 'cross_theme_candidate',
      subjectId: 'adjacent-space-material-supply-or-substitution',
      displayName: 'Material supply or substitution constraint',
      metadata: {
        discovery: {
          adjacentCandidateKey: 'adjacent-space-material-supply-or-substitution',
          adjacentLane: 'material_supply_or_substitution',
        },
      },
    },
    evidence: [
      {
        evidenceId: 'EVID-GENERIC-PAPER',
        kind: 'paper',
        publisher: 'arxiv',
        title: 'Photonic-Implemented Efficient Deep Quantum Neural Network via Virtual-Driven Hilbert Space Expansion',
      },
    ],
  });

  const deepBundle = await attachDeepResearchPack(bundle);
  assert.equal(deepBundle.metadata.deepResearch.packs.researchPack.status, 'gap');
  assert.equal(deepBundle.metadata.deepResearch.packs.researchPack.rows.length, 0);
});

test('cross-theme deep pack adds action bridge without upgrading investment readiness', async () => {
  const bundle = planReportFigures({
    ...buildSampleReportBundle(REPORT_TYPES.CROSS_THEME, { subject: 'Solid rocket motor capacity' }),
    evidence: [
      {
        evidenceId: 'EVID-XBOW',
        kind: 'source_query_evidence',
        evidenceGrade: 'accepted',
        publisher: 'PR Newswire',
        title: "X-Bow Readies Nation's Newest Solid Rocket Motor Facility for Production",
        metadata: { desiredEvidenceClass: 'supplier_capacity', evidenceUse: 'promotion_candidate', promotionEligible: true },
      },
      {
        evidenceId: 'EVID-NOC',
        kind: 'source_query_evidence',
        evidenceGrade: 'accepted',
        publisher: 'Northrop Grumman',
        title: 'Northrop Grumman Successfully Tests a New Solid Rocket Motor Developed in Less Than a Year',
        metadata: { desiredEvidenceClass: 'technical_qualification', evidenceUse: 'promotion_candidate', promotionEligible: true },
      },
      {
        evidenceId: 'EVID-LHX',
        kind: 'source_query_evidence',
        evidenceGrade: 'accepted',
        publisher: 'Defense Security Monitor',
        title: 'Pentagon to Invest $1 billion in L3Harris Rocket Motor Business',
        metadata: { desiredEvidenceClass: 'procurement_trigger', evidenceUse: 'promotion_candidate', promotionEligible: true },
      },
      {
        evidenceId: 'EVID-SUB',
        kind: 'source_query_evidence',
        evidenceGrade: 'accepted',
        publisher: 'GAO',
        title: 'Solid rocket motor production has limited qualified substitutes and no near-term supplier redundancy',
        metadata: { desiredEvidenceClass: 'negative_control', evidenceUse: 'negative_control_candidate', promotionEligible: false },
      },
      {
        evidenceId: 'EVID-MARKET-ONLY',
        kind: 'external-rss',
        evidenceGrade: 'direct',
        publisher: 'Market Research',
        title: 'Solid Rocket Motor Market Size, Share and Growth Forecast by 2034',
      },
    ],
    metadata: {
      candidate: {
        connector_name: 'solid rocket motor capacity',
        themes: ['defense-industrial', 'space'],
        evidence_summary: {
          discovery: {
            role: 'constraint',
            mechanism: 'missile replenishment and launch cadence both depend on qualified motor production capacity',
            triggerTerms: ['solid rocket motor', 'interceptor production', 'launch vehicle'],
          },
        },
      },
    },
  });
  const deepBundle = await attachDeepResearchPack(bundle);
  const bridge = deepBundle.metadata.deepResearch.crossThemeActionBridge;
  const validation = validateReportBundle(deepBundle, { analysis: generateDeterministicAnalystDraft(deepBundle) });

  assert.equal(bridge.status, 'available');
  assert.equal(bridge.exposedIssuers.some((issuer) => ['LHX', 'NOC', 'LMT'].includes(issuer.symbol)), true);
  assert.equal(bridge.marketTranslation.status, 'follow_up_required');
  assert.equal(['C', 'D'].includes(validation.quality.investmentReadinessQuality.grade), true);
  assert.equal(validation.quality.investmentReadiness?.tier, 'signal_triage');
  assert.equal(Boolean(validation.quality.crossThemeActionability), true);
  assert.equal(validation.quality.crossThemeActionability.metrics.marketRowCount, 0);
  assert.equal(bridge.evidenceMatrix.find((row) => row.evidenceClass === 'supplier_capacity').status, 'promotion_eligible');
  assert.equal(deepBundle.metadata.deepResearch.crossThemeEvidenceMatrix.find((row) => row.evidenceClass === 'supplier_capacity').status, 'promotion_eligible');
  assert.equal(validation.quality.crossThemeActionability.metrics.negativeControlStatus, 'supported_constraint');
  const institutional = deepBundle.metadata.deepResearch.packs.institutionalEvidencePack.dimensions;
  assert.equal(institutional.find((row) => row.key === 'cross_theme_connector_evidence').rowCount > 0, true);
  assert.equal(institutional.find((row) => row.key === 'causal_mechanism_validation').rowCount > 0, true);
  assert.equal(bridge.exposedIssuers.find((issuer) => issuer.symbol === 'LHX').status, 'operating_anchor_attached');
  assert.equal(bridge.exposedIssuers.find((issuer) => issuer.symbol === 'NOC').status, 'operating_anchor_attached');
});

test('cross-theme actionability requires issuer exposure before market translation', async () => {
  const baseBundle = {
    ...buildSampleReportBundle(REPORT_TYPES.CROSS_THEME, { subject: 'Solid rocket motor capacity' }),
    marketReactions: [
      {
        symbol: 'LHX',
        eventWindow: '+5d',
        relativeReturnPct: 4.2,
        tStat: 1.8,
        sampleSize: 120,
        validationStatus: 'validated',
        controls: ['benchmark=QQQ', 'factor=market_beta'],
      },
    ],
    metadata: {
      candidate: {
        connector_name: 'solid rocket motor capacity',
        themes: ['defense-industrial', 'space'],
        evidence_summary: {
          discovery: {
            role: 'constraint',
            mechanism: 'missile replenishment and launch cadence both depend on qualified motor production capacity',
            triggerTerms: ['solid rocket motor', 'interceptor production', 'launch vehicle'],
          },
        },
      },
    },
  };
  const noIssuerBundle = await attachDeepResearchPack(planReportFigures({
    ...baseBundle,
    evidence: [
      {
        evidenceId: 'EVID-XBOW',
        kind: 'source_query_evidence',
        evidenceGrade: 'accepted',
        publisher: 'PR Newswire',
        title: "X-Bow Readies Nation's Newest Solid Rocket Motor Facility for Production",
        metadata: { desiredEvidenceClass: 'supplier_capacity', evidenceUse: 'promotion_candidate', promotionEligible: true },
      },
    ],
  }));
  const noIssuerBridge = noIssuerBundle.metadata.deepResearch.crossThemeActionBridge;
  assert.equal(noIssuerBridge.metrics.issuerBridgeCount, 0);
  assert.equal(noIssuerBridge.metrics.marketRowCount, 0);
  assert.equal(noIssuerBridge.marketTranslation.status, 'follow_up_required');

  const issuerBundle = await attachDeepResearchPack(planReportFigures({
    ...baseBundle,
    evidence: [
      {
        evidenceId: 'EVID-XBOW',
        kind: 'source_query_evidence',
        evidenceGrade: 'accepted',
        publisher: 'PR Newswire',
        title: "X-Bow Readies Nation's Newest Solid Rocket Motor Facility for Production",
        metadata: { desiredEvidenceClass: 'supplier_capacity', evidenceUse: 'promotion_candidate', promotionEligible: true },
      },
      {
        evidenceId: 'EVID-SUB',
        kind: 'source_query_evidence',
        evidenceGrade: 'accepted',
        publisher: 'GAO',
        title: 'Solid rocket motor production has limited qualified substitutes and no near-term supplier redundancy',
        metadata: { desiredEvidenceClass: 'negative_control', evidenceUse: 'negative_control_candidate', promotionEligible: false },
      },
      {
        evidenceId: 'EVID-LHX-ISSUER',
        kind: 'source_query_evidence',
        evidenceGrade: 'accepted',
        publisher: 'L3Harris',
        title: 'L3Harris Aerojet solid rocket motor backlog and segment guidance point to issuer exposure',
        metadata: { desiredEvidenceClass: 'issuer_exposure', evidenceUse: 'promotion_candidate', promotionEligible: true },
      },
      {
        evidenceId: 'EVID-SUBSTITUTION-LIMIT',
        kind: 'source_query_evidence',
        evidenceGrade: 'accepted',
        publisher: 'GAO',
        title: 'Solid rocket motor qualification constraint limits fast substitution among suppliers',
        metadata: { desiredEvidenceClass: 'substitution_limit', evidenceUse: 'promotion_candidate', promotionEligible: true },
      },
    ],
  }));
  const issuerBridge = issuerBundle.metadata.deepResearch.crossThemeActionBridge;
  const validation = validateReportBundle(issuerBundle, { analysis: generateDeterministicAnalystDraft(issuerBundle) });
  assert.equal(issuerBridge.metrics.issuerBridgeCount >= 1, true);
  assert.equal(issuerBridge.metrics.marketRowCount >= 1, true);
  assert.equal(issuerBridge.marketTranslation.status, 'attached');
  assert.equal(['S', 'A', 'B'].includes(validation.quality.crossThemeActionability.grade), true);
});

test('cross-theme memo renders action bridge sections and ribbon without theme-report investment labels', async () => {
  const bundle = await attachDeepResearchPack(planReportFigures({
    ...buildSampleReportBundle(REPORT_TYPES.CROSS_THEME, { subject: 'Solid rocket motor capacity' }),
    evidence: [
      {
        evidenceId: 'EVID-XBOW',
        kind: 'source_query_evidence',
        evidenceGrade: 'accepted',
        publisher: 'PR Newswire',
        title: "X-Bow Readies Nation's Newest Solid Rocket Motor Facility for Production",
        metadata: { desiredEvidenceClass: 'supplier_capacity', evidenceUse: 'promotion_candidate', promotionEligible: true },
      },
    ],
    metadata: {
      candidate: {
        connector_name: 'solid rocket motor capacity',
        themes: ['defense-industrial', 'space'],
        evidence_summary: {
          discovery: {
            role: 'constraint',
            mechanism: 'missile replenishment and launch cadence both depend on qualified motor production capacity',
            triggerTerms: ['solid rocket motor', 'interceptor production'],
          },
        },
      },
    },
  }));
  const analysis = generateDeterministicAnalystDraft(bundle);
  const html = renderReportHtml(bundle, { analysis });

  assert.equal(analysis.narrativeStructure.provider, 'deterministic_fallback');
  assert.match(html, /Why This Connector Matters/i);
  assert.match(html, /Shared Constraint Map/i);
  assert.match(html, /Issuer and Market Translation/i);
  assert.match(html, /Discovery-to-Action Bridge/i);
  assert.match(html, /action bridge/i);
  assert.match(html, /investment gate/i);
  assert.doesNotMatch(html, /portfolio use/i);
});

test('deep data-depth narrative separates pack gaps from KPI-level gaps', () => {
  const bundle = planReportFigures(withDeepResearch(buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'Deep Grid Power' })));
  const analysis = generateDeterministicAnalystDraft(bundle);
  const dataDepth = analysis.dataDepth.map((block) => block.text).join(' ');
  assert.match(dataDepth, /evidence split|remaining research gaps|economic/i);
  assert.doesNotMatch(dataDepth, /Pack-level|KPI-level|fundamentalPack|filingPack|transcriptPack|industryPack/);
  assert.doesNotMatch(dataDepth, /Missing areas \(none\).*missing KPI/i);
  assert.equal(analysis.sourceQueries.some((query) => query.metadata?.gapKind === 'theme_kpi' && query.metadata?.kpiKey === 'capacity_buildout_proxy'), true);
});

test('narrative blueprint stays semantic before section-specific rendering', () => {
  const bundle = planReportFigures(buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'AI / Machine Learning' }));
  const signalCards = buildSignalCards(bundle);
  const blueprint = buildNarrativeBlueprint(bundle, signalCards, {});
  assert.equal(blueprint.version, 'semantic-blueprint-v3');
  assert.equal(blueprint.sections, undefined);
  assert.equal(typeof blueprint.evidenceLogic?.requiredConfirmation, 'string');
  assert.equal(typeof blueprint.sectionIntent?.researchAgenda, 'string');

  const plan = renderClientMemoFromBlueprint(blueprint);
  assert.equal(plan.version, 'semantic-plan-v3');
  assert.equal(Array.isArray(plan.sections.watchNext), true);
  assert.equal(Array.isArray(plan.sections.researchAgenda), true);
  assert.equal(Array.isArray(plan.longFormSections), true);
  assert.equal(plan.longFormSections.some((section) => section.key === 'contextAndWhatChanged'), true);
  assert.equal(plan.longFormSections
    .filter((section) => section.key !== 'analystConclusion')
    .every((section) => section.paragraphs.length >= 3), true);
});

test('adaptive narrative structure gives report types distinct titles while preserving role coverage', () => {
  const themePlan = renderClientMemoFromBlueprint(buildNarrativeBlueprint(
    planReportFigures(buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'AI / Machine Learning' })),
    buildSignalCards(planReportFigures(buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'AI / Machine Learning' }))),
    {},
  ));
  const crossPlan = renderClientMemoFromBlueprint(buildNarrativeBlueprint(
    planReportFigures(buildSampleReportBundle(REPORT_TYPES.CROSS_THEME)),
    buildSignalCards(planReportFigures(buildSampleReportBundle(REPORT_TYPES.CROSS_THEME))),
    {},
  ));
  const eventPlan = renderClientMemoFromBlueprint(buildNarrativeBlueprint(
    planReportFigures(buildSampleReportBundle(REPORT_TYPES.EVENT_SIGNAL)),
    buildSignalCards(planReportFigures(buildSampleReportBundle(REPORT_TYPES.EVENT_SIGNAL))),
    {},
  ));

  assert.equal(themePlan.narrativeStructure.provider, 'deterministic_fallback');
  assert.equal(themePlan.narrativeStructure.requiredRoleCoverage, 1);
  assert.equal(crossPlan.narrativeStructure.requiredRoleCoverage, 1);
  assert.equal(eventPlan.narrativeStructure.requiredRoleCoverage, 1);

  const themeTitles = themePlan.longFormSections.map((section) => section.title).join(' | ');
  const crossTitles = crossPlan.longFormSections.map((section) => section.title).join(' | ');
  const eventTitles = eventPlan.longFormSections.map((section) => section.title).join(' | ');
  assert.match(themeTitles, /What the Market Is Trying to Decide|Attention vs Operating Evidence|Mechanism Test/i);
  assert.match(crossTitles, /Why This Connector Matters|Shared Constraint Map|Evidence Ladder|Promote (or|\/) Reject/i);
  assert.match(eventTitles, /What Happened|Transmission Path|Affected Themes and Assets|Alternative Explanations/i);
  assert.notEqual(themeTitles, crossTitles);
  assert.notEqual(themeTitles, eventTitles);
});

test('adaptive narrative validator rejects missing roles, duplicate titles, and unsupported title entities', () => {
  const bundle = planReportFigures(buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'Grid Power' }));
  const invalidOutline = {
    archetype: 'theme_report',
    provider: 'llm',
    sections: [
      {
        key: 'contextAndWhatChanged',
        title: 'NVIDIA 2030 Shock',
        role: 'current_judgment',
        requiredMoves: ['current_read'],
        evidenceAnchors: [],
        riskLevel: 'medium',
        targetWords: 220,
      },
      {
        key: 'evidenceAssessment',
        title: 'NVIDIA 2030 Shock',
        role: 'evidence_hierarchy',
        requiredMoves: ['proof_hierarchy'],
        evidenceAnchors: [],
        riskLevel: 'medium',
        targetWords: 260,
      },
    ],
  };
  const validation = validateNarrativeStructure(invalidOutline, bundle);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(' '), /missing required roles/i);
  assert.match(validation.errors.join(' '), /duplicate section title/i);
  assert.match(validation.errors.join(' '), /unsupported title token/i);
});

test('invalid adaptive outline falls back to deterministic narrative structure', () => {
  const bundle = planReportFigures(buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'Grid Power' }));
  const plan = renderClientMemoFromBlueprint(buildNarrativeBlueprint(bundle, buildSignalCards(bundle), {}));
  const invalidOutline = {
    provider: 'llm',
    sections: [{ key: 'contextAndWhatChanged', title: 'NVIDIA 2030 Shock', role: 'current_judgment' }],
  };
  const applied = applyAdaptiveNarrativeStructureToPlan(plan, invalidOutline, bundle);
  assert.equal(applied.narrativeStructure.provider, 'deterministic_fallback');
  assert.match(applied.narrativeStructure.fallbackReason, /missing required roles|unsupported title token/i);
  assert.equal(applied.narrativeStructure.requiredRoleCoverage, 1);
});

test('long-form memo translates multiple investment blockers into readable client language', () => {
  const bundle = planReportFigures({
    ...buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'AI / Machine Learning' }),
    metadata: {
      deepResearch: {
        investmentReadiness: {
          tier: 'signal_triage',
          blockers: [
            'only 0/5 core investment packs are available',
            'article sample size is unknown',
            'source diversity 0.00 is below 0.8',
          ],
        },
      },
    },
  });
  const signalCards = buildSignalCards(bundle);
  const plan = renderClientMemoFromBlueprint(buildNarrativeBlueprint(bundle, signalCards, {}));
  const text = plan.longFormSections
    .flatMap((section) => section.paragraphs)
    .map((paragraph) => paragraph.text)
    .join(' ');

  assert.doesNotMatch(text, /available article sample size is unknown source diversity/i);
  assert.match(text, /core investment evidence is incomplete/i);
  assert.match(text, /article sample size is unknown/i);
  assert.match(text, /independent source diversity is below target/i);
  assert.match(text, /core evidence lanes are populated, the evidence sample reaches investment-memo depth, and independent source diversity improves/i);
});

test('generic issuer thesis bridge normalizes repeated legacy issuer roles before client rendering', () => {
  const bundle = planReportFigures(withGenericIssuerThesis(buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'Conflict' })));
  const analysis = generateDeterministicAnalystDraft(bundle);
  const html = renderReportHtml(bundle, { analysis });
  const markdown = renderReportMarkdown(bundle, { analysis });
  const validation = validateReportBundle(bundle, {
    analysis,
    renderedArtifacts: { html, markdown },
  });

  assert.doesNotMatch(markdown, /validate through revenue, margin, guidance, and market sensitivity/i);
  assert.match(markdown, /BDRY: research-prioritization use; bridge gap for BDRY/i);
  assert.equal(
    validation.blockers.some((blocker) => blocker.type === 'repeated_client_phrase'),
    false,
    JSON.stringify(validation.blockers),
  );
});

test('defense ontology memo uses defense-specific economics without space/AI leakage', () => {
  const bundle = planReportFigures({
    ...buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'Defense Industrial' }),
    metadata: {
      deepResearch: {
        ontologyPack: {
          ontologyKey: 'defense_industrial',
          ontologyLabel: 'Defense Industrial',
          isGenericFallback: false,
          missingKpis: [
            { displayName: 'Defense book-to-bill', critical: true, requiredFor: 'investment_memo' },
            { displayName: 'Procurement budget line items', critical: true, requiredFor: 'investment_memo' },
            { displayName: 'Munitions capacity', critical: true, requiredFor: 'investment_memo' },
            { displayName: 'Missile and air-defense demand', critical: true, requiredFor: 'investment_memo' },
          ],
          issuerUniverseSymbols: ['RTX', 'LMT', 'NOC', 'GD', 'ITA', 'UUP'],
          excludedSymbols: ['ITA', 'UUP'],
        },
        investmentReadiness: {
          tier: 'signal_triage',
          blockers: [
            'theme ontology critical KPI coverage 27%; missing Defense book-to-bill, Procurement budget line items, Munitions capacity, Missile and air-defense demand',
          ],
          sampleAdequacy: 'investment_memo',
          sourceDiversity: 1,
          directManagementCommentarySymbolCount: 3,
          requiredTranscriptSymbolCount: 3,
        },
      },
    },
  });
  const plan = renderClientMemoFromBlueprint(buildNarrativeBlueprint(bundle, buildSignalCards(bundle), {}));
  assert.match(plan.thesis.short, /backlog conversion and replenishment thesis/i);
  assert.doesNotMatch(plan.thesis.short, /possible narrative rotation/i);
  const text = plan.longFormSections
    .flatMap((section) => section.paragraphs)
    .map((paragraph) => paragraph.text)
    .join(' ');

  assert.match(text, /backlog|book-to-bill|procurement/i);
  assert.match(text, /defense primes|missile and air-defense suppliers|shipbuilders/i);
  assert.doesNotMatch(text, /launch cadence/i);
  assert.doesNotMatch(text, /sample adequacy|independent source breadth/i);
  assert.doesNotMatch(text, /broad tech|semiconductor|power-related language/i);
  assert.doesNotMatch(text, /primary management commentary and controlled market tests/i);
  assert.match(text, /decision-grade operating KPI confirmation and controlled market tests/i);
});

test('AI issuer bridge uses infrastructure economics instead of defense examples', () => {
  const bundle = planReportFigures({
    ...buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'AI / Machine Learning' }),
    metadata: {
      deepResearch: {
        ontologyPack: {
          ontologyKey: 'data_center_infrastructure',
          ontologyLabel: 'Data Center Infrastructure',
          isGenericFallback: false,
          missingKpis: [
            { displayName: 'Data center power and MW capacity', critical: true, requiredFor: 'investment_memo' },
          ],
        },
        packs: {
          issuerThesisPack: {
            cards: [
              {
                symbol: 'MSFT',
                thesisUse: 'research_prioritization',
                role: 'theme-exposed issuer requiring operating validation',
                dataFlags: {
                  hasFundamentals: true,
                  hasValuation: true,
                  hasConsensus: true,
                  hasIssuerCommentary: true,
                  hasIssuerOperatingKpi: false,
                  hasMarketReaction: true,
                },
              },
              {
                symbol: 'AMD',
                thesisUse: 'research_prioritization',
                role: 'theme-exposed issuer requiring operating validation',
                dataFlags: {
                  hasFundamentals: true,
                  hasValuation: true,
                  hasConsensus: true,
                  hasIssuerCommentary: true,
                  hasIssuerOperatingKpi: false,
                  hasMarketReaction: true,
                },
              },
            ],
          },
        },
        investmentReadiness: {
          tier: 'signal_triage',
          blockers: ['theme ontology critical KPI coverage 33%; missing Data center power and MW capacity'],
        },
      },
    },
  });
  const plan = renderClientMemoFromBlueprint(buildNarrativeBlueprint(bundle, buildSignalCards(bundle), {}));
  const text = plan.longFormSections
    .flatMap((section) => section.paragraphs)
    .map((paragraph) => paragraph.text)
    .join(' ');

  assert.match(text, /AI workload growth|cloud revenue|accelerator|server demand|data-center power/i);
  assert.doesNotMatch(text, /missile|air-defense|shipyard|backlog conversion/i);
});

test('defense narrative prefers ontology high-fit operating anchors over visible low-fit events', () => {
  const bundle = planReportFigures({
    ...buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'Defense Industrial' }),
    metadata: {
      themeContext: {
        events: [
          {
            title: 'Generic conflict headline drives social coverage',
            articleCount: 8,
            sourceCount: 3,
            isSurge: true,
          },
        ],
      },
      deepResearch: {
        ontologyPack: {
          ontologyKey: 'defense_industrial',
          ontologyLabel: 'Defense Industrial',
          isGenericFallback: false,
          topAnchorFits: [
            {
              title: 'Al Tariq munitions to be integrated on Acinci UAV',
              fit: {
                label: 'high',
                score: 1,
                reason: 'Defense Industrial operating KPI or mechanism evidence',
              },
            },
          ],
        },
        investmentReadiness: {
          tier: 'signal_triage',
          blockers: ['theme ontology critical KPI coverage 73%; missing Defense book-to-bill'],
        },
      },
    },
  });
  const plan = renderClientMemoFromBlueprint(buildNarrativeBlueprint(bundle, buildSignalCards(bundle), {}));
  const text = plan.longFormSections
    .flatMap((section) => section.paragraphs)
    .map((paragraph) => paragraph.text)
    .join(' ');

  assert.match(text, /Al Tariq munitions to be integrated on Acinci UAV/i);
  assert.match(text, /highest-fit operating anchor|matches the thesis mechanism/i);
  assert.doesNotMatch(text, /Generic conflict headline drives social coverage/);
});

test('issuer thesis pack adds company-level valuation bridge without recommendations', () => {
  const bundle = planReportFigures({
    ...buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'Defense Industrial' }),
    marketReactions: [
      {
        reactionId: 'MRKT-GD',
        symbol: 'GD',
        relativeReturnPct: 1.61,
        tStat: 0.49,
        controls: ['sample_size=1455'],
        validationStatus: 'validated',
      },
    ],
    metadata: {
      deepResearch: {
        ontologyPack: {
          ontologyKey: 'defense_industrial',
          ontologyLabel: 'Defense Industrial',
          issuerUniverseSymbols: ['RTX', 'LMT', 'NOC', 'GD', 'ITA', 'UUP'],
        },
        packs: {
          issuerThesisPack: {
            status: 'available',
            coverage: 0.67,
            consensusSymbols: ['LMT'],
            valuationSymbols: ['LMT', 'GD'],
            missingConsensusSymbols: ['RTX', 'NOC', 'GD'],
            missingValuationSymbols: ['RTX', 'NOC'],
            cards: [
              {
                symbol: 'LMT',
                role: 'missile defense, aeronautics, space systems, and backlog-to-revenue conversion',
                fundamentalBridge: 'revenue $71.0B; EPS $27.55; FCF $6.8B',
                valuationBridge: 'consensus revenue proxy $73.5B; P/E 17.2x',
                marketBridge: '0.80% relative return, t-stat 1.20',
                operatingBridge: 'issuer operating bridge: backlog, missile demand, segment guidance',
                kpiEvidence: ['backlog', 'missile demand', 'segment guidance'],
                thesisUse: 'thesis_validation',
                dataFlags: {
                  hasFundamentals: true,
                  hasValuation: true,
                  hasConsensus: true,
                  hasIssuerCommentary: true,
                  hasThemeKpiContext: true,
                  hasIssuerOperatingKpi: true,
                  hasMarketReaction: true,
                },
              },
              {
                symbol: 'GD',
                role: 'shipbuilding, combat systems, aerospace backlog, and yard-throughput execution',
                fundamentalBridge: 'issuer fundamentals are not yet deep enough',
                valuationBridge: 'recent price $292.10',
                marketBridge: '1.61% relative return, t-stat 0.49',
                operatingBridge: 'issuer operating bridge pending; theme-level KPI context includes contract awards, procurement budgets',
                kpiEvidence: [],
                themeKpiContext: ['contract awards', 'procurement budgets'],
                thesisUse: 'research_prioritization',
                dataFlags: {
                  hasFundamentals: false,
                  hasValuation: true,
                  hasConsensus: false,
                  hasIssuerCommentary: false,
                  hasThemeKpiContext: true,
                  hasIssuerOperatingKpi: false,
                  hasMarketReaction: true,
                },
              },
            ],
          },
        },
        investmentReadiness: {
          tier: 'signal_triage',
          blockers: ['theme ontology critical KPI coverage 73%; missing Defense book-to-bill'],
        },
      },
    },
  });
  const plan = renderClientMemoFromBlueprint(buildNarrativeBlueprint(bundle, buildSignalCards(bundle), {}));
  const issuerSection = plan.longFormSections.find((section) => section.key === 'issuerThesisAndValuationBridge');
  assert.ok(issuerSection, 'expected issuer thesis section');
  const text = issuerSection.paragraphs.map((paragraph) => paragraph.text).join(' ');
  assert.match(text, /company-level bridge/i);
  assert.match(text, /LMT.*backlog-to-revenue/i);
  assert.match(text, /GD.*shipbuilding/i);
  assert.match(text, /earnings revision|multiple expansion|downside-risk/i);
  assert.match(text, /Issuer-specific operating KPI bridge is missing for GD/i);
  assert.match(text, /consensus is missing for RTX, NOC, and GD/i);
  assert.doesNotMatch(text, /\b(buy|sell|price target|recommendation)\b/i);
});

test('issuer thesis memo exposes expectation bridge separately from valuation and market rows', () => {
  const bundle = planReportFigures({
    ...buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'AI / Machine Learning' }),
    metadata: {
      deepResearch: {
        ontologyPack: {
          ontologyKey: 'data_center_infrastructure',
          ontologyLabel: 'Data Center Infrastructure',
          issuerUniverseSymbols: ['AMD', 'MSFT'],
        },
        packs: {
          issuerThesisPack: {
            status: 'available',
            coverage: 0.9,
            consensusSymbols: ['AMD'],
            valuationSymbols: ['AMD'],
            missingConsensusSymbols: [],
            missingValuationSymbols: [],
            cards: [
              {
                symbol: 'AMD',
                role: 'accelerator supplier exposure through AI compute demand',
                fundamentalBridge: 'revenue $25.8B; EPS $1.20',
                valuationBridge: 'consensus revenue proxy $30.1B; P/E 42.0x',
                expectationBridge: 'market evidence decision-grade: 43.53% relative move, t-stat 12.69; consensus revenue proxy $30.1B vs attached revenue $25.8B (+16.7% spread; period alignment required); valuation multiple context: P/E 42.0x',
                expectationBridgeTier: 'expectation_validation',
                marketBridge: '43.53% relative return, t-stat 12.69',
                operatingBridge: 'issuer operating bridge: direct issuer commentary plus fundamental evidence; theme-level KPI context includes accelerator orders and data-center utilization; attribution still requires analyst validation',
                thesisUse: 'thesis_validation',
                dataFlags: {
                  hasFundamentals: true,
                  hasValuation: true,
                  hasConsensus: true,
                  hasIssuerCommentary: true,
                  hasThemeKpiContext: true,
                  hasIssuerOperatingBridge: true,
                  hasMarketReaction: true,
                },
              },
            ],
          },
        },
      },
    },
  });
  const plan = renderClientMemoFromBlueprint(buildNarrativeBlueprint(bundle, buildSignalCards(bundle), {}));
  const issuerSection = plan.longFormSections.find((section) => section.key === 'issuerThesisAndValuationBridge');
  assert.ok(issuerSection, 'expected issuer thesis section');
  const text = issuerSection.paragraphs.map((paragraph) => paragraph.text).join(' ');
  assert.match(text, /expectation read/i);
  assert.match(text, /consensus revenue proxy \$30\.1B vs attached revenue \$25\.8B/i);
  assert.match(text, /market evidence decision-grade/i);
  assert.doesNotMatch(text, /\b(buy|sell|price target|recommendation)\b/i);

  const html = renderReportHtml(bundle, {
    validation: { quality: { investmentReadiness: { marketValidation: {} } } },
    analysis: plan,
  });
  assert.match(html, /Expectation read/i);
  assert.match(html, /Valuation bridge/i);
  assert.match(html, /Market bridge/i);
});

test('issuer thesis narrative does not treat theme KPI context as issuer operating proof', () => {
  const bundle = planReportFigures({
    ...buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'Defense Industrial' }),
    metadata: {
      deepResearch: {
        packs: {
          issuerThesisPack: {
            status: 'available',
            coverage: 0.45,
            consensusSymbols: [],
            valuationSymbols: ['RTX'],
            missingConsensusSymbols: ['RTX'],
            missingValuationSymbols: [],
            cards: [
              {
                symbol: 'RTX',
                role: 'missile and air-defense exposure',
                fundamentalBridge: 'revenue $68.9B',
                valuationBridge: 'recent price $104.22',
                marketBridge: '0.45% relative return, t-stat 0.30',
                operatingBridge: 'issuer operating bridge pending; theme-level KPI context includes contract awards',
                themeKpiContext: ['contract awards'],
                thesisUse: 'research_prioritization',
                dataFlags: {
                  hasFundamentals: true,
                  hasValuation: true,
                  hasConsensus: false,
                  hasIssuerCommentary: false,
                  hasThemeKpiContext: true,
                  hasIssuerOperatingKpi: false,
                  hasMarketReaction: true,
                },
              },
            ],
          },
        },
      },
    },
  });
  const plan = renderClientMemoFromBlueprint(buildNarrativeBlueprint(bundle, buildSignalCards(bundle), {}));
  const issuerSection = plan.longFormSections.find((section) => section.key === 'issuerThesisAndValuationBridge');
  assert.ok(issuerSection, 'expected issuer thesis section');
  const text = issuerSection.paragraphs.map((paragraph) => paragraph.text).join(' ');
  assert.match(text, /RTX remain[s]? research-prioritization/i);
  assert.match(text, /Issuer-specific operating KPI bridge is missing for RTX/i);
  assert.doesNotMatch(text, /RTX has enough issuer-level evidence to support thesis-validation review/i);
});

test('issuer thesis narrative recognizes partial issuer operating bridge without calling it pending', () => {
  const bundle = planReportFigures({
    ...buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'AI / Machine Learning' }),
    metadata: {
      deepResearch: {
        packs: {
          issuerThesisPack: {
            status: 'available',
            coverage: 0.82,
            consensusSymbols: ['MSFT'],
            valuationSymbols: ['MSFT'],
            missingConsensusSymbols: [],
            missingValuationSymbols: [],
            cards: [
              {
                symbol: 'MSFT',
                role: 'theme-exposed issuer requiring operating validation',
                fundamentalBridge: 'revenue $651.1B; capex $44.5B',
                valuationBridge: 'consensus revenue proxy $651.1B; P/E 29.2x',
                marketBridge: '0.24% relative return, t-stat 0.42',
                operatingBridge: 'issuer operating bridge: direct issuer commentary plus fundamental evidence; theme-level KPI context includes Data center power and MW capacity, Hyperscaler capex; attribution still requires analyst validation',
                kpiEvidence: [],
                themeKpiContext: ['Data center power and MW capacity', 'Hyperscaler capex'],
                thesisUse: 'thesis_validation',
                dataFlags: {
                  hasFundamentals: true,
                  hasValuation: true,
                  hasConsensus: true,
                  hasIssuerCommentary: true,
                  hasThemeKpiContext: true,
                  hasIssuerOperatingKpi: false,
                  hasIssuerOperatingBridge: true,
                  hasMarketReaction: true,
                },
              },
            ],
          },
        },
      },
    },
  });
  const plan = renderClientMemoFromBlueprint(buildNarrativeBlueprint(bundle, buildSignalCards(bundle), {}));
  const issuerSection = plan.longFormSections.find((section) => section.key === 'issuerThesisAndValuationBridge');
  assert.ok(issuerSection, 'expected issuer thesis section');
  const text = issuerSection.paragraphs.map((paragraph) => paragraph.text).join(' ');
  assert.match(text, /MSFT has enough issuer-level evidence to support thesis-validation review/i);
  assert.match(text, /direct issuer commentary plus fundamental evidence/i);
  assert.doesNotMatch(text, /Issuer-specific operating KPI bridge is missing for MSFT/i);
});

test('market anchor prose does not call weak t-stat moves notable', () => {
  const bundle = planReportFigures({
    ...buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'Defense Industrial' }),
    marketReactions: [
      {
        reactionId: 'MRKT-LMT',
        symbol: 'LMT',
        relativeReturnPct: -5.39,
        tStat: 0.08,
        eventWindow: '1w',
        controls: ['sample_size=403'],
        validationStatus: 'validated',
      },
    ],
    metadata: {
      deepResearch: {
        investmentReadiness: {
          tier: 'thesis_validation',
          blockers: [],
          decisionValidationGaps: ['controlled market validation is weak-screen; strongest t-stat 0.08 is below decision-grade or lacks benchmark/factor/regime controls'],
          marketValidation: { tier: 'weak_screen', score: 0.28, maxAbsTStat: 0.08 },
          availableCorePackCount: 5,
          requiredCorePackCount: 4,
          sampleAdequacy: 'investment_memo',
          sourceDiversity: 0.92,
          directManagementCommentarySymbolCount: 4,
          requiredTranscriptSymbolCount: 3,
        },
      },
    },
  });
  const plan = renderClientMemoFromBlueprint(buildNarrativeBlueprint(bundle, buildSignalCards(bundle), {}));
  const text = plan.longFormSections
    .flatMap((section) => section.paragraphs)
    .map((paragraph) => paragraph.text)
    .join(' ');

  assert.match(text, /LMT screens as the strongest monitored market anchor/i);
  assert.match(text, /negative move is not decision-useful/i);
  assert.doesNotMatch(text, /magnitude is notable/i);
});

test('thesis-validation memo narrative does not overstate investment readiness', () => {
  const bundle = planReportFigures({
    ...buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'AI / Machine Learning' }),
    metadata: {
      deepResearch: {
        investmentReadiness: {
          tier: 'investment_memo_candidate',
          blockers: [],
          availableCorePackCount: 5,
          requiredCorePackCount: 4,
          sampleAdequacy: 'investment_memo',
          sourceDiversity: 0.92,
          directManagementCommentarySymbolCount: 4,
          requiredTranscriptSymbolCount: 3,
        },
      },
    },
  });
  const signalCards = buildSignalCards(bundle);
  const plan = renderClientMemoFromBlueprint(buildNarrativeBlueprint(bundle, signalCards, {}));
  const text = plan.longFormSections
    .flatMap((section) => section.paragraphs)
    .map((paragraph) => paragraph.text)
    .join(' ');

  assert.match(text, /thesis validation/i);
  assert.match(text, /decision-grade validation|controlled market sensitivity/i);
  assert.match(text, /No report-blocking evidence gap/i);
  assert.doesNotMatch(text, /investment-memo candidate|memo-candidate review|memo candidate/i);
  assert.doesNotMatch(text, /binding blocker|primary evidence blocker|missing core evidence|research-prioritization scope/i);
  assert.doesNotMatch(text, /does not yet have the primary operating confirmation/i);
  assert.doesNotMatch(text, /not ready to be treated as a finished investment call/i);
  assert.doesNotMatch(text, /remain in discovery/i);

  const validation = {
    ok: true,
    quality: {
      publishable: true,
      productTier: 'investment_memo_candidate',
      investmentReadiness: {
        tier: 'investment_memo_candidate',
        blockers: [],
      },
      publishabilityReasons: [],
    },
  };
  const html = renderReportHtml(bundle, { analysis: plan, validation });
  const markdown = renderReportMarkdown(bundle, { analysis: plan, validation });
  assert.match(html, /Thesis validation memo/i);
  assert.match(html, /Investment memo preparation/i);
  assert.match(html, /Review-ready, not decision-ready/i);
  assert.match(html, /Not actionable/i);
  assert.match(html, /No report-blocking evidence gap/i);
  assert.match(html, /decision-grade validation is still required/i);
  assert.doesNotMatch(html, /Investment memo candidate|Investment-memo candidate|No blocker-level/i);
  assert.doesNotMatch(html, /<code>theme_report<\/code>|&middot; client memo|appendixtheme_report/i);
  assert.match(markdown, /Scope: Thesis validation memo/i);
  assert.match(markdown, /Decision use: Investment memo preparation/i);
  assert.match(markdown, /Portfolio use: Not actionable/i);
});

test('memo candidate with decision-grade market validation is labeled analyst action review, not a recommendation', () => {
  const bundle = planReportFigures({
    ...buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'AI / Machine Learning' }),
    metadata: {
      deepResearch: {
        investmentReadiness: {
          tier: 'investment_memo_candidate',
          blockers: [],
          decisionValidationGaps: [],
          marketValidation: {
            tier: 'decision_grade',
            decisionGradeRowCount: 3,
            maxAbsTStat: 4.2,
          },
        },
      },
    },
  });
  const plan = renderClientMemoFromBlueprint(buildNarrativeBlueprint(bundle, buildSignalCards(bundle), {}));
  const validation = {
    ok: true,
    quality: {
      publishable: true,
      productTier: 'investment_memo_candidate',
      investmentReadiness: {
        tier: 'investment_memo_candidate',
        blockers: [],
        decisionValidationGaps: [],
        marketValidation: {
          tier: 'decision_grade',
          decisionGradeRowCount: 3,
          maxAbsTStat: 4.2,
        },
      },
      publishabilityReasons: [],
    },
  };
  const html = renderReportHtml(bundle, { analysis: plan, validation });
  const markdown = renderReportMarkdown(bundle, { analysis: plan, validation });
  assert.match(html, /portfolio use<\/span><strong>Analyst action review/i);
  assert.match(markdown, /Portfolio use: Analyst action review/i);
  assert.doesNotMatch(`${html}\n${markdown}`, /\b(buy|sell|price target|recommendation)\b/i);
});

test('thesis-validation information gaps do not include stale warning-level fallback when blockers are cleared', () => {
  const bundle = planReportFigures({
    ...buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'AI / Machine Learning' }),
    caveats: [
      {
        caveatId: 'CAV-DEEP-DECISION-VALIDATION',
        severity: 'medium',
        type: 'decision_validation_gap',
        text: 'No report-blocking evidence gap is attached, but decision-grade validation remains incomplete: controlled market validation is screening-grade.',
        appliesToClaimIds: ['CLM-001'],
      },
    ],
    metadata: {
      deepResearch: {
        investmentReadiness: {
          tier: 'thesis_validation',
          blockers: [],
          decisionValidationGaps: ['controlled market validation is screening-grade'],
          availableCorePackCount: 5,
          requiredCorePackCount: 4,
          sampleAdequacy: 'investment_memo',
          sourceDiversity: 1,
          directManagementCommentarySymbolCount: 5,
          requiredTranscriptSymbolCount: 3,
        },
      },
    },
  });
  const analysis = generateDeterministicAnalystDraft(bundle);
  const gapText = analysis.informationGaps.map((item) => item.text).join(' ');
  assert.doesNotMatch(gapText, /Validation is warning-level/i);
  assert.doesNotMatch(gapText, /research-prioritization scope until missing evidence/i);
  assert.match(gapText, /decision-grade validation remains incomplete/i);
});

test('deep research market validation preserves regime consistency without promoting to decision grade', async () => {
  const bundle = {
    ...buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'AI / Machine Learning' }),
    marketReactions: [
      {
        reactionId: 'MRKT-AMD-REGIME',
        symbol: 'AMD',
        eventWindow: '1m',
        relativeReturnPct: 50,
        tStat: 1.6,
        validationStatus: 'validated',
        sampleSize: 1000,
        controls: ['benchmark=QQQ', 'factor=SOXX', 'regime_count=2'],
        metadata: {
          regimeControls: {
            regimes: [
              { regime: 'balanced', horizon: '1m', avg_return: 40, hit_rate: 0.9, sample_size: 500 },
              { regime: 'crisis', horizon: '1m', avg_return: 35, hit_rate: 0.8, sample_size: 300 },
            ],
          },
        },
      },
    ],
  };
  const deepBundle = await attachDeepResearchPack(bundle);
  const marketValidation = deepBundle.metadata?.deepResearch?.investmentReadiness?.marketValidation;
  assert.equal(marketValidation.tier, 'screening_grade');
  assert.equal(marketValidation.decisionGradeRowCount, 0);
  assert.equal(marketValidation.screeningGradeRowCount, 1);
  assert.equal(marketValidation.regimeSupportRowCount, 1);
  assert.equal(marketValidation.rows[0].regimeConsistent, true);
  assert.match(marketValidation.rows[0].regimeSupportLabel, /same-direction regime\/horizon rows/);
});

test('deep research market validation recognizes underscored benchmark and factor controls', async () => {
  const bundle = {
    ...buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'Grid Power' }),
    marketReactions: [
      {
        reactionId: 'MRKT-PWR-REPORT-CONTROLS',
        symbol: 'PWR',
        eventWindow: '5d',
        relativeReturnPct: 1.2,
        tStat: 2.4,
        validationStatus: 'validated',
        sampleSize: 240,
        controls: ['market_quotes_report_controls', 'benchmark_spy_qqq', 'sector_factor_xli_xlu'],
      },
    ],
  };
  const deepBundle = await attachDeepResearchPack(bundle);
  const marketValidation = deepBundle.metadata?.deepResearch?.investmentReadiness?.marketValidation;
  assert.equal(marketValidation.tier, 'decision_grade');
  assert.equal(marketValidation.decisionGradeRowCount, 1);
  assert.equal(marketValidation.rows[0].hasBenchmarkControl, true);
  assert.equal(marketValidation.rows[0].hasFactorControl, true);
});

test('strict endogenous adjacent market validation ignores rows without direct issuer bridge', async () => {
  const bundle = {
    ...buildSampleReportBundle(REPORT_TYPES.CROSS_THEME, { subject: 'approved-supplier qualification lead time' }),
    subject: {
      subjectType: 'cross_theme_candidate',
      subjectId: 'endogenous-adjacent-clean-energy-generated-approved-supplier-qualification-lead-time',
      displayName: 'approved-supplier qualification lead time',
      metadata: {
        themes: ['clean-energy'],
        discovery: {
          discoveryNamespace: 'strict_endogenous_adjacent',
          frontierDiscovery: true,
          connector: 'Clean Energy',
          concreteBottleneckNodes: [
            { node: 'approved-supplier qualification lead time', key: 'approved_supplier_onboarding' },
          ],
        },
      },
    },
    marketReactions: [
      {
        reactionId: 'MRKT-META-UNRELATED',
        symbol: 'META',
        eventWindow: '2w',
        relativeReturnPct: 9,
        tStat: 121,
        validationStatus: 'validated',
        sampleSize: 765,
        controls: ['matched_controls', 'factor=QQQ'],
      },
    ],
    metadata: {
      adjacentCandidate: {
        metadata: {
          discoveryNamespace: 'strict_endogenous_adjacent',
          frontierDiscovery: true,
          themes: ['clean-energy'],
        },
      },
    },
  };
  const deepBundle = await attachDeepResearchPack(bundle);
  const readiness = deepBundle.metadata?.deepResearch?.investmentReadiness;
  const marketValidation = deepBundle.metadata?.deepResearch?.investmentReadiness?.marketValidation;
  assert.equal(readiness.tier, 'signal_triage');
  assert.ok(readiness.blockers.some((item) => /no direct issuer bridge/i.test(item)));
  assert.equal(marketValidation.tier, 'missing');
  assert.equal(marketValidation.rowCount, 0);
  assert.equal(marketValidation.missingReason, 'no_direct_issuer_bridge');
  assert.match(marketValidation.gap, /no direct issuer bridge/i);
  const matrix = deepBundle.metadata?.deepResearch?.evidenceClassMatrix || [];
  const marketRow = matrix.find((row) => row.evidenceClass === 'market_validation');
  assert.notEqual(marketRow?.status, 'promotion_eligible');
});

test('strict endogenous direct extraction ignores query-term scaffolding and generic issuer text', () => {
  const bundle = {
    reportType: REPORT_TYPES.CROSS_THEME,
    subject: {
      metadata: {
        discovery: {
          generatedLane: true,
          connector: 'Clean Energy',
          adjacentLane: 'generated_approved-supplier-qualification-lead-time',
          triggerTerms: ['grid interconnection queue', 'approved supplier qualification lead time'],
          concreteBottleneckNodes: [
            {
              node: 'approved-supplier qualification lead time',
              acceptanceCriteria: ['supplier onboarding or qualification lead time'],
            },
          ],
        },
      },
    },
    metadata: {
      strictEndogenousAdjacent: true,
      candidateIssuerUniverse: ['ETN'],
    },
  };
  const rows = buildEvidenceClassExtractionRows(bundle, {
    transcripts: [
      {
        id: 'generic-leadership',
        symbol: 'ETN',
        source_type: 'sec_investor_presentation_exhibit',
        title: 'ETN 8-K exhibit earnings-release commentary',
        excerpt: 'During his time with Eaton, Olivier helped build readiness and agility as we lead, invest and execute for growth.',
        fact_text: 'Backlog guidance grid interconnection queue approved supplier qualification lead time',
        metadata: {
          sourceType: 'sec_investor_presentation_exhibit',
          extractionTerms: ['backlog', 'guidance', 'grid interconnection queue', 'approved supplier qualification lead time'],
        },
      },
      {
        id: 'direct-bottleneck',
        symbol: 'ETN',
        source_type: 'sec_investor_presentation_exhibit',
        title: 'ETN investor presentation commentary',
        excerpt: 'Management said grid interconnection queue delays are increasing demand for electrical equipment orders and backlog tied to utility customers.',
        metadata: { sourceType: 'sec_investor_presentation_exhibit' },
      },
      {
        id: 'theme-summary-no-symbol',
        source_type: 'daily_curated_news',
        title: 'Clean Energy theme summary',
        excerpt: 'Clean Energy saw growing demand and customer activity, but this is a broad theme summary without issuer-specific exposure.',
        metadata: { sourceType: 'daily_curated_news' },
      },
    ],
  });
  assert.equal(rows.some((row) => row.metadata?.sourceRowId === 'generic-leadership'), false);
  assert.equal(rows.some((row) => row.metadata?.sourceRowId === 'theme-summary-no-symbol'), false);
  const direct = rows.find((row) => row.metadata?.sourceRowId === 'direct-bottleneck' && row.evidenceClass === 'issuer_exposure');
  assert.ok(direct, 'expected direct provider evidence only when the current bottleneck phrase is in the provider excerpt');
  assert.equal(direct.metadata?.strictContextTerms?.includes('grid interconnection queue'), true);
  assert.match(direct.fact_text, /grid interconnection queue delays/i);
});

test('frontier parent extraction requires the narrow node term, not partial broad wording', () => {
  const bundle = {
    reportType: REPORT_TYPES.CROSS_THEME,
    subject: {
      displayName: 'high-voltage switchgear',
      metadata: {
        discovery: {
          connector: 'high-voltage switchgear',
          triggerTerms: ['high-voltage switchgear'],
        },
      },
    },
    metadata: {
      candidate: {
        evidence_summary: {
          frontierParentCollectionEligible: true,
        },
      },
      candidateIssuerUniverse: ['PWR', 'ETN'],
    },
  };
  const rows = buildEvidenceClassExtractionRows(bundle, {
    transcripts: [
      {
        id: 'partial-high-voltage',
        symbol: 'PWR',
        source_type: 'sec_direct_management_commentary',
        excerpt: 'high-voltage substation, transformer and transmission interconnection infrastructure to connect data center facilities to the grid.',
        metadata: { sourceType: 'sec_direct_management_commentary' },
      },
      {
        id: 'direct-switchgear',
        symbol: 'ETN',
        source_type: 'sec_direct_management_commentary',
        excerpt: 'Management described high-voltage switchgear demand, long lead times, backlog, and utility customer orders.',
        metadata: { sourceType: 'sec_direct_management_commentary' },
      },
    ],
  });
  assert.equal(rows.some((row) => row.metadata?.sourceRowId === 'partial-high-voltage'), false);
  assert.equal(rows.some((row) => row.metadata?.sourceRowId === 'direct-switchgear' && row.evidenceClass === 'issuer_exposure'), true);
});

test('deep research market validation keeps small-sample outliers out of headline rows', async () => {
  const bundle = {
    ...buildSampleReportBundle(REPORT_TYPES.CROSS_THEME, { subject: 'Solid rocket motor capacity' }),
    marketReactions: [
      {
        reactionId: 'MRKT-RKLB-DECISION',
        symbol: 'RKLB',
        eventWindow: '1w',
        relativeReturnPct: 8,
        tStat: 3.2,
        validationStatus: 'validated',
        sampleSize: 120,
        controls: ['matched_controls', 'macro_regime_matched_controls'],
      },
      {
        reactionId: 'MRKT-IRDM-SMALL-N',
        symbol: 'IRDM',
        eventWindow: '1w',
        relativeReturnPct: 40,
        tStat: 20,
        validationStatus: 'screened',
        sampleSize: 3,
        controls: ['matched_controls', 'macro_regime_matched_controls'],
      },
    ],
  };
  const deepBundle = await attachDeepResearchPack(bundle);
  const marketValidation = deepBundle.metadata?.deepResearch?.investmentReadiness?.marketValidation;
  assert.equal(marketValidation.tier, 'decision_grade');
  assert.equal(marketValidation.best.symbol, 'RKLB');
  assert.equal(marketValidation.maxAbsTStat, 3.2);
  assert.equal(marketValidation.screenedOutliers.some((row) => row.symbol === 'IRDM'), true);
});

test('deep research pack exposes institutional evidence density and queues weak table lanes', async () => {
  const bundle = buildThemeReportBundle({
    theme: {
      key: 'ai-ml',
      label: 'AI / Machine Learning',
      yoy: 12,
      acceleration: 4,
      sourceDiversity: 0.62,
    },
    evidence: [
      { evidenceId: 'EVID-001', kind: 'news_article', publisher: 'Sample Source', title: 'AI demand remains under review', freshnessStatus: 'fresh' },
    ],
  });
  const deepBundle = await attachDeepResearchPack(bundle);
  const institutionalPack = deepBundle.metadata?.deepResearch?.packs?.institutionalEvidencePack;
  assert.ok(institutionalPack, 'expected institutional evidence pack');
  assert.equal(institutionalPack.status, 'gap');
  assert.ok(institutionalPack.dimensions.some((dimension) => dimension.key === 'controlled_market_validation'));
  assert.ok(institutionalPack.blockingDimensions.length > 0);
  assert.ok(deepBundle.metrics.some((metric) => metric.metricId === 'MET-DEEP-INSTITUTIONAL-EVIDENCE-DENSITY'));
  assert.ok(deepBundle.caveats.some((caveat) => caveat.caveatId === 'CAV-DEEP-INSTITUTIONAL-EVIDENCE-DENSITY'));
  assert.ok(deepBundle.watchIndicators.some((watch) => watch.metadata?.packName === 'institutionalEvidencePack'));
  assert.ok(deepBundle.metadata.deepResearch.collectionPlan.some((task) => task.packName === 'institutionalEvidencePack'));
  const figuredBundle = planReportFigures(deepBundle);
  assert.ok(figuredBundle.figures.some((figure) => figure.figureId === 'FIG-DEEP-INSTITUTIONAL-EVIDENCE'));
});
