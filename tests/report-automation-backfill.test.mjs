import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReportBackfillApprovalPayload,
  computeReportBackfillRetry,
  drainReportBackfillTasks,
  enqueueReportSourceQueryDrafts,
} from '../scripts/_shared/report-deep-research-pack.mjs';

test('report backfill approval payload is review-gated and report-scoped', () => {
  const payload = buildReportBackfillApprovalPayload({
    id: 42,
    report_id: 'RPT-abc',
    subject_key: 'semiconductor-capex',
    pack_name: 'filingPack',
    query: '  Semiconductor capex 10-K risk factors  ',
    metadata: {
      reason: 'No filing evidence rows are attached.',
      reportType: 'theme_report',
      subject: {
        displayName: 'Semiconductor capex',
        metadata: { theme: 'semiconductors' },
      },
    },
  });

  assert.equal(payload.source, 'report-deep-research-pack');
  assert.equal(payload.actionType, undefined);
  assert.equal(payload.approvalRequired, true);
  assert.equal(payload.reportBackfillTaskId, '42');
  assert.equal(payload.reportId, 'RPT-abc');
  assert.equal(payload.query, 'Semiconductor capex 10-K risk factors');
  assert.equal(payload.themes.includes('semiconductors'), true);
  assert.match(payload.boundary, /review-gated/);
  assert.match(payload.boundary, /does not execute paid providers/);
});

test('cross-theme report backfill approval payload preserves candidate identity for evidence edges', () => {
  const payload = buildReportBackfillApprovalPayload({
    id: 43,
    report_id: 'RPT-cross',
    subject_key: '16776',
    pack_name: 'crossThemeDiscoveryPack',
    query: 'solid rocket motor capacity production capacity supplier evidence',
    metadata: {
      reason: 'Cross-theme bottleneck needs direct supplier evidence.',
      reportType: 'cross_theme_bottleneck_report',
      candidate: { themes: ['defense-industrial', 'space'] },
      subject: {
        subjectType: 'cross_theme_candidate',
        subjectId: '16776',
        displayName: 'solid rocket motor capacity',
      },
    },
  });

  assert.equal(payload.candidateId, '16776');
  assert.equal(payload.connector, 'solid rocket motor capacity');
  assert.equal(payload.target, 'solid rocket motor capacity');
  assert.equal(payload.themes.includes('defense-industrial'), true);
  assert.equal(payload.themes.includes('space'), true);
});

test('report backfill approval preserves adjacent provider route metadata', () => {
  const payload = buildReportBackfillApprovalPayload({
    id: 77,
    report_id: 'RPT-space-test',
    subject_key: 'adjacent-space-launch-fueling',
    pack_name: 'adjacent_theme:launch_fueling_or_cryogenic_infrastructure',
    task_type: 'source_query',
    query: 'space launch fueling cryogenic infrastructure LOX supplier',
    metadata: {
      collectionKind: 'adjacent_theme_candidate',
      adjacentCandidateKey: 'adjacent-space-launch-fueling',
      adjacentLane: 'launch_fueling_or_cryogenic_infrastructure',
      desiredEvidenceClass: 'supplier_capacity',
      evidenceClasses: ['supplier_capacity', 'technical_qualification'],
      providerRoutePlan: {
        evidenceClass: 'supplier_capacity',
        providerRoute: 'adjacent_lane_source_query',
        executableCollectors: ['source-query'],
        sourceProviders: ['official-company', 'official-pdf'],
        queryVariants: [
          'space launch fueling cryogenic infrastructure LOX liquid oxygen supplier',
          'launch pad cryogenic storage hydrogen helium supplier capacity',
        ],
        promotionEligible: false,
      },
    },
  });

  assert.equal(payload.collectionKind, 'adjacent_theme_candidate');
  assert.equal(payload.candidateId, 'adjacent-space-launch-fueling');
  assert.equal(payload.adjacentCandidateKey, 'adjacent-space-launch-fueling');
  assert.equal(payload.adjacentLane, 'launch_fueling_or_cryogenic_infrastructure');
  assert.equal(payload.providerRoutePlan.providerRoute, 'adjacent_lane_source_query');
  assert.equal(payload.providerRoutePlan.queryVariants[0], 'space launch fueling cryogenic infrastructure LOX liquid oxygen supplier');
  assert.ok(payload.providerRoutePlan.queryVariants.some((query) => /launch pad cryogenic/.test(query)));
  assert.doesNotMatch(payload.providerRoutePlan.queryVariants.join(' '), /solid rocket motor/i);
});

