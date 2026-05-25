import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStagedProviderLiveExecutorPayload,
} from '../scripts/_shared/staged-provider-live-executor.mjs';

function fetchFor(map = {}) {
  return async (url) => {
    const raw = map[String(url)];
    if (raw === undefined) {
      return { ok: false, status: 404, headers: { get: () => 'text/plain' }, text: async () => '', arrayBuffer: async () => Buffer.from('', 'utf8') };
    }
    const body = typeof raw === 'object' ? raw.body : raw;
    const contentType = typeof raw === 'object' ? raw.contentType || 'text/html; charset=utf-8' : 'text/html; charset=utf-8';
    return {
      ok: true,
      status: 200,
      headers: { get: () => contentType },
      text: async () => body,
      arrayBuffer: async () => Buffer.from(body, 'utf8'),
    };
  };
}

function activation(records = []) {
  return {
    records: records.map((record) => ({
      candidateId: `${record.providerName}:${record.evidenceClass}`,
      status: 'staged',
      fixtureStatus: 'fixture_verified',
      reviewGatedActivation: true,
      sourceType: 'official_company_ir',
      ...record,
    })),
  };
}

function abfTasks() {
  return [
    {
      taskId: 'abf-issuer',
      seedId: 'seed-abf',
      evidenceClass: 'issuer_exposure',
      providerRoute: 'company_ir_direct_pdf',
      status: 'queued',
      acceptanceCriteria: {
        requiredTerms: ['ABF substrate', 'capacity', 'customer demand'],
        bridgeTerms: ['capacity', 'capex', 'customer demand', 'revenue'],
      },
    },
    {
      taskId: 'abf-holdout',
      seedId: 'seed-abf',
      evidenceClass: 'holdout_validation',
      providerRoute: 'company_ir_direct_pdf',
      status: 'queued',
      acceptanceCriteria: {
        requiredTerms: ['ABF substrate', 'capacity', 'customer demand'],
      },
    },
    {
      taskId: 'abf-negative',
      seedId: 'seed-abf',
      evidenceClass: 'negative_control',
      providerRoute: 'company_ir_direct_pdf',
      status: 'needs_operator_review',
      acceptanceCriteria: {
        requiredTerms: ['ABF substrate', 'capacity'],
      },
    },
  ];
}

test('staged company IR provider performs bounded live collection and promotes only accepted official evidence', async () => {
  const payload = await buildStagedProviderLiveExecutorPayload({
    sourceProviderActivation: activation([
      { providerName: 'company_ir_direct_pdf', evidenceClass: 'issuer_exposure' },
      { providerName: 'company_ir_direct_pdf', evidenceClass: 'holdout_validation' },
    ]),
    backfillPlan: { tasks: abfTasks() },
  }, {
    fetchImpl: fetchFor({
      'https://www.ibiden.com/ir/library/annual/': `
        <a href="/ir/library/annual/annual-2026.pdf">Annual Report 2026 ABF substrate capacity</a>
        <a href="/ir/library/annual/integrated-2026.pdf">Integrated Report 2026 IC substrate capacity</a>
      `,
      'https://www.ibiden.com/ir/library/annual/annual-2026.pdf': {
        contentType: 'application/pdf',
        body: '%PDF-1.4 (Official annual report: ABF package substrate capacity and capex allocation are tied to customer demand, revenue, backlog, and lead time.) %%EOF',
      },
      'https://www.ibiden.com/ir/library/annual/integrated-2026.pdf': {
        contentType: 'application/pdf',
        body: '%PDF-1.4 (Official integrated report: high-end IC substrate capacity expansion supports customer demand and revenue growth.) %%EOF',
      },
    }),
    executeLive: true,
    maxTargets: 3,
    rateLimitMs: 0,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });

  assert.equal(payload.targetCount, 1);
  assert.equal(payload.providerCollectorRegistry.ok, true);
  assert.equal(payload.providerRuns[0].collectorKind, 'company_ir_document_extraction');
  assert.equal(payload.executedTargetCount, 1);
  assert.equal(payload.rawEvidenceStoredCount > 0, true);
  assert.equal(payload.acceptedEvidence.some((row) => row.evidenceClass === 'issuer_exposure'), true);
  assert.equal(payload.acceptedEvidence.some((row) => row.evidenceClass === 'holdout_validation'), true);
  assert.equal(payload.acceptedPromotionEvidenceStoredCount, 1);
  assert.deepEqual(payload.coveredEvidenceClasses, ['issuer_exposure']);
  assert.equal(payload.readinessChanged, false);
  assert.equal(payload.providerExecutionBoundary.providerActivationWrites, 0);
  assert.equal(payload.providerExecutionBoundary.readinessPromotionWrites, 0);
  assert.equal(payload.providerExecutionBoundary.reportCandidateWrites, 0);
  assert.equal(payload.acceptedPromotionEvidence[0].validationFixtureOnly, false);
});

