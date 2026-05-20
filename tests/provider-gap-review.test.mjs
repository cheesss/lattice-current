import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { normalizeMechanismSeed } from '../scripts/_shared/mechanism-seed-generator.mjs';
import {
  buildProviderGapReviewItem,
  summarizeProviderGapReview,
} from '../scripts/_shared/provider-gap-proposals.mjs';
import { runProviderGapReview } from '../scripts/review-provider-gap-proposals.mjs';

const generatedAt = '2026-05-19T00:00:00.000Z';

function sampleSeed(overrides = {}) {
  const seed = normalizeMechanismSeed({
    source: 'direct',
    themeKey: overrides.themeKey || 'defense-industrial',
    themeLabel: overrides.themeLabel || 'Defense Industrial Base',
    prompt: overrides.prompt || 'Missile demand increases solid rocket motor qualification, energetic material, and qualified supplier capacity constraints.',
    seedTerms: overrides.seedTerms || ['solid rocket motor supplier capacity'],
    issuerCandidates: overrides.issuerCandidates || ['LHX', 'NOC'],
  }, { generatedAt });
  seed.providerGaps = overrides.providerGaps || [
    'provider_gap_dart',
    'provider_gap_trade_media',
    'provider_gap_patent_api',
  ];
  seed.biasAudit = {
    ...(seed.biasAudit || {}),
    provider_gap_labels: seed.providerGaps,
  };
  return seed;
}

function seedRow(overrides = {}) {
  const seed = sampleSeed(overrides);
  const outcomeTier = overrides.outcomeTier || 'weak_noise';
  const status = overrides.providerStatus || 'provider-no-hit';
  return {
    seed_id: seed.seedId,
    seed_title: seed.seedTitle,
    status: overrides.status || 'review_ready',
    theme_key: seed.theme.key,
    theme_label: seed.theme.label,
    scores: seed.scores,
    provider_gaps: seed.providerGaps,
    seed_json: seed,
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
      ],
      outcomeLedger: [
        {
          evidenceClass: 'supplier_capacity',
          status,
          failureCategory: status,
          outcomeTier,
          metadata: {
            source: 'run-mechanism-seed-provider-backfill',
            collectionKind: 'operator_mechanism_seed_provider',
            providerRunStatus: status,
            providerEvidenceReason: status === 'provider-no-hit'
              ? 'provider-no-hit no class-qualified official provider rows'
              : 'accepted provider evidence',
          },
          recordedAt: generatedAt,
        },
      ],
      outcomeCounts: {
        [outcomeTier]: 1,
      },
    },
  };
}

test('provider gap review item converts exhausted direct-provider seed into review-gated adapter/source item', () => {
  const item = buildProviderGapReviewItem(seedRow(), {
    maxProviderAttempts: 1,
    queryLimitPerProposal: 3,
  });

  assert.equal(item.reviewState, 'adapter_or_source_coverage_review');
  assert.equal(item.primaryBlocker, 'direct_provider_exhausted');
  assert.equal(item.providerBackfill.status, 'provider_backfill_exhausted');
  assert.equal(item.proposalCount > 0, true);
  assert.equal(item.providers.includes('dart'), true);
  assert.equal(item.providers.includes('trade_media'), true);
  assert.equal(item.evidenceClassesBlocked.includes('supplier_capacity'), true);
  assert.equal(item.proposals.every((proposal) => proposal.activationAllowed === false), true);
  assert.equal(item.proposals.every((proposal) => proposal.noProviderActivation === true), true);
  assert.equal(item.proposals.every((proposal) => !Object.hasOwn(proposal, 'queryMap')), true);
  assert.equal(item.mutationPolicy.approvalQueueWrites, 0);
  assert.equal(item.mutationPolicy.providerActivationWrites, 0);
});

test('provider gap review summary focuses on exhausted seeds and keeps completed seeds out by default', () => {
  const exhausted = seedRow();
  const complete = seedRow({
    prompt: 'AI data center power demand creates switchgear and transformer supplier bottlenecks.',
    themeKey: 'cloud-infrastructure',
    themeLabel: 'Cloud Infrastructure',
    outcomeTier: 'promotion_candidate',
    providerStatus: 'executed',
  });
  const summary = summarizeProviderGapReview([exhausted, complete], {
    maxProviderAttempts: 1,
    limit: 10,
  });

  assert.equal(summary.ok, true);
  assert.equal(summary.totalRows, 2);
  assert.equal(summary.exhaustedSeedCount, 1);
  assert.equal(summary.reviewItemCount, 1);
  assert.equal(summary.items[0].seedId, exhausted.seed_id);
  assert.equal(summary.providerCounts.dart >= 1, true);
  assert.equal(summary.evidenceClassCounts.supplier_capacity >= 1, true);
  assert.equal(summary.boundaries.approvalQueueWrites, 0);
  assert.equal(summary.boundaries.canonicalWrites, 0);
  assert.equal(summary.boundaries.providerActivationWrites, 0);
});

test('provider gap review CLI writes only runtime artifact and no queue/canonical/provider state', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-provider-gap-review-'));
  const artifactOut = path.join(tmp, 'review.json');
  try {
    const result = await runProviderGapReview({
      rows: [seedRow()],
      artifactOut,
      maxProviderAttempts: 1,
      limit: 10,
    });
    const artifact = JSON.parse(await readFile(artifactOut, 'utf8'));

    assert.equal(result.ok, true);
    assert.equal(result.mode, 'provider-gap-review');
    assert.equal(result.boundaries.runtimeArtifactWrites, 1);
    assert.equal(result.boundaries.approvalQueueWrites, 0);
    assert.equal(result.boundaries.reportBackfillWrites, 0);
    assert.equal(result.boundaries.researchEvidenceBundleWrites, 0);
    assert.equal(result.boundaries.providerActivationWrites, 0);
    assert.equal(artifact.reviewItemCount, 1);
    assert.equal(artifact.items[0].reviewState, 'adapter_or_source_coverage_review');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('provider gap review can filter by provider without exposing activation path', () => {
  const summary = summarizeProviderGapReview([seedRow()], {
    provider: 'patent_api',
    maxProviderAttempts: 1,
  });

  assert.equal(summary.reviewItemCount, 1);
  assert.equal(summary.items[0].providers.includes('patent_api'), true);
  assert.equal(summary.items[0].mutationPolicy.providerActivationAllowed, false);
  assert.equal(summary.items[0].nextAction.includes('review provider gap proposals'), true);
});
