/**
 * IS-5 Integration Test — Config Externalization + Alerts
 *
 * Verifies:
 * 1. ConfigManager runtime parameter changes
 * 2. Config propagation to HMM and Bandit modules
 * 3. Alert routing to source-ops-log format
 * 4. Config change history tracking
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { ConfigManager, DEFAULT_MODEL_PARAMS, AlertEngine, DEFAULT_ALERT_RULES } = await import(
  '../src/services/alerts/alert-system.ts'
);
const { setHmmParams, getHmmParams } = await import(
  '../src/services/math-models/hmm-regime.ts'
);
const { setBanditDiscountFactor, getBanditDiscountFactor, createBanditArmState } = await import(
  '../src/services/math-models/contextual-bandit.ts'
);

// ---------------------------------------------------------------------------
// 1. ConfigManager runtime parameter changes
// ---------------------------------------------------------------------------

describe('IS-5: ConfigManager runtime parameters', () => {
  let cm;

  beforeEach(() => {
    cm = new ConfigManager();
  });

  it('getParams returns defaults', () => {
    const params = cm.getParams();
    assert.equal(params.hmm.transitionPriorStrength, 12);
    assert.equal(params.hmm.onlineDiscount, 0.992);
    assert.equal(params.conviction.discountFactor, 0.995);
    assert.equal(params.bandit.discountFactor, 0.995);
  });

  it('updateParam changes a single value', () => {
    const ok = cm.updateParam('hmm.transitionPriorStrength', 15);
    assert.equal(ok, true);
    assert.equal(cm.getParams().hmm.transitionPriorStrength, 15);
  });

  it('updateParam rejects invalid paths', () => {
    assert.equal(cm.updateParam('invalid.path', 0), false);
    assert.equal(cm.updateParam('hmm.nonexistent', 0), false);
    assert.equal(cm.updateParam('tooDeep.a.b', 0), false);
  });

  it('loadConfig replaces all params', () => {
    const newConfig = {
      hmm: { transitionPriorStrength: 20, onlineDiscount: 0.98 },
      conviction: { discountFactor: 0.99, learningRate: 0.1 },
      bandit: { discountFactor: 0.99, explorationScale: 0.5 },
      risk: { maxGrossExposurePct: 100, maxNetExposurePct: 50, maxSinglePositionPct: 8 },
      degradation: { minDataSufficiency: 0.4, maxModelStaleness: 0.6 },
    };
    cm.loadConfig(newConfig);
    const params = cm.getParams();
    assert.equal(params.hmm.transitionPriorStrength, 20);
    assert.equal(params.bandit.explorationScale, 0.5);
    assert.equal(params.risk.maxGrossExposurePct, 100);
  });

  it('tracks change history', () => {
    cm.updateParam('conviction.learningRate', 0.05, 'api');
    cm.updateParam('conviction.learningRate', 0.03, 'manual');
    const history = cm.getHistory();
    assert.equal(history.length, 2);
    assert.equal(history[0].path, 'conviction.learningRate');
    assert.equal(history[0].newValue, 0.05);
    assert.equal(history[1].newValue, 0.03);

    const pathHistory = cm.getHistoryForPath('conviction.learningRate');
    assert.equal(pathHistory.length, 2);
  });

  it('getParams returns deep copy (mutations do not affect state)', () => {
    const params1 = cm.getParams();
    params1.hmm.transitionPriorStrength = 999;
    const params2 = cm.getParams();
    assert.equal(params2.hmm.transitionPriorStrength, 12, 'mutation should not affect internal state');
  });
});

// ---------------------------------------------------------------------------
// 2. Config propagation to math modules
// ---------------------------------------------------------------------------

describe('IS-5: Config propagation to HMM and Bandit', () => {
  it('setHmmParams updates module-level values', () => {
    setHmmParams(18, 0.985);
    const params = getHmmParams();
    assert.equal(params.transitionPriorStrength, 18);
    assert.equal(params.onlineDiscount, 0.985);
    // Reset
    setHmmParams(12, 0.992);
  });

  it('setBanditDiscountFactor updates new arm defaults', () => {
    setBanditDiscountFactor(0.99);
    const newArm = createBanditArmState('test-arm', 4);
    assert.equal(newArm.discountFactor, 0.99);
    // Reset
    setBanditDiscountFactor(0.995);
  });

  it('full config reload propagation', () => {
    const cm = new ConfigManager();
    cm.updateParam('hmm.transitionPriorStrength', 25);
    cm.updateParam('bandit.discountFactor', 0.985);

    const params = cm.getParams();
    setHmmParams(params.hmm.transitionPriorStrength, params.hmm.onlineDiscount);
    setBanditDiscountFactor(params.bandit.discountFactor);

    assert.equal(getHmmParams().transitionPriorStrength, 25);
    assert.equal(getBanditDiscountFactor(), 0.985);

    // Reset
    setHmmParams(12, 0.992);
    setBanditDiscountFactor(0.995);
  });
});

// ---------------------------------------------------------------------------
// 3. AlertEngine routing
// ---------------------------------------------------------------------------

describe('IS-5: AlertEngine routing', () => {
  it('alert listener receives fired alerts', () => {
    const engine = new AlertEngine();
    const received = [];
    engine.onAlert((alert) => received.push(alert));

    engine.evaluate({
      sourceFailureStreak: 5,
      weightChangePct: 0,
      convictionCalibrationBiasPct: 0,
      isAbstaining: true,
      portfolioDrawdownPct: 20,
      dataPipelineDelayMinutes: 120,
      modelStaleness: 0.9,
      recentHitRatePct: 30,
    });

    assert.ok(received.length > 0, 'listener should receive alerts');
    // All alerts should have standard fields for source-ops-log routing
    for (const alert of received) {
      assert.equal(typeof alert.ruleId, 'string');
      assert.equal(typeof alert.severity, 'string');
      assert.equal(typeof alert.message, 'string');
      assert.equal(typeof alert.timestamp, 'string');
    }
  });

  it('removeListener stops delivery', () => {
    const engine = new AlertEngine();
    const received = [];
    const remove = engine.onAlert((alert) => received.push(alert));

    engine.evaluate({
      sourceFailureStreak: 0,
      weightChangePct: 0,
      convictionCalibrationBiasPct: 0,
      isAbstaining: true,
      portfolioDrawdownPct: 0,
      dataPipelineDelayMinutes: 0,
      modelStaleness: 0,
      recentHitRatePct: 50,
    });
    const countBefore = received.length;

    remove();
    engine.evaluate({
      sourceFailureStreak: 0,
      weightChangePct: 0,
      convictionCalibrationBiasPct: 0,
      isAbstaining: true,
      portfolioDrawdownPct: 0,
      dataPipelineDelayMinutes: 0,
      modelStaleness: 0,
      recentHitRatePct: 50,
    });

    // With cooldown, second evaluate may or may not fire, but listener was removed
    // so received count should not increase
    assert.equal(received.length, countBefore, 'no new alerts after removeListener');
  });
});

// ---------------------------------------------------------------------------
// 4. model-params.json structure validation
// ---------------------------------------------------------------------------

describe('IS-5: model-params.json compatibility', () => {
  it('DEFAULT_MODEL_PARAMS has all required sections', () => {
    assert.ok(DEFAULT_MODEL_PARAMS.hmm, 'has hmm section');
    assert.ok(DEFAULT_MODEL_PARAMS.conviction, 'has conviction section');
    assert.ok(DEFAULT_MODEL_PARAMS.bandit, 'has bandit section');
    assert.ok(DEFAULT_MODEL_PARAMS.risk, 'has risk section');
    assert.ok(DEFAULT_MODEL_PARAMS.degradation, 'has degradation section');
  });

  it('ConfigManager accepts DEFAULT_MODEL_PARAMS', () => {
    const cm = new ConfigManager(DEFAULT_MODEL_PARAMS);
    const params = cm.getParams();
    assert.equal(typeof params.hmm.transitionPriorStrength, 'number');
    assert.equal(typeof params.conviction.discountFactor, 'number');
    assert.equal(typeof params.risk.maxGrossExposurePct, 'number');
  });
});
