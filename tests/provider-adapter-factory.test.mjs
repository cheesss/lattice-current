import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { normalizeMechanismSeed } from '../scripts/_shared/mechanism-seed-generator.mjs';
import {
  buildProviderAdapterProposalsFromReviewItems,
  persistProviderAdapterProposalReviews,
  summarizeProviderAdapterProposals,
} from '../scripts/_shared/provider-adapter-factory.mjs';
import { runProviderAdapterProposal } from '../scripts/propose-provider-adapter.mjs';

const generatedAt = '2026-05-19T00:00:00.000Z';
const forbiddenWritePattern = /\b(insert\s+into|update|delete\s+from)\s+(approval_queue|report_backfill_tasks|universal_research_subjects|research_evidence_bundles|knowledge_edges|source_registry|canonical_events|canonical_sources)\b/i;

class FakeProposalClient {
  constructor() {
    this.calls = [];
    this.proposals = [];
    this.id = 0;
  }

  async query(sql, values = []) {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    this.calls.push({ sql: text, values });
    const lower = text.toLowerCase();
    if (lower.startsWith('select id, status from codex_proposals')) {
      const found = this.proposals.find((proposal) => proposal.payload.proposalId === values[0]);
      return { rows: found ? [{ id: found.id, status: found.status }] : [] };
    }
    if (lower.startsWith('insert into codex_proposals')) {
      this.id += 1;
      const row = {
        id: this.id,
        proposal_type: 'provider-gap',
        payload: JSON.parse(values[0]),
        status: values[1],
        reasoning: values[2],
        source: values[3],
      };
      this.proposals.push(row);
      return { rows: [{ id: row.id, status: row.status, created_at: generatedAt }] };
    }
    return { rows: [] };
  }
}

function seed(overrides = {}) {
  const item = normalizeMechanismSeed({
    source: 'direct',
    themeKey: overrides.themeKey || 'defense-industrial',
    themeLabel: overrides.themeLabel || 'Defense Industrial Base',
    prompt: overrides.prompt || 'Missile demand increases solid rocket motor qualification, energetic material, and qualified supplier capacity constraints.',
    seedTerms: overrides.seedTerms || ['solid rocket motor supplier capacity'],
    issuerCandidates: overrides.issuerCandidates || ['LHX', 'NOC'],
  }, { generatedAt });
  item.providerGaps = overrides.providerGaps || ['provider_gap_patent_api', 'provider_gap_trade_media'];
  item.biasAudit = {
    ...(item.biasAudit || {}),
    provider_gap_labels: item.providerGaps,
  };
  return item;
}

function row(overrides = {}) {
  const item = seed(overrides);
  return {
    seed_id: item.seedId,
    seed_title: item.seedTitle,
    status: overrides.status || 'review_ready',
    theme_key: item.theme.key,
    theme_label: item.theme.label,
    scores: item.scores,
    provider_gaps: item.providerGaps,
    seed_json: item,
    evidence_plan: {
      routeAware: true,
      providerRoutePlans: [
        {
          evidenceClass: 'supplier_capacity',
          providerRoute: 'supplier_capacity',
          executableCollectors: ['sec', 'fmp', 'source-query'],
          sourceProviders: ['company_ir', 'trade_press'],
          issuerUniverse: ['LHX'],
          candidateIssuerUniverse: ['LHX', 'NOC'],
          queryVariants: ['LHX solid rocket motor supplier capacity'],
        },
        {
          evidenceClass: 'technical_qualification',
          providerRoute: 'technical_qualification',
          executableCollectors: ['source-query'],
          sourceProviders: ['patents', 'papers'],
          issuerUniverse: [],
          candidateIssuerUniverse: ['LHX', 'NOC'],
          queryVariants: ['solid rocket motor qualification patent supplier'],
        },
      ],
      outcomeLedger: [
        {
          evidenceClass: 'supplier_capacity',
          status: 'provider-no-hit',
          failureCategory: 'provider-no-hit',
          outcomeTier: 'weak_noise',
          metadata: {
            source: 'run-mechanism-seed-provider-backfill',
            collectionKind: 'operator_mechanism_seed_provider',
            providerRunStatus: 'provider-no-hit',
          },
          recordedAt: generatedAt,
        },
      ],
      outcomeCounts: { weak_noise: 1 },
    },
  };
}

