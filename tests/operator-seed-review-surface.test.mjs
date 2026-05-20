import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOperatorSeedReviewDetail,
  buildOperatorSeedReviewItem,
  buildOperatorSeedReviewPayload,
  buildSeedEvidenceActionPayload,
} from '../scripts/_shared/operator-seed-review-surface.mjs';
import { buildRouteAwareSeedEvidencePlan } from '../scripts/_shared/seed-evidence-plan.mjs';

function sampleSeed(overrides = {}) {
  const seed = {
    seedId: 'msd-phase-d-srm',
    seedTitle: 'Defense -> SRM capacity -> qualified supplier bottleneck',
    status: 'review_ready',
    theme: { key: 'defense-industrial', label: 'Defense Industrial' },
    growthDriver: 'missile replenishment demand',
    realActivity: 'munitions production ramp',
    physicalProcess: 'solid rocket motor casting and qualification',
    requiredInputs: ['energetic materials', 'qualified test stands'],
    bottleneck: {
      label: 'solid rocket motor qualified supplier capacity',
      class: 'supplier_capacity',
      mechanism: 'qualified capacity cannot expand instantly',
    },
    supplierCategory: {
      label: 'solid rocket motor supplier',
      publicIssuerCandidates: ['LHX', 'NOC'],
    },
    evidenceQueries: ['solid rocket motor capacity expansion official release'],
    counterEvidenceQueries: ['solid rocket motor shortage no capacity pressure substitute supplier'],
    expectedEvidenceClasses: [
      'mechanism_validation',
      'issuer_exposure',
      'market_validation',
      'negative_control',
      'supplier_capacity',
    ],
    scores: { composite_seed_score: 0.82 },
    biasAudit: {
      missing_sources: ['missing_non_us_source'],
      provider_gap_labels: ['provider_gap_patent_api'],
      bias_flags: ['source_coverage_monoculture'],
    },
    providerGaps: ['provider_gap_patent_api'],
    ...overrides,
  };
  return seed;
}

function rowForSeed(seed = sampleSeed(), overrides = {}) {
  return {
    seed_id: seed.seedId,
    seed_key: seed.seedId,
    seed_title: seed.seedTitle,
    status: seed.status,
    theme_key: seed.theme.key,
    theme_label: seed.theme.label,
    seed_json: seed,
    scores: seed.scores,
    bias_audit: seed.biasAudit,
    provider_gaps: seed.providerGaps,
    evidence_plan: buildRouteAwareSeedEvidencePlan(seed),
    lineage: seed.lineage || {},
    review_state: {},
    updated_at: '2026-05-19T10:00:00.000Z',
    ...overrides,
  };
}

test('operator seed review item exposes lifecycle fields without raw query drafts', () => {
  const item = buildOperatorSeedReviewItem(rowForSeed());
  assert.equal(item.seedId, 'msd-phase-d-srm');
  assert.equal(item.status, 'review_ready');
  assert.equal(item.evidence.phaseCStatus, 'complete');
  assert.equal(item.actionAvailability.canMarkReportCandidate, true);
  assert.equal(item.mutationPolicy.providerActivationWrites, 0);
  assert.ok(item.evidence.classRows.some((row) => row.evidenceClass === 'negative_control'));
  assert.equal(Object.hasOwn(item, 'sourceQueryDrafts'), false);
  assert.equal(Object.hasOwn(item, 'providerRoutePlans'), false);
});

test('operator seed detail keeps raw plan in audit payload only', () => {
  const detail = buildOperatorSeedReviewDetail(rowForSeed());
  assert.ok(Array.isArray(detail.detail.evidenceQueries));
  assert.ok(Array.isArray(detail.detail.counterEvidenceQueries));
  assert.ok(detail.detail.auditPayload.evidencePlan.sourceQueryDrafts.length > 0);
  assert.equal(detail.detail.phaseCAudit.complete, true);
});

test('operator seed review payload aggregates dashboard counts and write boundaries', () => {
  const payload = buildOperatorSeedReviewPayload([
    rowForSeed(),
    rowForSeed(sampleSeed({ seedId: 'msd-phase-d-grid', status: 'needs_evidence', theme: { key: 'clean-energy', label: 'Clean Energy' } })),
  ]);
  assert.equal(payload.ok, true);
  assert.equal(payload.total, 2);
  assert.equal(payload.statusCounts.review_ready, 1);
  assert.equal(payload.statusCounts.needs_evidence, 1);
  assert.equal(payload.boundaries.canonicalWrites, 0);
  assert.equal(payload.boundaries.providerActivationWrites, 0);
});

test('seed evidence action payload defaults to review-only and no queue writes', () => {
  const payload = buildSeedEvidenceActionPayload(rowForSeed());
  assert.equal(payload.mode, 'evidence-plan-review');
  assert.equal(payload.enqueueDefault, false);
  assert.equal(payload.mutationPolicy.approvalQueueWrites, 0);
  assert.equal(payload.mutationPolicy.providerActivationWrites, 0);
});
