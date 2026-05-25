import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildSeedBiasEvidenceAcquisition,
  executeSeedBiasOfficialRoutes,
  executeSeedBiasSourceQueries,
} from '../scripts/_shared/seed-bias-evidence-acquisition.mjs';
import {
  evaluateSeedEvidenceAcceptance,
} from '../scripts/_shared/seed-evidence-acceptance.mjs';
import {
  runSeedBiasEvidenceAcquisition,
} from '../scripts/run-seed-bias-evidence-acquisition.mjs';

function seed() {
  return {
    seedId: 'acq-seed',
    seedTitle: 'advanced packaging capacity',
    theme: { key: 'semiconductor', label: 'Semiconductor' },
    growthDriver: 'autonomous source-derived packaging demand',
    realActivity: 'advanced packaging ramp',
    physicalProcess: 'substrate and packaging line qualification',
    requiredInputs: ['advanced substrates', 'qualified packaging line'],
    bottleneck: { label: 'advanced packaging capacity', class: 'supplier_capacity', mechanism: 'qualified capacity bottleneck' },
    supplierCategory: { label: 'packaging suppliers', publicIssuerCandidates: ['PWR'] },
    evidenceQueries: ['official advanced packaging capacity exposure'],
    counterEvidenceQueries: ['easy substitute supplier redundancy'],
    expectedEvidenceClasses: ['issuer_exposure', 'negative_control', 'holdout_validation'],
    scores: { knownNarrativeScore: 0.2, seedSimilarityScore: 0.1 },
    lineage: { source: 'research_question', sourceIds: ['acq'] },
  };
}

function rss(items = []) {
  return `<?xml version="1.0" encoding="UTF-8"?><rss><channel>${
    items.map((item) => `<item><title>${item.title}</title><link>${item.link}</link><description>${item.description}</description><pubDate>${item.pubDate || 'Wed, 20 May 2026 00:00:00 GMT'}</pubDate><source>${item.source || 'Example News'}</source></item>`).join('')
  }</channel></rss>`;
}

function task(evidenceClass, overrides = {}) {
  return {
    taskId: `task-${evidenceClass}`,
    seedId: 'acq-seed',
    evidenceClass,
    providerRoute: evidenceClass,
    sourceQuery: `${evidenceClass} source query`,
    acceptanceCriteria: {
      requiredTerms: ['advanced packaging capacity', evidenceClass.replace(/_/g, ' ')],
    },
    status: evidenceClass === 'negative_control' ? 'needs_operator_review' : 'queued',
    reviewRequired: evidenceClass === 'negative_control',
    ...overrides,
  };
}

class FakeClient {
  constructor({ artifactPath }) {
    this.artifactPath = artifactPath;
    this.calls = [];
  }

  async query(sql, params = []) {
    const text = String(sql);
    this.calls.push({ sql: text, params });
    const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.includes('from operator_research_seed_bias_runs')) {
      return {
        rows: [{
          run_id: 'acq-run',
          verdict: 'DATA_LIMITED_BIAS',
          seed_count: 1,
          dominant_class: 'supplier_capacity',
          generated_at: '2026-05-20T00:00:00.000Z',
          payload: {
            seedBatch: { artifactPath: this.artifactPath },
            diagnosis: { verdict: 'DATA_LIMITED_BIAS' },
            gateResults: [{ seedId: 'acq-seed' }],
          },
        }],
      };
    }
    if (normalized.includes('from operator_research_seed_backfill_tasks')) {
      return {
        rows: ['negative_control', 'holdout_validation', 'issuer_exposure'].map((klass) => ({
          task_id: `task-${klass}`,
          run_id: 'acq-run',
          seed_id: 'acq-seed',
          evidence_class: klass,
          provider_route: klass,
          source_query: `${klass} source query`,
          acceptance_criteria: { requiredTerms: ['advanced packaging capacity', klass.replace(/_/g, ' ')] },
          status: klass === 'negative_control' ? 'needs_operator_review' : 'queued',
          review_required: klass === 'negative_control',
          payload: task(klass),
        })),
      };
    }
    if (normalized.includes('from operator_research_seed_evidence_raw')) return { rows: [] };
    if (normalized.includes('from operator_research_seed_evidence_accepted')) return { rows: [] };
    return { rows: [] };
  }
}