function assertNoForbiddenWrites(client) {
  assert.deepEqual(client.calls.filter((call) => forbiddenWritePattern.test(call.sql)).map((call) => call.sql), []);
}

test('provider adapter proposals aggregate repeated provider gaps into review-gated adapter scopes', () => {
  const summary = summarizeProviderAdapterProposals([row(), row({
    prompt: 'Defense missile demand increases energetics qualification and supplier lead time.',
  })], { minSeedCount: 1, queryLimit: 5 });

  assert.equal(summary.ok, true);
  assert.equal(summary.proposalCount > 0, true);
  const patent = summary.proposals.find((proposal) => proposal.provider === 'patent_api');
  assert.ok(patent);
  assert.equal(patent.type, 'provider-gap');
  assert.equal(patent.proposalKind, 'provider_adapter_scope');
  assert.equal(patent.activationAllowed, false);
  assert.equal(patent.codeMutationAllowed, false);
  assert.equal(patent.safetyChecklist.branchOnly, true);
  assert.equal(patent.safetyChecklist.fixtureRequired, true);
  assert.equal(patent.safetyChecklist.testRequired, true);
  assert.equal(patent.noProviderActivation, true);
  assert.equal(patent.evidenceClassesBlocked.includes('supplier_capacity'), true);
  assert.match(patent.healthCheckCommand, /collect-free-external-data/);
});

test('provider adapter builder can operate from dashboard review items', () => {
  const proposals = buildProviderAdapterProposalsFromReviewItems([
    {
      seedId: 'seed-a',
      providers: ['grid_interconnection_queue'],
      providerGaps: ['provider_gap_grid_interconnection_queue'],
      evidenceClassesBlocked: ['power_constraint'],
      sampleQueries: ['interconnection queue transformer lead time'],
      theme: { key: 'cloud-infrastructure' },
    },
  ]);

  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].provider, 'grid_interconnection_queue');
  assert.equal(proposals[0].safetyChecklist.providerActivationAllowed, false);
  assert.equal(proposals[0].safetyChecklist.sourceRegistryMutationAllowed, false);
});

test('provider adapter CLI dry-run writes only runtime artifact', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-provider-adapter-'));
  const artifactOut = path.join(tmp, 'adapter-proposals.json');
  try {
    const result = await runProviderAdapterProposal({
      rows: [row()],
      artifactOut,
      queryLimit: 4,
      minSeedCount: 1,
    });
    const artifact = JSON.parse(await readFile(artifactOut, 'utf8'));

    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.boundaries.runtimeArtifactWrites, 1);
    assert.equal(result.boundaries.codexProposalWrites, 0);
    assert.equal(result.boundaries.providerActivationWrites, 0);
    assert.equal(artifact.proposalCount > 0, true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('provider adapter apply writes review-only codex proposals and no executable queues', async () => {
  const client = new FakeProposalClient();
  const proposals = summarizeProviderAdapterProposals([row()], { minSeedCount: 1 }).proposals;
  const result = await persistProviderAdapterProposalReviews(client, proposals, { status: 'human-review' });
  const second = await persistProviderAdapterProposalReviews(client, proposals, { status: 'human-review' });

  assert.equal(result.ok, true);
  assert.equal(result.insertedCount, proposals.length);
  assert.equal(second.dedupedCount, proposals.length);
  assert.equal(client.proposals.every((proposal) => proposal.status === 'human-review'), true);
  assert.equal(client.proposals.every((proposal) => proposal.payload.activationAllowed === false), true);
  assert.equal(client.proposals.every((proposal) => proposal.payload.noProviderActivation === true), true);
  assertNoForbiddenWrites(client);
});