test('staged provider live executor does not leak unrelated repair-loop issuer universe into another seed task', async () => {
  const fetchedUrls = [];
  const payload = await buildStagedProviderLiveExecutorPayload({
    repairLoop: {
      selectedChildSeed: {
        childSeedId: 'unrelated-defense-child',
        issuerUniverse: ['NOC', 'LHX'],
        issuerCandidates: ['NOC', 'LHX'],
      },
    },
    sourceProviderActivation: activation([
      { providerName: 'company_ir_direct_pdf', evidenceClass: 'issuer_exposure' },
      { providerName: 'company_ir_direct_pdf', evidenceClass: 'holdout_validation' },
    ]),
    backfillPlan: { tasks: abfTasks().slice(0, 1) },
  }, {
    fetchImpl: async (url) => {
      fetchedUrls.push(String(url));
      return fetchFor({
        'https://www.ibiden.com/ir/library/annual/': '<a href="/ir/library/annual/annual-2026.pdf">Annual Report 2026 ABF substrate capacity</a>',
        'https://www.ibiden.com/ir/library/annual/annual-2026.pdf': {
          contentType: 'application/pdf',
          body: '%PDF-1.4 (Official annual report: ABF package substrate capacity and capex allocation are tied to customer demand, revenue, backlog, and lead time.) %%EOF',
        },
      })(url);
    },
    executeLive: true,
    maxTargets: 1,
    rateLimitMs: 0,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });

  assert.equal(fetchedUrls.some((url) => url.includes('ibiden.com')), true);
  assert.equal(payload.providerRuns[0].collectorStatus.issuerCount > 0, true);
  assert.equal(payload.acceptedPromotionEvidenceStoredCount, 1);
});

test('staged non-US provider without bounded collector records raw failure instead of promotion', async () => {
  const payload = await buildStagedProviderLiveExecutorPayload({
    sourceProviderActivation: activation([
      {
        providerName: 'unbounded_non_us_provider',
        evidenceClass: 'issuer_exposure',
        sourceType: 'non_us_official_filing',
        allowlist: ['unbounded.example'],
      },
    ]),
    backfillPlan: {
      tasks: [{
        taskId: 'unbounded-issuer',
        seedId: 'seed-abf',
        evidenceClass: 'issuer_exposure',
        providerRoute: 'unbounded_non_us_provider',
        status: 'queued',
        acceptanceCriteria: { requiredTerms: ['ABF substrate', 'capacity'] },
      }],
    },
  }, {
    fetchImpl: fetchFor({
      'https://unbounded.example/': '<html>Unbounded provider landing page</html>',
    }),
    executeLive: true,
    maxTargets: 2,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });

  assert.equal(payload.targetCount, 1);
  assert.equal(payload.targets[0].collectorKind, 'generic_staged_provider_probe');
  assert.equal(payload.rawEvidenceStoredCount, 1);
  assert.equal(payload.acceptedEvidenceStoredCount, 0);
  assert.equal(payload.acceptedPromotionEvidenceStoredCount, 0);
  assert.equal(payload.rawEvidence[0].acceptanceBlockers.includes('raw_not_accepted_by_acceptance_lane'), true);
  assert.equal(payload.providerExecutionBoundary.providerActivationWrites, 0);
  assert.equal(payload.providerExecutionBoundary.canonicalWrites, 0);
  assert.equal(payload.providerExecutionBoundary.reportCandidateWrites, 0);
});

