/**
 * Evaluation Pipeline — Phase 0.2
 *
 * Runs a strategy against a series of frames, computes forward returns,
 * and produces an EvaluationRun with all performance metrics.
 *
 * Also provides compareStrategies() for head-to-head comparison
 * and generateCalibrationReport() for conviction calibration analysis.
 */

import type {
  BaselineStrategy,
  BaselineSignal,
  EvaluationFrame,
  EvaluationForwardReturn,
  EvaluationRun,
  StrategyComparison,
  ComparisonReport,
  CalibrationBucket,
  CalibrationReport,
} from './types';

import {
  mean,
  median,
  compoundedReturn,
  maxDrawdown,
  sharpeRatio,
  calmarRatio,
  profitFactor,
  welchTTest,
} from './statistics';

// ---------------------------------------------------------------------------
// Forward Return Resolution
// ---------------------------------------------------------------------------

/**
 * For each signal, find the entry price (from the signal's frame) and
 * exit price (from a later frame within the horizon window).
 *
 * This simulates realistic execution:
 * - Entry at the frame's closing price
 * - Exit at the frame closest to horizonHours later
 */
export function resolveForwardReturns(
  signals: Array<BaselineSignal & { frameIndex: number }>,
  frames: EvaluationFrame[],
  horizonHours = 24,
): EvaluationForwardReturn[] {
  const results: EvaluationForwardReturn[] = [];
  const horizonMs = horizonHours * 3600_000;

  for (const signal of signals) {
    const entryFrame = frames[signal.frameIndex];
    if (!entryFrame) continue;

    const entryMarket = entryFrame.markets.find((m) => m.symbol === signal.symbol);
    if (!entryMarket || entryMarket.price == null) continue;

    const entryPrice = entryMarket.price;
    const entryTime = new Date(entryFrame.timestamp).getTime();

    // Find the exit frame: closest to target time without exceeding 1.5× horizon
    let exitPrice: number | null = null;
    let exitTimestamp: string | null = null;
    let exitReason: EvaluationForwardReturn['exitReason'] = 'no-exit-price';
    let bestReturnPct = 0;
    let worstDrawdown = 0;

    for (let i = signal.frameIndex + 1; i < frames.length; i++) {
      const f = frames[i];
      if (!f) continue;
      const fTime = new Date(f.timestamp).getTime();
      const elapsed = fTime - entryTime;

      const market = f.markets.find((m) => m.symbol === signal.symbol);
      if (!market || market.price == null) continue;

      // Track path-based metrics
      const currentReturn =
        signal.direction === 'long'
          ? ((market.price - entryPrice) / entryPrice) * 100
          : ((entryPrice - market.price) / entryPrice) * 100;

      if (currentReturn > bestReturnPct) bestReturnPct = currentReturn;
      const drawdown = bestReturnPct - currentReturn;
      if (drawdown > worstDrawdown) worstDrawdown = drawdown;

      // Trailing stop: if drawdown from peak > 0.8%
      if (bestReturnPct > 0.5 && drawdown > Math.max(0.8, bestReturnPct * 0.65)) {
        exitPrice = market.price;
        exitTimestamp = f.timestamp;
        exitReason = 'trailing-stop';
        break;
      }

      // Target horizon reached
      if (elapsed >= horizonMs) {
        exitPrice = market.price;
        exitTimestamp = f.timestamp;
        exitReason = 'target-horizon';
        break;
      }

      // Max hold fallback: 1.5× horizon
      if (elapsed >= horizonMs * 1.5) {
        exitPrice = market.price;
        exitTimestamp = f.timestamp;
        exitReason = 'max-hold-fallback';
        break;
      }
    }

    let rawReturnPct: number | null = null;
    let signedReturnPct: number | null = null;

    if (exitPrice != null) {
      rawReturnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
      signedReturnPct =
        signal.direction === 'long' ? rawReturnPct : -rawReturnPct;
    }

    results.push({
      signalId: `${signal.symbol}-${signal.timestamp}`,
      symbol: signal.symbol,
      direction: signal.direction,
      conviction: signal.conviction,
      entryTimestamp: entryFrame.timestamp,
      exitTimestamp,
      entryPrice,
      exitPrice,
      horizonHours,
      rawReturnPct,
      signedReturnPct,
      maxDrawdownPct: worstDrawdown > 0 ? worstDrawdown : null,
      exitReason,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Run a Single Strategy
// ---------------------------------------------------------------------------

export function runStrategy(
  strategy: BaselineStrategy,
  frames: EvaluationFrame[],
  horizonHours = 24,
): EvaluationRun {
  // Generate signals for each frame
  const allSignals: Array<BaselineSignal & { frameIndex: number }> = [];
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (!frame) continue;
    const signals = strategy.generateSignals(frame);
    for (const s of signals) {
      allSignals.push({ ...s, frameIndex: i });
    }
  }

  // Resolve forward returns
  const fwdReturns = resolveForwardReturns(allSignals, frames, horizonHours);

  // Filter to executed trades (has exit price)
  const executed = fwdReturns.filter((r) => r.signedReturnPct != null);
  const returns = executed.map((r) => r.signedReturnPct!);
  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r <= 0);

  const totalReturn = compoundedReturn(returns);
  const maxDd = maxDrawdown(returns);

  const firstFrame = frames[0];
  const lastFrame = frames[frames.length - 1];
  const period = {
    start: firstFrame ? firstFrame.timestamp : '',
    end: lastFrame ? lastFrame.timestamp : '',
  };

  const avgHolding =
    executed.length > 0
      ? executed.reduce((s, r) => {
          if (!r.exitTimestamp || !r.entryTimestamp) return s;
          const ms = new Date(r.exitTimestamp).getTime() - new Date(r.entryTimestamp).getTime();
          return s + ms / 3600_000;
        }, 0) / executed.length
      : 0;

  return {
    strategyName: strategy.name,
    period,
    ideaCount: allSignals.length,
    executedCount: executed.length,
    hitRate: executed.length > 0 ? wins.length / executed.length : 0,
    avgReturnPct: mean(returns),
    medianReturnPct: median(returns),
    totalReturnPct: totalReturn,
    maxDrawdownPct: maxDd,
    sharpeRatio: sharpeRatio(returns),
    calmarRatio: calmarRatio(totalReturn, maxDd),
    profitFactor: profitFactor(returns),
    avgHoldingHours: avgHolding,
    signalCount: allSignals.length,
    winCount: wins.length,
    lossCount: losses.length,
    returns,
    runTimestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Compare Strategies
// ---------------------------------------------------------------------------

export function compareStrategies(
  runs: EvaluationRun[],
  systemStrategyName = 'system',
): ComparisonReport {
  const comparisons: StrategyComparison[] = [];
  const systemRun = runs.find((r) => r.strategyName === systemStrategyName);

  // Pairwise: system vs each baseline
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const a = runs[i]!;
      const b = runs[j]!;
      const tTest =
        a.returns.length >= 2 && b.returns.length >= 2
          ? welchTTest(a.returns, b.returns)
          : null;

      comparisons.push({
        strategyA: a.strategyName,
        strategyB: b.strategyName,
        hitRateDiff: a.hitRate - b.hitRate,
        avgReturnDiff: a.avgReturnPct - b.avgReturnPct,
        sharpeDiff: a.sharpeRatio - b.sharpeRatio,
        pValue: tTest?.pValue ?? null,
        significant: tTest != null && tTest.pValue < 0.05,
      });
    }
  }

  // Best baseline (excluding system)
  const baselines = runs.filter((r) => r.strategyName !== systemStrategyName);
  const bestBaseline = baselines.length > 0
    ? baselines.reduce((best, r) => (r.sharpeRatio > best.sharpeRatio ? r : best))
    : null;

  let systemBeatsBest = false;
  let systemPValue: number | null = null;

  if (systemRun && bestBaseline) {
    const tTest = welchTTest(systemRun.returns, bestBaseline.returns);
    systemPValue = tTest.pValue;
    systemBeatsBest = systemRun.avgReturnPct > bestBaseline.avgReturnPct && tTest.pValue < 0.05;
  }

  const firstRun = runs[0];
  const period = firstRun
    ? firstRun.period
    : { start: '', end: '' };

  return {
    generatedAt: new Date().toISOString(),
    period,
    runs,
    comparisons,
    bestStrategy: bestBaseline?.strategyName ?? 'none',
    systemBeatsBestBaseline: systemBeatsBest,
    systemPValue,
  };
}

// ---------------------------------------------------------------------------
// Calibration Report
// ---------------------------------------------------------------------------

export function generateCalibrationReport(
  forwardReturns: EvaluationForwardReturn[],
  bucketCount = 10,
): CalibrationReport {
  const executed = forwardReturns.filter((r) => r.signedReturnPct != null);
  const bucketSize = 100 / bucketCount;
  const buckets: CalibrationBucket[] = [];

  for (let i = 0; i < bucketCount; i++) {
    const min = i * bucketSize;
    const max = (i + 1) * bucketSize;
    const items = executed.filter((r) => r.conviction >= min && r.conviction < max);
    const returns = items.map((r) => r.signedReturnPct!);
    const hits = returns.filter((r) => r > 0).length;

    const actualHitRate = items.length > 0 ? hits / items.length : 0;
    const expectedHitRate = (min + max) / 2 / 100;

    buckets.push({
      convictionRange: { min, max },
      count: items.length,
      actualHitRate,
      expectedHitRate,
      avgReturnPct: mean(returns),
      bias: actualHitRate - expectedHitRate,
    });
  }

  const nonEmpty = buckets.filter((b) => b.count > 0);
  const overallBias = mean(nonEmpty.map((b) => b.bias));
  const brierScore = mean(nonEmpty.map((b) => b.bias ** 2));

  const firstExec = executed[0];
  const lastExec = executed[executed.length - 1];
  const period = {
    start: firstExec ? firstExec.entryTimestamp : '',
    end: lastExec ? lastExec.entryTimestamp : '',
  };

  return {
    generatedAt: new Date().toISOString(),
    period,
    buckets,
    overallBias,
    brierScore,
  };
}
