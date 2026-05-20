import assert from 'node:assert/strict';
import test from 'node:test';

import {
  approvePendingSourceQueries,
  loadApprovedSourceQueryApprovals,
  previewPendingSourceQueries,
  scoreSourceQueryBundle,
} from '../scripts/_shared/source-query-executor.mjs';
import {
  recordOperatorSeedEvidenceOutcome,
} from '../scripts/_shared/operator-research-seeds.mjs';

class FilterCaptureClient {
  constructor() {
    this.calls = [];
  }

  async query(sql, params = []) {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    this.calls.push({ sql: text, params });
    if (text.startsWith('UPDATE approval_queue')) return { rows: [{ id: 101 }] };
    if (text.startsWith('SELECT id, payload')) {
      return {
        rows: [{
          id: 101,
          status: 'approved',
          payload: {
            query: 'seed evidence query',
            createdBy: 'operator-mechanism-seed',
            collectionKind: 'operator_mechanism_seed',
            operatorSeedId: 'msd-test',
          },
        }],
      };
    }
    if (text.startsWith('SELECT id')) return { rows: [{ id: 101 }] };
    return { rows: [] };
  }
}

class OutcomeClient {
  constructor() {
    this.calls = [];
    this.row = {
      seed_id: 'msd-test',
      status: 'evidence_running',
      evidence_plan: { outcomeCounts: {} },
      review_state: {},
    };
  }

  async query(sql, params = []) {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    this.calls.push({ sql: text, params });
    if (text.startsWith('SELECT status, evidence_plan, review_state')) {
      return { rows: [this.row] };
    }
    if (text.startsWith('UPDATE operator_research_seeds')) {
      const outcome = JSON.parse(params[2]);
      this.row = {
        ...this.row,
        status: params[1],
        evidence_plan: {
          latestOutcome: outcome,
          outcomeCounts: {
            [params[3]]: 1,
          },
          outcomeLedger: [outcome],
        },
        review_state: {
          latestEvidenceOutcome: outcome,
          evidenceOutcomeHistory: [outcome],
        },
      };
      return { rows: [this.row] };
    }
    return { rows: [] };
  }
}

test('operator seed source-query approval filters are scoped and do not rely on report-created filters', async () => {
  const client = new FilterCaptureClient();
  const approved = await approvePendingSourceQueries(client, {
    operatorSeedCreatedOnly: true,
    operatorSeedIds: ['msd-test'],
    limit: 1,
    reviewer: 'test',
  });
  const preview = await previewPendingSourceQueries(client, {
    operatorSeedCreatedOnly: true,
    operatorSeedIds: ['msd-test'],
    limit: 1,
  });
  const loaded = await loadApprovedSourceQueryApprovals(client, {
    operatorSeedCreatedOnly: true,
    operatorSeedIds: ['msd-test'],
    limit: 1,
  });

  assert.equal(approved.approvedCount, 1);
  assert.equal(preview.approvedCount, 1);
  assert.equal(loaded.length, 1);
  for (const call of client.calls) {
    assert.match(call.sql, /payload->>'createdBy' = 'operator-mechanism-seed'/);
    assert.match(call.sql, /payload->>'collectionKind' = 'operator_mechanism_seed'/);
    assert.match(call.sql, /payload->>'operatorSeedId' = ANY/);
    assert.equal(call.params.some((param) => Array.isArray(param) && param.includes('msd-test')), true);
  }
});

test('operator seed evidence outcome ledger moves collected evidence to review-ready without promotion mixing', async () => {
  const client = new OutcomeClient();
  const result = await recordOperatorSeedEvidenceOutcome(client, {
    seedId: 'msd-test',
    approvalId: 101,
    evidenceClass: 'negative_control',
    query: 'substitution and redundancy check',
    status: 'negative-control-collected',
    failureCategory: 'negative-control-collected',
    negativeControlCount: 1,
    persistedBundleCount: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'review_ready');
  assert.equal(result.outcome.outcomeTier, 'negative_control_candidate');
  assert.equal(client.row.evidence_plan.latestOutcome.evidenceClass, 'negative_control');
  assert.equal(client.row.evidence_plan.outcomeCounts.negative_control_candidate, 1);
  assert.equal(client.row.review_state.latestEvidenceOutcome.status, 'negative-control-collected');
});

test('operator seed weak/no-result outcome returns seed to needs_evidence', async () => {
  const client = new OutcomeClient();
  const result = await recordOperatorSeedEvidenceOutcome(client, {
    seedId: 'msd-test',
    approvalId: 102,
    evidenceClass: 'mechanism_validation',
    query: 'mechanism validation',
    status: 'needs-fix',
    failureCategory: 'no-results',
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'needs_evidence');
  assert.equal(result.outcome.outcomeTier, 'needs_fix');
});

test('operator seed provider no-hit does not downgrade existing review-ready status', async () => {
  const client = new OutcomeClient();
  client.row.status = 'review_ready';
  const result = await recordOperatorSeedEvidenceOutcome(client, {
    seedId: 'msd-test',
    approvalId: 103,
    evidenceClass: 'issuer_exposure',
    query: 'official provider backfill',
    status: 'needs-fix',
    failureCategory: 'no class-qualified official provider rows',
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'review_ready');
  assert.equal(result.outcome.outcomeTier, 'needs_fix');
});

test('negative-control invalidator remains non-promotion but closes as negative-control candidate', () => {
  const scored = scoreSourceQueryBundle({
    title: 'Advanced packaging capacity has alternative suppliers and no shortage',
    textExcerpt: 'The source says there is redundant capacity, supplier redundancy, and no capacity constraint for the target process.',
    metadata: { source: 'example' },
  }, {
    id: 1201,
    payload: {
      query: '"advanced packaging and substrate capacity" easy substitutes supplier redundancy no capacity constraint',
      desiredEvidenceClass: 'negative_control',
      collectionKind: 'operator_mechanism_seed',
      operatorSeedId: 'msd-test',
      subject: {
        subjectType: 'operator_mechanism_seed',
        displayName: 'advanced packaging and substrate capacity',
      },
    },
  });

  assert.equal(scored.evidenceUse, 'negative_control_candidate');
  assert.equal(scored.negativeControlFinding, 'invalidator');
  assert.equal(scored.promotionEligible, false);
  assert.equal(scored.accepted, false);
});
