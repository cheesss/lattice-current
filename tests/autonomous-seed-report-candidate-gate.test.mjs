import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeMechanismSeed } from '../scripts/_shared/mechanism-seed-generator.mjs';
import { buildRouteAwareSeedEvidencePlan } from '../scripts/_shared/seed-evidence-plan.mjs';
import { evaluateAutonomousSeedReportCandidateGate } from '../scripts/_shared/seed-bias-diagnostics.mjs';

function seed(overrides = {}) {
  const item = normalizeMechanismSeed({
    source: 'research_question',
    sourceIds: ['auto-q'],
    themeKey: 'cloud-infrastructure',
    themeLabel: 'Cloud Infrastructure',
    prompt: 'grid interconnection transformer switchgear capacity bottleneck from source stream',
    seedTerms: ['grid interconnection', 'transformer lead time'],
    issuerCandidates: ['ETN', 'VRT'],
    sourceRefs: [{ sourceType: 'official_company', region: 'US' }, { sourceType: 'trade_press', region: 'EU' }],
    ...overrides,
  }, { generatedAt: '2026-05-20T00:00:00.000Z' });
  return item;
}

test('negative control not survived blocks autonomous report candidate', () => {
  const item = seed();
  const plan = buildRouteAwareSeedEvidencePlan(item);
  const gate = evaluateAutonomousSeedReportCandidateGate(item, {
    evidencePlan: plan,
    requireAutonomous: true,
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.blockers.includes('negative_control_not_closed'), true);
  assert.equal(gate.blockers.includes('accepted_evidence_missing'), true);
});

test('known narrative score blocks autonomous report candidate', () => {
  const item = seed();
  item.scores.knownNarrativeScore = 0.95;
  const gate = evaluateAutonomousSeedReportCandidateGate(item, {
    evidencePlan: buildRouteAwareSeedEvidencePlan(item),
    requireAutonomous: true,
    targetedBackfillRan: true,
    acceptedEvidence: [{ seedId: item.seedId, evidenceClass: 'issuer_exposure', coveredEvidenceClasses: ['issuer_exposure'] }],
    negativeControlSurvival: { items: [{ seedId: item.seedId, survivalStatus: 'SURVIVED' }] },
    holdoutValidation: { items: [{ seedId: item.seedId, holdoutConfirmed: true, confirmationCount: 1, contradictionCount: 0 }] },
    issuerBridge: { status: 'closed' },
    marketValidation: { localControlledMarketData: true, tier: 'screening_grade' },
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.blockers.includes('known_narrative_overfit'), true);
});

test('representative tickers are suppressed during early seed generation', () => {
  const item = seed({ issuerCandidates: ['NVDA', 'MSFT', 'ABCX'] });
  assert.equal(item.supplierCategory.publicIssuerCandidates.includes('NVDA'), false);
  assert.equal(item.supplierCategory.publicIssuerCandidates.includes('MSFT'), false);
  assert.equal(item.supplierCategory.publicIssuerCandidates.includes('ABCX'), true);
  assert.equal(item.scores.representativeTickerSuppressionApplied, true);
});
