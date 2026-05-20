import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { normalizeMechanismSeed } from '../scripts/_shared/mechanism-seed-generator.mjs';
import { buildRouteAwareSeedEvidencePlan } from '../scripts/_shared/seed-evidence-plan.mjs';
import {
  auditOperatorSeedPhaseCRow,
  summarizeOperatorSeedPhaseCAudit,
} from '../scripts/_shared/operator-seed-phase-c-audit.mjs';
import { runMechanismSeedPhaseCAudit } from '../scripts/audit-mechanism-seed-phase-c.mjs';

const generatedAt = '2026-05-19T00:00:00.000Z';

function seed(overrides = {}) {
  const item = normalizeMechanismSeed({
    source: 'direct',
    themeKey: overrides.themeKey || 'cloud-infrastructure',
    themeLabel: overrides.themeLabel || 'Cloud Infrastructure',
    prompt: overrides.prompt || 'AI data center rack density creates grid interconnection, transformer, switchgear, and cooling bottlenecks.',
    seedTerms: overrides.seedTerms || ['AI data center power constraint'],
    issuerCandidates: overrides.issuerCandidates || ['PWR', 'ETN'],
    expectedEvidenceClasses: overrides.expectedEvidenceClasses || [],
  }, { generatedAt });
  item.providerGaps = overrides.providerGaps || [
    'provider_gap_dart',
    'provider_gap_trade_media',
    'provider_gap_grid_interconnection_queue',
  ];
  item.biasAudit = {
    ...(item.biasAudit || {}),
    provider_gap_labels: item.providerGaps,
  };
  return item;
}

function completeRow(overrides = {}) {
  const item = seed(overrides);
  const plan = buildRouteAwareSeedEvidencePlan(item, { queryLimitPerClass: 1 });
  return {
    seed_id: item.seedId,
    seed_title: item.seedTitle,
    status: overrides.status || 'review_ready',
    theme_key: item.theme.key,
    theme_label: item.theme.label,
    provider_gaps: item.providerGaps,
    seed_json: item,
    evidence_plan: {
      ...plan,
      outcomeLedger: [
        {
          evidenceClass: 'issuer_exposure',
          status: 'needs-fix',
          failureCategory: 'no class-qualified official provider rows',
          outcomeTier: 'needs_fix',
          metadata: {
            source: 'run-mechanism-seed-provider-backfill',
            collectionKind: 'operator_mechanism_seed_provider',
            providerRunStatus: 'provider-no-hit',
            providerEvidenceReason: 'provider-no-hit no class-qualified official provider rows',
          },
          recordedAt: generatedAt,
        },
      ],
      outcomeCounts: { needs_fix: 1 },
    },
  };
}

test('Phase C audit marks a route-aware seed contract complete even when evidence is exhausted', () => {
  const row = completeRow();
  const audit = auditOperatorSeedPhaseCRow(row, { maxProviderAttempts: 1 });

  assert.equal(audit.complete, true);
  assert.equal(audit.phaseCStatus, 'complete');
  assert.deepEqual(audit.missing, []);
  assert.equal(audit.checks.hasNegativeControlDrafts, true);
  assert.equal(audit.checks.marketValidationPromotionBlocked, true);
  assert.equal(audit.checks.providerGapReviewReady, true);
  assert.equal(audit.mutationPolicy.providerActivationWrites, 0);
});

test('Phase C audit catches missing market validation plan and negative-control separation', () => {
  const row = completeRow();
  row.evidence_plan = {
    ...row.evidence_plan,
    marketValidationPlan: undefined,
    negativeControlDrafts: [],
    sourceQueryDrafts: row.evidence_plan.sourceQueryDrafts.map((draft) => (
      draft.desiredEvidenceClass === 'negative_control'
        ? { ...draft, promotionEligible: true, evidenceUse: 'promotion_candidate' }
        : draft
    )),
  };
  delete row.evidence_plan.marketValidationPlan;
  const audit = auditOperatorSeedPhaseCRow(row, { maxProviderAttempts: 1 });

  assert.equal(audit.complete, false);
  assert.equal(audit.missing.includes('plan_field:marketValidationPlan'), true);
  assert.equal(audit.missing.includes('market_validation_plan'), true);
  assert.equal(audit.missing.includes('negative_control_non_promotion_boundary'), true);
});

test('Phase C summary aggregates incomplete contracts and preserves write boundaries', () => {
  const good = completeRow();
  const bad = completeRow({ prompt: 'Specialty component bottleneck without issuer bridge.' });
  bad.evidence_plan = { routeAware: false, providerRoutePlans: [] };
  const summary = summarizeOperatorSeedPhaseCAudit([good, bad], { maxProviderAttempts: 1 });

  assert.equal(summary.ok, false);
  assert.equal(summary.total, 2);
  assert.equal(summary.completeCount, 1);
  assert.equal(summary.incompleteCount, 1);
  assert.equal(summary.missingCounts.route_aware_evidence_plan, 1);
  assert.equal(summary.boundaries.approvalQueueWrites, 0);
  assert.equal(summary.boundaries.providerActivationWrites, 0);
});

test('Phase C audit CLI writes only runtime artifact', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-phase-c-audit-'));
  const artifactOut = path.join(tmp, 'phase-c-audit.json');
  try {
    const result = await runMechanismSeedPhaseCAudit({
      rows: [completeRow()],
      artifactOut,
      maxProviderAttempts: 1,
    });
    const artifact = JSON.parse(await readFile(artifactOut, 'utf8'));

    assert.equal(result.ok, true);
    assert.equal(result.mode, 'phase-c-audit');
    assert.equal(result.boundaries.runtimeArtifactWrites, 1);
    assert.equal(result.boundaries.approvalQueueWrites, 0);
    assert.equal(result.boundaries.researchEvidenceBundleWrites, 0);
    assert.equal(result.boundaries.providerActivationWrites, 0);
    assert.equal(artifact.completeCount, 1);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