test('class-limited acquisition stores negative holdout issuer raw evidence without provider activation', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'seed-bias-acq-'));
  const artifactPath = path.join(tmp, 'seeds.json');
  await writeFile(artifactPath, `${JSON.stringify({ seeds: [seed()] }, null, 2)}\n`, 'utf8');
  const client = new FakeClient({ artifactPath });
  try {
    const result = await runSeedBiasEvidenceAcquisition({
      apply: true,
      client,
      artifactRoot: tmp,
      generatedAt: '2026-05-20T00:00:00.000Z',
    });
    assert.equal(result.ok, true);
    assert.equal(result.seedId, 'acq-seed');
    assert.deepEqual(result.selectedEvidenceClasses, ['negative_control', 'holdout_validation', 'issuer_exposure']);
    assert.equal(result.newRawEvidenceCount > 0, true);
    assert.equal(result.newAcceptedEvidenceCount, 0);
    assert.equal(result.acceptedEvidenceCount, 0);
    assert.equal(result.negativeControlStatus, 'INCONCLUSIVE');
    assert.equal(result.holdoutConfirmed, false);
    assert.equal(result.issuerBridgeStatus, 'missing');
    assert.equal(result.gateResult.gate, 'blocked');
    assert.equal(result.boundaries.providerActivationWrites, 0);
    assert.equal(client.calls.some((call) => /operator_research_seed_evidence_raw/i.test(call.sql)), true);
    assert.equal(client.calls.some((call) => /operator_research_seed_negative_controls/i.test(call.sql)), true);
    assert.equal(client.calls.some((call) => /operator_research_seed_holdout_results/i.test(call.sql)), true);
    assert.equal(client.calls.some((call) => /provider_activation|source_registry|approval_queue|universal_research_subjects/i.test(call.sql)), false);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('local seed-artifact dry-run bypasses DB and does not inject positive-path candidates', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'seed-bias-local-acq-'));
  const artifactPath = path.join(tmp, 'mechanism-seeds.json');
  await writeFile(artifactPath, `${JSON.stringify({ seeds: [seed()] }, null, 2)}\n`, 'utf8');
  try {
    const result = await runSeedBiasEvidenceAcquisition({
      dryRun: true,
      apply: false,
      seedArtifact: artifactPath,
      artifactRoot: tmp,
      decomposeChildBottlenecks: true,
      selectedChildOnly: true,
      executeOfficialRoute: false,
      generatedAt: '2026-05-20T00:00:00.000Z',
    });

    assert.equal(result.ok, true);
    assert.equal(result.seedId, 'acq-seed');
    assert.ok(result.selectedChildSeed?.childSeedId);
    assert.equal(result.positivePathCandidateSeed, null);
    assert.equal(result.boundaries.dbWrites, 0);
    assert.equal(result.boundaries.providerActivationWrites, 0);
    assert.equal(result.boundaries.canonicalWrites, 0);
    assert.equal(result.boundaries.sourceRegistryWrites, 0);
    assert.equal(result.gateResult.gate, 'blocked');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('local seed-artifact dry-run exposes positive-path candidates only when explicitly requested', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'seed-bias-local-positive-acq-'));
  const artifactPath = path.join(tmp, 'mechanism-seeds.json');
  await writeFile(artifactPath, `${JSON.stringify({ seeds: [seed()] }, null, 2)}\n`, 'utf8');
  try {
    const result = await runSeedBiasEvidenceAcquisition({
      dryRun: true,
      apply: false,
      seedArtifact: artifactPath,
      artifactRoot: tmp,
      includePositivePathCandidates: true,
      decomposeChildBottlenecks: true,
      executeOfficialRoute: false,
      generatedAt: '2026-05-20T00:00:00.000Z',
    });

    assert.equal(result.ok, true);
    assert.ok(result.positivePathCandidateSeed);
    assert.equal(result.boundaries.dbWrites, 0);
    assert.equal(result.boundaries.providerActivationWrites, 0);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('source-query execution stores weak results as raw evidence without accepted promotion', async () => {
  const fetchImpl = async () => ({
    ok: true,
    text: async () => rss([{
      title: 'General semiconductor market roundup mentions ASML and TSM',
      link: 'https://example.com/general-semiconductor-roundup',
      description: 'A broad market note mentions tickers but does not connect advanced packaging capacity to revenue backlog guidance capacity or customer exposure.',
      source: 'Example Trade',
    }]),
  });
  const executed = await executeSeedBiasSourceQueries({
    seed: seed(),
    tasks: [task('negative_control'), task('holdout_validation'), task('issuer_exposure')],
    fetchImpl,
    maxItemsPerQuery: 1,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  assert.equal(executed.sourceQueryExecution, true);
  assert.equal(executed.queryCount, 11);
  assert.equal(executed.rawEvidence.length, 11);

  const result = buildSeedBiasEvidenceAcquisition({
    seed: seed(),
    tasks: [task('negative_control'), task('holdout_validation'), task('issuer_exposure')],
    collectedRawEvidence: executed.rawEvidence,
    diagnosis: { verdict: 'DATA_LIMITED_BIAS' },
    targetedBackfillRan: true,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  assert.equal(result.sourceQueryExecution, true);
  assert.equal(result.newRawEvidence.length, 11);
  assert.equal(result.newAcceptedEvidence.length, 0);
  assert.equal(result.acceptedEvidenceCount, 0);
  assert.equal(result.gateResult.gate, 'blocked');
  assert.equal(result.gateResult.blockers.includes('accepted_evidence_missing'), true);
  assert.equal(result.gateResult.blockers.includes('negative_control_not_closed'), true);
  assert.equal(result.gateResult.blockers.includes('holdout_confirmation_missing'), true);
});

test('official route can accept issuer exposure only from official filing bridge', async () => {
  const fetchImpl = async (url) => {
    const text = String(url);
    if (text.includes('company_tickers.json')) {
      return {
        ok: true,
        json: async () => ({ 0: { ticker: 'TSM', cik_str: 1046179, title: 'Taiwan Semiconductor Manufacturing Company Limited' } }),
      };
    }
    if (text.includes('submissions/CIK0001046179.json')) {
      return {
        ok: true,
        json: async () => ({
          filings: {
            recent: {
              form: ['20-F'],
              accessionNumber: ['0001046179-26-000001'],
              primaryDocument: ['tsm-20251231.htm'],
              filingDate: ['2026-04-10'],
            },
          },
        }),
      };
    }
    return {
      ok: true,
      text: async () => '<html><body>Official annual report: advanced packaging capacity and CoWoS substrate capacity are tied to customer demand, revenue opportunity, capex allocation, and lead time management.</body></html>',
    };
  };
  const executed = await executeSeedBiasOfficialRoutes({
    seed: seed(),
    tasks: [task('issuer_exposure'), task('holdout_validation'), task('negative_control')],
    issuerCandidates: ['TSM'],
    fetchImpl,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const result = buildSeedBiasEvidenceAcquisition({
    seed: seed(),
    tasks: [task('issuer_exposure'), task('holdout_validation'), task('negative_control')],
    collectedRawEvidence: executed.rawEvidence,
    diagnosis: { verdict: 'DATA_LIMITED_BIAS' },
    targetedBackfillRan: true,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  assert.equal(executed.officialRouteExecution, true);
  assert.equal(result.acceptedEvidence.some((row) => row.evidenceClass === 'issuer_exposure'), true);
  assert.equal(result.issuerBridgeStatus, 'attached');
  assert.equal(result.holdoutValidation.holdoutConfirmed, false);
  assert.equal(result.gateResult.gate, 'blocked');
  assert.equal(result.gateResult.blockers.includes('negative_control_not_closed'), true);
  assert.equal(result.gateResult.blockers.includes('holdout_confirmation_missing'), true);
  assert.equal(result.gateResult.blockers.includes('independent_source_breadth_missing'), true);
});

test('official route records source unavailable failures without activation writes', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const executed = await executeSeedBiasOfficialRoutes({
    seed: seed(),
    tasks: [task('issuer_exposure'), task('holdout_validation'), task('negative_control')],
    issuerCandidates: ['TSM'],
    fetchImpl,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  const result = buildSeedBiasEvidenceAcquisition({
    seed: seed(),
    tasks: [task('issuer_exposure'), task('holdout_validation'), task('negative_control')],
    collectedRawEvidence: executed.rawEvidence,
    diagnosis: { verdict: 'DATA_LIMITED_BIAS' },
    targetedBackfillRan: true,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  assert.equal(result.acceptedEvidenceCount, 0);
  assert.equal(result.failureClassification.counts.SOURCE_UNAVAILABLE > 0, true);
  assert.equal(result.boundaries.providerActivationWrites, 0);
});

test('issuer exposure ticker-only mention is not accepted', () => {
  const verdict = evaluateSeedEvidenceAcceptance({
    evidenceId: 'ticker-only',
    seedId: 'acq-seed',
    evidenceClass: 'issuer_exposure',
    source: 'trade-media',
    summary: 'PWR was mentioned in a broad market roundup.',
  }, {
    task: task('issuer_exposure'),
    now: new Date('2026-05-20T00:00:00.000Z'),
  });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.blockers.includes('acceptance_criteria_not_met'), true);
});

test('accepted issuer evidence alone does not allow report candidate without negative and holdout closure', () => {
  const result = buildSeedBiasEvidenceAcquisition({
    seed: seed(),
    tasks: [task('negative_control'), task('holdout_validation'), task('issuer_exposure')],
    existingAcceptedEvidence: [{
      evidenceId: 'accepted-issuer',
      seedId: 'acq-seed',
      evidenceClass: 'issuer_exposure',
      evidenceUse: 'promotion_candidate',
      promotionEligible: true,
      source: 'official-company',
      coveredEvidenceClasses: ['issuer_exposure'],
    }, {
      evidenceId: 'accepted-mechanism',
      seedId: 'acq-seed',
      evidenceClass: 'mechanism_validation',
      evidenceUse: 'promotion_candidate',
      promotionEligible: true,
      source: 'government-official',
      coveredEvidenceClasses: ['mechanism_validation'],
    }],
    diagnosis: { verdict: 'DATA_LIMITED_BIAS' },
    targetedBackfillRan: true,
    generatedAt: '2026-05-20T00:00:00.000Z',
  });
  assert.equal(result.acceptedEvidenceCount, 2);
  assert.equal(result.gateResult.gate, 'blocked');
  assert.equal(result.gateResult.blockers.includes('negative_control_not_closed'), true);
  assert.equal(result.gateResult.blockers.includes('holdout_confirmation_missing'), true);
});
