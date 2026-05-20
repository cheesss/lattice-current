import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { normalizeMechanismSeed } from '../scripts/_shared/mechanism-seed-generator.mjs';
import {
  buildRouteAwareSeedEvidencePlan,
  enqueueSeedEvidenceSourceQueries,
} from '../scripts/_shared/seed-evidence-plan.mjs';
import { runMechanismSeedGeneration } from '../scripts/run-mechanism-seed-generation.mjs';

const generatedAt = '2026-05-19T00:00:00.000Z';
const forbiddenWritePattern = /\b(insert\s+into|update|delete\s+from)\s+(report_backfill_tasks|universal_research_subjects|research_evidence_bundles|knowledge_edges|source_registry)\b/i;

function seedFromPrompt(prompt, overrides = {}) {
  return normalizeMechanismSeed({
    source: 'direct',
    themeKey: overrides.themeKey,
    themeLabel: overrides.themeLabel,
    prompt,
    seedTerms: overrides.seedTerms || [],
    issuerCandidates: overrides.issuerCandidates || [],
    expectedEvidenceClasses: overrides.expectedEvidenceClasses || [],
    bottleneck: overrides.bottleneck,
  }, { generatedAt });
}

class FakePhaseCClient {
  constructor() {
    this.calls = [];
    this.seeds = new Map();
    this.approvals = [];
    this.runId = 0;
    this.approvalId = 0;
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
      const row = {
        seed_id: values[0],
        seed_key: values[1],
        seed_title: values[2],
        status: values[3],
        seed_hash: values[6],
        evidence_plan: JSON.parse(values[11]),
      };
      this.seeds.set(row.seed_id, row);
      return { rows: [{ seed_id: row.seed_id, status: row.status, seed_hash: row.seed_hash }] };
    }

    if (lower.startsWith('insert into operator_research_seed_runs')) {
      this.runId += 1;
      return { rows: [{ id: this.runId }] };
    }

    if (lower.startsWith('select id, status from approval_queue')) {
      const operatorSeedId = values[0];
      const query = String(values[1] || '').toLowerCase();
      const evidenceClass = String(values[2] || '');
      const found = this.approvals.find((approval) => (
        approval.payload.operatorSeedId === operatorSeedId
        && String(approval.payload.query || '').toLowerCase() === query
        && String(approval.payload.desiredEvidenceClass || '') === evidenceClass
      ));
      return { rows: found ? [{ id: found.id, status: found.status }] : [] };
    }

    if (lower.startsWith('insert into approval_queue')) {
      const payload = JSON.parse(values[0]);
      this.approvalId += 1;
      const row = { id: this.approvalId, action_type: 'source-query', status: 'pending', payload };
      this.approvals.push(row);
      return { rows: [{ id: row.id, status: row.status, created_at: new Date().toISOString() }] };
    }

    if (lower.startsWith('update operator_research_seeds')) {
      const row = this.seeds.get(values[0]);
      if (row) {
        row.status = row.status === 'rejected' ? row.status : 'evidence_running';
        row.evidence_plan = JSON.parse(values[1]);
      }
      return { rows: [] };
    }

    return { rows: [] };
  }
}

function assertNoForbiddenWrites(client) {
  const forbidden = client.calls.filter((call) => forbiddenWritePattern.test(call.sql));
  assert.deepEqual(forbidden.map((call) => call.sql), []);
  assert.equal(client.approvals.every((row) => row.action_type === 'source-query'), true);
}

test('SRM seed creates supplier, procurement, negative-control, and blocked market plans', () => {
  const seed = seedFromPrompt('Defense missile replenishment requires solid rocket motor production capacity, energetic binders, qualified suppliers, and test range throughput.', {
    themeKey: 'defense-industrial',
    themeLabel: 'Defense Industrial',
    seedTerms: ['solid rocket motor capacity'],
  });
  const plan = buildRouteAwareSeedEvidencePlan(seed);
  const classes = plan.providerRoutePlans.map((route) => route.evidenceClass);

  assert.equal(classes.includes('supplier_capacity'), true);
  assert.equal(classes.includes('procurement_trigger'), true);
  assert.equal(classes.includes('negative_control'), true);
  assert.equal(plan.negativeControlDrafts.length > 0, true);
  assert.equal(plan.negativeControlDrafts.every((draft) => draft.promotionEligible === false), true);
  assert.equal(plan.marketValidationPlan.promotionFromSourceQueryAllowed, false);
  assert.equal(plan.marketValidationPlan.status, 'blocked_missing_issuer_universe');
});

test('seed evidence drafts prefer class-specific provider queries over generic seed query', () => {
  const seed = seedFromPrompt('Defense missile replenishment requires solid rocket motor production capacity, energetic binders, qualified suppliers, and test range throughput.', {
    themeKey: 'defense-industrial',
    themeLabel: 'Defense Industrial',
    seedTerms: ['solid rocket motor capacity'],
  });
  const plan = buildRouteAwareSeedEvidencePlan(seed, { queryLimitPerClass: 1 });
  const genericQuery = seed.evidenceQueries[0];
  const supplier = plan.sourceQueryDrafts.find((draft) => draft.desiredEvidenceClass === 'supplier_capacity');
  const procurement = plan.sourceQueryDrafts.find((draft) => draft.desiredEvidenceClass === 'procurement_trigger');

  assert.notEqual(supplier.query, genericQuery);
  assert.match(supplier.query, /production capacity|facility|throughput|expansion/i);
  assert.notEqual(procurement.query, genericQuery);
  assert.match(procurement.query, /procurement|contract|award|funding|budget/i);
});

