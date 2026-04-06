/**
 * Tests for the Evaluation Framework — Phase 0
 * (Runs against compiled JS output)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { srcModuleUrl } from './_workspace-paths.mjs';

const {
  RandomStrategy,
  SentimentOnlyStrategy,
  MomentumStrategy,
  AlwaysLongStrategy,
  ContraryStrategy,
  ALL_BASELINE_STRATEGIES,
  getBaselineStrategy,
  runStrategy,
  compareStrategies,
  generateCalibrationReport,
  resolveForwardReturns,
  runFullAblationSuite,
  createAblatedSystemStrategy,
  mean,
  median,
  stddev,
  compoundedReturn,
  maxDrawdown,
  sharpeRatio,
  profitFactor,
  welchTTest,
} = await import(srcModuleUrl('services/evaluation/index.ts'));

// ---------------------------------------------------------------------------
// Test Data Factory
// ---------------------------------------------------------------------------

function makeFrame(index, overrides = {}) {
  const ts = new Date(Date.UTC(2025, 0, 1 + Math.floor(index / 24), index % 24)).toISOString();
  return {
    id: `frame-${index}`,
    timestamp: ts,
    validTimeStart: ts,
    validTimeEnd: ts,
    markets: [
      { symbol: 'SPY', price: 450 + index * 0.5, changePercent: (index % 5) * 0.4 - 0.8 },
      { symbol: 'GLD', price: 180 + index * 0.2, changePercent: (index % 3) * 0.3 - 0.3 },
      { symbol: 'USO', price: 72 + index * 0.1, changePercent: (index % 7) * 0.2 - 0.5 },
    ],
    news: [
      { headline: `Event ${index}`, source: 'reuters', sentiment: Math.sin(index) * 0.5, timestamp: ts },
      { headline: `Update ${index}`, source: 'bbc', sentiment: Math.cos(index) * 0.3, timestamp: ts },
    ],
    clusters: index % 4 === 0
      ? [{
          id: `cluster-${index}`,
          label: `Cluster ${index}`,
          severity: 40 + (index % 60),
          eventCount: 3 + (index % 5),
          avgSentiment: Math.sin(index) * 0.4,
          keywords: ['energy', 'conflict', 'oil'],
        }]
      : [],
    ...overrides,
  };
}

function makeFrames(count) {
  return Array.from({ length: count }, (_, i) => makeFrame(i));
}

// ---------------------------------------------------------------------------
// Statistics Tests
// ---------------------------------------------------------------------------

describe('Statistics', () => {
  it('mean() computes correct average', () => {
    assert.equal(mean([1, 2, 3, 4, 5]), 3);
    assert.equal(mean([]), 0);
    assert.equal(mean([10]), 10);
  });

  it('median() computes correct median', () => {
    assert.equal(median([1, 2, 3, 4, 5]), 3);
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(median([]), 0);
  });

  it('stddev() computes sample standard deviation', () => {
    const sd = stddev([2, 4, 4, 4, 5, 5, 7, 9]);
    assert.ok(Math.abs(sd - 2.138) < 0.01, `stddev was ${sd}`);
    assert.equal(stddev([]), 0);
    assert.equal(stddev([5]), 0);
  });

  it('compoundedReturn() compounds correctly', () => {
    const cr = compoundedReturn([10, 10]);
    assert.ok(Math.abs(cr - 21) < 0.01, `compounded was ${cr}`);
    assert.equal(compoundedReturn([]), 0);
  });

  it('maxDrawdown() tracks equity curve drawdown', () => {
    const dd = maxDrawdown([10, -20, 5]);
    assert.ok(dd > 15 && dd < 25, `maxDrawdown was ${dd}`);
    assert.equal(maxDrawdown([]), 0);
  });

  it('sharpeRatio() returns 0 for insufficient data', () => {
    assert.equal(sharpeRatio([]), 0);
    assert.equal(sharpeRatio([5]), 0);
  });

  it('sharpeRatio() is positive for consistently positive returns', () => {
    const sr = sharpeRatio([1, 2, 1.5, 2.5, 1, 3, 2, 1.5]);
    assert.ok(sr > 0, `sharpe was ${sr}`);
  });

  it('profitFactor() = gross profit / gross loss', () => {
    const pf = profitFactor([10, -5, 20, -10]);
    assert.ok(Math.abs(pf - 2.0) < 0.01, `profitFactor was ${pf}`);
    assert.equal(profitFactor([10, 20]), Infinity);
    assert.equal(profitFactor([]), 0);
  });

  it('welchTTest() returns high p-value for identical distributions', () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const b = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = welchTTest(a, b);
    assert.ok(result.pValue > 0.9, `p-value was ${result.pValue}`);
  });

  it('welchTTest() returns low p-value for different distributions', () => {
    const a = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    const b = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = welchTTest(a, b);
    assert.ok(result.pValue < 0.01, `p-value was ${result.pValue}`);
    assert.ok(result.tStatistic > 0, `t was ${result.tStatistic}`);
  });

  it('welchTTest() handles small samples gracefully', () => {
    const result = welchTTest([1], [2]);
    assert.equal(result.pValue, 1);
  });
});

// ---------------------------------------------------------------------------
// Baseline Strategy Tests
// ---------------------------------------------------------------------------

describe('Baseline Strategies', () => {
  const frames = makeFrames(50);

  it('ALL_BASELINE_STRATEGIES contains 5 strategies', () => {
    assert.equal(ALL_BASELINE_STRATEGIES.length, 5);
  });

  it('getBaselineStrategy() returns correct strategy by name', () => {
    const s = getBaselineStrategy('random');
    assert.ok(s);
    assert.equal(s.name, 'random');
    assert.equal(getBaselineStrategy('nonexistent'), undefined);
  });

  it('RandomStrategy generates deterministic signals per frame', () => {
    const frame = frames[0];
    const signals1 = RandomStrategy.generateSignals(frame);
    const signals2 = RandomStrategy.generateSignals(frame);
    assert.deepEqual(signals1, signals2, 'Random should be deterministic per frame');
    assert.ok(signals1.length > 0, 'Should generate at least one signal');
    assert.ok(signals1.length <= 3, 'Should generate at most 3 signals');
  });

  it('SentimentOnlyStrategy responds to positive/negative sentiment', () => {
    const positiveFrame = makeFrame(0, {
      news: [
        { headline: 'Good', source: 'a', sentiment: 0.8, timestamp: '' },
        { headline: 'Great', source: 'b', sentiment: 0.6, timestamp: '' },
      ],
    });
    const negativeFrame = makeFrame(1, {
      news: [
        { headline: 'Bad', source: 'a', sentiment: -0.8, timestamp: '' },
        { headline: 'Awful', source: 'b', sentiment: -0.6, timestamp: '' },
      ],
    });

    const posSigs = SentimentOnlyStrategy.generateSignals(positiveFrame);
    const negSigs = SentimentOnlyStrategy.generateSignals(negativeFrame);

    assert.ok(posSigs.length > 0);
    assert.ok(negSigs.length > 0);
    assert.ok(posSigs.every((s) => s.direction === 'long'));
    assert.ok(negSigs.every((s) => s.direction === 'short'));
  });

  it('SentimentOnlyStrategy skips on neutral sentiment', () => {
    const neutralFrame = makeFrame(0, {
      news: [
        { headline: 'Meh', source: 'a', sentiment: 0.01, timestamp: '' },
        { headline: 'Ok', source: 'b', sentiment: -0.01, timestamp: '' },
      ],
    });
    const signals = SentimentOnlyStrategy.generateSignals(neutralFrame);
    assert.equal(signals.length, 0);
  });

  it('MomentumStrategy follows price direction', () => {
    const frame = makeFrame(0, {
      markets: [
        { symbol: 'SPY', price: 450, changePercent: 2.5 },
        { symbol: 'GLD', price: 180, changePercent: -1.8 },
        { symbol: 'USO', price: 72, changePercent: 0.1 },
      ],
    });
    const signals = MomentumStrategy.generateSignals(frame);
    const spy = signals.find((s) => s.symbol === 'SPY');
    const gld = signals.find((s) => s.symbol === 'GLD');
    const uso = signals.find((s) => s.symbol === 'USO');

    assert.ok(spy);
    assert.equal(spy.direction, 'long');
    assert.ok(gld);
    assert.equal(gld.direction, 'short');
    assert.ok(!uso);
  });

  it('AlwaysLongStrategy always generates long signals', () => {
    const signals = AlwaysLongStrategy.generateSignals(frames[0]);
    assert.ok(signals.length > 0);
    assert.ok(signals.every((s) => s.direction === 'long'));
    assert.ok(signals.every((s) => s.conviction === 60));
  });

  it('ContraryStrategy fades sentiment', () => {
    const positiveFrame = makeFrame(0, {
      news: [{ headline: 'Good', source: 'a', sentiment: 0.8, timestamp: '' }],
    });
    const signals = ContraryStrategy.generateSignals(positiveFrame);
    assert.ok(signals.length > 0);
    assert.ok(signals.every((s) => s.direction === 'short'));
  });
});

// ---------------------------------------------------------------------------
// Forward Return Resolution Tests
// ---------------------------------------------------------------------------

describe('Forward Return Resolution', () => {
  const frames = makeFrames(100);

  it('resolves entry/exit prices from frames', () => {
    const signals = [{
      symbol: 'SPY',
      direction: 'long',
      conviction: 60,
      timestamp: frames[5].timestamp,
      reason: 'test',
      frameIndex: 5,
    }];
    const returns = resolveForwardReturns(signals, frames, 24);
    assert.equal(returns.length, 1);
    assert.ok(returns[0].entryPrice > 0);
    assert.ok(returns[0].exitPrice != null);
    assert.ok(returns[0].signedReturnPct != null);
    assert.ok(['target-horizon', 'trailing-stop', 'max-hold-fallback'].includes(returns[0].exitReason));
  });

  it('handles missing market data gracefully', () => {
    const signals = [{
      symbol: 'NONEXISTENT',
      direction: 'long',
      conviction: 50,
      timestamp: frames[0].timestamp,
      reason: 'test',
      frameIndex: 0,
    }];
    const returns = resolveForwardReturns(signals, frames, 24);
    assert.equal(returns.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Evaluation Pipeline Tests
// ---------------------------------------------------------------------------

describe('Evaluation Pipeline', () => {
  const frames = makeFrames(200);

  it('runStrategy() produces valid EvaluationRun', () => {
    const run = runStrategy(RandomStrategy, frames, 24);

    assert.equal(run.strategyName, 'random');
    assert.ok(run.ideaCount > 0);
    assert.ok(run.hitRate >= 0 && run.hitRate <= 1);
    assert.ok(typeof run.avgReturnPct === 'number');
    assert.ok(typeof run.sharpeRatio === 'number');
    assert.ok(typeof run.maxDrawdownPct === 'number');
    assert.ok(run.returns.length > 0);
    assert.ok(run.winCount + run.lossCount === run.executedCount);
  });

  it('runStrategy() works for all 5 baseline strategies', () => {
    for (const strategy of ALL_BASELINE_STRATEGIES) {
      const run = runStrategy(strategy, frames, 24);
      assert.ok(run.strategyName === strategy.name);
      assert.ok(typeof run.hitRate === 'number');
    }
  });

  it('compareStrategies() produces valid ComparisonReport', () => {
    const runs = ALL_BASELINE_STRATEGIES.map((s) => runStrategy(s, frames, 24));
    const report = compareStrategies(runs, 'random');

    assert.ok(report.runs.length === 5);
    assert.ok(report.comparisons.length > 0);
    assert.ok(report.generatedAt.length > 0);

    for (const comp of report.comparisons) {
      assert.ok(typeof comp.hitRateDiff === 'number');
      assert.ok(typeof comp.avgReturnDiff === 'number');
      if (comp.pValue != null) {
        assert.ok(comp.pValue >= 0 && comp.pValue <= 1);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Calibration Tests
// ---------------------------------------------------------------------------

describe('Calibration Report', () => {
  it('generateCalibrationReport() produces valid buckets', () => {
    const fwdReturns = [
      { signalId: '1', symbol: 'SPY', direction: 'long', conviction: 80, entryTimestamp: '2025-01-01', exitTimestamp: '2025-01-02', entryPrice: 100, exitPrice: 102, horizonHours: 24, rawReturnPct: 2, signedReturnPct: 2, maxDrawdownPct: 0.5, exitReason: 'target-horizon' },
      { signalId: '2', symbol: 'SPY', direction: 'long', conviction: 80, entryTimestamp: '2025-01-02', exitTimestamp: '2025-01-03', entryPrice: 102, exitPrice: 101, horizonHours: 24, rawReturnPct: -1, signedReturnPct: -1, maxDrawdownPct: 1.5, exitReason: 'target-horizon' },
      { signalId: '3', symbol: 'GLD', direction: 'short', conviction: 40, entryTimestamp: '2025-01-01', exitTimestamp: '2025-01-02', entryPrice: 180, exitPrice: 178, horizonHours: 24, rawReturnPct: -1.1, signedReturnPct: 1.1, maxDrawdownPct: 0.3, exitReason: 'target-horizon' },
      { signalId: '4', symbol: 'GLD', direction: 'short', conviction: 40, entryTimestamp: '2025-01-02', exitTimestamp: '2025-01-03', entryPrice: 178, exitPrice: 180, horizonHours: 24, rawReturnPct: 1.1, signedReturnPct: -1.1, maxDrawdownPct: 1.1, exitReason: 'target-horizon' },
    ];

    const report = generateCalibrationReport(fwdReturns, 10);
    assert.equal(report.buckets.length, 10);
    assert.ok(typeof report.overallBias === 'number');
    assert.ok(typeof report.brierScore === 'number');
    assert.ok(report.brierScore >= 0);
  });
});

// ---------------------------------------------------------------------------
// Ablation Tests
// ---------------------------------------------------------------------------

describe('Ablation Runner', () => {
  const frames = makeFrames(100);

  it('createAblatedSystemStrategy() generates signals', () => {
    const strategy = createAblatedSystemStrategy([], 'full-system');
    const run = runStrategy(strategy, frames, 24);
    assert.ok(run.ideaCount >= 0);
  });

  it('ablation with conviction disabled differs from full system', () => {
    const full = createAblatedSystemStrategy([], 'full');
    const noConviction = createAblatedSystemStrategy(['conviction'], 'no-conviction');

    const fullRun = runStrategy(full, frames, 24);
    const ablatedRun = runStrategy(noConviction, frames, 24);

    assert.ok(
      fullRun.hitRate !== ablatedRun.hitRate || fullRun.ideaCount !== ablatedRun.ideaCount,
      'Ablated run should differ from full run',
    );
  });

  it('runFullAblationSuite() produces valid report', () => {
    const report = runFullAblationSuite(frames, 24);

    assert.ok(report.fullSystemRun);
    assert.equal(report.ablations.length, 8);
    assert.equal(report.contributions.length, 8);

    for (const contrib of report.contributions) {
      assert.ok(typeof contrib.hitRateDelta === 'number');
      assert.ok(typeof contrib.avgReturnDelta === 'number');
      assert.ok(typeof contrib.sharpeDelta === 'number');
    }

    assert.ok(report.generatedAt.length > 0);
  });
});