test('staged TDnet provider executes bounded issuer-exposure fixture parser', async () => {
  const payload = await buildStagedProviderLiveExecutorPayload({
    sourceProviderActivation: activation([
      {
        providerName: 'tdnet',
        evidenceClass: 'issuer_exposure',
        sourceType: 'non_us_official_disclosure',
        allowlist: ['www.release.tdnet.info'],
      },
    ]),
    backfillPlan: {
      tasks: [{
        taskId: 'tdnet-issuer',
        seedId: 'seed-tdnet',
        evidenceClass: 'issuer_exposure',
        providerRoute: 'tdnet',
        status: 'queued',
        sourceQuery: 'TDnet IBIDEN ABF substrate capacity revenue',
        acceptanceCriteria: {
          requiredTerms: ['ABF substrate', 'capacity'],
          bridgeTerms: ['customer demand', 'sales'],
        },
      }],
    },
  }, {
    executeLive: true,
    maxTargets: 1,
    generatedAt: '2026-05-23T00:00:00.000Z',
  });

  assert.equal(payload.targetCount, 1);
  assert.equal(payload.targets[0].collectorKind, 'tdnet_issuer_exposure');
  assert.equal(payload.providerRuns[0].collectorKind, 'tdnet_issuer_exposure');
  assert.equal(payload.rawEvidenceStoredCount, 5);
  assert.equal(payload.acceptedEvidence.some((row) => row.evidenceClass === 'issuer_exposure'), true);
  assert.equal(payload.acceptedPromotionEvidenceStoredCount, 1);
  assert.equal(payload.coveredEvidenceClasses.includes('issuer_exposure'), true);
  assert.equal(payload.rawEvidence.find((row) => row.fixtureKind === 'ticker_only_rejection_fixture').accepted, false);
  assert.equal(payload.rawEvidence.find((row) => row.fixtureKind === 'raw_metadata_only_rejection_fixture').accepted, false);
  assert.equal(payload.providerRuns[0].collectorStatus.acceptanceSafety.rawEvidenceAutoPromotes, false);
  assert.equal(payload.providerExecutionBoundary.readinessPromotionWrites, 0);
  assert.equal(payload.providerExecutionBoundary.reportCandidateWrites, 0);
});

test('staged DART provider executes bounded issuer-exposure fixture parser', async () => {
  const payload = await buildStagedProviderLiveExecutorPayload({
    sourceProviderActivation: activation([
      {
        providerName: 'dart',
        evidenceClass: 'issuer_exposure',
        sourceType: 'non_us_official_filing',
        allowlist: ['dart.fss.or.kr'],
      },
    ]),
    backfillPlan: {
      tasks: [{
        taskId: 'dart-issuer',
        seedId: 'seed-dart',
        evidenceClass: 'issuer_exposure',
        providerRoute: 'dart',
        status: 'queued',
        sourceQuery: 'DART Samsung HBM memory capacity revenue',
        acceptanceCriteria: {
          requiredTerms: ['HBM memory', 'capacity'],
          bridgeTerms: ['customer demand', 'sales'],
        },
      }],
    },
  }, {
    executeLive: true,
    maxTargets: 1,
    generatedAt: '2026-05-23T00:00:00.000Z',
  });

  assert.equal(payload.targetCount, 1);
  assert.equal(payload.targets[0].collectorKind, 'dart_issuer_exposure');
  assert.equal(payload.providerRuns[0].collectorKind, 'dart_issuer_exposure');
  assert.equal(payload.rawEvidenceStoredCount, 5);
  assert.equal(payload.acceptedEvidence.some((row) => row.evidenceClass === 'issuer_exposure'), true);
  assert.equal(payload.acceptedPromotionEvidenceStoredCount, 1);
  assert.equal(payload.coveredEvidenceClasses.includes('issuer_exposure'), true);
  assert.equal(payload.rawEvidence.find((row) => row.fixtureKind === 'ticker_only_rejection_fixture').accepted, false);
  assert.equal(payload.rawEvidence.find((row) => row.fixtureKind === 'raw_metadata_only_rejection_fixture').accepted, false);
  assert.equal(payload.providerRuns[0].collectorStatus.acceptanceSafety.rawEvidenceAutoPromotes, false);
  assert.equal(payload.providerExecutionBoundary.readinessPromotionWrites, 0);
  assert.equal(payload.providerExecutionBoundary.reportCandidateWrites, 0);
});

