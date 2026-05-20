import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { normalizeMechanismSeed } from '../scripts/_shared/mechanism-seed-generator.mjs';
import {
  summarizeOperatorSeedSelfImprovement,
} from '../scripts/_shared/operator-seed-self-improvement.mjs';
import { runMechanismSeedSelfImprovement } from '../scripts/run-mechanism-seed-self-improvement.mjs';

const generatedAt = '2026-05-19T00:00:00.000Z';

function seed(overrides = {}) {
  const item = normalizeMechanismSeed({
    source: 'direct',
    themeKey: overrides.themeKey || 'cloud-infrastructure',
    themeLabel: overrides.themeLabel || 'Cloud Infrastructure',
    prompt: overrides.prompt || 'AI data center rack density creates grid interconnection, transformer, switchgear, and cooling bottlenecks.',
    seedTerms: overrides.seedTerms || ['AI data center power constraint'],
    issuerCandidates: overrides.issuerCandidates || ['PWR', 'ETN'],
  }, { generatedAt });
  item.providerGaps = overrides.providerGaps || ['provider_gap_grid_interconnection_queue', 'provider_gap_trade_media'];
  item.biasAudit = {
    ...(item.biasAudit || {}),
    source_region_diversity: overrides.sourceRegionDiversity ?? 1,
    source_type_diversity: overrides.sourceTypeDiversity ?? 1,
    missing_sources: overrides.missingSources || ['missing_non_us_source', 'missing_trade_press_source'],
    provider_gap_labels: item.providerGaps,
  };
  return item;
}

function row(overrides = {}) {
  const item = seed(overrides);
  return {
    seed_id: item.seedId,
    seed_title: item.seedTitle,
    status: overrides.status || 'needs_evidence',
    theme_key: item.theme.key,
    theme_label: item.theme.label,
    provider_gaps: item.providerGaps,
    bias_audit: item.biasAudit,
    seed_json: item,
    review_state: overrides.reviewState || {},
    evidence_plan: {
      routeAware: true,
      providerRoutePlans: [
        {
          evidenceClass: 'issuer_exposure',
          providerRoute: 'issuer_exposure',
          issuerUniverse: [],
          candidateIssuerUniverse: [],
          collectionUniverse: [],
          blocked: true,
          blockedReason: 'blocked_missing_issuer_universe',
        },
        {
          evidenceClass: 'market_validation',
          providerRoute: 'market_validation',
          issuerUniverse: [],
          candidateIssuerUniverse: [],
          blocked: true,
          blockedReason: 'no_event_uplift_rows',
        },
        {
          evidenceClass: 'negative_control',
          providerRoute: 'negative_control',
          queryVariants: ['substitute supplier no capacity pressure'],
        },
        {
          evidenceClass: 'power_constraint',
          providerRoute: 'power_constraint',
          queryVariants: ['interconnection queue transformer lead time'],
        },
      ],
      marketValidationPlan: {
        status: 'missing',
        missingReason: 'no_event_uplift_rows',
        promotionFromSourceQueryAllowed: false,
      },
      negativeControlDrafts: [],
      outcomeLedger: [],
    },
  };
}

test('self-improvement detects provider gaps, missing evidence classes, issuer, market, and negative-control patterns', () => {
  const summary = summarizeOperatorSeedSelfImprovement([row(), row({
    prompt: 'AI data center growth creates transformer and switchgear bottlenecks for grid interconnection.',
  })], { minCount: 1 });
  const kinds = summary.proposals.map((proposal) => proposal.kind);

  assert.equal(summary.ok, true);
  assert.equal(kinds.includes('source_coverage_monoculture'), true);
  assert.equal(kinds.includes('repeated_provider_gap'), true);
  assert.equal(kinds.includes('evidence_class_repeatedly_missing'), true);
  assert.equal(kinds.includes('issuer_universe_repeatedly_empty'), true);
  assert.equal(kinds.includes('market_validation_repeatedly_no_rows'), true);
  assert.equal(kinds.includes('negative_control_repeatedly_unchecked'), true);
  assert.equal(summary.proposals.every((proposal) => proposal.codeMutationAllowed === false), true);
  assert.equal(summary.proposals.every((proposal) => proposal.providerActivationAllowed === false), true);
  assert.equal(summary.boundaries.approvalQueueWrites, 0);
  assert.equal(summary.boundaries.providerActivationWrites, 0);
});

test('self-improvement detects generic narrative rejection separately', () => {
  const rejected = row({
    status: 'rejected',
    reviewState: {
      latest: {
        reason: 'generic narrative missing physical process and missing required input',
      },
    },
  });
  const summary = summarizeOperatorSeedSelfImprovement([rejected], { minCount: 1 });

  assert.equal(summary.proposals.some((proposal) => proposal.kind === 'repeated_generic_narrative_rejection'), true);
});

test('self-improvement CLI writes advisory artifact only', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-seed-self-improve-'));
  const artifactOut = path.join(tmp, 'self-improvement.json');
  try {
    const result = await runMechanismSeedSelfImprovement({
      rows: [row()],
      artifactOut,
      minCount: 1,
    });
    const artifact = JSON.parse(await readFile(artifactOut, 'utf8'));

    assert.equal(result.ok, true);
    assert.equal(result.mode, 'mechanism-seed-self-improvement');
    assert.equal(result.boundaries.runtimeArtifactWrites, 1);
    assert.equal(result.boundaries.approvalQueueWrites, 0);
    assert.equal(result.boundaries.providerActivationWrites, 0);
    assert.equal(artifact.proposalCount > 0, true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
