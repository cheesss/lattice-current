import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReportBackfillClosureLedger } from '../scripts/_shared/report-backfill-closure.mjs';
import {
  buildGenericEvidenceUnblockPlan,
  normalizeUnblockBlockerType,
} from '../scripts/_shared/report-unblock-controller.mjs';

function artifact({ reportId = 'RPT-test', reportType = 'theme_report', subject, matrix = [], validation = {} } = {}) {
  return {
    reportId,
    bundle: {
      reportId,
      reportType,
      subject,
      metadata: {
        deepResearchPack: {
          evidenceClassMatrix: matrix,
        },
      },
    },
    validation,
  };
}

test('generic unblock controller normalizes blockers across report shapes', () => {
  const cases = [
    artifact({
      reportId: 'RPT-theme',
      subject: { subjectType: 'theme', subjectId: 'ai-ml', displayName: 'AI / Machine Learning' },
      matrix: [
        { evidenceClass: 'power_constraint', status: 'missing', providerRoute: 'industry_policy_or_utility_source' },
        { evidenceClass: 'market_validation', status: 'missing', providerRoute: 'market_validation' },
      ],
    }),
    artifact({
      reportId: 'RPT-symbol',
      reportType: 'symbol_report',
      subject: { subjectType: 'symbol', subjectId: 'MSFT', displayName: 'MSFT' },
      matrix: [
        { evidenceClass: 'issuer_exposure', status: 'missing', providerRoute: 'issuer_filing_transcript_or_contract' },
      ],
    }),
    artifact({
      reportId: 'RPT-cross',
      reportType: 'cross_theme_bottleneck_report',
      subject: {
        subjectType: 'cross_theme_candidate',
        subjectId: '16776',
        displayName: 'solid rocket motor capacity',
        metadata: { themes: ['defense-industrial', 'space'], discovery: { triggerTerms: ['Aerojet Rocketdyne'] } },
      },
      matrix: [
        { evidenceClass: 'procurement_trigger', status: 'missing', providerRoute: 'official_contract_or_policy_source' },
        { evidenceClass: 'negative_control', status: 'missing', providerRoute: 'source_query_negative_control' },
      ],
    }),
    artifact({
      reportId: 'RPT-keyword',
      reportType: 'keyword_report',
      subject: { subjectType: 'keyword', subjectId: 'battery material capacity', displayName: 'battery material capacity' },
      matrix: [
        { evidenceClass: 'supplier_capacity', status: 'missing', providerRoute: 'industry_official_or_company_source' },
      ],
    }),
  ];

  for (const item of cases) {
    const ledger = buildReportBackfillClosureLedger({ artifact: item });
    const plan = buildGenericEvidenceUnblockPlan({ artifact: item, closureLedger: ledger });
    assert.equal(['targeted_backfill_needed', 'blocked_collecting'].includes(plan.unblockStatus), true, item.reportId);
    assert.equal(plan.blockers.length > 0, true, item.reportId);
    assert.equal(plan.routePlans.every((route) => Array.isArray(route.queryVariants)), true, item.reportId);
  }

  const cross = buildGenericEvidenceUnblockPlan({
    artifact: cases[2],
    closureLedger: buildReportBackfillClosureLedger({ artifact: cases[2] }),
  });
  assert.equal(cross.blockers.some((row) => row.type === 'negative_control_unchecked'), true);
  assert.equal(cross.routePlans.some((row) => row.evidenceClass === 'procurement_trigger' && row.executableCollectors.includes('usaspending')), true);
});

test('generic unblock controller blocks issuer-specific routes without issuer universe', () => {
  const item = artifact({
    reportId: 'RPT-no-issuer',
    reportType: 'cross_theme_bottleneck_report',
    subject: {
      subjectType: 'cross_theme_candidate',
      subjectId: 'unknown',
      displayName: 'unmapped bottleneck',
      metadata: { themes: ['technology-general'] },
    },
    matrix: [
      { evidenceClass: 'issuer_exposure', status: 'missing', providerRoute: 'issuer_filing_transcript_or_contract' },
    ],
  });
  const ledger = buildReportBackfillClosureLedger({ artifact: item });
  const plan = buildGenericEvidenceUnblockPlan({ artifact: item, closureLedger: ledger });
  const issuer = plan.blockers.find((row) => row.evidenceClass === 'issuer_exposure');

  assert.equal(issuer.type, 'issuer_bridge_missing');
  assert.equal(issuer.blockedReason, 'blocked_missing_issuer_universe');
  assert.deepEqual(issuer.executableCollectors, []);
  assert.equal(plan.unblockStatus, 'targeted_backfill_needed');
});

test('generic unblock controller closes repeated failed route attempts as exhausted', () => {
  const item = artifact({
    reportId: 'RPT-exhausted',
    subject: { subjectType: 'theme', subjectId: 'clean-energy', displayName: 'Clean Energy' },
    matrix: [
      { evidenceClass: 'supplier_capacity', status: 'missing', providerRoute: 'industry_official_or_company_source' },
    ],
  });
  const ledger = buildReportBackfillClosureLedger({ artifact: item });
  const plan = buildGenericEvidenceUnblockPlan({
    artifact: item,
    closureLedger: ledger,
    state: {
      routes: {
        'clean-energy::supplier_capacity::no-issuer::query': {
          evidenceClass: 'supplier_capacity',
          attempts: 3,
          exhausted: true,
          lastResult: 'no_progress',
          providers: ['sec', 'source-query'],
        },
      },
    },
  });

  assert.equal(plan.unblockStatus, 'search_exhausted_not_validated');
  assert.equal(plan.blockers[0].type, 'search_exhausted');
  assert.equal(plan.blockers[0].state, 'exhausted');
});

test('generic unblock controller keeps class-specific next actions separated', () => {
  const item = artifact({
    reportId: 'RPT-cloud',
    subject: { subjectType: 'theme', subjectId: 'cloud-infrastructure', displayName: 'Cloud Infrastructure' },
    matrix: [
      { evidenceClass: 'negative_control', status: 'missing' },
      { evidenceClass: 'mechanism_validation', status: 'missing' },
    ],
  });
  const ledger = buildReportBackfillClosureLedger({ artifact: item });
  const plan = buildGenericEvidenceUnblockPlan({ artifact: item, closureLedger: ledger });
  const mechanism = plan.blockers.find((row) => row.evidenceClass === 'mechanism_validation');
  const negative = plan.blockers.find((row) => row.evidenceClass === 'negative_control');

  assert.equal(negative.nextAction, 'run separate negative-control lane');
  assert.equal(mechanism.nextAction, 'route targeted backfill for mechanism_validation');
});

test('technical render blockers stay separate from evidence blockers', () => {
  assert.equal(normalizeUnblockBlockerType({
    type: 'repeated_client_phrase',
    message: 'Client memo repeats long phrases across sections.',
  }), 'technical_render_blocker');
});