test('report backfill retry policy is bounded and exhausts conservatively', () => {
  const first = computeReportBackfillRetry({ attempt_count: 0 }, {
    maxAttempts: 3,
    retryBaseDelayMs: 60_000,
    retryMaxDelayMs: 600_000,
  });
  assert.equal(first.status, 'retry_wait');
  assert.equal(first.attempt, 1);
  assert.equal(first.exhausted, false);
  assert.equal(first.delayMs, 60_000);
  assert.equal(typeof first.nextAttemptAt, 'string');

  const exhausted = computeReportBackfillRetry({ attempt_count: 2 }, {
    maxAttempts: 3,
    retryBaseDelayMs: 60_000,
    retryMaxDelayMs: 600_000,
  });
  assert.equal(exhausted.status, 'failed');
  assert.equal(exhausted.attempt, 3);
  assert.equal(exhausted.exhausted, true);
  assert.equal(exhausted.nextAttemptAt, null);
});

test('report backfill drain queues source-query approvals without canonical writes', async () => {
  const fake = new FakeReportBackfillClient();
  const result = await drainReportBackfillTasks(fake, {
    dryRun: false,
    limit: 5,
    reconcileStale: false,
    maxAttempts: 3,
  });

  assert.equal(result.ok, true);
  assert.equal(result.queuedCount, 1);
  assert.equal(result.results[0].status, 'queued_review');
  assert.equal(fake.approvals.length, 1);
  assert.equal(fake.approvals[0].actionType, 'source-query');
  assert.equal(fake.approvals[0].payload.source, 'report-deep-research-pack');
  assert.equal(fake.taskUpdates.some((update) => update.status === 'queued_review'), true);
  assert.equal(fake.actions.length, 1);
  assert.equal(fake.actions[0].result, 'queued');
  assert.equal(fake.sql.some((statement) => /UPDATE\s+canonical_events/i.test(statement)), false);
  assert.equal(fake.sql.some((statement) => /INSERT\s+INTO\s+articles/i.test(statement)), false);
});

test('report backfill drain can reconcile queued source-query tasks immediately', async () => {
  const fake = new FakeImmediateReconcileClient();
  const result = await drainReportBackfillTasks(fake, {
    dryRun: false,
    ensureSchema: false,
    limit: 5,
    staleHours: 0,
    reconcileStale: true,
    maxAttempts: 3,
  });

  assert.equal(result.ok, true);
  assert.equal(result.reconciledCount, 1);
  assert.equal(result.reconciled[0].status, 'completed');
  assert.equal(fake.reconcileParams[1], 0);
  assert.equal(fake.taskUpdates.some((update) => update.status === 'completed'), true);
});

test('report backfill drain reconciles weak source-query memory as non-blocking collected state', async () => {
  const fake = new FakeImmediateReconcileClient({ approvalStatus: 'weak-noise-collected' });
  const result = await drainReportBackfillTasks(fake, {
    dryRun: false,
    ensureSchema: false,
    limit: 5,
    staleHours: 0,
    reconcileStale: true,
    maxAttempts: 3,
  });

  assert.equal(result.ok, true);
  assert.equal(result.reconciledCount, 1);
  assert.equal(result.reconciled[0].status, 'weak_noise_collected');
  assert.equal(fake.taskUpdates.some((update) => update.status === 'weak_noise_collected'), true);
});

