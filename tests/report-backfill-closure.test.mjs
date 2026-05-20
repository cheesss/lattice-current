import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildReportBackfillClosureLedger,
  loadReportBackfillClosureSummaries,
  normalizeClosureStatus,
} from '../scripts/_shared/report-backfill-closure.mjs';

test('report backfill closure ledger normalizes tasks, approvals, and evidence by class', () => {
  const ledger = buildReportBackfillClosureLedger({
    artifact: {
      reportId: 'RPT-test',
      reportPath: 'data/reports/RPT-test/report.html',
      bundle: {
        reportType: 'theme_report',
        subject: { display: 'AI / Machine Learning' },
        evidenceContractMatrix: [
          { evidenceClass: 'issuer_commentary', status: 'missing' },
          { evidenceClass: 'market_validation', status: 'missing' },
          { evidenceClass: 'negative_control', status: 'context' },
        ],
      },
    },
    taskRows: [{
      id: 1,
      status: 'queued_review',
      metadata: { desiredEvidenceClass: 'issuer_commentary', providerRoutePlan: { providerRoute: 'issuer_commentary' } },
    }],
    approvalRows: [{
      id: 2,
      status: 'approved',
      payload: { desiredEvidenceClass: 'issuer_commentary', providerRoutePlan: { providerRoute: 'issuer_commentary' } },
    }],
    evidenceRows: [{
      id: 3,
      source_type: 'external-rss',
      metadata: { desiredEvidenceClass: 'negative_control', evidenceUse: 'negative_control_candidate', negativeControlFinding: 'supported_constraint' },
    }],
    marketValidation: { tier: 'weak_screen', evidenceUse: 'weak_noise' },
  });

  assert.equal(normalizeClosureStatus({ metadata: { evidenceUse: 'promotion_candidate' } }, 'evidence'), 'promotion_collected');
  assert.equal(ledger.reportId, 'RPT-test');
  assert.equal(ledger.subject, 'AI / Machine Learning');
  assert.equal(ledger.marketTier, 'weak_screen');
  assert.equal(ledger.negativeControlStatus, 'supported_constraint');
  assert.equal(ledger.classLedger.some((row) => row.evidenceClass === 'issuer_commentary' && row.state === 'approved'), true);
  assert.equal(ledger.classLedger.some((row) => row.evidenceClass === 'market_validation' && row.state === 'weak_noise'), true);
  assert.equal(ledger.openClasses.includes('issuer_commentary'), true);
  assert.equal(ledger.visibleStatus, 'running');
  assert.equal(ledger.visualStatus, 'running');
  assert.equal(ledger.severity, 'info');
  assert.equal(ledger.classRows.some((row) =>
    row.evidenceClass === 'issuer_commentary'
    && row.providerRoute === 'issuer_commentary'
    && row.tier === 'missing'
  ), true);
  assert.equal(ledger.primaryBlocker.startsWith('open evidence class:'), true);
  assert.match(ledger.nextAction, /route targeted backfill/);
});

