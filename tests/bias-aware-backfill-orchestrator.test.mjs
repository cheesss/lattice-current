import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runSeedBiasBackfillOrchestrator } from '../scripts/run-seed-bias-backfill-orchestrator.mjs';

class FakeClient {
  constructor() {
    this.calls = [];
  }

  async query(sql, params = []) {
    this.calls.push({ sql: String(sql), params });
    return { rows: [] };
  }
}

test('bias-aware orchestrator dry-run writes local artifacts and no mutation boundaries', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'seed-bias-orch-'));
  try {
    const result = await runSeedBiasBackfillOrchestrator({
      dryRun: true,
      generateSeeds: true,
      source: 'all',
      limit: 8,
      artifactRoot: tmp,
    });
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'dry-run');
    assert.ok(result.diagnosis.verdict);
    assert.equal(result.backfillResults.acceptedEvidenceStoredCount, 0);
    assert.equal(result.backfillResults.readinessChanged, false);
    assert.equal(result.boundaries.approvalQueueWrites, 0);
    assert.equal(result.boundaries.canonicalWrites, 0);
    assert.equal(result.artifactPaths.diagnostics.endsWith('seed-bias-diagnostics.latest.json'), true);
    assert.equal(result.artifactPaths.acceptedEvidence.endsWith('seed-bias-accepted-evidence.latest.json'), true);
    assert.equal(result.backfillPlan.tasks.some((task) => task.evidenceClass === 'negative_control'), true);
    assert.equal(result.backfillPlan.tasks.some((task) => task.evidenceClass === 'holdout_validation'), true);
    assert.equal(result.backfillPlan.tasks.some((task) => task.evidenceClass === 'issuer_exposure'), true);
    assert.equal(result.backfillPlan.tasks.some((task) => task.evidenceClass === 'market_validation'), true);
    assert.equal(result.gateResults.every((item) => item.gate === 'blocked'), true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('controlled apply persists only one top autonomous seed ledger without provider activation', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'seed-bias-apply-'));
  const client = new FakeClient();
  try {
    const result = await runSeedBiasBackfillOrchestrator({
      apply: true,
      generateSeeds: true,
      source: 'all',
      limit: 1,
      topSeedLimit: 1,
      artifactRoot: tmp,
      client,
      runId: 'test-controlled-apply-one-seed',
    });
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'apply');
    assert.equal(result.seedBatch.seedCount, 1);
    assert.equal(result.gateResults.length, 1);
    assert.equal(result.gateResults[0].gate, 'blocked');
    assert.equal(result.backfillResults.rawEvidenceStoredCount > 0, true);
    assert.equal(result.backfillResults.acceptedEvidenceStoredCount, 0);
    assert.equal(result.backfillResults.readinessChanged, false);
    assert.equal(result.boundaries.providerActivationWrites, 0);
    assert.equal(result.boundaries.canonicalWrites, 0);
    assert.equal(client.calls.some((call) => /operator_research_seed_bias_runs/i.test(call.sql)), true);
    assert.equal(client.calls.some((call) => /operator_research_seed_backfill_tasks/i.test(call.sql)), true);
    assert.equal(client.calls.some((call) => /operator_research_seed_evidence_raw/i.test(call.sql)), true);
    assert.equal(client.calls.some((call) => /operator_research_seed_evidence_accepted/i.test(call.sql)), true);
    assert.equal(client.calls.some((call) => /operator_research_seed_holdout_results/i.test(call.sql)), true);
    assert.equal(client.calls.some((call) => /operator_research_seed_negative_controls/i.test(call.sql)), true);
    assert.equal(client.calls.some((call) => /provider_activation|source_registry|approval_queue|universal_research_subjects/i.test(call.sql)), false);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
