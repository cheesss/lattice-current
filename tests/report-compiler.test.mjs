import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSampleReportBundle, REPORT_TYPES } from '../scripts/_shared/report-evidence-bundle.mjs';
import { planReportFigures } from '../scripts/_shared/report-chart-planner.mjs';
import { renderAuditAppendixHtml, renderReportHtml, renderReportMarkdown } from '../scripts/_shared/report-compiler.mjs';
import { generateDeterministicAnalystDraft } from '../scripts/_shared/report-llm-analyst.mjs';
import { validateReportBundle } from '../scripts/_shared/report-validator.mjs';

test('compiler renders HTML and Markdown with evidence and validation sections', () => {
  const bundle = planReportFigures(buildSampleReportBundle(REPORT_TYPES.CROSS_THEME));
  const analysis = generateDeterministicAnalystDraft(bundle);
  const validation = validateReportBundle(bundle, { analysis });
  const html = renderReportHtml(bundle, { analysis, validation });
  const audit = renderAuditAppendixHtml(bundle, { analysis, validation });
  const md = renderReportMarkdown(bundle, { analysis, validation });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Why This Connector Matters/);
  assert.match(html, /Shared Constraint Map/);
  assert.doesNotMatch(html, /<h2>Signal Triage<\/h2>/);
  assert.match(html, /Market Expression and Scenario Gate/);
  assert.match(html, /Counter-Thesis, Risks, and Caveats/);
  assert.match(html, /Source Tasks and Review Agenda/);
  assert.match(html, /Exhibits/);
  assert.match(html, /Evidence tasks/);
  assert.match(html, /Exhibit 1\./);
  assert.doesNotMatch(html, /\brefs\s+\d+\b/i);
  assert.doesNotMatch(html, /Metric Ledger/);
  assert.doesNotMatch(`${html}\n${md}`, /\bSource queue\b|\bartifact\s+[SABCD]\b|\bfinal\s+[SABCD]\b|\bstatus\s+warning\b|\bValidation:\s+|\bQuality:\s+/i);
  assert.match(audit, /Evidence Base/);
  assert.match(audit, /Validation/);
  assert.match(audit, /FIG-XTC-GRAPH/);
  assert.match(md, /# Linde cryogenic cooling|# Linde/);
  assert.match(md, /## Shared Constraint Map/);
  assert.match(md, /## Market Expression and Scenario Gate/);
  assert.match(md, /## Counter-Thesis, Risks, and Caveats/);
  assert.match(md, /## Source Tasks and Review Agenda/);
  assert.match(md, /## Verification/);
  assert.doesNotMatch(md, /\brefs\s+\d+\b/i);
});

test('compiler client ribbon hides raw ontology coverage percentages', () => {
  const bundle = planReportFigures(buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'Defense Industrial' }));
  const analysis = generateDeterministicAnalystDraft(bundle);
  const validation = {
    ...validateReportBundle(bundle, { analysis }),
    quality: {
      productTier: 'signal_triage',
      publishable: true,
      investmentReadiness: {
        tier: 'signal_triage',
        blockers: [
          'theme ontology critical KPI coverage 27%; missing Defense book-to-bill, Procurement budget line items',
        ],
      },
      publishabilityReasons: [],
    },
  };
  const html = renderReportHtml(bundle, { analysis, validation });
  assert.match(html, /theme-specific operating KPI coverage is incomplete; missing Defense book-to-bill/i);
  assert.doesNotMatch(html, /27%/);
});

test('compiler renders institutional validation tables without raw pack names', () => {
  const bundle = {
    ...planReportFigures(buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'AI / Machine Learning' })),
    metadata: {
      deepResearch: {
        packs: {
          institutionalEvidencePack: {
            status: 'available',
            coverageScore: 0.71,
            tableCoverage: 0.9,
            primaryEvidenceCoverage: 0.8,
            longHorizonCoverage: 0.55,
            dimensions: [
              {
                key: 'controlled_market_validation',
                label: 'Controlled market validation',
                status: 'decision_grade',
                rowCount: 8,
                numericRowCount: 0,
                symbolCount: 3,
                sourceKindCount: 1,
                decisionUse: 'keeps raw price moves separate from repeatable theme sensitivity',
              },
              {
                label: 'Issuer fundamentals table',
                status: 'decision_grade',
                rowCount: 18,
                numericRowCount: 14,
                symbolCount: 4,
                sourceKindCount: 2,
                decisionUse: 'connects the theme to revenue, margin, cash flow, and capex lines',
              },
            ],
          },
          issuerThesisPack: {
            cards: [
              {
                symbol: 'AMD',
                role: 'theme-exposed issuer requiring operating validation',
                fundamentalBridge: 'revenue bridge attached',
                valuationBridge: 'consensus and price bridge attached',
                marketBridge: '58.61% relative return, t-stat 1.62',
                operatingBridge: 'issuer operating bridge pending',
                thesisUse: 'research_prioritization',
              },
            ],
          },
        },
        ontologyPack: {
          kpis: [
            {
              displayName: 'Data center power and MW capacity',
              satisfied: false,
              critical: true,
              requiredFor: 'investment_memo',
              priority: 94,
              queryTerms: ['data center power', 'MW capacity'],
            },
          ],
        },
      },
    },
  };
  const analysis = {
    longFormSections: [
      {
        key: 'executive_judgment',
        title: 'Executive Judgment',
        paragraphs: [{ text: 'The thesis remains evidence-bound and requires operating validation.' }],
      },
    ],
  };
  const validation = {
    status: 'passed',
    quality: {
      productTier: 'signal_triage',
      publishable: true,
      investmentReadiness: {
        tier: 'signal_triage',
        marketValidation: {
          tier: 'screening_grade',
          maxAbsTStat: 1.62,
          decisionGradeRowCount: 0,
          screeningGradeRowCount: 1,
          regimeSupportRowCount: 1,
          rows: [
            {
              symbol: 'AMD',
              eventWindow: '1m',
              relativeReturnPct: 58.61,
              tStat: 1.62,
              absTStat: 1.62,
              sampleSize: 1681,
              screeningGrade: true,
              decisionGrade: false,
              hasBenchmarkControl: true,
              hasFactorControl: true,
              regimeConsistent: true,
              regimeSupportLabel: '3/5 same-direction regime/horizon rows; 2 regimes; 2 horizons',
            },
          ],
        },
      },
    },
  };
  const html = renderReportHtml(bundle, { analysis, validation });
  const md = renderReportMarkdown(bundle, { analysis, validation });
  assert.match(html, /Evidence and Validation Tables/);
  assert.match(html, /Institutional Evidence Matrix/);
  assert.match(html, /Issuer Evidence Bridge/);
  assert.match(html, /Market Validation Table/);
  assert.match(html, /Theme-Specific KPI Gate/);
  assert.match(html, /AMD/);
  assert.match(html, /screening-grade/);
  assert.match(html, /regime-consistency support row/);
  assert.match(html, /same-direction regime\/horizon rows/);
  assert.match(html, /decision grade coverage; screening grade validation/);
  assert.match(md, /## Evidence and Validation Tables/);
  assert.match(md, /Regime support/);
  assert.match(md, /Data center power and MW capacity/);
  assert.doesNotMatch(`${html}\n${md}`, /fundamentalPack|transcriptPack|query manifest|metric ledger/i);
});

test('compiler surfaces frontier-node and consensus suppression diagnostics', () => {
  const bundle = {
    ...planReportFigures(buildSampleReportBundle(REPORT_TYPES.CROSS_THEME)),
    metadata: {
      adjacentCandidate: {
        source_terms: ['substation protection relay qualification lead time'],
        metadata: {
          frontierNodeSupported: true,
          sourceDerivedNodeCount: 2,
          scarcityEvidenceScore: 0.7,
          suppressedConsensusSymbols: ['ACME'],
          consensusPenaltyBasis: [{ term: 'grid interconnection queue', count: 4 }],
          nonObviousDiscovery: {
            themeDistanceScore: 0.55,
            bottleneckSpecificityScore: 0.82,
            scarcitySignalScore: 0.7,
            surpriseScore: 0.74,
            consensusPenalty: 0.48,
            frontierScore: 68,
            suppressedConsensusSymbols: ['ACME'],
            consensusPenaltyBasis: [{ term: 'grid interconnection queue', count: 4 }],
            suppressedNarrativeReason: 'candidate echoes a high-frequency narrative',
          },
          concreteBottleneckNodes: [{
            node: 'substation protection relay qualification lead time',
            nodeType: 'protection_control_system',
            sourceDerived: true,
            evidenceClasses: ['technical_qualification', 'power_constraint'],
            acceptanceCriteria: ['relay qualification lead time', 'utility approval dependency'],
          }],
        },
      },
    },
  };
  const analysis = generateDeterministicAnalystDraft(bundle);
  const validation = validateReportBundle(bundle, { analysis });
  const html = renderReportHtml(bundle, { analysis, validation });
  const md = renderReportMarkdown(bundle, { analysis, validation });
  assert.match(html, /Non-obvious Bottleneck Lens/);
  assert.match(html, /Frontier node support/);
  assert.match(html, /source-derived/);
  assert.match(html, /Suppressed consensus symbols/);
  assert.match(md, /Frontier node support/);
  assert.match(md, /Suppressed consensus symbols: ACME/);
});

test('compiler surfaces decision diagnostic without raw source-query mechanics', () => {
  const bundle = planReportFigures(buildSampleReportBundle(REPORT_TYPES.CROSS_THEME));
  const analysis = generateDeterministicAnalystDraft(bundle);
  const validation = {
    ...validateReportBundle(bundle, { analysis }),
    quality: {
      productTier: 'evidence_backed_bottleneck_candidate',
      publishable: true,
      publishabilityReasons: [],
      bottleneckReadiness: { label: 'Evidence-supported bottleneck candidate' },
      crossThemeDiscoveryQuality: { grade: 'S' },
      crossThemeActionability: { label: 'Discovery-to-action bridge' },
      researchUtility: {
        grade: 'B',
        label: 'Research Priority B',
        closureState: 'direct_bridge_pending',
      },
      investmentReadiness: { tier: 'thesis_validation' },
      decisionDiagnostic: {
        status: 'targeted_backfill_required',
        label: 'Targeted backfill needed',
        nextAction: 'continue only targeted official, issuer, market, and negative-control routes for open classes',
      },
    },
  };
  const html = renderReportHtml(bundle, { analysis, validation });
  const md = renderReportMarkdown(bundle, { analysis, validation });
  assert.match(html, /Discovery Readiness/);
  assert.match(html, /Strong discovery \(S\)/);
  assert.match(html, /Research Priority/);
  assert.match(html, /Research Priority B/);
  assert.match(html, /Investment Actionability/);
  assert.match(html, /Not investment-ready/);
  assert.match(html, /Evidence Closure/);
  assert.match(md, /Discovery Readiness: Strong discovery \(S\)/);
  assert.match(md, /Research Priority: Research Priority B/);
  assert.match(md, /Investment Actionability: Not investment-ready/);
  assert.match(html, /evidence state/i);
  assert.match(html, /Targeted backfill needed/);
  assert.match(md, /Evidence state: Targeted backfill needed/);
  assert.doesNotMatch(`${html}\n${md}`, /sourceQueryPersistedCount|approvalId|reportBackfillTaskId/);
});

test('compiler renders auto-discovered issuer map separately from action bridge', () => {
  const bundle = {
    ...planReportFigures(buildSampleReportBundle(REPORT_TYPES.CROSS_THEME, { subject: 'grid interconnection queue' })),
    metadata: {
      deepResearch: {
        packs: {
          issuerDiscoveryPack: {
            status: 'available',
            rows: [
              {
                symbol: 'VRT',
                issuerName: 'Vertiv',
                role: 'equipment_supplier',
                status: 'candidate',
                whyRelated: 'equipment supplier candidate from grid interconnection, data center power availability',
                nextValidation: 'collect SEC/IR/transcript/contract evidence for direct exposure before promotion.',
                promotionEligible: false,
              },
            ],
          },
        },
        crossThemeActionBridge: {
          rows: [{
            source_type: 'cross_theme_auto_issuer_map',
            symbol: 'VRT',
            issuer: 'Vertiv',
            issuerBridgeRole: 'equipment_supplier',
            status: 'candidate',
            exposureType: 'equipment supplier candidate from grid interconnection',
            requiredValidation: 'collect SEC/IR/transcript/contract evidence for direct exposure before promotion.',
            promotionEligible: false,
            metadata: { status: 'candidate', issuerBridgeRole: 'equipment_supplier' },
          }],
          autoDiscoveredIssuers: [{
            symbol: 'VRT',
            issuer: 'Vertiv',
            issuerBridgeRole: 'equipment_supplier',
            status: 'candidate',
            exposureType: 'equipment supplier candidate from grid interconnection',
            requiredValidation: 'collect SEC/IR/transcript/contract evidence for direct exposure before promotion.',
            promotionEligible: false,
          }],
        },
      },
    },
  };
  const analysis = { longFormSections: [{ key: 'issuerMarketTranslation', title: 'Issuer and Market Translation', paragraphs: [{ text: 'Candidate map exists but direct bridge is missing.' }] }] };
  const validation = { status: 'passed', quality: { investmentReadiness: { marketValidation: {} } } };
  const html = renderReportHtml(bundle, { analysis, validation });
  const md = renderReportMarkdown(bundle, { analysis, validation });

  assert.match(html, /Auto-discovered related issuer map/);
  assert.match(html, /Vertiv/);
  assert.match(html, /report-visible collection targets/i);
  assert.match(md, /Auto-discovered related issuer map/);
  assert.doesNotMatch(`${html}\n${md}`, /buy|sell|price target/i);
});

test('compiler renders non-obvious bottleneck lens before treating candidate as actionable', () => {
  const bundle = {
    ...planReportFigures(buildSampleReportBundle(REPORT_TYPES.CROSS_THEME, { subject: 'substation protection relay qualification lead time' })),
    metadata: {
      nonObviousDiscovery: {
        themeDistanceScore: 0.8,
        bottleneckSpecificityScore: 0.72,
        scarcitySignalScore: 0.58,
        consensusPenalty: 0.18,
        frontierScore: 74,
      },
      concreteBottleneckNodes: [{
        node: 'interconnection study capacity',
        nodeType: 'engineering_process',
        evidenceClasses: ['grid_interconnection', 'supplier_capacity'],
        acceptanceCriteria: ['study backlog or queue duration', 'utility/RTO/ISO planning document'],
      }],
      adjacentCandidate: {
        source_terms: ['substation protection relay', 'qualification lead time'],
      },
    },
  };
  const analysis = { longFormSections: [{ key: 'discovery', title: 'Discovery Judgment', paragraphs: [{ text: 'This is a frontier research lead, not an investment call.' }] }] };
  const validation = { status: 'passed', quality: { investmentReadiness: { marketValidation: {} } } };
  const html = renderReportHtml(bundle, { analysis, validation });
  const md = renderReportMarkdown(bundle, { analysis, validation });

  assert.match(html, /Non-obvious Bottleneck Lens/);
  assert.match(html, /Known narrative suppressed/);
  assert.match(html, /Narrow bottleneck node/);
  assert.match(html, /Scarcity test/);
  assert.match(html, /Concrete Node Probes/);
  assert.match(html, /interconnection study capacity/);
  assert.match(md, /Non-obvious Bottleneck Lens/);
  assert.match(md, /Concrete Node Probes/);
  assert.doesNotMatch(`${html}\n${md}`, /buy|sell|price target/i);
});