test('report backfill closure ledger exposes issuer-blocked and market missing reasons', () => {
  const ledger = buildReportBackfillClosureLedger({
    artifact: {
      reportId: 'RPT-no-issuer',
      bundle: {
        reportType: 'cross_theme_bottleneck_report',
        subject: { display: 'unmapped bottleneck' },
        evidenceContractMatrix: [
          { evidenceClass: 'issuer_exposure', status: 'missing' },
          { evidenceClass: 'market_validation', status: 'missing' },
        ],
      },
    },
    taskRows: [{
      id: 7,
      status: 'pending',
      metadata: {
        desiredEvidenceClass: 'issuer_exposure',
        closureState: 'blocked_missing_issuer_universe',
        nextAction: 'resolve issuer universe before running issuer-specific collectors',
      },
    }],
    marketValidation: {
      tier: 'missing',
      evidenceUse: 'missing',
      missingReason: 'no_issuer_universe',
      nextAction: 'resolve issuer universe before running controlled market validation',
    },
  });

  const issuer = ledger.classLedger.find((row) => row.evidenceClass === 'issuer_exposure');
  const market = ledger.classLedger.find((row) => row.evidenceClass === 'market_validation');

  assert.equal(issuer.state, 'blocked_missing_issuer_universe');
  assert.equal(market.state, 'blocked_missing_issuer_universe');
  assert.equal(market.terminalReason, 'no_issuer_universe');
  assert.equal(ledger.openClasses.includes('market_validation'), true);
  assert.equal(ledger.visualStatus, 'needs-fix');
  assert.equal(ledger.primaryBlocker, 'blocked_missing_issuer_universe');
  assert.equal(ledger.nextAction, 'resolve issuer universe');
  assert.equal(ledger.classRows.some((row) =>
    row.evidenceClass === 'market_validation'
    && row.visualStatus === 'blocked_missing_issuer_universe'
    && row.nextAction === 'resolve issuer universe before running controlled market validation'
  ), true);
});

test('report backfill closure ledger separates provider and acceptance terminal states', () => {
  const ledger = buildReportBackfillClosureLedger({
    artifact: {
      reportId: 'RPT-terminal',
      bundle: {
        reportType: 'theme_report',
        subject: { display: 'Generic Capacity Theme' },
        evidenceContractMatrix: [
          { evidenceClass: 'substitution_limit', status: 'missing' },
          { evidenceClass: 'historical_analog', status: 'missing' },
        ],
      },
    },
    taskRows: [{
      id: 10,
      status: 'completed',
      metadata: {
        desiredEvidenceClass: 'historical_analog',
        closureReason: 'collector_not_available',
        providerRoutePlan: { providerRoute: 'historical_memory', executableCollectors: ['manual-specialist'] },
      },
    }],
    evidenceRows: [{
      id: 11,
      source_type: 'external-rss',
      metadata: {
        desiredEvidenceClass: 'substitution_limit',
        evidenceUse: 'weak_noise',
        closureReason: 'acceptance_failed',
        acceptanceVerdict: 'weak_noise',
        factsExtracted: [{ key: 'generic_bottleneck_or_supplier', label: 'generic bottleneck or supplier mention' }],
        missingFacts: ['qualified_supplier_limit'],
        collectorCapability: { collector: 'source-query', supported: true },
      },
    }],
  });

  assert.equal(normalizeClosureStatus({ metadata: { closureReason: 'provider_no_hit' } }, 'task'), 'provider_no_hit');
  assert.equal(ledger.counts.collector_not_available, 1);
  assert.equal(ledger.classRows.some((row) =>
    row.evidenceClass === 'substitution_limit'
    && row.factsFound.includes('generic bottleneck')
    && row.closureReason === 'acceptance_failed'
  ), true);
  assert.equal(ledger.visualStatus, 'exhausted');
});

