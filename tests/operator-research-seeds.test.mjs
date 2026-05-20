import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ensureOperatorResearchSeedSchema,
  hashOperatorResearchSeed,
  reviewOperatorResearchSeed,
  upsertOperatorResearchSeeds,
} from '../scripts/_shared/operator-research-seeds.mjs';
import { normalizeMechanismSeed } from '../scripts/_shared/mechanism-seed-generator.mjs';
import { runMechanismSeedGeneration } from '../scripts/run-mechanism-seed-generation.mjs';
import { runMechanismSeedReview } from '../scripts/review-mechanism-seed.mjs';

const generatedAt = '2026-05-19T00:00:00.000Z';
const forbiddenWritePattern = /\b(insert\s+into|update|delete\s+from)\s+(approval_queue|report_backfill_tasks|universal_research_subjects|research_evidence_bundles|knowledge_edges|source_registry)\b/i;

class FakeSeedClient {
  constructor() {
    this.calls = [];
    this.seeds = new Map();
    this.runId = 0;
  }

  async query(sql, values = []) {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    this.calls.push({ sql: text, values });
    const lower = text.toLowerCase();

    if (lower.startsWith('select seed_id, seed_hash')) {
      const row = this.seeds.get(values[0]);
      return { rows: row ? [{ seed_id: row.seed_id, seed_hash: row.seed_hash, status: row.status }] : [] };
    }

    if (lower.startsWith('insert into operator_research_seeds')) {
      const existing = this.seeds.get(values[0]);
      const protectedStatuses = values[13] || [];
      const row = {
        seed_id: values[0],
        seed_key: values[1],
        seed_title: values[2],
        status: existing && protectedStatuses.includes(existing.status) ? existing.status : values[3],
        theme_key: values[4],
        theme_label: values[5],
        seed_hash: values[6],
        seed_json: JSON.parse(values[7]),
        scores: JSON.parse(values[8]),
        bias_audit: JSON.parse(values[9]),
        provider_gaps: values[10],
        evidence_plan: {
          ...JSON.parse(values[11]),
          ...(existing?.evidence_plan?.latestOutcome ? { latestOutcome: existing.evidence_plan.latestOutcome } : {}),
          ...(existing?.evidence_plan?.outcomeCounts ? { outcomeCounts: existing.evidence_plan.outcomeCounts } : {}),
          ...(existing?.evidence_plan?.outcomeLedger ? { outcomeLedger: existing.evidence_plan.outcomeLedger } : {}),
        },
        lineage: JSON.parse(values[12]),
        review_state: existing?.review_state || {},
        updated_at: new Date().toISOString(),
      };
      this.seeds.set(values[0], row);
      return { rows: [{ seed_id: row.seed_id, status: row.status, seed_hash: row.seed_hash }] };
    }

    if (lower.startsWith('insert into operator_research_seed_runs')) {
      this.runId += 1;
      return { rows: [{ id: this.runId }] };
    }

    if (lower.startsWith('update operator_research_seeds')) {
      const row = this.seeds.get(values[0]);
      if (!row) return { rows: [] };
      const event = JSON.parse(values[2]);
      row.status = values[1];
      row.review_state = {
        latest: event,
        history: [...(row.review_state?.history || []), event],
      };
      row.updated_at = new Date().toISOString();
      this.seeds.set(values[0], row);
      return { rows: [{ seed_id: row.seed_id, status: row.status, review_state: row.review_state, updated_at: row.updated_at }] };
    }

    if (lower.startsWith('select seed_id, seed_key')) {
      return { rows: [...this.seeds.values()].slice(0, values.at(-1) || 50) };
    }

    return { rows: [] };
  }
}

function sampleSeed(overrides = {}) {
  return normalizeMechanismSeed({
    source: 'direct',
    themeKey: overrides.themeKey || 'defense-industrial',
    themeLabel: overrides.themeLabel || 'Defense Industrial',
    prompt: overrides.prompt || 'Defense missile solid rocket motor capacity energetic binder qualified supplier bottleneck',
    seedTerms: overrides.seedTerms || ['solid rocket motor capacity'],
    sourceRefs: overrides.sourceRefs || [],
  }, { generatedAt });
}

function assertNoForbiddenWrites(client) {
  const forbidden = client.calls.filter((call) => forbiddenWritePattern.test(call.sql));
  assert.deepEqual(forbidden.map((call) => call.sql), []);
}

test('operator research seed schema is idempotent and scoped to operator seed tables', async () => {
  const client = new FakeSeedClient();
  const result = await ensureOperatorResearchSeedSchema(client);

  assert.equal(result.ok, true);
  assert.equal(client.calls.some((call) => /create table if not exists operator_research_seeds/i.test(call.sql)), true);
  assert.equal(client.calls.some((call) => /create table if not exists operator_research_seed_runs/i.test(call.sql)), true);
  assertNoForbiddenWrites(client);
});

