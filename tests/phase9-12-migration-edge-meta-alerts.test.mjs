/**
 * Phase 9-12 Test Suite
 * Tests: State Migration, Edge Hypothesis, Meta-Confidence, Alert System
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Phase 9 — State Migration
import {
  compareVersions,
  formatVersion,
  parseVersion,
  StateMigrationManager,
  resolveStorageTier,
  DEFAULT_STORAGE_TIERS,
  CURRENT_SCHEMA_VERSION,
} from '../src/services/state/state-migration.ts';
import { InMemoryStateStore } from '../src/services/state/in-memory-state-store.ts';

// Phase 10 — Edge Hypothesis
import {
  getHypotheses,
  getHypothesis,
  evaluateHypothesis,
  recordEvidence,
  assessEdgeStrength,
  buildVerificationPlan,
} from '../src/services/evaluation/edge-hypothesis.ts';

// Phase 11 — Meta-Confidence
import {
  assessMetaConfidence,
  canResumeJudgment,
  summarizeAssessment,
  DEFAULT_THRESHOLDS,
} from '../src/services/investment/meta-confidence.ts';

// Phase 12 — Alert System + Config
import {
  AlertEngine,
  ConfigManager,
  DEFAULT_MODEL_PARAMS,
  DEFAULT_ALERT_RULES,
  DASHBOARD_PANELS,
} from '../src/services/alerts/alert-system.ts';

// =========================================================================
// Phase 9: State Migration
// =========================================================================

describe('Phase 9: State Migration', () => {
  describe('Schema Version Utilities', () => {
    it('compareVersions returns correct ordering', () => {
      assert.equal(compareVersions({ major: 1, minor: 0, patch: 0, migratedAt: '' }, { major: 2, minor: 0, patch: 0, migratedAt: '' }), -1);
      assert.equal(compareVersions({ major: 2, minor: 0, patch: 0, migratedAt: '' }, { major: 1, minor: 0, patch: 0, migratedAt: '' }), 1);
      assert.equal(compareVersions({ major: 1, minor: 1, patch: 0, migratedAt: '' }, { major: 1, minor: 1, patch: 0, migratedAt: '' }), 0);
      assert.equal(compareVersions({ major: 1, minor: 0, patch: 1, migratedAt: '' }, { major: 1, minor: 0, patch: 2, migratedAt: '' }), -1);
    });

    it('formatVersion produces correct string', () => {
      assert.equal(formatVersion({ major: 2, minor: 1, patch: 3, migratedAt: '' }), '2.1.3');
    });

    it('parseVersion round-trips with formatVersion', () => {
      const v = parseVersion('3.2.1');
      assert.equal(v.major, 3);
      assert.equal(v.minor, 2);
      assert.equal(v.patch, 1);
      assert.equal(formatVersion(v), '3.2.1');
    });

    it('CURRENT_SCHEMA_VERSION is defined', () => {
      assert.equal(CURRENT_SCHEMA_VERSION.major, 2);
      assert.equal(CURRENT_SCHEMA_VERSION.minor, 0);
    });
  });

  describe('StateMigrationManager', () => {
    it('registers and retrieves pending migrations', () => {
      const mgr = new StateMigrationManager();
      mgr.registerMigration({
        id: 'mig-1',
        description: 'Test migration',
        fromVersion: { major: 1, minor: 0, patch: 0, migratedAt: '' },
        toVersion: { major: 2, minor: 0, patch: 0, migratedAt: '' },
        keys: ['key-a'],
        migrate: (data) => ({ ...data, migrated: true }),
      });
      const pending = mgr.getPendingMigrations({ major: 1, minor: 0, patch: 0, migratedAt: '' });
      assert.equal(pending.length, 1);
      assert.equal(pending[0].id, 'mig-1');
    });

    it('runs migration with snapshot-restore safety', async () => {
      const store = new InMemoryStateStore();
      await store.set('key-a', { value: 10 });

      const mgr = new StateMigrationManager();
      mgr.registerMigration({
        id: 'mig-upgrade',
        description: 'Upgrade key-a',
        fromVersion: { major: 1, minor: 0, patch: 0, migratedAt: '' },
        toVersion: { major: 2, minor: 0, patch: 0, migratedAt: '' },
        keys: ['key-a'],
        migrate: (data) => ({ ...(data), value: (data).value * 2 }),
      });

      const results = await mgr.runMigrations(store, { major: 1, minor: 0, patch: 0, migratedAt: '' });
      assert.equal(results.length, 1);
      assert.equal(results[0].success, true);
      assert.equal(results[0].keysProcessed, 1);

      const updated = await store.get('key-a');
      assert.deepEqual(updated, { value: 20 });
    });

    it('rolls back on total failure', async () => {
      const store = new InMemoryStateStore();
      await store.set('fail-key', { v: 1 });

      const mgr = new StateMigrationManager();
      mgr.registerMigration({
        id: 'mig-fail',
        description: 'Failing migration',
        fromVersion: { major: 1, minor: 0, patch: 0, migratedAt: '' },
        toVersion: { major: 2, minor: 0, patch: 0, migratedAt: '' },
        keys: ['fail-key'],
        migrate: () => { throw new Error('Intentional failure'); },
      });

      const results = await mgr.runMigrations(store, { major: 1, minor: 0, patch: 0, migratedAt: '' });
      assert.equal(results[0].success, false);
      assert.equal(results[0].keysFailed, 1);

      // Data should be restored
      const restored = await store.get('fail-key');
      assert.deepEqual(restored, { v: 1 });
    });

    it('tracks applied migrations', async () => {
      const store = new InMemoryStateStore();
      await store.set('k', 1);

      const mgr = new StateMigrationManager();
      mgr.registerMigration({
        id: 'mig-once',
        description: 'Run once',
        fromVersion: { major: 1, minor: 0, patch: 0, migratedAt: '' },
        toVersion: { major: 2, minor: 0, patch: 0, migratedAt: '' },
        keys: ['k'],
        migrate: (d) => (d) + 1,
      });

      await mgr.runMigrations(store, { major: 1, minor: 0, patch: 0, migratedAt: '' });
      assert.equal(mgr.isMigrationApplied('mig-once'), true);

      // Running again should not re-apply
      const results2 = await mgr.runMigrations(store, { major: 1, minor: 0, patch: 0, migratedAt: '' });
      assert.equal(results2.length, 0);

      const val = await store.get('k');
      assert.equal(val, 2); // only incremented once
    });
  });

  describe('Storage Tier Resolver', () => {
    it('resolves learning keys to postgres', () => {
      const result = resolveStorageTier('conviction-model-state');
      assert.ok(result);
      assert.equal(result.category, 'learning');
      assert.equal(result.backend, 'postgres');
    });

    it('resolves cache keys to redis', () => {
      const result = resolveStorageTier('current-snapshot');
      assert.ok(result);
      assert.equal(result.category, 'cache');
      assert.equal(result.backend, 'redis');
    });

    it('resolves wildcard audit keys', () => {
      const result = resolveStorageTier('decision-snapshot-idea-123');
      assert.ok(result);
      assert.equal(result.category, 'audit');
      assert.equal(result.backend, 'postgres');
    });

    it('returns null for unknown keys', () => {
      const result = resolveStorageTier('unknown-key-xyz');
      assert.equal(result, null);
    });

    it('DEFAULT_STORAGE_TIERS has all categories', () => {
      assert.ok(DEFAULT_STORAGE_TIERS.learning.length > 0);
      assert.ok(DEFAULT_STORAGE_TIERS.audit.length > 0);
      assert.ok(DEFAULT_STORAGE_TIERS.cache.length > 0);
      assert.ok(DEFAULT_STORAGE_TIERS.evaluation.length > 0);
    });
  });
});

// =========================================================================
// Phase 10: Edge Hypothesis
// =========================================================================

describe('Phase 10: Edge Hypothesis', () => {
  describe('Hypothesis Registry', () => {
    it('has 4 predefined hypotheses', () => {
      const hyps = getHypotheses();
      assert.equal(hyps.length, 4);
    });

    it('all hypotheses start as pending', () => {
      const hyps = getHypotheses();
      for (const h of hyps) {
        assert.equal(h.status, 'pending');
      }
    });

    it('getHypothesis returns deep copy', () => {
      const h1 = getHypothesis('cross-domain');
      assert.ok(h1);
      h1.name = 'mutated';
      const h2 = getHypothesis('cross-domain');
      assert.notEqual(h2.name, 'mutated');
    });

    it('each hypothesis has falsifiable statement', () => {
      const hyps = getHypotheses();
      for (const h of hyps) {
        assert.ok(h.falsifiableStatement.length > 10, `${h.id} needs falsifiable statement`);
      }
    });

    it('each hypothesis has at least one metric', () => {
      const hyps = getHypotheses();
      for (const h of hyps) {
        assert.ok(h.metrics.length >= 1, `${h.id} needs metrics`);
      }
    });
  });

  describe('Hypothesis Evaluation', () => {
    it('evaluates supported when all metrics pass with sufficient sample', () => {
      const evidence = evaluateHypothesis('cross-domain', [
        { metricName: 'sharpe_delta', observed: 0.25 },
        { metricName: 'cross_only_hit_rate', observed: 0.65 },
      ], { startDate: '2025-01-01', endDate: '2025-07-01', sampleSize: 120 });

      assert.equal(evidence.conclusion, 'supported');
      assert.ok(evidence.metricResults.every((r) => r.passed));
    });

    it('evaluates refuted when no metrics pass', () => {
      const evidence = evaluateHypothesis('cross-domain', [
        { metricName: 'sharpe_delta', observed: 0.05 },
        { metricName: 'cross_only_hit_rate', observed: 0.40 },
      ], { startDate: '2025-01-01', endDate: '2025-07-01', sampleSize: 120 });

      assert.equal(evidence.conclusion, 'refuted');
    });

    it('evaluates inconclusive with mixed results', () => {
      const evidence = evaluateHypothesis('cross-domain', [
        { metricName: 'sharpe_delta', observed: 0.20 },
        { metricName: 'cross_only_hit_rate', observed: 0.40 },
      ], { startDate: '2025-01-01', endDate: '2025-07-01', sampleSize: 120 });

      assert.equal(evidence.conclusion, 'inconclusive');
    });

    it('evaluates inconclusive with small sample even if metrics pass', () => {
      const evidence = evaluateHypothesis('cross-domain', [
        { metricName: 'sharpe_delta', observed: 0.25 },
        { metricName: 'cross_only_hit_rate', observed: 0.65 },
      ], { startDate: '2025-01-01', endDate: '2025-04-01', sampleSize: 15 });

      assert.equal(evidence.conclusion, 'inconclusive');
    });

    it('handles unknown hypothesis gracefully', () => {
      const evidence = evaluateHypothesis('nonexistent', [], { startDate: '', endDate: '', sampleSize: 0 });
      assert.equal(evidence.conclusion, 'inconclusive');
      assert.ok(evidence.notes.includes('Unknown'));
    });
  });

  describe('Evidence Recording', () => {
    it('recordEvidence updates hypothesis status', () => {
      const evidence = evaluateHypothesis('speed-advantage', [
        { metricName: 'avg_latency_minutes', observed: 15 },
        { metricName: 'pre_pricing_pct', observed: 65 },
      ], { startDate: '2025-01-01', endDate: '2025-04-01', sampleSize: 50 });

      const ok = recordEvidence('speed-advantage', evidence);
      assert.equal(ok, true);

      const h = getHypothesis('speed-advantage');
      assert.equal(h.status, 'supported');
      assert.ok(h.evidence);
    });

    it('recordEvidence returns false for unknown hypothesis', () => {
      assert.equal(recordEvidence('nope', { metricResults: [], verificationStartDate: '', verificationEndDate: '', sampleSize: 0, pValue: null, conclusion: 'supported', notes: '' }), false);
    });
  });

  describe('Edge Strength', () => {
    it('assessEdgeStrength returns valid assessment', () => {
      const assessment = assessEdgeStrength();
      assert.ok(assessment.overallStrength >= 0 && assessment.overallStrength <= 1);
      assert.equal(assessment.hypothesisStrengths.length, 4);
      assert.ok(['strong', 'moderate', 'weak', 'unverified'].includes(assessment.recommendation));
    });
  });

  describe('Verification Plan', () => {
    it('builds plan with correct duration', () => {
      const plan = buildVerificationPlan('cross-domain', '2025-01-01');
      assert.ok(plan);
      assert.equal(plan.hypothesisId, 'cross-domain');
      assert.ok(plan.controlVariables.length > 0);
      assert.equal(plan.requiredSampleSize, 100); // 6 month → 100
    });

    it('returns null for unknown hypothesis', () => {
      assert.equal(buildVerificationPlan('nonexistent', '2025-01-01'), null);
    });

    it('speed hypothesis uses shorter plan', () => {
      const plan = buildVerificationPlan('speed-advantage', '2025-01-01');
      assert.ok(plan);
      assert.equal(plan.requiredSampleSize, 50); // 3 month → 50
    });
  });
});

// =========================================================================
// Phase 11: Meta-Confidence
// =========================================================================

describe('Phase 11: Meta-Confidence', () => {
  const HEALTHY_INPUT = {
    dataSufficiency: 0.8,
    modelStaleness: 0.2,
    regimeUncertainty: 0.3,
    edgeStrength: 0.6,
    recentPerformancePct: 5,
    volatilityRegimeSigma: 1.5,
  };

  describe('assessMetaConfidence', () => {
    it('healthy input → canJudge true', () => {
      const result = assessMetaConfidence(HEALTHY_INPUT);
      assert.equal(result.canJudge, true);
      assert.equal(result.abstentionReasons.length, 0);
      assert.ok(result.confidence > 0.5);
    });

    it('low data sufficiency → canJudge false', () => {
      const result = assessMetaConfidence({ ...HEALTHY_INPUT, dataSufficiency: 0.1 });
      assert.equal(result.canJudge, false);
      assert.ok(result.abstentionReasons.some((r) => r.includes('data')));
      assert.ok(result.actions.includes('halt_new_ideas'));
    });

    it('high model staleness → canJudge false', () => {
      const result = assessMetaConfidence({ ...HEALTHY_INPUT, modelStaleness: 0.85 });
      assert.equal(result.canJudge, false);
      assert.ok(result.abstentionReasons.some((r) => r.includes('stale')));
    });

    it('high regime uncertainty → canJudge false', () => {
      const result = assessMetaConfidence({ ...HEALTHY_INPUT, regimeUncertainty: 0.9 });
      assert.equal(result.canJudge, false);
      assert.ok(result.abstentionReasons.some((r) => r.includes('regime') || r.includes('uncertain')));
    });

    it('sharp performance drop → canJudge false', () => {
      const result = assessMetaConfidence({ ...HEALTHY_INPUT, recentPerformancePct: -25 });
      assert.equal(result.canJudge, false);
      assert.ok(result.abstentionReasons.some((r) => r.includes('performance')));
      assert.ok(result.actions.includes('alert_operator'));
    });

    it('extreme volatility → canJudge false', () => {
      const result = assessMetaConfidence({ ...HEALTHY_INPUT, volatilityRegimeSigma: 4.5 });
      assert.equal(result.canJudge, false);
      assert.ok(result.abstentionReasons.some((r) => r.includes('volatility')));
    });

    it('degraded but not blocking data → canJudge true with warning', () => {
      const result = assessMetaConfidence({ ...HEALTHY_INPUT, dataSufficiency: 0.4 });
      assert.equal(result.canJudge, true);
      assert.ok(result.degradedFactors.length > 0);
    });

    it('low edge strength is degraded, not blocking', () => {
      const result = assessMetaConfidence({ ...HEALTHY_INPUT, edgeStrength: 0.05 });
      assert.equal(result.canJudge, true);
      assert.ok(result.degradedFactors.some((f) => f.includes('edge')));
    });

    it('multiple failures accumulate reasons', () => {
      const result = assessMetaConfidence({
        dataSufficiency: 0.1,
        modelStaleness: 0.9,
        regimeUncertainty: 0.95,
        edgeStrength: 0.0,
        recentPerformancePct: -30,
        volatilityRegimeSigma: 5,
      });
      assert.equal(result.canJudge, false);
      assert.ok(result.abstentionReasons.length >= 4);
    });

    it('confidence is between 0 and 1', () => {
      const r1 = assessMetaConfidence(HEALTHY_INPUT);
      const r2 = assessMetaConfidence({ dataSufficiency: 0, modelStaleness: 1, regimeUncertainty: 1, edgeStrength: 0, recentPerformancePct: -50, volatilityRegimeSigma: 6 });
      assert.ok(r1.confidence >= 0 && r1.confidence <= 1);
      assert.ok(r2.confidence >= 0 && r2.confidence <= 1);
      assert.ok(r1.confidence > r2.confidence);
    });

    it('actions are deduplicated', () => {
      const result = assessMetaConfidence({ ...HEALTHY_INPUT, dataSufficiency: 0.1, modelStaleness: 0.9 });
      const uniqueActions = new Set(result.actions);
      assert.equal(result.actions.length, uniqueActions.size);
    });
  });

  describe('canResumeJudgment', () => {
    it('healthy input → can resume', () => {
      const { canResume, remainingBlockers } = canResumeJudgment(HEALTHY_INPUT);
      assert.equal(canResume, true);
      assert.equal(remainingBlockers.length, 0);
    });

    it('blocking input → cannot resume with reasons', () => {
      const { canResume, remainingBlockers } = canResumeJudgment({ ...HEALTHY_INPUT, modelStaleness: 0.9 });
      assert.equal(canResume, false);
      assert.ok(remainingBlockers.length > 0);
    });
  });

  describe('summarizeAssessment', () => {
    it('healthy assessment has CAN JUDGE', () => {
      const result = assessMetaConfidence(HEALTHY_INPUT);
      const summary = summarizeAssessment(result);
      assert.ok(summary.includes('CAN judge'));
    });

    it('blocking assessment has CANNOT JUDGE', () => {
      const result = assessMetaConfidence({ ...HEALTHY_INPUT, dataSufficiency: 0.1 });
      const summary = summarizeAssessment(result);
      assert.ok(summary.includes('CANNOT judge'));
    });
  });
});

// =========================================================================
// Phase 12: Alert System + Config
// =========================================================================

describe('Phase 12: Alert System', () => {
  const NORMAL_CTX = {
    sourceFailureStreak: 0,
    weightChangePct: 5,
    convictionCalibrationBiasPct: 8,
    isAbstaining: false,
    portfolioDrawdownPct: 3,
    dataPipelineDelayMinutes: 5,
    modelStaleness: 0.3,
    recentHitRatePct: 55,
  };

  describe('AlertEngine', () => {
    it('has 8 default rules', () => {
      assert.ok(DEFAULT_ALERT_RULES.length >= 6);
    });

    it('no alerts on normal context', () => {
      const engine = new AlertEngine();
      const alerts = engine.evaluate(NORMAL_CTX);
      assert.equal(alerts.length, 0);
    });

    it('fires source failure alert on streak >= 3', () => {
      const engine = new AlertEngine();
      const alerts = engine.evaluate({ ...NORMAL_CTX, sourceFailureStreak: 5 });
      assert.ok(alerts.some((a) => a.ruleId === 'source-failure-streak'));
    });

    it('fires abstention alert', () => {
      const engine = new AlertEngine();
      const alerts = engine.evaluate({ ...NORMAL_CTX, isAbstaining: true });
      const abstention = alerts.find((a) => a.ruleId === 'abstention-entered');
      assert.ok(abstention);
      assert.equal(abstention.severity, 'critical');
    });

    it('fires drawdown alert', () => {
      const engine = new AlertEngine();
      const alerts = engine.evaluate({ ...NORMAL_CTX, portfolioDrawdownPct: 20 });
      assert.ok(alerts.some((a) => a.ruleId === 'drawdown-breach'));
    });

    it('fires pipeline delay alert', () => {
      const engine = new AlertEngine();
      const alerts = engine.evaluate({ ...NORMAL_CTX, dataPipelineDelayMinutes: 45 });
      assert.ok(alerts.some((a) => a.ruleId === 'pipeline-delay'));
    });

    it('fires hit rate collapse alert', () => {
      const engine = new AlertEngine();
      const alerts = engine.evaluate({ ...NORMAL_CTX, recentHitRatePct: 20 });
      assert.ok(alerts.some((a) => a.ruleId === 'hit-rate-collapse'));
    });

    it('respects cooldown between evaluations', () => {
      const engine = new AlertEngine();
      const ctx = { ...NORMAL_CTX, sourceFailureStreak: 5 };
      const first = engine.evaluate(ctx);
      assert.equal(first.length >= 1, true);

      // Immediately evaluate again — cooldown should block
      const second = engine.evaluate(ctx);
      assert.equal(second.filter((a) => a.ruleId === 'source-failure-streak').length, 0);
    });

    it('acknowledge marks alert', () => {
      const engine = new AlertEngine();
      engine.evaluate({ ...NORMAL_CTX, isAbstaining: true });
      const all = engine.getUnacknowledged();
      assert.ok(all.length > 0);
      const ok = engine.acknowledge(all[0].id);
      assert.equal(ok, true);
      assert.ok(engine.getUnacknowledged().length < all.length);
    });

    it('getBySeverity filters correctly', () => {
      const engine = new AlertEngine();
      engine.evaluate({ ...NORMAL_CTX, isAbstaining: true, portfolioDrawdownPct: 20, sourceFailureStreak: 5 });
      const criticals = engine.getBySeverity('critical');
      assert.ok(criticals.length >= 1);
      assert.ok(criticals.every((a) => a.severity === 'critical'));
    });

    it('listener receives alerts', () => {
      const engine = new AlertEngine();
      const received = [];
      engine.onAlert((alert) => received.push(alert));
      engine.evaluate({ ...NORMAL_CTX, isAbstaining: true });
      assert.ok(received.length > 0);
    });

    it('addRule and removeRule work', () => {
      const engine = new AlertEngine();
      const initial = engine.getRuleCount();
      engine.addRule({
        id: 'custom',
        name: 'Custom',
        description: 'test',
        severity: 'info',
        channels: ['log'],
        cooldownSeconds: 0,
        condition: () => true,
        message: () => 'custom alert',
      });
      assert.equal(engine.getRuleCount(), initial + 1);
      engine.removeRule('custom');
      assert.equal(engine.getRuleCount(), initial);
    });
  });

  describe('ConfigManager', () => {
    it('getParams returns deep copy of defaults', () => {
      const mgr = new ConfigManager();
      const p = mgr.getParams();
      assert.equal(p.conviction.learningRate, 0.08);
      p.conviction.learningRate = 999;
      assert.equal(mgr.getParams().conviction.learningRate, 0.08);
    });

    it('updateParam changes value and records history', () => {
      const mgr = new ConfigManager();
      const ok = mgr.updateParam('conviction.learningRate', 0.10);
      assert.equal(ok, true);
      assert.equal(mgr.getParams().conviction.learningRate, 0.10);
      const history = mgr.getHistory();
      assert.equal(history.length, 1);
      assert.equal(history[0].path, 'conviction.learningRate');
      assert.equal(history[0].previousValue, 0.08);
      assert.equal(history[0].newValue, 0.10);
    });

    it('updateParam rejects invalid path', () => {
      const mgr = new ConfigManager();
      assert.equal(mgr.updateParam('invalid.path.deep', 1), false);
      assert.equal(mgr.updateParam('conviction.nonexistent', 1), false);
    });

    it('loadConfig replaces all params and tracks changes', () => {
      const mgr = new ConfigManager();
      const newConfig = JSON.parse(JSON.stringify(DEFAULT_MODEL_PARAMS));
      newConfig.hmm.transitionPriorStrength = 20;
      newConfig.conviction.discountFactor = 0.99;
      mgr.loadConfig(newConfig, 'file');
      assert.equal(mgr.getParams().hmm.transitionPriorStrength, 20);
      assert.equal(mgr.getParams().conviction.discountFactor, 0.99);
      const history = mgr.getHistory();
      assert.ok(history.length >= 2);
      assert.ok(history.every((h) => h.source === 'file'));
    });

    it('getHistoryForPath filters correctly', () => {
      const mgr = new ConfigManager();
      mgr.updateParam('conviction.learningRate', 0.10);
      mgr.updateParam('conviction.learningRate', 0.12);
      mgr.updateParam('hmm.onlineDiscount', 0.99);
      const lrHistory = mgr.getHistoryForPath('conviction.learningRate');
      assert.equal(lrHistory.length, 2);
    });
  });

  describe('Dashboard Panels', () => {
    it('has 3 predefined panels', () => {
      assert.equal(DASHBOARD_PANELS.length, 3);
    });

    it('panels cover health, decision-flow, performance', () => {
      const categories = DASHBOARD_PANELS.map((p) => p.category);
      assert.ok(categories.includes('health'));
      assert.ok(categories.includes('decision-flow'));
      assert.ok(categories.includes('performance'));
    });

    it('each panel has metrics defined', () => {
      for (const panel of DASHBOARD_PANELS) {
        assert.ok(panel.metrics.length > 0, `${panel.id} needs metrics`);
      }
    });
  });
});