test('staged EDINET provider executes bounded issuer-exposure fixture parser', async () => {
  const payload = await buildStagedProviderLiveExecutorPayload({
    sourceProviderActivation: activation([
      {
        providerName: 'edinet',
        evidenceClass: 'issuer_exposure',
        sourceType: 'non_us_official_filing',
        allowlist: ['disclosure2.edinet-fsa.go.jp'],
      },
    ]),
    backfillPlan: {
      tasks: [{
        taskId: 'edinet-issuer',
        seedId: 'seed-edinet',
        evidenceClass: 'issuer_exposure',
        providerRoute: 'edinet',
        status: 'queued',
        sourceQuery: 'EDINET IBIDEN ABF substrate capacity revenue',
        acceptanceCriteria: {
          requiredTerms: ['ABF substrate', 'capacity'],
          bridgeTerms: ['customer demand', 'sales'],
        },
      }],
    },
  }, {
    executeLive: true,
    maxTargets: 1,
    generatedAt: '2026-05-23T00:00:00.000Z',
  });

  assert.equal(payload.targetCount, 1);
  assert.equal(payload.targets[0].collectorKind, 'edinet_issuer_exposure');
  assert.equal(payload.providerRuns[0].collectorKind, 'edinet_issuer_exposure');
  assert.equal(payload.rawEvidenceStoredCount, 5);
  assert.equal(payload.acceptedEvidence.some((row) => row.evidenceClass === 'issuer_exposure'), true);
  assert.equal(payload.acceptedPromotionEvidenceStoredCount, 1);
  assert.equal(payload.coveredEvidenceClasses.includes('issuer_exposure'), true);
  assert.equal(payload.rawEvidence.find((row) => row.fixtureKind === 'ticker_only_rejection_fixture').accepted, false);
  assert.equal(payload.rawEvidence.find((row) => row.fixtureKind === 'raw_metadata_only_rejection_fixture').accepted, false);
  assert.equal(payload.providerRuns[0].collectorStatus.acceptanceSafety.rawEvidenceAutoPromotes, false);
  assert.equal(payload.providerExecutionBoundary.readinessPromotionWrites, 0);
  assert.equal(payload.providerExecutionBoundary.reportCandidateWrites, 0);
});

test('staged Taiwan MOPS provider executes bounded issuer-exposure fixture parser', async () => {
  const payload = await buildStagedProviderLiveExecutorPayload({
    sourceProviderActivation: activation([
      {
        providerName: 'taiwan_mops',
        evidenceClass: 'issuer_exposure',
        sourceType: 'non_us_official_filing',
        allowlist: ['mops.twse.com.tw'],
      },
    ]),
    backfillPlan: {
      tasks: [{
        taskId: 'mops-issuer',
        seedId: 'seed-mops',
        evidenceClass: 'issuer_exposure',
        providerRoute: 'taiwan_mops',
        status: 'queued',
        sourceQuery: 'Taiwan MOPS Unimicron ABF substrate capacity revenue',
        acceptanceCriteria: {
          requiredTerms: ['ABF substrate', 'capacity'],
          bridgeTerms: ['customer demand', 'sales'],
        },
      }],
    },
  }, {
    executeLive: true,
    maxTargets: 1,
    generatedAt: '2026-05-23T00:00:00.000Z',
  });

  assert.equal(payload.targetCount, 1);
  assert.equal(payload.targets[0].collectorKind, 'taiwan_mops_issuer_exposure');
  assert.equal(payload.providerRuns[0].collectorKind, 'taiwan_mops_issuer_exposure');
  assert.equal(payload.rawEvidenceStoredCount, 5);
  assert.equal(payload.acceptedEvidence.some((row) => row.evidenceClass === 'issuer_exposure'), true);
  assert.equal(payload.acceptedPromotionEvidenceStoredCount, 1);
  assert.equal(payload.coveredEvidenceClasses.includes('issuer_exposure'), true);
  assert.equal(payload.rawEvidence.find((row) => row.fixtureKind === 'ticker_only_rejection_fixture').accepted, false);
  assert.equal(payload.rawEvidence.find((row) => row.fixtureKind === 'raw_metadata_only_rejection_fixture').accepted, false);
  assert.equal(payload.providerRuns[0].collectorStatus.acceptanceSafety.rawEvidenceAutoPromotes, false);
  assert.equal(payload.providerExecutionBoundary.readinessPromotionWrites, 0);
  assert.equal(payload.providerExecutionBoundary.reportCandidateWrites, 0);
});

