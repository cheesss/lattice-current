import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { normalizeMechanismSeed } from '../scripts/_shared/mechanism-seed-generator.mjs';
import {
  buildProviderGapClosureSummary,
  buildProviderGapProposals,
  buildReviewedSourceQueryDrafts,
  createEmptyGapClosureState,
  filterReviewedSourceQueryDraftsByState,
  recordGapAttempt,
} from '../scripts/_shared/provider-gap-proposals.mjs';
import { runMechanismSeedGapClosure } from '../scripts/run-mechanism-seed-gap-closure.mjs';

const generatedAt = '2026-05-19T00:00:00.000Z';
const forbiddenWritePattern = /\b(insert\s+into|update|delete\s+from)\s+(report_backfill_tasks|universal_research_subjects|research_evidence_bundles|knowledge_edges|source_registry|canonical_events|canonical_sources)\b/i;

class FakeGapClosureClient {
  constructor() {
    this.calls = [];
    this.approvals = [];
    this.approvalId = 0;
  }

  async query(sql, values = []) {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    this.calls.push({ sql: text, values });
    const lower = text.toLowerCase();

    if (lower.startsWith('select id, status from approval_queue')) {
      const [operatorSeedId, query, evidenceClass, providerGap] = values;
      const found = this.approvals.find((approval) => (
        approval.payload.operatorSeedId === operatorSeedId
        && String(approval.payload.query || '').toLowerCase() === String(query || '').toLowerCase()
        && approval.payload.desiredEvidenceClass === evidenceClass
        && approval.payload.providerGap === providerGap
      ));
      return { rows: found ? [{ id: found.id, status: found.status }] : [] };
    }

    if (lower.startsWith('insert into approval_queue')) {
      const payload = JSON.parse(values[0]);
      this.approvalId += 1;
      const row = {
        id: this.approvalId,
        action_type: 'source-query',
        status: 'pending',
        payload,
        reasoning: values[1],
      };
      this.approvals.push(row);
      return { rows: [{ id: row.id, status: row.status, created_at: new Date().toISOString() }] };
    }

    return { rows: [] };
  }
}

function sampleSeed(overrides = {}) {
  const seed = normalizeMechanismSeed({
    source: 'direct',
    themeKey: overrides.themeKey || 'ai-ml',
    themeLabel: overrides.themeLabel || 'AI / Machine Learning',
    prompt: overrides.prompt || 'AI data center rack density increases power demand, grid interconnection, transformer, switchgear, and cooling capacity bottlenecks.',
    seedTerms: overrides.seedTerms || ['AI data center power constraint'],
    issuerCandidates: overrides.issuerCandidates || ['ETN', 'PWR', 'VRT'],
    expectedEvidenceClasses: overrides.expectedEvidenceClasses || [],
  }, { generatedAt });
  seed.providerGaps = overrides.providerGaps || [
    'provider_gap_dart',
    'provider_gap_trade_media',
    'provider_gap_grid_interconnection_queue',
  ];
  seed.biasAudit = {
    ...(seed.biasAudit || {}),
    provider_gap_labels: seed.providerGaps,
  };
  return seed;
}

function sampleRow(overrides = {}) {
  const seed = sampleSeed(overrides);
  return {
    seed_id: seed.seedId,
    seed_title: seed.seedTitle,
    status: overrides.status || seed.status || 'needs_evidence',
    theme_key: seed.theme.key,
    provider_gaps: seed.providerGaps,
    seed_json: seed,
    evidence_plan: overrides.evidencePlan || {},
  };
}

function assertNoForbiddenWrites(client) {
  const forbidden = client.calls.filter((call) => forbiddenWritePattern.test(call.sql));
  assert.deepEqual(forbidden.map((call) => call.sql), []);
}

test('provider gap proposals map source coverage gaps to review-gated providers', () => {
  const row = sampleRow();
  const proposals = buildProviderGapProposals(row, { queryLimitPerProposal: 4 });
  const providers = proposals.map((proposal) => proposal.provider);

  assert.equal(providers.includes('dart'), true);
  assert.equal(providers.includes('trade_media'), true);
  assert.equal(providers.includes('grid_interconnection_queue'), true);
  assert.equal(proposals.every((proposal) => proposal.type === 'provider-gap'), true);
  assert.equal(proposals.every((proposal) => proposal.activationAllowed === false), true);
  assert.equal(proposals.every((proposal) => proposal.noProviderActivation === true), true);
  assert.equal(proposals.every((proposal) => proposal.noCanonicalMutation === true), true);
  assert.equal(proposals.some((proposal) => proposal.evidenceClassesBlocked.includes('power_constraint')), true);
  assert.match(proposals.flatMap((proposal) => proposal.exampleQueries).join(' '), /interconnection queue|trade press|annual report/i);
});