test('report source-query drafts enqueue into DB backfill tasks without canonical writes', async () => {
  const fake = new FakeReportSourceQueryDraftClient();
  const result = await enqueueReportSourceQueryDrafts(fake, {
    reportId: 'RPT-ai',
    reportType: 'theme_report',
    bundleId: 'EB-ai',
    subject: {
      subjectId: 'ai-ml',
      displayName: 'AI / Machine Learning',
      metadata: { theme: 'ai-ml' },
    },
  }, [{
    queryId: 'SQD-1',
    reportId: 'RPT-ai',
    bundleId: 'EB-ai',
    text: 'AI capex evidence cloud revenue accelerator orders',
    reason: 'Missing fundamental confirmation for the report thesis.',
    claimIds: ['CLM-001'],
    metricIds: ['MET-DEEP-DATA-DEPTH'],
    figureIds: ['FIG-DEEP-DATA-DEPTH'],
    caveatIds: ['CAV-DEEP-GAP'],
    approvalRequired: true,
    boundary: 'artifact-only; canonical source queue integration is intentionally deferred',
    metadata: {
      gapKind: 'investment_depth_collection',
      packName: 'fundamentalPack',
      collectionKind: 'filing_transcript_fundamental',
      query: 'AI capex evidence cloud revenue accelerator orders',
      target: 'AI / Machine Learning',
    },
  }], { ensureSchema: false });

  assert.equal(result.ok, true);
  assert.equal(result.insertedCount, 1);
  assert.equal(result.dedupedCount, 0);
  assert.equal(fake.backfillTasks.length, 1);
  assert.equal(fake.backfillTasks[0].subjectKey, 'ai-ml');
  assert.equal(fake.backfillTasks[0].packName, 'fundamentalPack');
  assert.equal(fake.backfillTasks[0].taskType, 'source_query');
  assert.equal(fake.backfillTasks[0].metadata.reviewGate, true);
  assert.equal(fake.backfillTasks[0].metadata.createdBy, 'report-source-query-draft');
  assert.match(fake.backfillTasks[0].metadata.liveQueueBoundary, /review-gated/);
  assert.equal(fake.sql.some((statement) => /INSERT\s+INTO\s+approval_queue/i.test(statement)), false);
  assert.equal(fake.sql.some((statement) => /UPDATE\s+canonical_events/i.test(statement)), false);
  assert.equal(fake.sql.some((statement) => /INSERT\s+INTO\s+articles/i.test(statement)), false);
});

test('deduped report source-query drafts refresh existing task metadata', async () => {
  const fake = new FakeReportSourceQueryDraftClient({ insertRows: [] });
  const result = await enqueueReportSourceQueryDrafts(fake, {
    reportId: 'RPT-cross-new',
    reportType: 'cross_theme_bottleneck_report',
    bundleId: 'EB-cross-new',
    subject: {
      subjectId: '16776',
      displayName: 'solid rocket motor capacity',
      subjectType: 'cross_theme_candidate',
      metadata: {},
    },
  }, [{
    queryId: 'SQD-cross',
    reportId: 'RPT-cross-new',
    bundleId: 'EB-cross-new',
    text: 'Open source query: "solid rocket motor" "production capacity" missile interceptor Aerojet Northrop backlog',
    reason: 'Cross-theme bottleneck needs direct supplier evidence.',
    approvalRequired: true,
    metadata: {
      gapKind: 'cross_theme_discovery',
      packName: 'cross-theme-discovery',
      query: '"solid rocket motor" "production capacity" missile interceptor Aerojet Northrop backlog',
      candidateId: '16776',
      candidateThemes: ['defense-industrial', 'space'],
      connector: 'solid rocket motor capacity',
      target: 'solid rocket motor capacity',
      desiredEvidenceClass: 'technical_qualification',
    },
  }], { ensureSchema: false });

  assert.equal(result.ok, true);
  assert.equal(result.insertedCount, 0);
  assert.equal(result.dedupedCount, 1);
  assert.equal(fake.backfillTasks.length, 0);
  assert.equal(fake.metadataUpdates.length, 1);
  assert.equal(fake.metadataUpdates[0].metadata.latestReportId, 'RPT-cross-new');
  assert.equal(fake.metadataUpdates[0].metadata.candidateId, '16776');
  assert.equal(fake.metadataUpdates[0].metadata.desiredEvidenceClass, 'technical_qualification');
  assert.deepEqual(fake.metadataUpdates[0].metadata.candidateThemes, ['defense-industrial', 'space']);
  assert.equal(fake.metadataUpdates[0].automation.latestDedupedReportId, 'RPT-cross-new');
  assert.equal(fake.sql.some((statement) => /INSERT\s+INTO\s+approval_queue/i.test(statement)), false);
});

class FakeReportBackfillClient {
  constructor() {
    this.sql = [];
    this.approvals = [];
    this.taskUpdates = [];
    this.actions = [];
    this.tasks = [{
      id: 7,
      report_id: 'RPT-gap',
      subject_key: 'critical-minerals',
      pack_name: 'policyPack',
      task_type: 'source_query',
      query: 'critical minerals permitting policy evidence',
      status: 'pending',
      priority: 85,
      metadata: {
        reason: 'No policy evidence rows are attached.',
        reportType: 'theme_report',
        subject: { displayName: 'Critical minerals' },
      },
      attempt_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }];
  }