test('official issuer filing route fans out to staged non-US official issuer collectors', async () => {
  const payload = await buildStagedProviderLiveExecutorPayload({
    sourceProviderActivation: activation([
      {
        providerName: 'tdnet',
        evidenceClass: 'issuer_exposure',
        sourceType: 'non_us_official_disclosure',
        allowlist: ['www.release.tdnet.info'],
      },
      {
        providerName: 'taiwan_mops',
        evidenceClass: 'issuer_exposure',
        sourceType: 'non_us_official_filing',
        allowlist: ['mops.twse.com.tw'],
      },
    ]),
    backfillPlan: {
      tasks: [{
        taskId: 'generic-official-issuer',
        seedId: 'seed-official-issuer',
        evidenceClass: 'issuer_exposure',
        providerRoute: 'issuer_filing_transcript_or_contract',
        status: 'queued',
        sourceQuery: 'advanced packaging substrate capacity issuer exposure segment revenue backlog guidance',
        acceptanceCriteria: {
          requiredTerms: ['advanced packaging capacity', 'substrate'],
          bridgeTerms: ['customer demand', 'sales'],
        },
      }],
    },
  }, {
    executeLive: true,
    maxTargets: 2,
    generatedAt: '2026-05-23T00:00:00.000Z',
  });

  assert.equal(payload.targetCount, 2);
  const kinds = payload.targets.map((target) => target.collectorKind).sort();
  assert.deepEqual(kinds, ['taiwan_mops_issuer_exposure', 'tdnet_issuer_exposure']);
  assert.equal(payload.providerExecutionBoundary.providerActivationWrites, 0);
  assert.equal(payload.providerExecutionBoundary.readinessPromotionWrites, 0);
  assert.equal(payload.providerExecutionBoundary.reportCandidateWrites, 0);
});

test('staged grid official provider collects mechanism evidence without promotion readiness', async () => {
  const payload = await buildStagedProviderLiveExecutorPayload({
    sourceProviderActivation: activation([
      {
        providerName: 'grid_official_readonly',
        evidenceClass: 'mechanism_validation',
        sourceType: 'official_grid_operator',
      },
    ]),
    backfillPlan: {
      tasks: [{
        taskId: 'grid-mechanism',
        seedId: 'seed-grid-a',
        evidenceClass: 'mechanism_validation',
        providerRoute: 'grid_official_readonly',
        status: 'queued',
        acceptanceCriteria: { requiredTerms: ['interconnection queue', 'processing capacity'] },
      }],
    },
  }, {
    executeLive: true,
    maxTargets: 2,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });

  assert.equal(payload.targetCount, 1);
  assert.equal(payload.rawEvidenceStoredCount >= 1, true);
  assert.equal(payload.acceptedEvidence.some((row) => row.evidenceClass === 'mechanism_validation'), true);
  assert.equal(payload.acceptedPromotionEvidenceStoredCount, 0);
  assert.equal(payload.coveredEvidenceClasses.length, 0);
  assert.equal(payload.readinessChanged, false);
  assert.equal(payload.providerRuns[0].providerName, 'grid_official_readonly');
  assert.equal(payload.providerRuns[0].collectorKind, 'grid_mechanism_validation');
  assert.equal(payload.providerExecutionBoundary.readinessPromotionWrites, 0);
});

