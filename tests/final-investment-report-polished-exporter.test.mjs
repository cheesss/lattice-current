import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildPolishedFinalInvestmentReportModel,
  writeValidatedCrossThemeFinalReport,
  writePolishedFinalInvestmentReport,
} from '../scripts/_shared/final-investment-report-polished-exporter.mjs';
import { listReportRegistry } from '../scripts/_shared/report-local-store.mjs';

function sampleFinalDryRun() {
  const gateChecklist = [
    'evidence_contract_matrix_closure',
    'accepted_promotion_evidence',
    'independent_source_breadth',
    'issuer_bridge',
    'negative_control',
    'holdout_validation',
    'valuation_bridge',
    'expectation_bridge',
    'controlled_market_validation',
    'market_regime_support',
    'contradiction_detector',
    'provider_blocked',
    'route_mismatch',
  ].map((key) => ({ key, passed: true, detail: key === 'market_regime_support' ? 'regime_supported' : 'closed' }));
  const matrix = [
    {
      evidenceClass: 'mechanism_validation',
      status: 'covered',
      acceptedCount: 3,
      promotionEligibleCount: 0,
      evidenceIds: [
        'grid-official:sample:lbnl-queued-up-fixture',
        'grid-official:sample:ferc-interconnection-reform-fixture',
        'grid-official:sample:iso-rto-queue-report-fixture',
      ],
      caveats: ['mechanism_evidence_not_investment_ready'],
    },
    {
      evidenceClass: 'grid_interconnection',
      status: 'covered',
      acceptedCount: 3,
      promotionEligibleCount: 0,
      evidenceIds: [
        'grid-official:sample:lbnl-queued-up-fixture',
        'grid-official:sample:ferc-interconnection-reform-fixture',
        'grid-official:sample:iso-rto-queue-report-fixture',
      ],
      caveats: ['mechanism_evidence_not_investment_ready'],
    },
    {
      evidenceClass: 'issuer_exposure',
      status: 'covered',
      acceptedCount: 3,
      promotionEligibleCount: 3,
      evidenceIds: [
        'grid-issuer-holdout:sample:utility-capex-transmission-plan-fixture',
        'grid-issuer-holdout:sample:iso-rto-network-upgrade-plan-fixture',
      ],
      caveats: [],
    },
    {
      evidenceClass: 'negative_control',
      status: 'CHECKED_NO_DIRECT',
      acceptedCount: 3,
      promotionEligibleCount: 0,
      evidenceIds: ['grid-negative:1'],
      caveats: ['negative_control_not_proof'],
    },
    {
      evidenceClass: 'holdout_validation',
      status: 'confirmed',
      acceptedCount: 2,
      promotionEligibleCount: 0,
      evidenceIds: ['grid-holdout:1'],
      caveats: [],
    },
    {
      evidenceClass: 'controlled_market_validation',
      status: 'controlled_ready',
      acceptedCount: 1,
      promotionEligibleCount: 0,
      evidenceIds: ['grid-market-validation:1'],
      regimeSupportStatus: 'regime_supported',
      caveats: ['market_validation_regime_support_missing', 'zero_regime_support'],
    },
    {
      evidenceClass: 'valuation_or_expectation_bridge',
      status: 'valuation_bridge_closed',
      acceptedCount: 3,
      promotionEligibleCount: 0,
      evidenceIds: ['accepted-valuation-bridge:pwr'],
      caveats: ['diagnostic_only_not_investment_readiness', 'VALUATION_OR_EXPECTATION_BRIDGE_MISSING'],
    },
  ];
  const claimEvidenceMap = [
    {
      claimId: 'mechanism-evidence',
      section: 'C. Mechanism Evidence',
      evidenceClass: 'mechanism_validation',
      evidenceIds: ['grid-official:sample:lbnl-queued-up-fixture'],
      caveats: ['mechanism_evidence_not_investment_ready'],
      requiresEvidence: true,
    },
    {
      claimId: 'issuer-bridge',
      section: 'D. Issuer Bridge',
      evidenceClass: 'issuer_exposure',
      evidenceIds: ['grid-issuer-holdout:sample:utility-capex-transmission-plan-fixture'],
      caveats: ['VALUATION_OR_EXPECTATION_BRIDGE_MISSING'],
      requiresEvidence: true,
    },
  ];
  return {
    ok: true,
    memoType: 'investment_memo_dry_run',
    metadata: {
      memoType: 'investment_memo_dry_run',
      decisionUse: 'human_review_required',
      subjectId: 'dryrun-test-subject',
      subjectLabel: 'Grid infrastructure execution capacity and power delivery backlog',
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
      finalInvestmentReportDryRunStatus: 'human_review_required',
      validatorStatus: 'passed',
    },
    finalInvestmentReportDryRunStatus: 'human_review_required',
    decisionUse: 'human_review_required',
    clientMemoMarkdown: [
      '## A. Executive Judgment',
      'This is a final investment report dry-run, not an approved investment memo.',
      'No buy/sell/position-sizing recommendation is made.',
      'Portfolio action is not allowed without human review.',
      'Decision-ready status remains false.',
    ].join('\n'),
    claims: claimEvidenceMap,
    gateChecklist,
    auditAppendix: {
      subject: {
        subjectId: 'dryrun-test-subject',
        subjectLabel: 'Grid infrastructure execution capacity and power delivery backlog',
        issuerUniverse: ['PWR', 'ACM', 'J'],
        mechanismSummary: 'Accepted official grid evidence supports an interconnection and execution bottleneck.',
        issuerBridgeSummary: 'Accepted issuer evidence links power delivery backlog to PWR/ACM/J exposure.',
        negativeControlSummary: 'Negative controls are CHECKED_NO_DIRECT.',
        holdoutSummary: 'Holdout validation is confirmed outside seed generation.',
        marketValidationSummary: 'Controlled market validation is controlled_ready.',
      },
      gateChecklist,
      evidenceContractMatrixSummary: matrix,
      claimEvidenceMap,
      mutationBoundary: {
        reportCandidateWrites: 0,
        readinessPromotionWrites: 0,
        providerActivationWrites: 0,
        canonicalWrites: 0,
        sourceRegistryWrites: 0,
        approvalQueueWrites: 0,
        portfolioActionWrites: 0,
      },
    },
    validation: { ok: true, status: 'passed', blockers: [] },
    marketRegimeSupport: {
      marketValidationRegimeStatus: 'regime_supported',
      regimeCoverageScore: 1,
      regimeConsistencyScore: 0.77,
      caveats: ['VALUATION_OR_EXPECTATION_BRIDGE_MISSING'],
    },
  };
}