  async query(sql, params = []) {
    this.sql.push(sql);
    if (/SELECT id, report_id, subject_key, pack_name/i.test(sql) && /task_type = 'source_query'/i.test(sql)) {
      return { rows: this.tasks };
    }
    if (/FROM approval_queue/i.test(sql) && /ORDER BY created_at DESC/i.test(sql)) {
      return { rows: [] };
    }
    if (/INSERT INTO approval_queue/i.test(sql)) {
      const payload = JSON.parse(params[0]);
      this.approvals.push({ actionType: 'source-query', payload, reasoning: params[1] });
      return { rows: [{ id: 101, status: 'pending', created_at: new Date().toISOString() }] };
    }
    if (/UPDATE report_backfill_tasks/i.test(sql) && /status = 'queued_review'/i.test(sql)) {
      this.taskUpdates.push({ status: 'queued_review', params });
      return { rows: [] };
    }
    if (/UPDATE report_backfill_tasks/i.test(sql)) {
      this.taskUpdates.push({ status: params[1], params });
      return { rows: [] };
    }
    if (/INSERT INTO automation_actions/i.test(sql)) {
      this.actions.push({ metadata: JSON.parse(params[0]), result: params[1], reason: params[2] });
      return { rows: [] };
    }
    return { rows: [] };
  }
}

class FakeImmediateReconcileClient {
  constructor({ approvalStatus = 'executed' } = {}) {
    this.sql = [];
    this.reconcileParams = null;
    this.taskUpdates = [];
    this.approvalStatus = approvalStatus;
    this.tasks = [{
      id: 541,
      report_id: 'RPT-cross',
      subject_key: '16776',
      pack_name: 'cross-theme-discovery',
      task_type: 'source_query',
      query: '"solid rocket motor capacity" procurement contract award funding budget program',
      status: 'queued_review',
      priority: 90,
      metadata: { candidateId: '16776', desiredEvidenceClass: 'procurement_trigger' },
      attempt_count: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }];
  }

  async query(sql, params = []) {
    this.sql.push(sql);
    if (/FROM report_backfill_tasks/i.test(sql) && /WHERE status = ANY/i.test(sql)) {
      this.reconcileParams = params;
      return { rows: this.tasks };
    }
    if (/FROM approval_queue/i.test(sql) && /ORDER BY created_at DESC/i.test(sql)) {
      return { rows: [{ id: 606, status: this.approvalStatus, payload: {}, created_at: new Date().toISOString() }] };
    }
    if (/UPDATE report_backfill_tasks/i.test(sql)) {
      this.taskUpdates.push({ status: params[1], params });
      return { rows: [] };
    }
    if (/FROM report_backfill_tasks/i.test(sql) && /task_type = 'source_query'/i.test(sql)) {
      return { rows: [] };
    }
    if (/INSERT INTO automation_actions/i.test(sql)) {
      return { rows: [] };
    }
    return { rows: [] };
  }
}

class FakeReportSourceQueryDraftClient {
  constructor({ insertRows = [{ id: 202 }] } = {}) {
    this.sql = [];
    this.backfillTasks = [];
    this.metadataUpdates = [];
    this.insertRows = insertRows;
  }

  async query(sql, params = []) {
    this.sql.push(sql);
    if (/INSERT INTO report_backfill_tasks/i.test(sql)) {
      if (this.insertRows.length) {
        this.backfillTasks.push({
          reportId: params[0],
          subjectKey: params[1],
          packName: params[2],
          query: params[3],
          priority: params[4],
          metadata: JSON.parse(params[5]),
          taskType: 'source_query',
        });
      }
      return { rows: this.insertRows };
    }
    if (/UPDATE report_backfill_tasks/i.test(sql) && /jsonb_build_object\('automation'/i.test(sql)) {
      this.metadataUpdates.push({
        subjectKey: params[0],
        packName: params[1],
        query: params[2],
        metadata: JSON.parse(params[4]),
        automation: JSON.parse(params[5]),
      });
      return { rows: [] };
    }
    return { rows: [] };
  }
}