test('staged FERC interconnection reform provider executes bounded engineering-process fixture parser', async () => {
  const payload = await buildStagedProviderLiveExecutorPayload({
    sourceProviderActivation: activation([
      {
        providerName: 'ferc_interconnection_reform',
        evidenceClass: 'engineering_process',
        sourceType: 'official_government',
        allowlist: ['www.ferc.gov'],
      },
    ]),
    backfillPlan: {
      tasks: [{
        taskId: 'ferc-engineering',
        seedId: 'seed-ferc',
        evidenceClass: 'engineering_process',
        providerRoute: 'ferc_interconnection_reform',
        status: 'queued',
        sourceQuery: 'FERC interconnection reform cluster study queue processing study deadline network upgrade',
        acceptanceCriteria: {
          requiredTerms: ['interconnection reform', 'network upgrade'],
          bridgeTerms: ['queue processing', 'study deadline'],
        },
      }],
    },
  }, {
    executeLive: true,
    maxTargets: 1,
    generatedAt: '2026-05-23T00:00:00.000Z',
  });

  assert.equal(payload.targetCount, 1);
  assert.equal(payload.targets[0].collectorKind, 'ferc_interconnection_reform_engineering_process');
  assert.equal(payload.providerRuns[0].collectorKind, 'ferc_interconnection_reform_engineering_process');
  assert.equal(payload.rawEvidenceStoredCount, 5);
  assert.equal(payload.acceptedEvidence.some((row) => row.evidenceClass === 'engineering_process'), true);
  assert.equal(payload.acceptedPromotionEvidenceStoredCount, 0);
  assert.deepEqual(payload.coveredEvidenceClasses, []);
  assert.equal(payload.rawEvidence.find((row) => row.fixtureKind === 'ticker_only_rejection_fixture').accepted, false);
  assert.equal(payload.rawEvidence.find((row) => row.fixtureKind === 'raw_metadata_only_rejection_fixture').accepted, false);
  assert.equal(payload.providerRuns[0].collectorStatus.acceptanceSafety.rawEvidenceAutoPromotes, false);
  assert.equal(payload.providerExecutionBoundary.readinessPromotionWrites, 0);
  assert.equal(payload.providerExecutionBoundary.reportCandidateWrites, 0);
});

test('staged FERC interconnection reform provider executes bounded permitting-regulatory fixture parser', async () => {
  const payload = await buildStagedProviderLiveExecutorPayload({
    sourceProviderActivation: activation([
      {
        providerName: 'ferc_interconnection_reform',
        evidenceClass: 'permitting_regulatory',
        sourceType: 'official_government',
        allowlist: ['www.ferc.gov'],
      },
    ]),
    backfillPlan: {
      tasks: [{
        taskId: 'ferc-permitting',
        seedId: 'seed-ferc',
        evidenceClass: 'permitting_regulatory',
        providerRoute: 'ferc_interconnection_reform',
        status: 'queued',
        sourceQuery: 'FERC interconnection reform final rule tariff revisions compliance filing site control',
        acceptanceCriteria: {
          requiredTerms: ['interconnection reform', 'site control'],
          bridgeTerms: ['compliance filing', 'tariff revisions'],
        },
      }],
    },
  }, {
    executeLive: true,
    maxTargets: 1,
    generatedAt: '2026-05-23T00:00:00.000Z',
  });

  assert.equal(payload.targetCount, 1);
  assert.equal(payload.targets[0].collectorKind, 'ferc_interconnection_reform_engineering_process');
  assert.equal(payload.providerRuns[0].collectorKind, 'ferc_interconnection_reform_engineering_process');
  assert.equal(payload.rawEvidenceStoredCount, 5);
  assert.equal(payload.acceptedEvidence.some((row) => row.evidenceClass === 'permitting_regulatory'), true);
  assert.equal(payload.acceptedPromotionEvidenceStoredCount, 0);
  assert.deepEqual(payload.coveredEvidenceClasses, []);
  assert.equal(payload.rawEvidence.find((row) => row.fixtureKind === 'ticker_only_rejection_fixture').accepted, false);
  assert.equal(payload.rawEvidence.find((row) => row.fixtureKind === 'raw_metadata_only_rejection_fixture').accepted, false);
  assert.equal(payload.providerRuns[0].collectorStatus.acceptanceSafety.rawEvidenceAutoPromotes, false);
  assert.equal(payload.providerExecutionBoundary.readinessPromotionWrites, 0);
  assert.equal(payload.providerExecutionBoundary.reportCandidateWrites, 0);
});