test('final investment export uses standard compiler-backed report path', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-final-polished-report-'));
  try {
    const reportRoot = path.join(tmp, 'reports');
    const result = await writePolishedFinalInvestmentReport({
      report: sampleFinalDryRun(),
      reportRoot,
    });
    const html = await readFile(result.paths.html, 'utf8');
    const audit = await readFile(result.paths.auditAppendixHtml, 'utf8');
    const markdown = await readFile(result.paths.markdown, 'utf8');
    const bundle = JSON.parse(await readFile(result.paths.bundle, 'utf8'));
    const analysis = JSON.parse(await readFile(result.paths.analysis, 'utf8'));
    const validation = JSON.parse(await readFile(result.paths.validation, 'utf8'));
    const registry = await listReportRegistry(reportRoot);

    assert.equal(bundle.reportType, 'final_investment_human_review_report');
    assert.equal(analysis.analystMode, 'deterministic_compiler_backed_final_investment_export');
    assert.equal(validation.status, 'passed');
    assert.match(html, /Final investment human-review report/);
    assert.match(html, /Evidence and Validation Tables/);
    assert.match(html, /Issuer Evidence Bridge/);
    assert.match(html, /Market Validation Table/);
    assert.match(html, /Why This Matters/);
    assert.match(html, /Evidence Ladder/);
    assert.match(html, /Why This Is Not Decision-Ready/);
    assert.match(html, /Portfolio action is not allowed without human review/);
    assert.ok((html.match(/<h2/g) || []).length >= 16);
    assert.doesNotMatch(html, /\bgrid-official:|grid-issuer:|grid-market-validation:|rawEvidenceIds|queryPayload\b/i);
    assert.match(audit, /grid-official:sample:lbnl-queued-up-fixture/);
    assert.match(markdown, /Full provenance, validation details, and raw audit records are written separately/);
    assert.match(markdown, /## What Would Promote Or Reject This Thesis/);
    assert.match(markdown, /coverage score is 1/);
    assert.match(markdown, /consistency score is 0\.77/);
    assert.doesNotMatch(markdown, /VALUATION_OR_EXPECTATION_BRIDGE_MISSING|zero_regime_support|market_validation_regime_support_missing/);
    assert.doesNotMatch(html, /VALUATION_OR_EXPECTATION_BRIDGE_MISSING|zero_regime_support|market_validation_regime_support_missing/);
    assert.match(audit, /valuation or expectation bridge remains a human-review caveat/);
    assert.equal(registry.some((row) => row.reportId === result.reportId), true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('polished report model keeps readiness and portfolio action disabled', () => {
  const model = buildPolishedFinalInvestmentReportModel(sampleFinalDryRun());
  assert.equal(model.status.readyForHumanReview, true);
  assert.equal(model.status.investmentMemoReady, false);
  assert.equal(model.status.decisionReady, false);
  assert.equal(model.status.portfolioActionAllowed, false);
  assert.equal(model.boundaries.reportCandidateWrites, 0);
  assert.equal(model.boundaries.readinessPromotionWrites, 0);
});

test('validated cross-theme export reuses cross-theme report surface without readiness promotion', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-validated-cross-theme-report-'));
  try {
    const reportRoot = path.join(tmp, 'reports');
    const result = await writeValidatedCrossThemeFinalReport({
      report: sampleFinalDryRun(),
      reportRoot,
    });
    const html = await readFile(result.paths.html, 'utf8');
    const markdown = await readFile(result.paths.markdown, 'utf8');
    const bundle = JSON.parse(await readFile(result.paths.bundle, 'utf8'));
    const analysis = JSON.parse(await readFile(result.paths.analysis, 'utf8'));
    const validation = JSON.parse(await readFile(result.paths.validation, 'utf8'));

    assert.equal(bundle.reportType, 'cross_theme_bottleneck_report');
    assert.equal(bundle.subject.subjectType, 'cross_theme_candidate');
    assert.equal(analysis.analystMode, 'deterministic_compiler_backed_validated_cross_theme_export');
    assert.deepEqual(
      new Set(analysis.signalCards.map((card) => card.domain)),
      new Set(['attention', 'fundamental', 'market', 'constraint', 'causal']),
    );
    assert.equal(analysis.analystSynthesis.strongestEvidence.length >= 1, true);
    assert.equal(analysis.analystSynthesis.invalidators.length >= 1, true);
    assert.notEqual(validation.status, 'blocked');
    assert.deepEqual(validation.blockers, []);
    assert.equal(validation.quality.decisionDiagnostic.status, 'human_review_required');
    assert.equal(validation.quality.decisionDiagnostic.evidenceSufficiency, 'sufficient_for_human_investment_memo_review');
    assert.equal(validation.quality.researchUtility.closureState, 'human_review_required');
    assert.match(html, /Discovery Judgment/);
    assert.match(html, /Human-review investment memo candidate; not decision-ready/);
    assert.doesNotMatch(html, /More evidence needed/);
    assert.match(html, /Why This Connector Matters/);
    assert.match(html, /Shared Constraint Map/);
    assert.match(html, /Why A Normal Theme Dashboard Would Miss It/);
    assert.match(html, /Bottleneck Transmission Path/);
    assert.match(html, /Discovery-to-Action Bridge/);
    assert.match(html, /Cross-Theme Evidence Matrix/);
    assert.match(html, /Auto-discovered related issuer map/);
    assert.match(html, /Cross-Theme Issuer Action Bridge/);
    assert.match(markdown, /cannot authorize portfolio action/);
    assert.equal(bundle.metadata.finalInvestmentDryRun.status.investmentMemoReady, false);
    assert.equal(bundle.metadata.finalInvestmentDryRun.status.decisionReady, false);
    assert.equal(bundle.metadata.finalInvestmentDryRun.status.portfolioActionAllowed, false);
    assert.equal(bundle.metadata.finalInvestmentDryRun.mutationBoundary.reportCandidateWrites, 0);
    assert.equal(bundle.metadata.finalInvestmentDryRun.mutationBoundary.readinessPromotionWrites, 0);
    assert.doesNotMatch(html, /\bgrid-official:|grid-issuer:|rawEvidenceIds|queryPayload\b/i);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('validated cross-theme export uses explicit non-grid subject metadata instead of grid/PWR fallback', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-validated-cross-theme-non-grid-'));
  try {
    const reportRoot = path.join(tmp, 'reports');
    const report = structuredClone(sampleFinalDryRun());
    report.metadata.subjectId = 'dryrun-cryo-subject';
    report.metadata.subjectLabel = 'Cryogenic valve qualification capacity across space and quantum hardware';
    report.auditAppendix.subject = {
      subjectId: 'dryrun-cryo-subject',
      subjectLabel: 'Cryogenic valve qualification capacity across space and quantum hardware',
      themes: ['space', 'quantum-computing'],
      themePair: 'space + quantum-computing',
      connector: 'cryogenic valve qualification capacity',
      bottleneckNode: 'cryogenic valve qualification capacity',
      mechanismNode: 'cryogenic valve qualification capacity',
      issuerBridgeNode: 'cryogenic component qualification backlog',
      concreteBottleneckNodes: [
        { node: 'cryogenic valve qualification capacity', class: 'technical_qualification' },
        { node: 'cryogenic component qualification backlog', class: 'issuer_bridge' },
      ],
      issuerUniverse: ['CRYOA', 'VACB'],
      mechanismSummary: 'Accepted official technical evidence supports a cryogenic qualification bottleneck.',
      issuerBridgeSummary: 'Accepted issuer evidence links qualification backlog to named supplier exposure.',
      negativeControlSummary: 'Negative controls are CHECKED_NO_DIRECT.',
      holdoutSummary: 'Holdout validation is confirmed outside seed generation.',
      marketValidationSummary: 'Controlled market validation is controlled_ready.',
    };
    for (const claim of report.auditAppendix.claimEvidenceMap) {
      claim.evidenceIds = claim.claimId === 'mechanism-evidence'
        ? ['cryo-official:qualification-standard']
        : ['cryo-issuer:qualification-backlog'];
    }
    report.claims = report.auditAppendix.claimEvidenceMap;
    report.auditAppendix.evidenceContractMatrixSummary = report.auditAppendix.evidenceContractMatrixSummary.map((row) => {
      if (row.evidenceClass === 'grid_interconnection') {
        return {
          ...row,
          evidenceClass: 'technical_qualification',
          evidenceIds: ['cryo-official:qualification-standard', 'cryo-official:qualification-lab'],
        };
      }
      if (row.evidenceClass === 'mechanism_validation') {
        return {
          ...row,
          evidenceIds: ['cryo-official:qualification-standard', 'cryo-official:qualification-lab'],
        };
      }
      if (row.evidenceClass === 'issuer_exposure') {
        return {
          ...row,
          evidenceIds: ['cryo-issuer:qualification-backlog', 'cryo-issuer:capacity-guidance'],
        };
      }
      return row;
    });
    const result = await writeValidatedCrossThemeFinalReport({ report, reportRoot });
    const html = await readFile(result.paths.html, 'utf8');
    const bundle = JSON.parse(await readFile(result.paths.bundle, 'utf8'));
    const validation = JSON.parse(await readFile(result.paths.validation, 'utf8'));

    assert.notEqual(validation.status, 'blocked');
    assert.deepEqual(validation.blockers, []);
    assert.deepEqual(bundle.subject.themes, ['space', 'quantum-computing']);
    assert.deepEqual(bundle.subject.metadata.issuerUniverse, ['CRYOA', 'VACB']);
    assert.match(html, /cryogenic valve qualification capacity/i);
    assert.doesNotMatch(html, /\bPWR\b|\bACM\b|AI\/data-center demand|power delivery backlog/i);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('validated cross-theme export marks positive-path AI grid subject as validation fixture only', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-validated-cross-theme-fixture-'));
  try {
    const reportRoot = path.join(tmp, 'reports');
    const report = sampleFinalDryRun();
    report.auditAppendix.subject.parentSeedId = 'positive-path-ai-grid-interconnection';
    report.auditAppendix.subject.childSeedId = 'msd-child-e19040c0';
    report.auditAppendix.subject.positivePathValidationFixture = true;
    report.auditAppendix.subject.subjectSelectionDisposition = 'validation_fixture_only';
    report.auditAppendix.subject.subjectLabel = 'Grid infrastructure execution capacity and power delivery backlog as an AI/data-center power bottleneck derivative';
    const result = await writeValidatedCrossThemeFinalReport({
      report,
      reportRoot,
    });
    const html = await readFile(result.paths.html, 'utf8');
    const bundle = JSON.parse(await readFile(result.paths.bundle, 'utf8'));
    const analysis = JSON.parse(await readFile(result.paths.analysis, 'utf8'));

    assert.equal(bundle.subject.subjectType, 'cross_theme_validation_fixture');
    assert.equal(bundle.subject.metadata.selectionDisposition, 'validation_fixture_only');
    assert.equal(bundle.subject.metadata.noveltyGatePassed, false);
    assert.equal(bundle.metadata.frontierDiscovery, false);
    assert.equal(bundle.metadata.nonObviousDiscovery.noveltyGatePassed, false);
    assert.match(html, /Validation fixture only/);
    assert.match(html, /not as the final non-obvious cross-theme discovery/);
    assert.match(html, /fails the final novelty-selection gate/);
    assert.equal(analysis.evidenceStrength.mutationBoundary.reportCandidateWrites, 0);
    assert.equal(bundle.metadata.finalInvestmentDryRun.mutationBoundary.readinessPromotionWrites, 0);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
