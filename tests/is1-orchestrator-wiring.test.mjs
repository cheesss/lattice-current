/**
 * IS-1 Integration Test — Orchestrator Wiring
 *
 * Verifies that Phase modules (meta-confidence, data-sufficiency,
 * decision-snapshots, alert-system) are properly wired into the
 * main investment orchestrator pipeline.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Meta-Confidence (Phase 11)
const { assessMetaConfidence, summarizeAssessment } = await import(
  '../src/services/investment/meta-confidence.ts'
);

// Data Sufficiency (Phase 8)
const { assessDataSufficiency, getDegradationPolicy } = await import(
  '../src/services/data-sufficiency.ts'
);

// Decision Snapshot (Phase 7)
const { buildDecisionSnapshot } = await import(
  '../src/services/audit/decision-snapshot.ts'
);

// Snapshot Store (Phase 7)
const { SnapshotStore } = await import(
  '../src/services/audit/snapshot-store.ts'
);

// Alert System (Phase 12)
const { AlertEngine, DEFAULT_ALERT_RULES } = await import(
  '../src/services/alerts/alert-system.ts'
);

// Edge Hypothesis (Phase 10)
const { assessEdgeStrength } = await import(
  '../src/services/evaluation/edge-hypothesis.ts'
);

// ---------------------------------------------------------------------------
// 1. Meta-Confidence + Data-Sufficiency compose correctly
// ---------------------------------------------------------------------------

describe('IS-1: Meta-Confidence + Data-Sufficiency compose', () => {
  it('data-sufficiency score feeds into meta-confidence input', () => {
    const sources = [
      { id: 'news-1', kind: 'news', available: true, lastSeenAt: new Date().toISOString(), staleMinutes: 5, errorMessage: null },
      { id: 'market-1', kind: 'market-data', available: true, lastSeenAt: new Date().toISOString(), staleMinutes: 1, errorMessage: null },
      { id: 'research-1', kind: 'research', available: false, lastSeenAt: null, staleMinutes: 999, errorMessage: 'timeout' },
    ];
    const dsa = assessDataSufficiency(sources);
    assert.ok(dsa.confidenceMultiplier >= 0 && dsa.confidenceMultiplier <= 1, 'confidenceMultiplier in [0,1]');
    assert.ok(Array.isArray(dsa.missingSources), 'missingSources is array');

    // Feed into meta-confidence
    const mcInput = {
      dataSufficiency: dsa.confidenceMultiplier,
      modelStaleness: 0.2,
      regimeUncertainty: 0.3,
      edgeStrength: 0.6,
      recentPerformancePct: 2.5,
      volatilityRegimeSigma: 1.0,
    };
    const mcResult = assessMetaConfidence(mcInput);
    assert.equal(typeof mcResult.canJudge, 'boolean');
    assert.ok(mcResult.confidence >= 0 && mcResult.confidence <= 1);
  });

  it('insufficient data triggers abstention', () => {
    const sources = [
      { id: 'news-1', kind: 'news', available: false, lastSeenAt: null, staleMinutes: 999, errorMessage: 'down' },
      { id: 'market-1', kind: 'market-data', available: false, lastSeenAt: null, staleMinutes: 999, errorMessage: 'down' },
    ];
    const dsa = assessDataSufficiency(sources);
    assert.ok(dsa.confidenceMultiplier < 0.5, 'low confidence when sources are down');

    const mcResult = assessMetaConfidence({
      dataSufficiency: dsa.confidenceMultiplier,
      modelStaleness: 0.8,
      regimeUncertainty: 0.9,
      edgeStrength: 0.1,
      recentPerformancePct: -5,
      volatilityRegimeSigma: 3.0,
    });
    assert.equal(mcResult.canJudge, false, 'system should abstain');
    assert.ok(mcResult.abstentionReasons.length > 0, 'should have abstention reasons');
    const summary = summarizeAssessment(mcResult);
    assert.ok(summary.length > 0, 'summary should be non-empty');
  });

  it('healthy conditions allow judgment', () => {
    const mcResult = assessMetaConfidence({
      dataSufficiency: 0.95,
      modelStaleness: 0.1,
      regimeUncertainty: 0.15,
      edgeStrength: 0.7,
      recentPerformancePct: 3.0,
      volatilityRegimeSigma: 0.8,
    });
    assert.equal(mcResult.canJudge, true, 'system should judge');
    assert.equal(mcResult.abstentionReasons.length, 0, 'no abstention reasons');
  });
});

// ---------------------------------------------------------------------------
// 2. Decision Snapshot creation + SnapshotStore
// ---------------------------------------------------------------------------

describe('IS-1: Decision Snapshot pipeline', () => {
  let store;

  beforeEach(() => {
    store = new SnapshotStore();
  });

  it('buildDecisionSnapshot creates a valid snapshot', () => {
    const snap = buildDecisionSnapshot({
      ideaId: 'idea-001',
      themeId: 'energy-disruption',
      context: {
        regime: { id: 'risk-off', label: 'risk-off', confidence: 0.85 },
        convictionFeatures: { corroboration: 0.7, evidence: 0.6, reality: 0.5 },
        convictionWeights: { corroboration: 1.2, evidence: 0.9, reality: 1.0 },
        convictionBias: 0.05,
        modelObservations: 120,
        banditScore: 0.65,
        macroOverlayState: 'risk-off',
        sourceProfileIds: ['src-1', 'src-2'],
        riskAssessment: { approved: true, vetoReasons: [], adjustedSizePct: 2.5 },
      },
      decisions: {
        rawConviction: 0.72,
        blendedConviction: 0.68,
        autonomyAction: 'deploy',
        finalSizePct: 2.5,
        vetoReasons: [],
        attribution: [],
      },
      reproducibility: {
        stateStoreVersion: 1,
        configHash: 'abc123',
        executionMode: 'live',
      },
    });

    assert.ok(snap.snapshotId, 'has snapshotId');
    assert.ok(snap.timestamp, 'has timestamp');
    assert.equal(snap.ideaId, 'idea-001');
    assert.equal(snap.themeId, 'energy-disruption');
    assert.equal(snap.decisions.rawConviction, 0.72);
    assert.equal(snap.context.regime.id, 'risk-off');
  });

  it('SnapshotStore save + query round-trips', () => {
    const snap1 = buildDecisionSnapshot({
      ideaId: 'idea-001',
      themeId: 'theme-A',
      context: {
        regime: null,
        convictionFeatures: {},
        convictionWeights: {},
        convictionBias: 0,
        modelObservations: 0,
        banditScore: null,
        macroOverlayState: null,
        sourceProfileIds: [],
        riskAssessment: null,
      },
      decisions: {
        rawConviction: 0.5,
        blendedConviction: 0.5,
        autonomyAction: 'watch',
        finalSizePct: 0,
        vetoReasons: [],
        attribution: [],
      },
      reproducibility: { stateStoreVersion: 0, configHash: '', executionMode: 'test' },
    });

    const snap2 = buildDecisionSnapshot({
      ideaId: 'idea-002',
      themeId: 'theme-B',
      context: {
        regime: null,
        convictionFeatures: {},
        convictionWeights: {},
        convictionBias: 0,
        modelObservations: 0,
        banditScore: null,
        macroOverlayState: null,
        sourceProfileIds: [],
        riskAssessment: null,
      },
      decisions: {
        rawConviction: 0.9,
        blendedConviction: 0.85,
        autonomyAction: 'deploy',
        finalSizePct: 3.0,
        vetoReasons: [],
        attribution: [],
      },
      reproducibility: { stateStoreVersion: 0, configHash: '', executionMode: 'test' },
    });

    store.save(snap1);
    store.save(snap2);

    const all = store.query({});
    assert.equal(all.length, 2);

    const byTheme = store.query({ themeId: 'theme-B' });
    assert.equal(byTheme.length, 1);
    assert.equal(byTheme[0].ideaId, 'idea-002');

    const byAction = store.query({ autonomyAction: 'deploy' });
    assert.equal(byAction.length, 1);
    assert.equal(byAction[0].decisions.finalSizePct, 3.0);
  });
});

// ---------------------------------------------------------------------------
// 3. Alert Engine fires correctly in orchestrator context
// ---------------------------------------------------------------------------

describe('IS-1: Alert Engine in orchestrator context', () => {
  let engine;

  beforeEach(() => {
    engine = new AlertEngine();
  });

  it('healthy context produces no alerts', () => {
    const ctx = {
      sourceFailureStreak: 0,
      weightChangePct: 1,
      convictionCalibrationBiasPct: 3,
      isAbstaining: false,
      portfolioDrawdownPct: 2,
      dataPipelineDelayMinutes: 5,
      modelStaleness: 0.1,
      recentHitRatePct: 55,
    };
    const alerts = engine.evaluate(ctx);
    assert.equal(alerts.length, 0, 'no alerts for healthy system');
  });

  it('abstaining triggers abstention alert', () => {
    const ctx = {
      sourceFailureStreak: 0,
      weightChangePct: 0,
      convictionCalibrationBiasPct: 0,
      isAbstaining: true,
      portfolioDrawdownPct: 0,
      dataPipelineDelayMinutes: 0,
      modelStaleness: 0.1,
      recentHitRatePct: 50,
    };
    const alerts = engine.evaluate(ctx);
    const abstainAlert = alerts.find((a) => a.ruleId === 'abstention-entered');
    assert.ok(abstainAlert, 'should fire abstention alert');
    assert.equal(abstainAlert.severity, 'critical');
  });

  it('high source failures fire source-streak alert', () => {
    const ctx = {
      sourceFailureStreak: 5,
      weightChangePct: 0,
      convictionCalibrationBiasPct: 0,
      isAbstaining: false,
      portfolioDrawdownPct: 0,
      dataPipelineDelayMinutes: 0,
      modelStaleness: 0.1,
      recentHitRatePct: 50,
    };
    const alerts = engine.evaluate(ctx);
    const sourceAlert = alerts.find((a) => a.ruleId === 'source-failure-streak');
    assert.ok(sourceAlert, 'should fire source failure alert');
  });

  it('alert output matches IntegrationMetadata shape', () => {
    const ctx = {
      sourceFailureStreak: 5,
      weightChangePct: 0,
      convictionCalibrationBiasPct: 0,
      isAbstaining: true,
      portfolioDrawdownPct: 15,
      dataPipelineDelayMinutes: 120,
      modelStaleness: 0.9,
      recentHitRatePct: 30,
    };
    const alerts = engine.evaluate(ctx);
    // Transform to IntegrationMetadata.alertsFired shape (as orchestrator does)
    const mapped = alerts.map((a) => ({ ruleId: a.ruleId, severity: a.severity, message: a.message }));
    assert.ok(mapped.length > 0);
    for (const entry of mapped) {
      assert.equal(typeof entry.ruleId, 'string');
      assert.ok(['info', 'warning', 'critical'].includes(entry.severity));
      assert.equal(typeof entry.message, 'string');
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Edge Strength feeds into meta-confidence
// ---------------------------------------------------------------------------

describe('IS-1: Edge Strength → Meta-Confidence flow', () => {
  it('assessEdgeStrength returns a numeric overallStrength', () => {
    const result = assessEdgeStrength();
    assert.equal(typeof result.overallStrength, 'number');
    assert.ok(result.overallStrength >= 0 && result.overallStrength <= 1);
  });

  it('edge strength feeds into meta-confidence correctly', () => {
    const edge = assessEdgeStrength();
    const mcResult = assessMetaConfidence({
      dataSufficiency: 0.9,
      modelStaleness: 0.1,
      regimeUncertainty: 0.2,
      edgeStrength: edge.overallStrength,
      recentPerformancePct: 1.0,
      volatilityRegimeSigma: 1.0,
    });
    assert.equal(typeof mcResult.canJudge, 'boolean');
    assert.ok(mcResult.factorScores.edgeStrength >= 0);
  });
});

// ---------------------------------------------------------------------------
// 5. Degradation Policy composition
// ---------------------------------------------------------------------------

describe('IS-1: Degradation Policy composition', () => {
  it('getDegradationPolicy returns valid policy for each level', () => {
    for (const level of ['full', 'degraded', 'minimal', 'insufficient']) {
      const policy = getDegradationPolicy(level, 'normal');
      assert.ok(policy.maxAction, `${level}: has maxAction`);
      assert.equal(typeof policy.sizeMultiplier, 'number');
      assert.equal(typeof policy.convictionFloor, 'number');
      assert.ok(policy.humanMessage.length > 0, `${level}: has humanMessage`);
    }
  });

  it('insufficient level restricts to abstain', () => {
    const policy = getDegradationPolicy('insufficient', 'crisis');
    assert.equal(policy.maxAction, 'abstain');
    assert.equal(policy.sizeMultiplier, 0);
  });
});

// ---------------------------------------------------------------------------
// 6. End-to-end integration metadata shape
// ---------------------------------------------------------------------------

describe('IS-1: IntegrationMetadata end-to-end shape', () => {
  it('composes a complete IntegrationMetadata object', () => {
    // Simulate the orchestrator flow
    const sources = [
      { id: 's1', kind: 'news', available: true, lastSeenAt: new Date().toISOString(), staleMinutes: 2, errorMessage: null },
      { id: 's2', kind: 'market-data', available: true, lastSeenAt: new Date().toISOString(), staleMinutes: 1, errorMessage: null },
    ];
    const dsa = assessDataSufficiency(sources);
    const edge = assessEdgeStrength();
    const mc = assessMetaConfidence({
      dataSufficiency: dsa.confidenceMultiplier,
      modelStaleness: 0.15,
      regimeUncertainty: 0.2,
      edgeStrength: edge.overallStrength,
      recentPerformancePct: 1.5,
      volatilityRegimeSigma: 0.9,
    });

    const alertEngine = new AlertEngine();
    const alerts = alertEngine.evaluate({
      sourceFailureStreak: 0,
      weightChangePct: 0,
      convictionCalibrationBiasPct: 0,
      isAbstaining: !mc.canJudge,
      portfolioDrawdownPct: 0,
      dataPipelineDelayMinutes: Math.max(...sources.map((s) => s.staleMinutes)),
      modelStaleness: 0.15,
      recentHitRatePct: 55,
    });

    const store = new SnapshotStore();
    const snap = buildDecisionSnapshot({
      ideaId: 'test-idea',
      themeId: 'test-theme',
      context: {
        regime: null,
        convictionFeatures: {},
        convictionWeights: {},
        convictionBias: 0,
        modelObservations: 0,
        banditScore: null,
        macroOverlayState: null,
        sourceProfileIds: [],
        riskAssessment: null,
      },
      decisions: {
        rawConviction: 0.6,
        blendedConviction: 0.55,
        autonomyAction: 'shadow',
        finalSizePct: 1.0,
        vetoReasons: [],
        attribution: [],
      },
      reproducibility: { stateStoreVersion: 0, configHash: 'test', executionMode: 'test' },
    });
    store.save(snap);

    // Build IntegrationMetadata (same as orchestrator does)
    const integration = {
      metaConfidence: {
        canJudge: mc.canJudge,
        confidence: mc.confidence,
        abstentionReasons: mc.abstentionReasons,
        degradedFactors: mc.degradedFactors,
      },
      dataSufficiency: {
        level: dsa.level,
        score: dsa.confidenceMultiplier,
        missingSources: dsa.missingSources,
      },
      decisionSnapshotCount: 1,
      alertsFired: alerts.map((a) => ({ ruleId: a.ruleId, severity: a.severity, message: a.message })),
      riskGateSummary: null,
    };

    // Verify shape
    assert.equal(typeof integration.metaConfidence.canJudge, 'boolean');
    assert.equal(typeof integration.metaConfidence.confidence, 'number');
    assert.ok(Array.isArray(integration.metaConfidence.abstentionReasons));
    assert.ok(Array.isArray(integration.metaConfidence.degradedFactors));
    assert.equal(typeof integration.dataSufficiency.level, 'string');
    assert.equal(typeof integration.dataSufficiency.score, 'number');
    assert.ok(Array.isArray(integration.dataSufficiency.missingSources));
    assert.equal(integration.decisionSnapshotCount, 1);
    assert.ok(Array.isArray(integration.alertsFired));
    assert.equal(integration.riskGateSummary, null);
  });
});