test('seed upsert preserves evidence outcome ledger while refreshing route plan', async () => {
  const client = new FakeSeedClient();
  const seed = sampleSeed();
  client.seeds.set(seed.seedId, {
    seed_id: seed.seedId,
    seed_hash: 'old-hash',
    status: 'needs_evidence',
    evidence_plan: {
      version: 'old',
      latestOutcome: { status: 'weak-noise-collected', evidenceClass: 'negative_control' },
      outcomeCounts: { weak_noise: 2 },
      outcomeLedger: [{ status: 'weak-noise-collected' }],
    },
  });

  const result = await upsertOperatorResearchSeeds(client, [seed], { source: 'unit-test' });
  const persisted = client.seeds.get(seed.seedId);

  assert.equal(result.updated, 1);
  assert.equal(persisted.evidence_plan.routeAware, true);
  assert.equal(persisted.evidence_plan.latestOutcome.status, 'weak-noise-collected');
  assert.equal(persisted.evidence_plan.outcomeCounts.weak_noise, 2);
  assert.equal(persisted.evidence_plan.outcomeLedger.length, 1);
  assertNoForbiddenWrites(client);
});

test('seed upsert dedupes by seedId and preserves Phase B write boundaries', async () => {
  const client = new FakeSeedClient();
  const seed = sampleSeed();

  const first = await upsertOperatorResearchSeeds(client, [seed], { source: 'unit-test' });
  const second = await upsertOperatorResearchSeeds(client, [seed], { source: 'unit-test' });

  assert.equal(first.inserted, 1);
  assert.equal(first.updated, 0);
  assert.equal(first.unchanged, 0);
  assert.equal(first.dbWrites, 2);
  assert.equal(second.inserted, 0);
  assert.equal(second.updated, 0);
  assert.equal(second.unchanged, 1);
  assert.equal(second.dbWrites, 1);
  assert.equal(client.seeds.size, 1);
  assert.equal(client.seeds.get(seed.seedId).evidence_plan.enqueueDefault, false);
  assert.equal(client.seeds.get(seed.seedId).evidence_plan.routeAware, true);
  assert.equal(client.seeds.get(seed.seedId).evidence_plan.sourceQueryDrafts.length > 0, true);
  assert.equal(first.approvalQueueWrites, 0);
  assert.equal(first.canonicalWrites, 0);
  assertNoForbiddenWrites(client);
});

test('operator seed hash ignores volatile generation timestamp for repeat apply idempotency', () => {
  const first = normalizeMechanismSeed({
    source: 'direct',
    themeKey: 'space',
    themeLabel: 'Space',
    prompt: 'Space launch LOX liquid hydrogen helium cryogenic ground support equipment',
    seedTerms: ['launch cryogenic support'],
  }, { generatedAt: '2026-05-19T00:00:00.000Z' });
  const second = normalizeMechanismSeed({
    source: 'direct',
    themeKey: 'space',
    themeLabel: 'Space',
    prompt: 'Space launch LOX liquid hydrogen helium cryogenic ground support equipment',
    seedTerms: ['launch cryogenic support'],
  }, { generatedAt: '2026-05-19T06:00:00.000Z' });

  assert.equal(first.seedId, second.seedId);
  assert.equal(hashOperatorResearchSeed(first), hashOperatorResearchSeed(second));
});

test('review lifecycle updates only seed status and review metadata', async () => {
  const client = new FakeSeedClient();
  const seed = sampleSeed();
  await upsertOperatorResearchSeeds(client, [seed], { source: 'unit-test' });

  const reviewed = await reviewOperatorResearchSeed(client, {
    seedId: seed.seedId,
    status: 'review_ready',
    reason: 'direct evidence checked',
    reviewer: 'test',
  });

  assert.equal(reviewed.ok, true);
  assert.equal(reviewed.row.status, 'review_ready');
  assert.equal(reviewed.row.review_state.latest.reason, 'direct evidence checked');
  assert.equal(reviewed.row.review_state.latest.reviewer, 'test');
  assert.equal(reviewed.row.review_state.history.length, 1);
  assertNoForbiddenWrites(client);
});

test('apply mode persists only operator seed rows and run ledger', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-seed-apply-'));
  const artifactOut = path.join(tmp, 'mechanism-seed-generation.apply.json');
  const client = new FakeSeedClient();
  try {
    const artifact = await runMechanismSeedGeneration({
      apply: true,
      source: 'ontology',
      limit: 6,
      artifactOut,
      client,
    });
    const persisted = JSON.parse(await readFile(artifactOut, 'utf8'));

    assert.equal(artifact.mode, 'apply');
    assert.equal(artifact.persistence.inserted > 0, true);
    assert.equal(artifact.boundaries.approvalQueueWrites, 0);
    assert.equal(artifact.boundaries.reportBackfillWrites, 0);
    assert.equal(artifact.boundaries.canonicalWrites, 0);
    assert.equal(persisted.persistence.runId, 1);
    assertNoForbiddenWrites(client);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('review CLI lists, summarizes, and reviews without queue writes', async () => {
  const client = new FakeSeedClient();
  const seed = sampleSeed();
  await upsertOperatorResearchSeeds(client, [seed], { source: 'unit-test' });

  const list = await runMechanismSeedReview({ list: true, statuses: ['needs_evidence'], client });
  const summary = await runMechanismSeedReview({ summary: true, client });
  const reviewed = await runMechanismSeedReview({
    seedId: seed.seedId,
    status: 'rejected',
    reason: 'too generic after review',
    reviewer: 'test',
    client,
  });

  assert.equal(list.mode, 'list');
  assert.equal(list.count, 1);
  assert.equal(summary.mode, 'summary');
  assert.equal(summary.total, 1);
  assert.equal(reviewed.mode, 'review');
  assert.equal(reviewed.boundaries.approvalQueueWrites, 0);
  assert.equal(client.seeds.get(seed.seedId).status, 'rejected');
  assertNoForbiddenWrites(client);
});