test('reviewed provider-gap source-query drafts stay seed-scoped and preserve negative-control separation', () => {
  const row = sampleRow({ providerGaps: ['provider_gap_trade_media'] });
  const proposals = buildProviderGapProposals(row);
  const drafts = buildReviewedSourceQueryDrafts(row, proposals, { queryLimitPerSeed: 20, queryLimitPerClass: 1 });
  const negative = drafts.find((draft) => draft.desiredEvidenceClass === 'negative_control');

  assert.equal(drafts.length > 0, true);
  assert.equal(drafts.every((draft) => draft.action_type !== 'canonical-cross-theme-proposal'), true);
  assert.equal(drafts.every((draft) => draft.createdBy === 'operator-mechanism-seed'), true);
  assert.equal(drafts.every((draft) => draft.collectionKind === 'operator_mechanism_seed'), true);
  assert.equal(drafts.every((draft) => draft.source === 'operator-provider-gap'), true);
  assert.equal(drafts.every((draft) => draft.gapClosureKind === 'provider_gap_reviewed_source_query'), true);
  assert.equal(drafts.every((draft) => draft.providerGapProposal.activationAllowed === false), true);
  assert.equal(Boolean(negative), true);
  assert.equal(negative.evidenceUse, 'negative_control_candidate');
  assert.equal(negative.promotionEligible, false);
});

test('terminal state suppresses repeated provider-gap source-query attempts', () => {
  const row = sampleRow({ providerGaps: ['provider_gap_grid_interconnection_queue'] });
  const firstDraft = buildReviewedSourceQueryDrafts(row, buildProviderGapProposals(row), {
    queryLimitPerSeed: 1,
    queryLimitPerClass: 1,
  })[0];
  const state = recordGapAttempt(createEmptyGapClosureState(), firstDraft, {
    status: 'queued',
    maxAttempts: 1,
  });
  const filtered = filterReviewedSourceQueryDraftsByState([firstDraft], state, { maxAttempts: 1 });

  assert.equal(filtered.ready.length, 0);
  assert.equal(filtered.skipped.length, 1);
  assert.equal(filtered.skipped[0].reason, 'attempt_exhausted');
});

test('terminal state advances to unattempted provider-gap drafts beyond the per-seed window', () => {
  const row = sampleRow();
  const firstWindow = buildReviewedSourceQueryDrafts(row, buildProviderGapProposals(row), {
    queryLimitPerSeed: 4,
    queryLimitPerClass: 1,
  });
  const exhaustedState = firstWindow.reduce(
    (state, draft) => recordGapAttempt(state, draft, { status: 'queued', maxAttempts: 1 }),
    createEmptyGapClosureState(),
  );
  const summary = buildProviderGapClosureSummary(row, {
    state: exhaustedState,
    queryLimitPerSeed: 4,
    queryLimitPerClass: 1,
    maxAttempts: 1,
  });

  assert.equal(summary.skippedDraftCount >= 4, true);
  assert.equal(summary.readyDraftCount > 0, true);
  assert.equal(summary.drafts.length > firstWindow.length, true);
});

test('gap closure dry-run summarizes next source-query actions without writes', async () => {
  const client = new FakeGapClosureClient();
  const result = await runMechanismSeedGapClosure({
    rows: [sampleRow()],
    dryRun: true,
    queryLimitPerSeed: 5,
    queryLimitPerClass: 1,
    client,
  });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.targetCount, 1);
  assert.equal(result.readyDraftCount > 0, true);
  assert.equal(result.boundaries.approvalQueueWrites, 0);
  assert.equal(result.boundaries.providerActivationWrites, 0);
  assert.equal(client.approvals.length, 0);
  assertNoForbiddenWrites(client);
});

test('gap closure apply queues only reviewed source-query approvals and writes terminal state', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-gap-closure-'));
  const stateFile = path.join(tmp, 'state.json');
  const client = new FakeGapClosureClient();
  try {
    const first = await runMechanismSeedGapClosure({
      rows: [sampleRow()],
      apply: true,
      stateFile,
      queryLimitPerSeed: 4,
      queryLimitPerClass: 1,
      sourceQueryLimit: 4,
      maxAttempts: 1,
      client,
    });
    const state = JSON.parse(await readFile(stateFile, 'utf8'));

    assert.equal(first.ok, true);
    assert.equal(first.dryRun, false);
    assert.equal(first.enqueue.insertedCount, 4);
    assert.equal(first.boundaries.approvalQueueWrites, 4);
    assert.equal(first.boundaries.canonicalWrites, 0);
    assert.equal(first.boundaries.providerActivationWrites, 0);
    assert.equal(Object.keys(state.attempts).length, 4);
    assert.equal(client.approvals.every((approval) => approval.action_type === 'source-query'), true);
    assert.equal(client.approvals.every((approval) => approval.payload.gapClosureKind === 'provider_gap_reviewed_source_query'), true);
    assert.equal(client.approvals.every((approval) => approval.payload.providerGapProposal.activationAllowed === false), true);
    assertNoForbiddenWrites(client);

    const second = await runMechanismSeedGapClosure({
      rows: [sampleRow()],
      apply: true,
      stateFile,
      queryLimitPerSeed: 4,
      queryLimitPerClass: 1,
      sourceQueryLimit: 4,
      maxAttempts: 1,
      client,
    });

    assert.equal(second.enqueue.insertedCount, 4);
    assert.equal(client.approvals.length, 8);
    assert.equal(new Set(client.approvals.map((approval) => approval.payload.query)).size, 8);
    assertNoForbiddenWrites(client);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