test('report backfill closure ledger exposes provider rate limits and direct-provider requirements', () => {
  const ledger = buildReportBackfillClosureLedger({
    artifact: {
      reportId: 'RPT-grid',
      bundle: {
        reportType: 'cross_theme_bottleneck_report',
        subject: { display: 'grid interconnection queue' },
        evidenceContractMatrix: [
          { evidenceClass: 'issuer_exposure', status: 'missing' },
          { evidenceClass: 'market_validation', status: 'missing' },
        ],
      },
    },
    approvalRows: [{
      id: 20,
      status: 'weak-noise-collected',
      payload: {
        desiredEvidenceClass: 'issuer_exposure',
        sourceQueryFailure: { category: 'weak-noise-only' },
        closureState: 'direct_provider_required',
        closureReason: 'broad_search_exhausted_direct_provider_required',
        nextAction: 'run direct SEC/IR/transcript/contract issuer bridge collectors',
      },
    }],
    providerRunRows: [{
      id: 21,
      status: 'deferred_provider',
      summary: {
        target: {
          reportId: 'RPT-grid',
          desiredEvidenceClasses: ['issuer_exposure'],
          providerRoutePlans: [{ evidenceClass: 'issuer_exposure', providerRoute: 'issuer_commentary' }],
        },
        results: [{ provider: 'fmp', rateLimited: true, deferredSymbols: ['VRT'], nextAttemptAt: '2026-05-18T12:00:00.000Z' }],
      },
    }],
    marketValidation: {
      tier: 'missing',
      evidenceUse: 'missing',
      missingReason: 'no_event_uplift_rows',
      nextAction: 'run report-specific event-control build or repair-recent-event-uplift',
    },
  });

  assert.equal(ledger.counts.provider_rate_limited, 1);
  assert.equal(ledger.evidenceState, 'provider_deferred');
  assert.equal(ledger.evidenceStateLabel, 'Provider cooldown pending');
  assert.equal(ledger.visualStatus, 'running');
  assert.equal(ledger.primaryBlocker, 'provider_rate_limited');
  assert.equal(ledger.nextAction, 'wait for provider cooldown, then resume deferred symbol/endpoint queue');
  assert.equal(ledger.classRows.some((row) =>
    row.evidenceClass === 'issuer_exposure'
    && row.closureReason === 'provider_rate_limited'
  ), true);
  assert.equal(ledger.classRows.some((row) =>
    row.evidenceClass === 'market_validation'
    && row.closureReason === 'no_event_uplift_rows'
  ), true);
});

test('report backfill closure ledger canonicalizes hyphenated provider classes', () => {
  const ledger = buildReportBackfillClosureLedger({
    artifact: {
      reportId: 'RPT-canonical',
      bundle: {
        reportType: 'cross_theme_bottleneck_report',
        subject: { display: 'generated grid node' },
        evidenceContractMatrix: [
          { evidenceClass: 'supplier_capacity', status: 'missing' },
        ],
      },
    },
    evidenceRows: [{
      id: 31,
      source_type: 'official-company',
      metadata: {
        desiredEvidenceClass: 'supplier_capacity',
        evidenceUse: 'promotion_candidate',
      },
    }],
    providerRunRows: [{
      id: 32,
      status: 'deferred_provider',
      summary: {
        target: {
          reportId: 'RPT-canonical',
          desiredEvidenceClasses: ['supplier-capacity'],
          providerRoutePlans: [{ evidenceClass: 'supplier-capacity', providerRoute: 'industry_official_or_company_source' }],
        },
      },
    }],
  });

  const supplierRows = ledger.classLedger.filter((row) => row.evidenceClass === 'supplier_capacity');
  assert.equal(supplierRows.length, 1);
  assert.equal(ledger.classLedger.some((row) => row.evidenceClass === 'supplier-capacity'), false);
  assert.equal(ledger.classRows.filter((row) => row.evidenceClass === 'supplier_capacity').length, 1);
  assert.equal(ledger.counts.provider_rate_limited, 1);
});

test('executed approvals do not count as promotion evidence without evidenceUse', () => {
  const ledger = buildReportBackfillClosureLedger({
    artifact: {
      reportId: 'RPT-executed-approval',
      bundle: {
        reportType: 'cross_theme_bottleneck_report',
        subject: { display: 'generated node' },
        evidenceContractMatrix: [
          { evidenceClass: 'supplier_capacity', status: 'missing' },
        ],
      },
    },
    approvalRows: [{
      id: 40,
      status: 'executed',
      payload: {
        desiredEvidenceClass: 'supplier_capacity',
        providerRoutePlan: { providerRoute: 'industry_official_or_company_source' },
      },
    }],
  });

  assert.equal(ledger.counts.promotion_collected, 0);
  assert.equal(ledger.counts.context_collected, 1);
  assert.equal(ledger.classRows.some((row) =>
    row.evidenceClass === 'supplier_capacity'
    && row.visualStatus === 'context_collected'
  ), true);
});

