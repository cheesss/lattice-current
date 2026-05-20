import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRouteAwareSeedEvidencePlan } from '../scripts/_shared/seed-evidence-plan.mjs';
import { evaluateAutonomousSeedReportCandidateGate } from '../scripts/_shared/seed-bias-diagnostics.mjs';

function seed() {
  return {
    seedId: 'final-gate-seed',
    seedTitle: 'substation transformer qualification capacity',
    theme: { key: 'grid', label: 'Grid Infrastructure' },
    growthDriver: 'autonomous utility interconnection signal',
    realActivity: 'substation transformer installation',
    physicalProcess: 'qualification and energization of high-voltage transformer equipment',
    requiredInputs: ['transformer', 'switchgear', 'qualified test slot'],
    bottleneck: { label: 'substation transformer qualification capacity', class: 'technical_qualification', mechanism: 'qualification bottleneck delays grid energization' },
    supplierCategory: { label: 'qualified electrical equipment suppliers', publicIssuerCandidates: ['PWR'] },
    evidenceQueries: ['official transformer qualification backlog evidence'],
    counterEvidenceQueries: ['supplier redundancy no timing pressure'],
    expectedEvidenceClasses: ['mechanism_validation', 'issuer_exposure', 'negative_control', 'market_validation'],
    scores: { knownNarrativeScore: 0.2, seedSimilarityScore: 0.1 },
    biasAudit: { seed_dependence_score: 0.1 },
    lineage: { source: 'research_question', sourceIds: ['auto-final-gate'] },
  };
}

function context(overrides = {}) {
  const item = seed();
  const plan = buildRouteAwareSeedEvidencePlan(item);
  return {
    seed: item,
    plan,
    ctx: {
      evidencePlan: plan,
      requireAutonomous: true,
      targetedBackfillRan: true,
      acceptedEvidence: [{
        seedId: item.seedId,
        evidenceClass: 'issuer_exposure',
        source: 'official-company',
        evidenceUse: 'promotion_candidate',
        coveredEvidenceClasses: ['issuer_exposure'],
      }, {
        seedId: item.seedId,
        evidenceClass: 'mechanism_validation',
        source: 'government-official',
        evidenceUse: 'promotion_candidate',
        coveredEvidenceClasses: ['mechanism_validation'],
      }],
      negativeControlSurvival: { items: [{ seedId: item.seedId, survivalStatus: 'CHECKED_NO_DIRECT' }] },
      holdoutValidation: { items: [{ seedId: item.seedId, holdoutConfirmed: true, confirmationCount: 1, contradictionCount: 0 }] },
      issuerBridge: { status: 'closed' },
      marketValidation: { localControlledMarketData: true, tier: 'screening_grade' },
      ...overrides,
    },
  };
}

test('accepted evidence 0 blocks final investment readiness path', () => {
  const { seed: item, ctx } = context({ acceptedEvidence: [] });
  const gate = evaluateAutonomousSeedReportCandidateGate(item, ctx);
  assert.equal(gate.ok, false);
  assert.equal(gate.blockers.includes('accepted_evidence_missing'), true);
});

test('missing market validation blocks decision-ready path', () => {
  const { seed: item, ctx } = context({ marketValidation: {} });
  const gate = evaluateAutonomousSeedReportCandidateGate(item, ctx);
  assert.equal(gate.ok, false);
  assert.equal(gate.blockers.includes('market_validation_missing'), true);
});

test('missing negative control closure blocks positive path', () => {
  const { seed: item, ctx } = context({ negativeControlSurvival: { items: [] } });
  const gate = evaluateAutonomousSeedReportCandidateGate(item, ctx);
  assert.equal(gate.ok, false);
  assert.equal(gate.blockers.includes('negative_control_not_closed'), true);
});

test('missing holdout confirmation blocks positive path', () => {
  const { seed: item, ctx } = context({ holdoutValidation: { items: [] } });
  const gate = evaluateAutonomousSeedReportCandidateGate(item, ctx);
  assert.equal(gate.ok, false);
  assert.equal(gate.blockers.includes('holdout_confirmation_missing'), true);
});

test('missing issuer bridge blocks investment report readiness path', () => {
  const { seed: item, ctx } = context({ issuerBridge: {}, issuerUniverse: [] });
  item.supplierCategory.publicIssuerCandidates = [];
  ctx.evidencePlan = {
    ...ctx.evidencePlan,
    providerRoutePlans: ctx.evidencePlan.providerRoutePlans.map((route) => ({
      ...route,
      candidateIssuerUniverse: [],
      collectionUniverse: [],
      issuerUniverse: [],
    })),
  };
  const gate = evaluateAutonomousSeedReportCandidateGate(item, ctx);
  assert.equal(gate.ok, false);
  assert.equal(gate.blockers.includes('issuer_bridge_missing'), true);
});

test('single independent accepted source blocks positive path', () => {
  const { seed: item, ctx } = context({
    acceptedEvidence: [{
      seedId: 'final-gate-seed',
      evidenceClass: 'issuer_exposure',
      source: 'official-company',
      evidenceUse: 'promotion_candidate',
      coveredEvidenceClasses: ['issuer_exposure'],
    }],
  });
  const gate = evaluateAutonomousSeedReportCandidateGate(item, ctx);
  assert.equal(gate.ok, false);
  assert.equal(gate.blockers.includes('independent_source_breadth_missing'), true);
});

test('all critical fixture gates allow report candidate', () => {
  const { seed: item, ctx } = context();
  const gate = evaluateAutonomousSeedReportCandidateGate(item, ctx);
  assert.equal(gate.ok, true);
  assert.equal(gate.gate, 'report_candidate_allowed');
  assert.equal(gate.visualStatus, 'review-ready');
});