test('staged ISO/RTO interconnection queue provider executes bounded engineering-process fixture parser', async () => {
  const payload = await buildStagedProviderLiveExecutorPayload({
    sourceProviderActivation: activation([
      {
        providerName: 'iso_rto_interconnection_queue_report',
        evidenceClass: 'engineering_process',
        sourceType: 'official_grid_operator',
        allowlist: ['www.pjm.com'],
      },
    ]),
    backfillPlan: {
      tasks: [{
        taskId: 'iso-rto-engineering',
        seedId: 'seed-iso-rto',
        evidenceClass: 'engineering_process',
        providerRoute: 'iso_rto_interconnection_queue_report',
        status: 'queued',
        sourceQuery: 'PJM MISO CAISO ERCOT SPP interconnection queue report study timeline processing delay network upgrade delay',
        acceptanceCriteria: {
          requiredTerms: ['interconnection queue', 'network upgrade'],
          bridgeTerms: ['processing delay', 'study timeline'],
        },
      }],
    },
  }, {
    executeLive: true,
    maxTargets: 1,
    generatedAt: '2026-05-23T00:00:00.000Z',
  });

  assert.equal(payload.targetCount, 1);
  assert.equal(payload.targets[0].collectorKind, 'iso_rto_interconnection_queue_report_engineering_process');
  assert.equal(payload.providerRuns[0].collectorKind, 'iso_rto_interconnection_queue_report_engineering_process');
  assert.equal(payload.rawEvidenceStoredCount, 5);
  assert.equal(payload.acceptedEvidence.some((row) => row.evidenceClass === 'engineering_process'), true);
  assert.equal(payload.acceptedPromotionEvidenceStoredCount, 0);
  assert.deepEqual(payload.coveredEvidenceClasses, []);
  assert.equal(payload.rawEvidence.find((row) => row.fixtureKind === 'ticker_only_rejection_fixture').accepted, false);
  assert.equal(payload.rawEvidence.find((row) => row.fixtureKind === 'raw_metadata_only_rejection_fixture').accepted, false);
  assert.equal(payload.providerRuns[0].collectorStatus.acceptanceSafety.rawEvidenceAutoPromotes, false);
  assert.equal(payload.providerExecutionBoundary.readinessPromotionWrites, 0);
  assert.equal(payload.providerExecutionBoundary.reportCandidateWrites, 0);
});

test('staged FERC provider is selected for generic grid interconnection engineering-process tasks', async () => {
  const payload = await buildStagedProviderLiveExecutorPayload({
    sourceProviderActivation: activation([
      {
        providerName: 'ferc_interconnection_reform',
        evidenceClass: 'engineering_process',
        sourceType: 'official_government',
        allowlist: ['www.ferc.gov'],
      },
    ]),
    backfillPlan: {
      tasks: [{
        taskId: 'generic-grid-engineering',
        seedId: 'seed-grid-engineering',
        evidenceClass: 'engineering_process',
        providerRoute: 'technical_or_process_source',
        status: 'queued',
        sourceQuery: 'grid interconnection queue processing capacity network upgrade delay',
        acceptanceCriteria: {
          requiredTerms: ['interconnection queue', 'network upgrade'],
          bridgeTerms: ['processing capacity', 'study delay'],
        },
      }],
    },
  }, {
    executeLive: true,
    maxTargets: 1,
    generatedAt: '2026-05-23T00:00:00.000Z',
  });

  assert.equal(payload.targetCount, 1);
  assert.equal(payload.targets[0].providerName, 'ferc_interconnection_reform');
  assert.equal(payload.targets[0].collectorKind, 'ferc_interconnection_reform_engineering_process');
  assert.equal(payload.acceptedPromotionEvidenceStoredCount, 0);
  assert.equal(payload.providerExecutionBoundary.readinessPromotionWrites, 0);
  assert.equal(payload.providerExecutionBoundary.reportCandidateWrites, 0);
});