test('AI data center seed routes power and capex without defense procurement route', () => {
  const seed = seedFromPrompt('AI data center rack density is raising power demand. Find grid interconnection, transformer, switchgear, and cooling bottlenecks.', {
    themeKey: 'ai-ml',
    themeLabel: 'AI / Machine Learning',
    seedTerms: ['AI data center power constraint'],
    issuerCandidates: ['MSFT', 'NVDA'],
  });
  const plan = buildRouteAwareSeedEvidencePlan(seed);
  const power = plan.providerRoutePlans.find((route) => route.evidenceClass === 'power_constraint');
  const procurement = plan.providerRoutePlans.find((route) => route.evidenceClass === 'procurement_trigger');

  assert.equal(Boolean(power), true);
  assert.equal(power.executableCollectors.includes('eia'), true);
  assert.equal(power.executableCollectors.includes('public-planning-source'), true);
  assert.equal(Boolean(procurement), false);
  assert.equal(plan.providerRoutePlans.some((route) => route.evidenceClass === 'capex_confirmation'), true);
});

test('issuer-specific classes block when no issuer or candidate universe exists', () => {
  const seed = seedFromPrompt('Specialty component bottleneck with no identified public issuer bridge yet.', {
    themeKey: 'emerging-tech',
    themeLabel: 'Emerging Technology',
    bottleneck: {
      label: 'specialty component qualification bottleneck',
      class: 'technical_qualification',
      mechanism: 'qualified component supply constrains scaling',
    },
    expectedEvidenceClasses: ['issuer_commentary', 'market_validation'],
  });
  seed.supplierCategory.publicIssuerCandidates = [];
  const plan = buildRouteAwareSeedEvidencePlan(seed);
  const issuerCommentary = plan.providerRoutePlans.find((route) => route.evidenceClass === 'issuer_commentary');
  const market = plan.providerRoutePlans.find((route) => route.evidenceClass === 'market_validation');

  assert.equal(issuerCommentary.blocked, true);
  assert.equal(issuerCommentary.blockedReason, 'blocked_missing_issuer_universe');
  assert.equal(market.blocked, true);
  assert.equal(plan.blockedRoutes.some((route) => route.evidenceClass === 'market_validation'), true);
});

test('enqueue writes only seed-scoped source-query approvals and updates seed evidence status', async () => {
  const client = new FakePhaseCClient();
  const seed = seedFromPrompt('Defense missile replenishment requires solid rocket motor production capacity, energetic binders, qualified suppliers, and test range throughput.', {
    themeKey: 'defense-industrial',
    themeLabel: 'Defense Industrial',
    seedTerms: ['solid rocket motor capacity'],
  });
  client.seeds.set(seed.seedId, { seed_id: seed.seedId, status: 'needs_evidence', seed_hash: 'seed', evidence_plan: {} });

  const result = await enqueueSeedEvidenceSourceQueries(client, [seed], { limit: 8, queryLimitPerClass: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.insertedCount > 0, true);
  assert.equal(result.approvalQueueWrites, result.insertedCount);
  assert.equal(client.approvals.every((approval) => approval.payload.collectionKind === 'operator_mechanism_seed'), true);
  assert.equal(client.approvals.every((approval) => approval.payload.createdBy === 'operator-mechanism-seed'), true);
  assert.equal(client.approvals.every((approval) => approval.payload.operatorSeedId === seed.seedId), true);
  assert.equal(client.approvals.every((approval) => !['add-rss', 'backfill-source', 'canonical-cross-theme-proposal'].includes(approval.action_type)), true);
  assert.equal(client.seeds.get(seed.seedId).status, 'evidence_running');
  assertNoForbiddenWrites(client);

  const deduped = await enqueueSeedEvidenceSourceQueries(client, [seed], { limit: 8, queryLimitPerClass: 1 });
  assert.equal(deduped.insertedCount, 0);
  assert.equal(deduped.dedupedCount, result.insertedCount);
  assertNoForbiddenWrites(client);
});

test('CLI enqueue requires apply and apply enqueue remains source-query scoped', async () => {
  await assert.rejects(
    () => runMechanismSeedGeneration({ enqueueEvidence: true, source: 'ontology', limit: 1 }),
    /--enqueue-evidence requires --apply/,
  );

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-seed-phase-c-'));
  const client = new FakePhaseCClient();
  try {
    const artifact = await runMechanismSeedGeneration({
      apply: true,
      enqueueEvidence: true,
      source: 'ontology',
      limit: 2,
      sourceQueryLimit: 5,
      queryLimitPerClass: 1,
      artifactOut: path.join(tmp, 'mechanism-seed-generation.apply.json'),
      client,
    });

    assert.equal(artifact.mode, 'apply');
    assert.equal(artifact.summary.sourceQueryEnqueued > 0, true);
    assert.equal(artifact.boundaries.approvalQueueWrites, artifact.summary.sourceQueryEnqueued);
    assert.equal(artifact.boundaries.reportBackfillWrites, 0);
    assert.equal(artifact.boundaries.canonicalWrites, 0);
    assert.equal(client.approvals.every((approval) => approval.action_type === 'source-query'), true);
    assertNoForbiddenWrites(client);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
