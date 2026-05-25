import assert from 'node:assert/strict';
import test from 'node:test';

import { computeCrossThemeDiscoveryQuality } from '../scripts/_shared/cross-theme-discovery-quality.mjs';
import { computeReportQuality } from '../scripts/_shared/report-quality.mjs';

function acceptedMatrixRow(evidenceClass, directCount, status, sourceGroups = []) {
  return {
    evidenceClass,
    label: evidenceClass.replace(/_/g, ' '),
    status,
    directCount,
    promotionEligibleCount: evidenceClass === 'issuer_exposure' ? directCount : 0,
    sourceGroups,
  };
}

function validatedFinalCrossThemeBundle() {
  const evidenceMatrix = [
    acceptedMatrixRow('mechanism_validation', 1, 'accepted', ['official mechanism source']),
    acceptedMatrixRow('issuer_exposure', 2, 'promotion_collected', ['official issuer source']),
    acceptedMatrixRow('issuer_commentary_or_official_issuer_bridge', 2, 'accepted_official_issuer_bridge', ['official issuer source']),
    acceptedMatrixRow('negative_control', 3, 'checked_no_direct', ['negative-control lane']),
    acceptedMatrixRow('holdout_validation', 1, 'confirmed', ['independent holdout source']),
    acceptedMatrixRow('controlled_market_validation', 1, 'controlled_ready', ['local controlled market data']),
    acceptedMatrixRow('source_breadth', 5, 'accepted', []),
    acceptedMatrixRow('contradiction_check', 1, 'evaluated', ['contradiction detector']),
    acceptedMatrixRow('valuation_or_expectation_bridge', 1, 'valuation_bridge_closed', ['valuation context']),
  ];
  return {
    reportType: 'cross_theme_bottleneck_report',
    reportId: 'RPT-validated-cross-theme-quality-fixture',
    subject: {
      displayName: 'Rocket motor casing composite capacity across defense and space',
      themes: ['defense-industrial', 'space'],
      metadata: {
        finalInvestmentDryRun: true,
        validatedCrossThemeExport: true,
      },
    },
    sourceSummary: {
      sourceCount: 2,
      publisherCount: 2,
      sourceDiversityScore: 0.4,
      lowDiversityFlag: false,
    },
    claims: [
      {
        claimId: 'mechanism-evidence',
        canonicalText: 'Accepted operating evidence links rocket motor casing composite capacity to the bottleneck.',
        validationStatus: 'validated',
        supportingEvidenceIds: ['defense-propulsion:fixture:issuer_exposure:lhx'],
      },
    ],
    evidence: [
      {
        evidenceId: 'defense-propulsion:fixture:issuer_exposure:lhx',
        kind: 'issuer_exposure',
        publisher: 'Official defense propulsion source',
        title: 'Official propulsion capacity release',
        excerpt: 'The issuer describes rocket motor casing composite capacity expansion, manufacturing capacity, facilities, production lines, and demand.',
        summary: 'rocket motor casing composite capacity expansion manufacturing capacity facilities production demand',
        desiredEvidenceClass: 'issuer_exposure',
        evidenceUse: 'promotion_candidate',
        promotionEligible: true,
        evidenceGrade: 'direct',
        metadata: {
          evidenceClass: 'issuer_exposure',
          desiredEvidenceClass: 'issuer_exposure',
          evidenceUse: 'promotion_candidate',
          promotionEligible: true,
          directness: 'direct',
        },
      },
      {
        evidenceId: 'seed-official:fixture:issuer_exposure:NOC',
        kind: 'issuer_exposure',
        publisher: 'NOC official issuer source',
        title: 'Official issuer exposure source',
        excerpt: 'The issuer bridge links rocket motor casing composite capacity to backlog, revenue, guidance, customer demand, and production capacity.',
        summary: 'rocket motor casing composite capacity backlog revenue guidance customer demand production capacity',
        desiredEvidenceClass: 'issuer_exposure',
        evidenceUse: 'promotion_candidate',
        promotionEligible: true,
        evidenceGrade: 'direct',
        metadata: {
          evidenceClass: 'issuer_exposure',
          desiredEvidenceClass: 'issuer_exposure',
          evidenceUse: 'promotion_candidate',
          promotionEligible: true,
          directness: 'direct',
        },
      },
      {
        evidenceId: 'defense-propulsion:fixture:negative_control',
        kind: 'negative_control',
        publisher: 'Official defense propulsion source',
        title: 'Negative-control lane',
        excerpt: 'Negative control checked_no_direct found no easy substitute, supplier redundancy, no capacity constraint, or direct invalidator.',
        summary: 'negative control checked_no_direct no easy substitute supplier redundancy no capacity constraint',
        desiredEvidenceClass: 'negative_control',
        evidenceUse: 'negative_control_candidate',
        promotionEligible: false,
        evidenceGrade: 'constraint_check',
        metadata: {
          evidenceClass: 'negative_control',
          desiredEvidenceClass: 'negative_control',
          evidenceUse: 'negative_control_candidate',
          promotionEligible: false,
        },
      },
    ],
    metrics: [
      { metricId: 'MET-FINAL-SOURCE-BREADTH', value: 5, unit: 'source_lanes' },
      { metricId: 'MET-DEEP-DATA-DEPTH', value: 0.82, unit: 'score' },
      { metricId: 'MET-DEEP-INSTITUTIONAL-EVIDENCE-DENSITY', value: 0.86, unit: 'score' },
      { metricId: 'MET-DEEP-HISTORICAL-ANALOGS', value: 1, unit: 'analogues' },
      { metricId: 'MET-DEEP-CAUSAL-EDGES', value: 3, unit: 'edges' },
    ],
    figures: [
      { figureId: 'FIG-1', title: 'Evidence readiness', chartType: 'status_board', supportedClaimIds: ['mechanism-evidence'] },
    ],
    caveats: [{ caveatId: 'CAV-1', type: 'human_review_boundary', text: 'Human review remains required.' }],
    watchIndicators: [
      { watchId: 'WATCH-1', label: 'Backlog and guidance', source: 'issuer filings', horizon: 'next reporting cycle' },
    ],
    dataFreshness: [{ source: 'fixture', freshnessStatus: 'fresh' }],
    metadata: {
      finalInvestmentDryRun: {
        status: {
          finalInvestmentReportDryRunStatus: 'human_review_required',
          investmentMemoReady: false,
          decisionReady: false,
          portfolioActionAllowed: false,
        },
      },
      frontierDiscovery: true,
      sourceDerivedNodeCount: 3,
      scarcityEvidenceScore: 0.78,
      nonObviousDiscovery: {
        frontierScore: 0.82,
        consensusPenalty: 0.08,
      },
      candidate: {
        evidence_summary: {
          seedSimilarity: 0.18,
          novelty: 0.8,
          themeDistance: 0.84,
          sourceDiversity: 0.4,
          constraintCriticality: 0.82,
        },
      },
      deepResearch: {
        evidenceClassMatrix: evidenceMatrix,
        universalEvidenceContract: {
          requiredClasses: evidenceMatrix.map((row) => ({
            evidenceClass: row.evidenceClass,
            required: true,
          })),
        },
        crossThemeActionBridge: {
          evidenceMatrix,
          missingClasses: [],
          negativeControlStatus: 'checked_no_direct',
          metrics: {
            missingClasses: [],
            evidenceClassCoverage: 1,
            issuerCount: 2,
            issuerBridgeCount: 2,
            bridgeAttachedCount: 2,
            marketRowCount: 1,
            negativeControlStatus: 'checked_no_direct',
          },
        },
        investmentReadiness: {
          tier: 'thesis_validation',
          blockers: ['human_review_required'],
          decisionValidationGaps: ['decision-ready promotion remains disabled'],
          sourceDiversity: 0.4,
          marketValidation: {
            tier: 'screening_grade',
            rowCount: 1,
            controlledRowCount: 1,
            screeningGradeRowCount: 1,
          },
        },
      },
    },
  };
}

