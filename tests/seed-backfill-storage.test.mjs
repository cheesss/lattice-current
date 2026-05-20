import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ensureOperatorSeedBiasSchema,
  persistOperatorSeedBiasArtifacts,
} from '../scripts/_shared/operator-seed-bias-storage.mjs';
import {
  buildBiasBackfillPlan,
  diagnoseSeedBias,
} from '../scripts/_shared/seed-bias-diagnostics.mjs';

class FakeClient {
  constructor() {
    this.calls = [];
  }

  async query(sql, params = []) {
    this.calls.push({ sql: String(sql), params });
    return { rows: [] };
  }
}

function seed(id = 'storage-seed') {
  return {
    seedId: id,
    seedTitle: 'storage test seed',
    theme: { key: 'grid', label: 'Grid' },
    growthDriver: 'autonomous source signal',
    realActivity: 'substation buildout',
    physicalProcess: 'interconnection study and switchgear installation',
    requiredInputs: ['switchgear'],
    bottleneck: { label: 'switchgear qualification', class: 'supplier_capacity', mechanism: 'capacity shortage' },
    supplierCategory: { label: 'qualified suppliers', publicIssuerCandidates: ['PWR'] },
    evidenceQueries: ['official switchgear evidence'],
    counterEvidenceQueries: ['supplier redundancy no timing pressure'],
    expectedEvidenceClasses: ['mechanism_validation', 'issuer_exposure', 'negative_control'],
    scores: { knownNarrativeScore: 0.2 },
    lineage: { source: 'research_question', sourceIds: [id] },
  };
}

test('operator seed bias schema is idempotent and creates only seed-bias tables', async () => {
  const client = new FakeClient();
  const result = await ensureOperatorSeedBiasSchema(client);
  assert.equal(result.ok, true);
  assert.equal(client.calls.some((call) => call.sql.includes('operator_research_seed_bias_runs')), true);
  assert.equal(client.calls.some((call) => call.sql.includes('operator_research_seed_backfill_tasks')), true);
  assert.equal(client.calls.some((call) => call.sql.includes('approval_queue')), false);
  assert.equal(client.calls.some((call) => call.sql.includes('canonical')), false);
  assert.equal(client.calls.some((call) => call.sql.includes('source_registry')), false);
});

test('DATA_LIMITED_BIAS persists targeted task ledger without canonical/provider activation writes', async () => {
  const seeds = Array.from({ length: 6 }, (_, index) => seed(`storage-${index}`));
  const diagnosis = diagnoseSeedBias({
    seeds,
    sourceCoverage: { skew: 0.9 },
    marketValidation: { holdoutConfirmationRate: 0 },
  });
  const backfillPlan = buildBiasBackfillPlan({ seeds, diagnosis, evidencePlans: [] });
  const client = new FakeClient();

  const persisted = await persistOperatorSeedBiasArtifacts(client, {
    runId: 'storage-run',
    diagnosis,
    seedBatch: { seedCount: seeds.length },
    backfillPlan,
    backfillResults: { rawEvidence: [], acceptedEvidence: [] },
    holdoutValidation: { items: [] },
    negativeControlSurvival: { items: [] },
    payload: { ok: true },
  });

  assert.equal(persisted.ok, true);
  assert.equal(backfillPlan.tasks.some((task) => task.status === 'queued_local_market_validation'), true);
  assert.equal(backfillPlan.tasks.some((task) => task.status === 'provider_gap_proposal_required'), true);
  assert.equal(backfillPlan.tasks.some((task) => task.status === 'needs_operator_review' || task.status === 'queued'), true);
  assert.equal(backfillPlan.tasks.some((task) => task.evidenceClass === 'holdout_validation'), true);
  assert.equal(client.calls.some((call) => /approval_queue|universal_research_subjects|source_registry|provider_activation/i.test(call.sql)), false);
});
