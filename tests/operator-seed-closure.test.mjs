import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeMechanismSeed } from '../scripts/_shared/mechanism-seed-generator.mjs';
import { buildRouteAwareSeedEvidencePlan } from '../scripts/_shared/seed-evidence-plan.mjs';
import {
  buildOperatorSeedProviderBackfillPlan,
  classifyNegativeControlClosure,
  operatorSeedProviderTarget,
  providerBackfillAttemptSummary,
  summarizeOperatorSeedClosure,
} from '../scripts/_shared/operator-seed-closure.mjs';

const generatedAt = '2026-05-19T00:00:00.000Z';

function seedFromPrompt(prompt, overrides = {}) {
  return normalizeMechanismSeed({
    source: 'direct',
    themeKey: overrides.themeKey || 'defense-industrial',
    themeLabel: overrides.themeLabel || 'Defense Industrial',
    prompt,
    seedTerms: overrides.seedTerms || [],
    issuerCandidates: overrides.issuerCandidates || [],
  }, { generatedAt });
}

function rowForSeed(seed, evidencePlanPatch = {}) {
  return {
    seed_id: seed.seedId,
    seed_title: seed.seedTitle,
    status: 'needs_evidence',
    theme_key: seed.theme.key,
    seed_json: seed,
    evidence_plan: {
      ...buildRouteAwareSeedEvidencePlan(seed, { queryLimitPerClass: 1 }),
      ...evidencePlanPatch,
    },
  };
}

test('negative-control closure distinguishes invalidator, supported constraint, and checked-no-direct', () => {
  assert.equal(classifyNegativeControlClosure([{
    evidenceClass: 'negative_control',
    negativeControlClosure: 'invalidator',
  }]).closure, 'invalidator');

  assert.equal(classifyNegativeControlClosure([{
    evidenceClass: 'negative_control',
    negativeControlFindingCounts: { supported_constraint: 2 },
  }]).closure, 'supported_constraint');

  assert.equal(classifyNegativeControlClosure([
    { evidenceClass: 'negative_control', outcomeTier: 'weak_noise' },
    { evidenceClass: 'negative_control', outcomeTier: 'weak_noise' },
  ]).closure, 'checked_no_direct');
});

test('needs-evidence seed builds direct provider backfill plan before more broad source-query', () => {
  const seed = seedFromPrompt('Defense missile replenishment requires solid rocket motor production capacity, energetic binders, qualified suppliers, and test range throughput.', {
    seedTerms: ['solid rocket motor capacity'],
    issuerCandidates: ['LHX', 'NOC'],
  });
  const row = rowForSeed(seed, {
    outcomeLedger: [
      { evidenceClass: 'negative_control', outcomeTier: 'weak_noise' },
      { evidenceClass: 'negative_control', outcomeTier: 'weak_noise' },
    ],
  });
  const plan = buildOperatorSeedProviderBackfillPlan(row);
  const closure = summarizeOperatorSeedClosure(row);
  const target = operatorSeedProviderTarget(row);

  assert.equal(plan.status, 'provider_backfill_required');
  assert.equal(plan.providers.includes('dod-contracts'), true);
  assert.equal(plan.providers.includes('usaspending'), true);
  assert.equal(plan.routes.some((route) => route.evidenceClass === 'supplier_capacity'), true);
  assert.equal(closure.negativeControl.closure, 'checked_no_direct');
  assert.equal(closure.evidenceState, 'targeted provider backfill needed');
  assert.equal(target.operatorSeedId, seed.seedId);
  assert.equal(target.providerRoutePlans.length, plan.routeCount);
});

test('provider backfill plan skips classes that already have strong outcomes', () => {
  const seed = seedFromPrompt('AI data center rack density raises power demand and transformer lead-time constraints.', {
    themeKey: 'cloud-infrastructure',
    themeLabel: 'Data Center Infrastructure',
    seedTerms: ['data center power constraint'],
    issuerCandidates: ['MSFT', 'NVDA'],
  });
  const base = buildRouteAwareSeedEvidencePlan(seed, { queryLimitPerClass: 1 });
  const row = rowForSeed(seed, {
    ...base,
    outcomeLedger: [
      { evidenceClass: 'power_constraint', outcomeTier: 'supporting_context' },
      { evidenceClass: 'capex_confirmation', outcomeTier: 'promotion_candidate' },
    ],
  });
  const plan = buildOperatorSeedProviderBackfillPlan(row);

  assert.equal(plan.routes.some((route) => route.evidenceClass === 'power_constraint'), false);
  assert.equal(plan.routes.some((route) => route.evidenceClass === 'capex_confirmation'), false);
});