test('validated final cross-theme quality uses accepted source breadth matrix without relaxing readiness', () => {
  const bundle = validatedFinalCrossThemeBundle();
  const discovery = computeCrossThemeDiscoveryQuality(bundle);

  assert.equal(discovery.metrics.sourceDiversity >= 0.8, true, JSON.stringify(discovery.metrics));
  assert.equal(discovery.metrics.acceptedMatrixSourceBreadth, 5);
  assert.equal(discovery.metrics.independentSourceGroupCount >= 5, true);
  assert.equal(discovery.metrics.missingEvidenceClasses.includes('source_breadth'), false);
  assert.equal(discovery.metrics.missingEvidenceClasses.includes('controlled_market_validation'), false);

  const quality = computeReportQuality(bundle, { blockers: [], exportIntegrity: 1 }, {
    keyJudgments: [{ text: 'Accepted evidence supports human review only.', claimIds: ['mechanism-evidence'] }],
    thesis: [{ text: 'This is a thesis validation report, not an autonomous investment memo.', claimIds: ['mechanism-evidence'] }],
    catalysts: [{ text: 'Official evidence refreshes are the only catalyst for readiness changes.', claimIds: ['mechanism-evidence'] }],
    evidenceSynthesis: [{ text: 'Accepted source breadth is taken from the Evidence Contract Matrix.', claimIds: ['mechanism-evidence'] }],
    dataDepth: [{ text: 'The matrix closes accepted source breadth while keeping portfolio action disabled.', claimIds: ['mechanism-evidence'] }],
    causalChain: [{ text: 'Capacity constraints transmit through supplier capacity, backlog, and guidance.', claimIds: ['mechanism-evidence'] }],
    historicalAnalogues: [{ text: 'A human analyst must still compare this with prior defense-industrial bottleneck cycles.', claimIds: ['mechanism-evidence'] }],
    timeline: [{ text: 'Refresh timing follows official issuer and government evidence cadence.', claimIds: ['mechanism-evidence'] }],
    marketTransmission: [{ text: 'Market validation is controlled and diagnostic only.', claimIds: ['mechanism-evidence'] }],
    scenarios: [
      { text: 'Base case remains human-review only.', claimIds: ['mechanism-evidence'] },
      { text: 'Upside requires analyst approval.', claimIds: ['mechanism-evidence'] },
      { text: 'Downside invalidates if backlog weakens.', claimIds: ['mechanism-evidence'] },
    ],
    risks: [
      { text: 'Negative controls may later weaken the thesis.', claimIds: ['mechanism-evidence'] },
      { text: 'Provider coverage may still miss private suppliers.', claimIds: ['mechanism-evidence'] },
    ],
    analyticalAssessment: [{ text: 'Evidence gates are closed for human-review thesis validation only.', claimIds: ['mechanism-evidence'] }],
    decisionUse: [{ text: 'Portfolio action remains disabled.', claimIds: ['mechanism-evidence'] }],
    feedbackLearning: [{ text: 'Future cycles must refresh source breadth before approval.', claimIds: ['mechanism-evidence'] }],
    watchNext: [{ text: 'Watch issuer backlog, guidance, and government capacity funding.', claimIds: ['mechanism-evidence'] }],
    analystConclusion: [{ text: 'The report can be reviewed by a human, but cannot approve investment readiness.', claimIds: ['mechanism-evidence'] }],
  });

  assert.equal(quality.publishabilityReasons.includes('evidence diversity is below institutional target'), false);
  assert.equal(quality.investmentReadiness.tier, 'thesis_validation');
});