test('report backfill closure ignores stale provider runs outside current issuer universe', () => {
  const ledger = buildReportBackfillClosureLedger({
    artifact: {
      reportId: 'RPT-current',
      bundle: {
        reportType: 'cross_theme_bottleneck_report',
        subject: { display: 'generated qualification node' },
        metadata: { candidateIssuerUniverse: ['ETN', 'PWR'] },
        evidenceContractMatrix: [
          { evidenceClass: 'issuer_exposure', status: 'missing' },
          { evidenceClass: 'supplier_capacity', status: 'missing' },
        ],
      },
    },
    providerRunRows: [
      {
        id: 41,
        status: 'deferred_provider',
        target_key: 'endogenous-adjacent-current::ETN,PWR,NVDA,MSFT',
        summary: {
          target: {
            desiredEvidenceClasses: ['issuer_exposure', 'supplier_capacity'],
            providerRoutePlans: [
              { evidenceClass: 'issuer_exposure', providerRoute: 'issuer_filing_transcript_or_contract' },
              { evidenceClass: 'supplier_capacity', providerRoute: 'industry_official_or_company_source' },
            ],
          },
        },
      },
      {
        id: 42,
        status: 'deferred_provider',
        target_key: 'endogenous-adjacent-current::ETN,PWR',
        summary: {
          target: {
            desiredEvidenceClasses: ['issuer_exposure'],
            providerRoutePlans: [
              { evidenceClass: 'issuer_exposure', providerRoute: 'issuer_filing_transcript_or_contract' },
            ],
          },
        },
      },
      {
        id: 43,
        status: 'deferred_provider',
        target_key: 'endogenous-adjacent-current::',
        summary: { target: { providerRoutePlans: [] } },
      },
    ],
  });

  assert.equal(ledger.counts.provider_rate_limited, 1);
  assert.equal(ledger.classRows.some((row) => row.evidenceClass === 'supplier_capacity' && row.closureReason === 'provider_rate_limited'), false);
  assert.equal(ledger.classRows.some((row) => row.evidenceClass === 'unknown'), false);
  assert.equal(ledger.classRows.some((row) => row.evidenceClass === 'issuer_exposure' && row.closureReason === 'provider_rate_limited'), true);
});

test('closure summaries carry provider deferrals across regenerated report ids', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lattice-closure-'));
  const dir = path.join(root, 'RPT-new');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'bundle.json'), JSON.stringify({
    reportId: 'RPT-new',
    reportType: 'cross_theme_bottleneck_report',
    subject: { displayName: 'strict generated lane' },
    evidenceContractMatrix: [{ evidenceClass: 'issuer_exposure', status: 'missing' }],
    metadata: {
      deepResearch: {
        reportClosureLedger: {
          items: [{ metadata: { reportId: 'RPT-old' } }],
        },
      },
    },
  }));

  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/external_provider_backfill_runs/i.test(sql)) {
        assert.deepEqual(params[0].sort(), ['RPT-new', 'RPT-old']);
        return { rows: [{
          id: 55,
          status: 'deferred_provider',
          summary: {
            target: {
              reportId: 'RPT-old',
              latestReportId: 'RPT-new',
              reportIds: ['RPT-old', 'RPT-new'],
              desiredEvidenceClasses: ['issuer_exposure'],
              providerRoutePlans: [{ evidenceClass: 'issuer_exposure', providerRoute: 'issuer_filing_transcript_or_contract' }],
            },
            results: [{ provider: 'sec', rateLimited: true, deferredSymbols: ['ETN'], nextAttemptAt: '2026-05-18T12:00:00.000Z' }],
          },
        }] };
      }
      return { rows: [] };
    },
  };

  const [summary] = await loadReportBackfillClosureSummaries({ client, reportRoot: root, reportDirs: [dir] });
  assert.equal(summary.reportId, 'RPT-new');
  assert.equal(summary.counts.provider_rate_limited, 1);
  assert.equal(summary.primaryBlocker, 'provider_rate_limited');
  assert.equal(queries.some((query) => /external_provider_backfill_runs/i.test(query.sql)), true);
});
