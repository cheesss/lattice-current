import assert from 'node:assert/strict';
import test from 'node:test';

import { computeCrossThemeDiscoveryQuality } from '../scripts/_shared/cross-theme-discovery-quality.mjs';
import { computeReportQuality } from '../scripts/_shared/report-quality.mjs';

function block(text = 'Evidence-bound analyst paragraph.', refs = true) {
  return refs
    ? { text, claimIds: ['CLM-1'], evidenceIds: ['EVID-1'] }
    : { text };
}

function fullDeepAnalysis() {
  const sections = [
    'keyJudgments',
    'thesis',
    'catalysts',
    'dataDepth',
    'causalChain',
    'historicalAnalogues',
    'evidenceSynthesis',
    'timeline',
    'marketTransmission',
    'scenarios',
    'risks',
    'analyticalAssessment',
    'decisionUse',
    'feedbackLearning',
    'watchNext',
    'analystConclusion',
  ];
  return Object.fromEntries(sections.map((section) => [section, [block(`${section} explains the evidence-backed implication with context and limits.`)]]));
}

test('deep reports cannot remain S/publishable when evidence diversity is below target', () => {
  const bundle = {
    reportType: 'theme_report',
    subject: { subjectId: 'technology-general', displayName: 'Technology General' },
    claims: [{
      claimId: 'CLM-1',
      confidenceLevel: 'medium',
      supportingEvidenceIds: ['EVID-1'],
      supportingMetricIds: ['MET-DEEP-DATA-DEPTH', 'MET-DEEP-CAUSAL-EDGES', 'MET-DEEP-HISTORICAL-ANALOGS'],
      supportingFigureIds: ['FIG-1'],
    }],
    evidence: [
      { evidenceId: 'EVID-1', publisher: 'One Source', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-2', publisher: 'One Source', freshnessStatus: 'fresh' },
    ],
    sourceSummary: { distinctSources: 2, sourceDiversityScore: 0.65, lowDiversityFlag: false },
    dataFreshness: [],
    metrics: [
      { metricId: 'MET-DEEP-DATA-DEPTH', value: 0.9 },
      { metricId: 'MET-DEEP-CAUSAL-EDGES', value: 3 },
      { metricId: 'MET-DEEP-HISTORICAL-ANALOGS', value: 2 },
    ],
    figures: [{ figureId: 'FIG-1', analyticQuestion: 'What changed?', supportedClaimIds: ['CLM-1'] }],
    caveats: [],
    watchIndicators: [{ label: 'Watch source diversity', source: 'source-registry', horizon: '7d' }],
    metadata: { deepResearch: { gaps: [] } },
  };

  const quality = computeReportQuality(bundle, { blockers: [], exportIntegrity: 1 }, fullDeepAnalysis());
  assert.equal(quality.publishable, false);
  assert.equal(quality.publishabilityReasons.includes('evidence diversity is below institutional target'), true);
  assert.equal(['B', 'C', 'D'].includes(quality.grade), true);
});

test('deep research provenance can clear a news-only source diversity cap', () => {
  const analysis = Object.fromEntries([
    'keyJudgments',
    'thesis',
    'catalysts',
    'dataDepth',
    'causalChain',
    'historicalAnalogues',
    'evidenceSynthesis',
    'timeline',
    'marketTransmission',
    'scenarios',
    'risks',
    'analyticalAssessment',
    'decisionUse',
    'feedbackLearning',
    'watchNext',
    'analystConclusion',
  ].map((section) => [section, [block(`${section} explains the supported implication with context, limits, and decision use.`)]]));
  const bundle = {
    reportType: 'theme_report',
    subject: { subjectId: 'ai-ml', displayName: 'AI / Machine Learning' },
    claims: [{
      claimId: 'CLM-1',
      confidenceLevel: 'medium',
      supportingEvidenceIds: ['EVID-1'],
      supportingMetricIds: ['MET-DEEP-DATA-DEPTH', 'MET-DEEP-CAUSAL-EDGES', 'MET-DEEP-HISTORICAL-ANALOGS'],
      supportingFigureIds: ['FIG-1'],
    }],
    evidence: [
      { evidenceId: 'EVID-1', publisher: 'News Source', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-2', publisher: 'News Source', freshnessStatus: 'fresh' },
    ],
    sourceSummary: { distinctSources: 2, sourceDiversityScore: 0.65, lowDiversityFlag: false },
    dataFreshness: [],
    metrics: [
      { metricId: 'MET-DEEP-DATA-DEPTH', value: 0.9 },
      { metricId: 'MET-DEEP-CAUSAL-EDGES', value: 3 },
      { metricId: 'MET-DEEP-HISTORICAL-ANALOGS', value: 2 },
    ],
    figures: [{ figureId: 'FIG-1', analyticQuestion: 'What changed?', supportedClaimIds: ['CLM-1'] }],
    caveats: [],
    watchIndicators: [{ label: 'Watch management commentary', source: 'sec-edgar', horizon: '7d' }],
    metadata: {
      deepResearch: {
        gaps: [],
        investmentReadiness: {
          tier: 'investment_memo_candidate',
          blockers: [],
          sourceDiversity: 0.88,
          newsSourceDiversity: 0.65,
          researchSourceDiversity: 0.88,
          sourceDiversityBasis: 'deep_research_pack_provenance',
          availableCorePackCount: 5,
          requiredCorePackCount: 4,
          sampleAdequacy: 'investment_memo',
          transcriptProxyCount: 0,
          directManagementCommentarySymbolCount: 4,
          requiredTranscriptSymbolCount: 3,
        },
      },
    },
  };

  const quality = computeReportQuality(bundle, { blockers: [], exportIntegrity: 1 }, analysis);
  assert.equal(quality.publishabilityReasons.includes('evidence diversity is below institutional target'), false);
  assert.equal(quality.metrics.analysis_evidenceDiversity >= 0.88, true);
  assert.equal(quality.investmentReadinessQuality.metrics.diversityScore, 0.88);
});

test('institutional evidence density caps deep reports until quantitative tables are review-grade', () => {
  const analysis = fullDeepAnalysis();
  const bundle = {
    reportType: 'theme_report',
    subject: { subjectId: 'ai-ml', displayName: 'AI / Machine Learning' },
    claims: [{
      claimId: 'CLM-1',
      confidenceLevel: 'medium',
      supportingEvidenceIds: ['EVID-1'],
      supportingMetricIds: [
        'MET-DEEP-DATA-DEPTH',
        'MET-DEEP-CAUSAL-EDGES',
        'MET-DEEP-HISTORICAL-ANALOGS',
        'MET-DEEP-INSTITUTIONAL-EVIDENCE-DENSITY',
      ],
      supportingFigureIds: ['FIG-1'],
    }],
    evidence: [
      { evidenceId: 'EVID-1', publisher: 'News Source', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-2', publisher: 'Research Source', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-3', publisher: 'Company Source', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-4', publisher: 'Market Source', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-5', publisher: 'Policy Source', freshnessStatus: 'fresh' },
    ],
    sourceSummary: { distinctSources: 5, sourceDiversityScore: 1, lowDiversityFlag: false },
    dataFreshness: [],
    metrics: [
      { metricId: 'MET-DEEP-DATA-DEPTH', value: 0.9 },
      { metricId: 'MET-DEEP-CAUSAL-EDGES', value: 3 },
      { metricId: 'MET-DEEP-HISTORICAL-ANALOGS', value: 2 },
      { metricId: 'MET-DEEP-INSTITUTIONAL-EVIDENCE-DENSITY', value: 0.32 },
    ],
    figures: [{ figureId: 'FIG-1', analyticQuestion: 'What changed?', supportedClaimIds: ['CLM-1'] }],
    caveats: [{ caveatId: 'CAV-INST', type: 'institutional_evidence_gap', text: 'Institutional evidence tables are thin.' }],
    watchIndicators: [{ label: 'Collect valuation tables', source: 'report-backfill-tasks', horizon: '30d' }],
    metadata: {
      deepResearch: {
        gaps: [],
        packs: {
          institutionalEvidencePack: {
            tier: 'institutional_gap',
            coverageScore: 0.32,
          },
        },
        investmentReadiness: {
          tier: 'thesis_validation',
          blockers: [],
          sourceDiversity: 1,
          availableCorePackCount: 5,
          requiredCorePackCount: 4,
          sampleAdequacy: 'investment_memo',
          transcriptProxyCount: 0,
          directManagementCommentarySymbolCount: 4,
          requiredTranscriptSymbolCount: 3,
        },
      },
    },
  };

  const quality = computeReportQuality(bundle, { blockers: [], exportIntegrity: 1 }, analysis);
  assert.equal(quality.publishable, false);
  assert.equal(quality.publishabilityReasons.includes('institutional evidence tables are below publishable density'), true);
  assert.equal(quality.metrics.analysis_institutionalEvidenceDensity, 0.32);
  assert.equal(['C', 'D'].includes(quality.analysisGrade), true);
});

test('weak controlled market validation caps investment readiness even when evidence packs are broad', () => {
  const analysis = fullDeepAnalysis();
  const bundle = {
    reportType: 'theme_report',
    subject: { subjectId: 'defense-industrial', displayName: 'Defense Industrial' },
    claims: [{
      claimId: 'CLM-1',
      confidenceLevel: 'medium',
      supportingEvidenceIds: ['EVID-1'],
      supportingMetricIds: ['MET-DEEP-DATA-DEPTH', 'MET-DEEP-CAUSAL-EDGES', 'MET-DEEP-HISTORICAL-ANALOGS', 'MET-DEEP-MARKET-VALIDATION'],
      supportingFigureIds: ['FIG-1'],
    }],
    evidence: [
      { evidenceId: 'EVID-1', publisher: 'News Source', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-2', publisher: 'Research Source', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-3', publisher: 'Company Source', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-4', publisher: 'Market Source', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-5', publisher: 'Policy Source', freshnessStatus: 'fresh' },
    ],
    sourceSummary: { distinctSources: 5, sourceDiversityScore: 1, lowDiversityFlag: false },
    dataFreshness: [],
    metrics: [
      { metricId: 'MET-DEEP-DATA-DEPTH', value: 0.9 },
      { metricId: 'MET-DEEP-CAUSAL-EDGES', value: 3 },
      { metricId: 'MET-DEEP-HISTORICAL-ANALOGS', value: 2 },
      { metricId: 'MET-DEEP-MARKET-VALIDATION', value: 0.38 },
    ],
    figures: [{ figureId: 'FIG-1', analyticQuestion: 'What changed?', supportedClaimIds: ['CLM-1'] }],
    caveats: [{ caveatId: 'CAV-MARKET', type: 'decision_validation_gap', text: 'Controlled market validation is screening-grade.' }],
    watchIndicators: [{ label: 'Run controlled event study', source: 'report-backfill-tasks', horizon: '30d' }],
    metadata: {
      deepResearch: {
        gaps: [],
        investmentReadiness: {
          tier: 'thesis_validation',
          blockers: [],
          decisionValidationGaps: ['controlled market validation is weak-screen; strongest t-stat 0.49 is below decision-grade or lacks benchmark/factor/regime controls'],
          marketValidation: { tier: 'weak_screen', score: 0.38, maxAbsTStat: 0.49 },
          sourceDiversity: 1,
          availableCorePackCount: 5,
          requiredCorePackCount: 4,
          sampleAdequacy: 'investment_memo',
          transcriptProxyCount: 0,
          directManagementCommentarySymbolCount: 4,
          requiredTranscriptSymbolCount: 3,
          ontologyCoverage: {
            ontologyKey: 'defense_industrial',
            requiredKpiCoverage: 0.91,
            investmentCriticalGapCount: 0,
            issuerCommentaryCoverage: 1,
          },
        },
      },
    },
  };

  const quality = computeReportQuality(bundle, { blockers: [], exportIntegrity: 1 }, analysis);
  assert.equal(quality.productTier, 'thesis_validation');
  assert.equal(quality.investmentReadinessQuality.grade, 'B');
  assert.equal(quality.investmentReadinessQuality.metrics.decisionValidationGapCount, 1);
  assert.equal(quality.investmentReadinessQuality.metrics.marketValidationTier, 'weak_screen');
});

test('strict frontier discovery cannot earn S from context without source-derived node support', () => {
  const evidence = [
    {
      evidenceId: 'E1',
      title: 'substation protection relay qualification lead time supplier capacity backlog direct evidence',
      publisher: 'official-source-1',
      evidenceGrade: 'direct',
      metadata: { desiredEvidenceClass: 'supplier_capacity', evidenceUse: 'promotion_candidate', promotionEligible: true, directness: 'direct' },
    },
    {
      evidenceId: 'E2',
      title: 'certified substation automation requires qualification evidence direct',
      publisher: 'official-source-2',
      evidenceGrade: 'direct',
      metadata: { desiredEvidenceClass: 'technical_qualification', evidenceUse: 'promotion_candidate', promotionEligible: true, directness: 'direct' },
    },
    {
      evidenceId: 'E3',
      title: 'approved supplier hard to substitute protection relay settings direct',
      publisher: 'official-source-3',
      evidenceGrade: 'direct',
      metadata: { desiredEvidenceClass: 'substitution_limit', evidenceUse: 'promotion_candidate', promotionEligible: true, directness: 'direct' },
    },
    {
      evidenceId: 'E4',
      title: 'issuer ACME has backlog and revenue exposure to substation protection relay direct',
      publisher: 'official-source-4',
      evidenceGrade: 'direct',
      metadata: { desiredEvidenceClass: 'issuer_exposure', evidenceUse: 'promotion_candidate', promotionEligible: true, directness: 'direct' },
    },
  ];
  const quality = computeCrossThemeDiscoveryQuality({
    reportType: 'cross_theme_bottleneck_report',
    subject: {
      subjectType: 'cross_theme_candidate',
      displayName: 'substation protection relay qualification lead time',
      metadata: {
        discovery: {
          discoveryNamespace: 'strict_endogenous_adjacent',
          concreteBottleneckNodes: [{ node: 'substation protection relay qualification lead time' }],
        },
      },
    },
    evidence,
    metadata: {
      adjacentCandidate: {
        metadata: {
          discoveryNamespace: 'strict_endogenous_adjacent',
          frontierDiscovery: true,
          frontierNodeSupported: false,
          sourceDerivedNodeCount: 0,
          scarcityEvidenceScore: 0.1,
          nonObviousDiscovery: {
            frontierScore: 72,
            scarcitySignalScore: 0.1,
          },
        },
      },
      deepResearch: {
        universalEvidenceContract: {
          requiredClasses: [
            { evidenceClass: 'supplier_capacity' },
            { evidenceClass: 'technical_qualification' },
            { evidenceClass: 'substitution_limit' },
            { evidenceClass: 'issuer_exposure' },
          ],
        },
      },
    },
  });

  assert.equal(quality.metrics.frontierDiscovery, 1);
  assert.equal(quality.metrics.frontierNodeSupported, 0);
  assert.equal(quality.caps.includes('B'), true);
  assert.notEqual(quality.grade, 'S');
});

test('theme ontology critical gaps cap investment readiness even when packs are broad', () => {
  const analysis = fullDeepAnalysis();
  const bundle = {
    reportType: 'theme_report',
    subject: { subjectId: 'defense-industrial', displayName: 'Defense Industrial' },
    claims: [{
      claimId: 'CLM-1',
      confidenceLevel: 'medium',
      supportingEvidenceIds: ['EVID-1'],
      supportingMetricIds: ['MET-DEEP-DATA-DEPTH', 'MET-DEEP-CAUSAL-EDGES', 'MET-DEEP-HISTORICAL-ANALOGS', 'MET-DEEP-ONTOLOGY-COVERAGE'],
      supportingFigureIds: ['FIG-1'],
    }],
    evidence: [
      { evidenceId: 'EVID-1', publisher: 'News Source', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-2', publisher: 'Research Source', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-3', publisher: 'Policy Source', freshnessStatus: 'fresh' },
    ],
    sourceSummary: { distinctSources: 31, sourceDiversityScore: 0.87, lowDiversityFlag: false },
    dataFreshness: [],
    metrics: [
      { metricId: 'MET-DEEP-DATA-DEPTH', value: 0.9 },
      { metricId: 'MET-DEEP-CAUSAL-EDGES', value: 3 },
      { metricId: 'MET-DEEP-HISTORICAL-ANALOGS', value: 2 },
      { metricId: 'MET-DEEP-ONTOLOGY-COVERAGE', value: 0.25 },
    ],
    figures: [{ figureId: 'FIG-1', analyticQuestion: 'What changed?', supportedClaimIds: ['CLM-1'] }],
    caveats: [{ caveatId: 'CAV-ONTOLOGY', type: 'theme_ontology_gap', text: 'Missing defense-specific operating KPIs.' }],
    watchIndicators: [{ label: 'Collect defense backlog', source: 'report-backfill-tasks', horizon: '30d' }],
    metadata: {
      deepResearch: {
        gaps: [],
        investmentReadiness: {
          tier: 'signal_triage',
          blockers: ['theme ontology critical KPI coverage 25%; missing Defense backlog'],
          sourceDiversity: 1,
          availableCorePackCount: 5,
          requiredCorePackCount: 4,
          sampleAdequacy: 'investment_memo',
          transcriptProxyCount: 0,
          directManagementCommentarySymbolCount: 0,
          requiredTranscriptSymbolCount: 3,
          ontologyCoverage: {
            ontologyKey: 'defense_industrial',
            requiredKpiCoverage: 0.25,
            investmentCriticalGapCount: 4,
            issuerCommentaryCoverage: 0,
          },
        },
      },
    },
  };

  const quality = computeReportQuality(bundle, { blockers: [], exportIntegrity: 1 }, analysis);
  assert.equal(quality.productTier, 'signal_triage');
  assert.equal(quality.investmentReadinessQuality.grade, 'C');
  assert.equal(quality.investmentReadinessQuality.metrics.ontologyCriticalGapCount, 4);
});

test('missing historical analogues still block publishability for theme investment reports', () => {
  const analysis = fullDeepAnalysis();
  const bundle = {
    reportType: 'theme_report',
    subject: { subjectId: 'ai-ml', displayName: 'AI / Machine Learning' },
    claims: [{
      claimId: 'CLM-1',
      confidenceLevel: 'medium',
      supportingEvidenceIds: ['EVID-1'],
      supportingMetricIds: ['MET-DEEP-DATA-DEPTH', 'MET-DEEP-CAUSAL-EDGES', 'MET-DEEP-HISTORICAL-ANALOGS'],
      supportingFigureIds: ['FIG-1'],
    }],
    evidence: [
      { evidenceId: 'EVID-1', publisher: 'News Source', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-2', publisher: 'Research Source', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-3', publisher: 'Policy Source', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-4', publisher: 'Company Source', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-5', publisher: 'Market Source', freshnessStatus: 'fresh' },
    ],
    sourceSummary: { distinctSources: 5, sourceDiversityScore: 1, lowDiversityFlag: false },
    dataFreshness: [],
    metrics: [
      { metricId: 'MET-DEEP-DATA-DEPTH', value: 0.9 },
      { metricId: 'MET-DEEP-CAUSAL-EDGES', value: 3 },
      { metricId: 'MET-DEEP-HISTORICAL-ANALOGS', value: 0 },
    ],
    figures: [{ figureId: 'FIG-1', analyticQuestion: 'What changed?', supportedClaimIds: ['CLM-1'] }],
    caveats: [],
    watchIndicators: [{ label: 'Watch management commentary', source: 'sec-edgar', horizon: '7d' }],
    metadata: {
      deepResearch: {
        gaps: [],
        investmentReadiness: {
          tier: 'thesis_validation',
          blockers: [],
          sourceDiversity: 1,
          availableCorePackCount: 5,
          requiredCorePackCount: 4,
          sampleAdequacy: 'investment_memo',
          transcriptProxyCount: 0,
          directManagementCommentarySymbolCount: 4,
          requiredTranscriptSymbolCount: 3,
        },
      },
    },
  };

  const quality = computeReportQuality(bundle, { blockers: [], exportIntegrity: 1 }, analysis);
  assert.equal(quality.publishable, false);
  assert.equal(quality.publishabilityReasons.includes('no reliable historical analogue is attached'), true);
});

test('cross-theme discovery reports can publish without fabricating historical analogues', () => {
  const analysis = fullDeepAnalysis();
  const bundle = {
    reportType: 'cross_theme_bottleneck_report',
    subject: {
      subjectType: 'cross_theme_candidate',
      subjectId: 'solid-rocket-motor-capacity',
      displayName: 'solid rocket motor capacity',
    },
    claims: [{
      claimId: 'CLM-1',
      confidenceLevel: 'medium',
      supportingEvidenceIds: ['EVID-1'],
      supportingMetricIds: ['MET-DEEP-DATA-DEPTH', 'MET-DEEP-CAUSAL-EDGES', 'MET-DEEP-HISTORICAL-ANALOGS'],
      supportingFigureIds: ['FIG-1'],
    }],
    evidence: [
      { evidenceId: 'EVID-1', publisher: 'Source A', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-2', publisher: 'Source B', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-3', publisher: 'Source C', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-4', publisher: 'Source D', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-5', publisher: 'Source E', freshnessStatus: 'fresh' },
    ],
    sourceSummary: { distinctSources: 5, sourceDiversityScore: 1, lowDiversityFlag: false },
    dataFreshness: [],
    metrics: [
      { metricId: 'MET-DEEP-DATA-DEPTH', value: 0.9 },
      { metricId: 'MET-DEEP-CAUSAL-EDGES', value: 3 },
      { metricId: 'MET-DEEP-HISTORICAL-ANALOGS', value: 0 },
    ],
    figures: [{ figureId: 'FIG-1', analyticQuestion: 'What changed?', supportedClaimIds: ['CLM-1'] }],
    caveats: [{ caveatId: 'CAV-1', type: 'historical_memory_gap', text: 'No reliable named analogue is attached; this remains a discovery memo.' }],
    watchIndicators: [{ label: 'Validate supplier capacity', source: 'source-query', horizon: '30d' }],
    metadata: {
      deepResearch: {
        gaps: [],
        investmentReadiness: {
          tier: 'signal_triage',
          blockers: ['operating validation remains incomplete'],
          sourceDiversity: 1,
          availableCorePackCount: 5,
          requiredCorePackCount: 4,
          sampleAdequacy: 'investment_memo',
          transcriptProxyCount: 0,
          directManagementCommentarySymbolCount: 0,
          requiredTranscriptSymbolCount: 3,
        },
      },
    },
  };

  const quality = computeReportQuality(bundle, { blockers: [], exportIntegrity: 1 }, analysis);
  assert.equal(quality.publishable, true);
  assert.equal(quality.publishabilityReasons.includes('no reliable historical analogue is attached'), false);
  assert.equal(quality.metrics.analysis_historicalContextScore, 0);
});

test('decision diagnostic separates missing validation from a negative investment conclusion', () => {
  const analysis = fullDeepAnalysis();
  const bundle = {
    reportType: 'cross_theme_bottleneck_report',
    subject: {
      subjectType: 'cross_theme_candidate',
      subjectId: 'solid-rocket-motor-capacity',
      displayName: 'solid rocket motor capacity',
    },
    claims: [{
      claimId: 'CLM-1',
      confidenceLevel: 'medium',
      supportingEvidenceIds: ['EVID-1'],
      supportingMetricIds: ['MET-DEEP-DATA-DEPTH', 'MET-DEEP-CAUSAL-EDGES', 'MET-DEEP-HISTORICAL-ANALOGS'],
      supportingFigureIds: ['FIG-1'],
    }],
    evidence: [
      { evidenceId: 'EVID-1', publisher: 'Defense News', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-2', publisher: 'Army.mil', freshnessStatus: 'fresh' },
      { evidenceId: 'EVID-3', publisher: 'SEC', freshnessStatus: 'fresh' },
    ],
    sourceSummary: { distinctSources: 3, sourceDiversityScore: 0.8, lowDiversityFlag: false },
    dataFreshness: [],
    metrics: [
      { metricId: 'MET-DEEP-DATA-DEPTH', value: 0.9 },
      { metricId: 'MET-DEEP-CAUSAL-EDGES', value: 3 },
      { metricId: 'MET-DEEP-HISTORICAL-ANALOGS', value: 0 },
    ],
    figures: [{ figureId: 'FIG-1', analyticQuestion: 'What changed?', supportedClaimIds: ['CLM-1'] }],
    caveats: [{ caveatId: 'CAV-1', type: 'decision_validation_gap', text: 'Market and negative control validation remain incomplete.' }],
    watchIndicators: [{ label: 'Validate substitution limits', source: 'source-query', horizon: '30d' }],
    metadata: {
      candidate: {
        evidence_summary: {
          sourceQueryEvidenceCount: 1,
          sourceQueryPersistedCount: 108,
          sourceQueryContextCount: 6,
          sourceQueryNegativeControlCount: 0,
          sourceQueryNoiseCount: 101,
          sourceQueryApprovalTiers: {
            878: { updatedAt: '2026-05-14T10:00:00Z', persistedBundleCount: 12, promotionBundleCount: 0, contextBundleCount: 0, negativeControlCount: 0, noiseCount: 12 },
            879: { updatedAt: '2026-05-14T10:01:00Z', persistedBundleCount: 12, promotionBundleCount: 0, contextBundleCount: 0, negativeControlCount: 0, noiseCount: 12 },
            880: { updatedAt: '2026-05-14T10:02:00Z', persistedBundleCount: 12, promotionBundleCount: 0, contextBundleCount: 0, negativeControlCount: 0, noiseCount: 12 },
            884: { updatedAt: '2026-05-14T10:06:00Z', persistedBundleCount: 12, promotionBundleCount: 0, contextBundleCount: 6, negativeControlCount: 0, noiseCount: 6 },
            885: { updatedAt: '2026-05-14T10:07:00Z', persistedBundleCount: 12, promotionBundleCount: 1, contextBundleCount: 0, negativeControlCount: 0, noiseCount: 11 },
          },
        },
      },
      deepResearch: {
        gaps: [],
        investmentReadiness: {
          tier: 'thesis_validation',
          blockers: [],
          decisionValidationGaps: ['controlled market validation is missing'],
          marketValidation: { tier: 'missing', score: 0 },
          sourceDiversity: 1,
          availableCorePackCount: 5,
          requiredCorePackCount: 4,
          sampleAdequacy: 'cross_theme_discovery',
          directManagementCommentarySymbolCount: 4,
          requiredTranscriptSymbolCount: 3,
        },
        crossThemeActionBridge: {
          score: 0.42,
          tier: 'discovery_to_action_bridge',
          label: 'Discovery-to-action bridge',
          metrics: {
            evidenceClassCoverage: 0.4,
            issuerTranslationScore: 0.55,
            marketTranslationScore: 0,
            marketRowCount: 0,
            negativeControlStatus: 'unchecked',
            missingClasses: ['technical_qualification', 'substitution_limit', 'issuer_exposure', 'negative_control'],
          },
        },
      },
    },
  };

  const quality = computeReportQuality(bundle, { blockers: [], exportIntegrity: 1 }, analysis);
  assert.equal(quality.decisionDiagnostic.status, 'targeted_backfill_required');
  assert.equal(quality.decisionDiagnostic.evidenceSufficiency, 'insufficient_for_investment_call');
  assert.equal(quality.decisionDiagnostic.continueBackfill, true);
  assert.equal(quality.decisionDiagnostic.stopBroadBackfill, true);
});

test('decision diagnostic can mark an evidence-backed rejection when negative controls invalidate the connector', () => {
  const analysis = fullDeepAnalysis();
  const bundle = {
    reportType: 'cross_theme_bottleneck_report',
    subject: { subjectType: 'cross_theme_candidate', subjectId: 'connector', displayName: 'connector' },
    claims: [{
      claimId: 'CLM-1',
      confidenceLevel: 'medium',
      supportingEvidenceIds: ['EVID-1'],
      supportingMetricIds: ['MET-DEEP-DATA-DEPTH'],
      supportingFigureIds: ['FIG-1'],
    }],
    evidence: [{ evidenceId: 'EVID-1', publisher: 'Company Source', freshnessStatus: 'fresh' }],
    sourceSummary: { distinctSources: 3, sourceDiversityScore: 0.8, lowDiversityFlag: false },
    dataFreshness: [],
    metrics: [{ metricId: 'MET-DEEP-DATA-DEPTH', value: 0.9 }],
    figures: [{ figureId: 'FIG-1', analyticQuestion: 'What changed?', supportedClaimIds: ['CLM-1'] }],
    caveats: [],
    watchIndicators: [{ label: 'Archive connector', source: 'negative-control', horizon: '30d' }],
    metadata: {
      deepResearch: {
        gaps: [],
        investmentReadiness: {
          tier: 'thesis_validation',
          blockers: [],
          sourceDiversity: 1,
          availableCorePackCount: 5,
          requiredCorePackCount: 4,
          sampleAdequacy: 'cross_theme_discovery',
        },
        crossThemeActionBridge: {
          score: 0.2,
          metrics: {
            negativeControlStatus: 'invalidated',
            missingClasses: ['negative_control'],
          },
        },
      },
    },
  };

  const quality = computeReportQuality(bundle, { blockers: [], exportIntegrity: 1 }, analysis);
  assert.equal(quality.decisionDiagnostic.status, 'evidence_backed_reject');
  assert.equal(quality.decisionDiagnostic.evidenceSufficiency, 'sufficient_to_reject');
  assert.equal(quality.decisionDiagnostic.continueBackfill, false);
});

test('decision diagnostic separates market validation pending from broad backfill', () => {
  const analysis = fullDeepAnalysis();
  const bundle = {
    reportType: 'cross_theme_bottleneck_report',
    subject: { subjectType: 'cross_theme_candidate', subjectId: 'connector', displayName: 'connector' },
    claims: [{ claimId: 'CLM-1', confidenceLevel: 'medium', supportingEvidenceIds: ['EVID-1'], supportingMetricIds: ['MET-1'], supportingFigureIds: ['FIG-1'] }],
    evidence: [{ evidenceId: 'EVID-1', publisher: 'Company Source', freshnessStatus: 'fresh' }],
    sourceSummary: { distinctSources: 3, sourceDiversityScore: 0.8, lowDiversityFlag: false },
    dataFreshness: [],
    metrics: [{ metricId: 'MET-1', value: 1 }],
    figures: [{ figureId: 'FIG-1', analyticQuestion: 'What changed?', supportedClaimIds: ['CLM-1'] }],
    caveats: [{ type: 'decision_validation_gap', text: 'Market validation remains incomplete.' }],
    watchIndicators: [{ label: 'Run market validation', source: 'event_uplift', horizon: '30d' }],
    metadata: {
      deepResearch: {
        gaps: [],
        reportClosureLedger: {
          openClasses: [],
          marketTier: 'missing',
          negativeControlStatus: 'checked_no_direct',
          counts: {},
        },
        investmentReadiness: {
          tier: 'thesis_validation',
          blockers: [],
          decisionValidationGaps: ['controlled market validation is missing'],
          marketValidation: { tier: 'missing', score: 0 },
          sourceDiversity: 1,
          availableCorePackCount: 5,
          requiredCorePackCount: 4,
          sampleAdequacy: 'cross_theme_discovery',
        },
        crossThemeActionBridge: {
          score: 0.72,
          metrics: {
            negativeControlStatus: 'checked_no_direct',
            missingClasses: [],
            evidenceClassesCovered: ['supplier_capacity', 'issuer_exposure', 'procurement_trigger', 'negative_control'],
          },
        },
      },
    },
  };

  const quality = computeReportQuality(bundle, { blockers: [], exportIntegrity: 1 }, analysis);
  assert.equal(quality.decisionDiagnostic.status, 'market_validation_pending');
  assert.equal(quality.decisionDiagnostic.label, 'Market validation pending');
  assert.equal(quality.decisionDiagnostic.stopBroadBackfill, true);
});

test('research utility can reach priority B without raising investment actionability', () => {
  const analysis = fullDeepAnalysis();
  const bundle = {
    reportType: 'cross_theme_bottleneck_report',
    subject: {
      subjectType: 'cross_theme_candidate',
      subjectId: 'generated-grid-interconnection',
      displayName: 'generated grid interconnection queue',
    },
    claims: [{ claimId: 'CLM-1', confidenceLevel: 'medium', supportingEvidenceIds: ['EVID-1'], supportingMetricIds: ['MET-1'], supportingFigureIds: ['FIG-1'] }],
    evidence: [{ evidenceId: 'EVID-1', publisher: 'Utility Source', freshnessStatus: 'fresh' }],
    sourceSummary: { distinctSources: 2, sourceDiversityScore: 0.7, lowDiversityFlag: false },
    dataFreshness: [],
    metrics: [{ metricId: 'MET-1', value: 1 }],
    figures: [{ figureId: 'FIG-1', analyticQuestion: 'What changed?', supportedClaimIds: ['CLM-1'] }],
    caveats: [{ type: 'investment_gate', text: 'Direct issuer bridge and market validation remain missing.' }],
    watchIndicators: [{ label: 'Attach direct issuer exposure', source: 'SEC/IR', horizon: '30d' }],
    metadata: {
      candidate: {
        evidence_summary: {
          sourceQueryPersistedCount: 60,
          sourceQueryContextCount: 24,
          sourceQueryNoiseCount: 12,
        },
      },
      deepResearch: {
        gaps: ['issuer bridge', 'market validation'],
        reportClosureLedger: {
          openClasses: ['issuer_exposure', 'market_validation'],
          negativeControlStatus: 'unchecked',
          marketTier: 'missing',
          counts: { context_collected: 8, weak_noise: 3 },
        },
        investmentReadiness: {
          tier: 'signal_triage',
          blockers: ['direct issuer bridge is missing'],
          decisionValidationGaps: ['controlled market validation is missing'],
          marketValidation: { tier: 'missing', score: 0 },
          sourceDiversity: 0.7,
          availableCorePackCount: 1,
          requiredCorePackCount: 4,
          sampleAdequacy: 'cross_theme_discovery',
        },
        crossThemeActionBridge: {
          score: 0.32,
          tier: 'discovery_to_action_bridge',
          label: 'Discovery-to-action bridge',
          autoDiscoveredIssuers: [
            { symbol: 'VRT', status: 'probable_exposure', candidateOnly: true },
            { symbol: 'ETN', status: 'probable_exposure', candidateOnly: true },
            { symbol: 'PWR', status: 'probable_exposure', candidateOnly: true },
            { symbol: 'HUBB', status: 'probable_exposure', candidateOnly: true },
            { symbol: 'NEE', status: 'candidate', candidateOnly: true },
            { symbol: 'SO', status: 'candidate', candidateOnly: true },
          ],
          issuerBridgeSummary: {
            candidateIssuerCount: 6,
            probableExposureCount: 4,
            bridgeAttachedCount: 0,
            marketAttachedCount: 0,
          },
          metrics: {
            evidenceClassCoverage: 0.25,
            issuerTranslationScore: 0,
            marketTranslationScore: 0,
            candidateIssuerCount: 6,
            probableExposureCount: 4,
            bridgeAttachedCount: 0,
            marketRowCount: 0,
            negativeControlStatus: 'unchecked',
            missingClasses: ['issuer_exposure', 'market_validation'],
          },
        },
      },
    },
  };

  const quality = computeReportQuality(bundle, { blockers: [], exportIntegrity: 1 }, analysis);
  assert.equal(quality.researchUtility.grade, 'B');
  assert.equal(quality.researchUtility.metrics.probableExposureCount, 4);
  assert.equal(quality.crossThemeActionability.metrics.bridgeAttachedCount, 0);
  assert.equal(quality.investmentReadiness.tier, 'signal_triage');
  assert.notEqual(quality.productTier, 'investment_memo_candidate');
});