test('staged grid issuer bridge provider can produce accepted issuer promotion evidence', async () => {
  const payload = await buildStagedProviderLiveExecutorPayload({
    sourceProviderActivation: activation([
      {
        providerName: 'grid_issuer_bridge_readonly',
        evidenceClass: 'issuer_exposure',
        sourceType: 'official_issuer_grid_source',
      },
    ]),
    backfillPlan: {
      tasks: [{
        taskId: 'grid-issuer',
        seedId: 'seed-grid-b',
        evidenceClass: 'issuer_exposure',
        providerRoute: 'grid_issuer_bridge_readonly',
        status: 'queued',
        acceptanceCriteria: { requiredTerms: ['power delivery', 'backlog'] },
      }],
    },
  }, {
    executeLive: true,
    maxTargets: 2,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });

  assert.equal(payload.targetCount, 1);
  assert.equal(payload.acceptedEvidenceStoredCount >= 1, true);
  assert.equal(payload.acceptedPromotionEvidenceStoredCount >= 1, true);
  assert.equal(payload.coveredEvidenceClasses.includes('issuer_exposure'), true);
  assert.equal(payload.readinessChanged, false);
  assert.equal(payload.providerRuns[0].collectorStatus.issuerCandidates.includes('PWR'), true);
  assert.equal(payload.providerRuns[0].collectorKind, 'grid_issuer_bridge');
  assert.equal(payload.providerExecutionBoundary.reportCandidateWrites, 0);
});

test('staged defense propulsion provider can collect issuer, holdout, and negative-control rows safely', async () => {
  const payload = await buildStagedProviderLiveExecutorPayload({
    sourceProviderActivation: activation([
      { providerName: 'defense_propulsion_readonly', evidenceClass: 'issuer_exposure', sourceType: 'official_defense_and_issuer_source' },
      { providerName: 'defense_propulsion_readonly', evidenceClass: 'holdout_validation', sourceType: 'official_defense_and_issuer_source' },
      { providerName: 'defense_propulsion_readonly', evidenceClass: 'negative_control', sourceType: 'official_defense_and_issuer_source' },
    ]),
    backfillPlan: {
      tasks: [
        {
          taskId: 'defense-issuer',
          seedId: 'seed-defense',
          evidenceClass: 'issuer_exposure',
          providerRoute: 'defense_propulsion_readonly',
          status: 'queued',
          sourceQuery: 'solid rocket motor capacity',
          acceptanceCriteria: { requiredTerms: ['solid rocket motor', 'capacity'] },
        },
        {
          taskId: 'defense-holdout',
          seedId: 'seed-defense',
          evidenceClass: 'holdout_validation',
          providerRoute: 'defense_propulsion_readonly',
          status: 'queued',
          sourceQuery: 'solid rocket motor capacity holdout',
          acceptanceCriteria: { requiredTerms: ['solid rocket motor', 'capacity'] },
        },
        {
          taskId: 'defense-negative',
          seedId: 'seed-defense',
          evidenceClass: 'negative_control',
          providerRoute: 'defense_propulsion_readonly',
          status: 'queued',
          sourceQuery: 'solid rocket motor no capacity constraint',
          acceptanceCriteria: { requiredTerms: ['solid rocket motor'] },
        },
      ],
    },
  }, {
    executeLive: true,
    maxTargets: 3,
    generatedAt: '2025-02-20T00:00:00.000Z',
  });

  assert.equal(payload.targetCount, 3);
  assert.equal(payload.acceptedEvidence.some((row) => row.evidenceClass === 'issuer_exposure'), true);
  assert.equal(payload.acceptedEvidence.some((row) => row.evidenceClass === 'holdout_validation'), true);
  assert.equal(payload.acceptedEvidence.some((row) => row.evidenceClass === 'negative_control'), true);
  assert.equal(payload.acceptedPromotionEvidence.some((row) => row.evidenceClass === 'negative_control'), false);
  assert.equal(payload.coveredEvidenceClasses.includes('issuer_exposure'), true);
  assert.equal(payload.providerExecutionBoundary.providerActivationWrites, 0);
  assert.equal(payload.providerExecutionBoundary.portfolioActionWrites, 0);
});