test('provider backfill plan marks direct provider routes complete when strong evidence exists', () => {
  const seed = seedFromPrompt('Defense missile solid rocket motor issuer commentary and exposure are tied to funded production ramps.', {
    seedTerms: ['solid rocket motor capacity'],
    issuerCandidates: ['LHX', 'NOC'],
  });
  const base = buildRouteAwareSeedEvidencePlan(seed, { queryLimitPerClass: 1 });
  const row = rowForSeed(seed, {
    ...base,
    providerRoutePlans: base.providerRoutePlans.filter((route) => route.evidenceClass === 'issuer_commentary'),
    outcomeLedger: [
      {
        evidenceClass: 'issuer_commentary',
        outcomeTier: 'promotion_candidate',
        status: 'executed',
        metadata: {
          source: 'run-mechanism-seed-provider-backfill',
          collectionKind: 'operator_mechanism_seed_provider',
        },
      },
    ],
  });
  const plan = buildOperatorSeedProviderBackfillPlan(row);
  const closure = summarizeOperatorSeedClosure(row);

  assert.equal(plan.status, 'provider_backfill_complete');
  assert.equal(plan.routeCount, 0);
  assert.equal(plan.closedCount, 1);
  assert.equal(closure.evidenceState, 'provider backfill complete');
});

test('provider backfill plan closes repeated no-hit official provider attempts as exhausted', () => {
  const seed = seedFromPrompt('Semiconductor advanced packaging substrate capacity requires qualified substrate and interposer supply.', {
    themeKey: 'semiconductors',
    themeLabel: 'Semiconductor',
    seedTerms: ['advanced packaging substrate capacity'],
    issuerCandidates: ['ASML', 'TSM'],
  });
  const base = buildRouteAwareSeedEvidencePlan(seed, { queryLimitPerClass: 1 });
  const row = rowForSeed(seed, {
    ...base,
    providerRoutePlans: base.providerRoutePlans.filter((route) => route.evidenceClass === 'issuer_exposure'),
    outcomeLedger: [
      {
        evidenceClass: 'issuer_exposure',
        outcomeTier: 'needs_fix',
        status: 'needs-fix',
        failureCategory: 'no class-qualified official provider rows',
        metadata: {
          source: 'run-mechanism-seed-provider-backfill',
          collectionKind: 'operator_mechanism_seed_provider',
          providerRunStatus: 'retry_wait',
          providerEvidenceReason: 'no class-qualified official provider rows',
        },
      },
    ],
  });
  const attempt = providerBackfillAttemptSummary(row, 'issuer_exposure', { maxProviderAttempts: 1 });
  const plan = buildOperatorSeedProviderBackfillPlan(row, { maxProviderAttempts: 1 });
  const closure = summarizeOperatorSeedClosure(row, { maxProviderAttempts: 1 });
  const target = operatorSeedProviderTarget(row, { maxProviderAttempts: 1 });

  assert.equal(attempt.exhausted, true);
  assert.equal(plan.status, 'provider_backfill_exhausted');
  assert.equal(plan.routeCount, 0);
  assert.equal(plan.exhaustedCount > 0, true);
  assert.equal(closure.evidenceState, 'provider backfill exhausted');
  assert.equal(target.providerRoutePlans.length, 0);
});

test('provider backfill plan reports retry-window deferral separately from exhaustion', () => {
  const seed = seedFromPrompt('AI data center rack density raises power demand and transformer lead-time constraints.', {
    themeKey: 'cloud-infrastructure',
    themeLabel: 'Data Center Infrastructure',
    seedTerms: ['data center power constraint'],
    issuerCandidates: ['ETN', 'VRT'],
  });
  const base = buildRouteAwareSeedEvidencePlan(seed, { queryLimitPerClass: 1 });
  const row = rowForSeed(seed, {
    ...base,
    providerRoutePlans: base.providerRoutePlans.filter((route) => route.evidenceClass === 'issuer_exposure'),
    outcomeLedger: [
      {
        evidenceClass: 'issuer_exposure',
        outcomeTier: '',
        status: 'retry_wait',
        failureCategory: 'provider_retry_wait',
        metadata: {
          source: 'run-mechanism-seed-provider-backfill',
          collectionKind: 'operator_mechanism_seed_provider',
          providerRunStatus: 'retry_wait',
          providerEvidenceReason: 'provider retry wait',
        },
      },
    ],
  });
  const plan = buildOperatorSeedProviderBackfillPlan(row, { maxProviderAttempts: 1 });

  assert.equal(plan.status, 'provider_backfill_deferred');
  assert.equal(plan.routeCount, 0);
  assert.equal(plan.deferredCount > 0, true);
});
