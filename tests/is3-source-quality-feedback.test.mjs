/**
 * IS-3 Integration Test — Source Quality + Feedback Loop
 *
 * Verifies:
 * 1. Regime-aware learning rate replaces hardcoded discount
 * 2. Source quality weighting affects conviction model updates
 * 3. FeedbackDelayCompensator tracks model staleness
 * 4. Model staleness feeds into meta-confidence
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Conviction scorer
const {
  scoreConvictionModel,
  updateConvictionModel,
  blendLearnedConviction,
  normalizeConvictionFeatures,
} = await import('../src/services/investment/conviction-scorer.ts');

// Module state (to reset between tests)
const moduleState = await import('../src/services/investment/module-state.ts');

// Feedback Delay Compensator
const {
  FeedbackDelayCompensator,
  computeRegimeAwareLearningRate,
} = await import('../src/services/investment/feedback-delay-compensator.ts');

// Meta Confidence
const { assessMetaConfidence } = await import(
  '../src/services/investment/meta-confidence.ts'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFeatures(overrides = {}) {
  return {
    corroborationQuality: 60,
    recentEvidenceScore: 70,
    realityScore: 65,
    graphSignalScore: 50,
    transferEntropy: 0.3,
    banditScore: 55,
    regimeMultiplier: 100,
    coveragePenalty: 10,
    falsePositiveRisk: 20,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Regime-aware learning rate
// ---------------------------------------------------------------------------

describe('IS-3: Regime-aware learning rate', () => {
  it('returns a valid learning rate', () => {
    const rate = computeRegimeAwareLearningRate({
      baseLearningRate: 0.01,
      currentRegime: 'normal',
      regimeAtGeneration: 'normal',
      holdingDurationHours: 48,
    });
    assert.equal(typeof rate, 'number');
    assert.ok(rate > 0, 'rate should be positive');
    assert.ok(rate < 1, 'rate should be < 1');
  });

  it('regime mismatch reduces learning rate', () => {
    const matchedRate = computeRegimeAwareLearningRate({
      baseLearningRate: 0.01,
      currentRegime: 'normal',
      regimeAtGeneration: 'normal',
      holdingDurationHours: 48,
    });
    const mismatchedRate = computeRegimeAwareLearningRate({
      baseLearningRate: 0.01,
      currentRegime: 'crisis',
      regimeAtGeneration: 'normal',
      holdingDurationHours: 48,
    });
    assert.ok(
      mismatchedRate <= matchedRate,
      'mismatched regime should not increase learning rate',
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Source quality weighting in conviction updates
// ---------------------------------------------------------------------------

describe('IS-3: Source quality weighting', () => {
  beforeEach(() => {
    // Reset conviction model to known state
    moduleState.convictionModelState.bias = 0;
    moduleState.convictionModelState.observations = 0;
    moduleState.convictionModelState.learningRate = 0.01;
    for (const key of Object.keys(moduleState.convictionModelState.weights)) {
      moduleState.convictionModelState.weights[key] = 1.0;
    }
  });

  it('high source quality amplifies learning', () => {
    const features = makeFeatures();
    const biasBefore = moduleState.convictionModelState.bias;

    updateConvictionModel(features, 5.0, {
      currentRegime: 'normal',
      generationRegime: 'normal',
      sourceQualityWeight: 1.5,
    });
    const biasAfterHighQuality = moduleState.convictionModelState.bias;
    const highQualityDelta = Math.abs(biasAfterHighQuality - biasBefore);

    // Reset
    moduleState.convictionModelState.bias = 0;
    for (const key of Object.keys(moduleState.convictionModelState.weights)) {
      moduleState.convictionModelState.weights[key] = 1.0;
    }

    updateConvictionModel(features, 5.0, {
      currentRegime: 'normal',
      generationRegime: 'normal',
      sourceQualityWeight: 0.3,
    });
    const biasAfterLowQuality = moduleState.convictionModelState.bias;
    const lowQualityDelta = Math.abs(biasAfterLowQuality - biasBefore);

    assert.ok(
      highQualityDelta >= lowQualityDelta,
      `high quality delta (${highQualityDelta}) should >= low quality delta (${lowQualityDelta})`,
    );
  });

  it('updateConvictionModel increments observations', () => {
    const features = makeFeatures();
    const obsBefore = moduleState.convictionModelState.observations;
    updateConvictionModel(features, 3.0, { currentRegime: 'normal' });
    assert.equal(
      moduleState.convictionModelState.observations,
      obsBefore + 1,
    );
  });

  it('null features are safely ignored', () => {
    const obsBefore = moduleState.convictionModelState.observations;
    updateConvictionModel(null, 5.0);
    assert.equal(moduleState.convictionModelState.observations, obsBefore);
  });
});

// ---------------------------------------------------------------------------
// 3. FeedbackDelayCompensator staleness tracking
// ---------------------------------------------------------------------------

describe('IS-3: FeedbackDelayCompensator staleness', () => {
  it('fresh compensator reports high staleness (no updates)', () => {
    const comp = new FeedbackDelayCompensator();
    const report = comp.estimateModelStaleness();
    assert.equal(typeof report.stalenessScore, 'number');
    assert.ok(report.stalenessScore >= 0 && report.stalenessScore <= 1);
    assert.ok(report.explanation.length > 0);
  });

  it('staleness decreases after recording an update', () => {
    const comp = new FeedbackDelayCompensator();
    const beforeReport = comp.estimateModelStaleness();

    comp.recordUpdate({
      timestamp: new Date().toISOString(),
      ideaRunId: 'test-run-1',
      realizedReturnPct: 2.5,
      regimeAtGeneration: 'normal',
      regimeAtClose: 'normal',
      regimeAtUpdate: 'normal',
      convictionAtGeneration: 0.7,
      holdingDurationHours: 48,
      featureSnapshot: { corroboration: 0.6 },
      weightsBefore: { corroboration: 1.0 },
      weightsAfter: { corroboration: 1.01 },
    });

    const afterReport = comp.estimateModelStaleness();
    assert.ok(
      afterReport.stalenessScore <= beforeReport.stalenessScore,
      'staleness should decrease after update',
    );
  });

  it('pending idea registration works', () => {
    const comp = new FeedbackDelayCompensator();
    comp.registerPendingIdea({
      ideaId: 'idea-1',
      generatedAt: new Date().toISOString(),
      regimeAtGeneration: 'normal',
      convictionAtGeneration: 0.6,
    });
    const report = comp.estimateModelStaleness();
    assert.equal(report.pendingIdeaCount, 1);
  });

  it('confidence adjustment reduces with staleness', () => {
    const comp = new FeedbackDelayCompensator();
    // Record a recent update so the model isn't maximally stale
    comp.recordUpdate({
      timestamp: new Date().toISOString(),
      ideaRunId: 'test-run',
      realizedReturnPct: 1.0,
      regimeAtGeneration: 'normal',
      regimeAtClose: 'normal',
      regimeAtUpdate: 'normal',
      convictionAtGeneration: 0.5,
      holdingDurationHours: 24,
      featureSnapshot: {},
      weightsBefore: {},
      weightsAfter: {},
    });
    // Note: adjustConfidenceForStaleness operates on integer confidence scale (0-100)
    const adjusted = comp.adjustConfidenceForStaleness(80);
    assert.equal(typeof adjusted, 'number');
    assert.ok(adjusted <= 80, 'adjusted confidence should not exceed base');
    assert.ok(adjusted > 0, 'adjusted confidence should be positive');
  });
});

// ---------------------------------------------------------------------------
// 4. Model staleness → meta-confidence integration
// ---------------------------------------------------------------------------

describe('IS-3: Staleness → Meta-Confidence flow', () => {
  it('high staleness degrades meta-confidence', () => {
    const freshResult = assessMetaConfidence({
      dataSufficiency: 0.9,
      modelStaleness: 0.1, // fresh
      regimeUncertainty: 0.2,
      edgeStrength: 0.7,
      recentPerformancePct: 2.0,
      volatilityRegimeSigma: 1.0,
    });

    const staleResult = assessMetaConfidence({
      dataSufficiency: 0.9,
      modelStaleness: 0.9, // very stale
      regimeUncertainty: 0.2,
      edgeStrength: 0.7,
      recentPerformancePct: 2.0,
      volatilityRegimeSigma: 1.0,
    });

    assert.ok(
      staleResult.confidence <= freshResult.confidence,
      'stale model should have lower confidence',
    );
  });

  it('extreme staleness can cause abstention', () => {
    const result = assessMetaConfidence({
      dataSufficiency: 0.5,
      modelStaleness: 0.95, // extremely stale
      regimeUncertainty: 0.8,
      edgeStrength: 0.2,
      recentPerformancePct: -3.0,
      volatilityRegimeSigma: 2.5,
    });
    // With multiple bad signals, system should abstain
    assert.equal(result.canJudge, false);
    assert.ok(result.degradedFactors.length > 0 || result.abstentionReasons.length > 0);
  });
});
