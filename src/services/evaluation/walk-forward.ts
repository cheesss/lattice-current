/**
 * Walk-Forward Validation — Phase 3
 *
 * Implements rolling-window backtesting with proper train/test isolation.
 * Each window trains on historical data, then tests on unseen future data,
 * providing realistic out-of-sample performance estimates.
 */

import { ExecutionContext, createBacktestContext, createEvaluationContext } from '../execution-context';
import { TemporalBarrier } from '../temporal-barrier';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WalkForwardConfig {
  /** The total evaluation period. */
  totalPeriod: { start: Date; end: Date };
  /** Number of days in each training window. */
  trainingWindowDays: number;
  /** Number of days in each test window (out-of-sample). */
  testWindowDays: number;
  /** Number of days to step forward between windows. */
  stepDays: number;
  /** Optional random seed for reproducible results. */
  randomSeed?: number;
}

export interface WalkForwardWindow {
  /** Window index (0-based). */
  index: number;
  /** Training period boundaries. */
  trainingStart: Date;
  trainingEnd: Date;
  /** Test period boundaries (out-of-sample). */
  testStart: Date;
  testEnd: Date;
}

export interface WindowResult {
  /** Which window this result belongs to. */
  window: WalkForwardWindow;
  /** Metrics from the training phase. */
  trainingMetrics: WalkForwardMetrics;
  /** Metrics from the test (out-of-sample) phase. */
  testMetrics: WalkForwardMetrics;
  /** Number of frames processed in training. */
  trainingFrameCount: number;
  /** Number of frames processed in test. */
  testFrameCount: number;
}

export interface WalkForwardMetrics {
  /** Average conviction score across generated ideas. */
  avgConviction: number;
  /** Total number of idea cards generated. */
  totalIdeas: number;
  /** Number of ideas that hit take-profit. */
  takeProfitCount: number;
  /** Number of ideas that hit stop-loss. */
  stopLossCount: number;
  /** Average return across all closed positions. */
  avgReturnPct: number;
  /** Hit rate (profitable ideas / total closed). */
  hitRate: number;
  /** Temporal violations detected (should be 0). */
  temporalViolations: number;
  /** Number of frames that failed during processing (0 = all succeeded). */
  failedFrameCount: number;
}

export interface WalkForwardResult {
  /** Configuration used for this run. */
  config: WalkForwardConfig;
  /** Per-window results. */
  windows: WindowResult[];
  /** Aggregate out-of-sample metrics (average of all test windows). */
  aggregateTestMetrics: WalkForwardMetrics;
  /** Aggregate in-sample metrics (average of all training windows). */
  aggregateTrainingMetrics: WalkForwardMetrics;
  /** Overfitting ratio: training performance / test performance. */
  overfitRatio: number;
  /** Total execution time in milliseconds. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Window Generation
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

/** Generate the rolling windows for walk-forward evaluation. */
export function generateWindows(config: WalkForwardConfig): WalkForwardWindow[] {
  const windows: WalkForwardWindow[] = [];
  const totalEndMs = config.totalPeriod.end.getTime();

  let windowStart = config.totalPeriod.start.getTime();
  let index = 0;

  while (true) {
    const trainingStart = new Date(windowStart);
    const trainingEnd = new Date(windowStart + config.trainingWindowDays * MS_PER_DAY);
    const testStart = new Date(trainingEnd.getTime());
    const testEnd = new Date(testStart.getTime() + config.testWindowDays * MS_PER_DAY);

    // Stop if the test window exceeds the total period
    if (testEnd.getTime() > totalEndMs) break;

    windows.push({
      index,
      trainingStart,
      trainingEnd,
      testStart,
      testEnd,
    });

    windowStart += config.stepDays * MS_PER_DAY;
    index++;

    // Safety: prevent infinite loops
    if (index > 500) break;
  }

  return windows;
}

// ---------------------------------------------------------------------------
// Context Creation for Windows
// ---------------------------------------------------------------------------

/** Create an execution context for a training window. */
export function createTrainingContext(
  window: WalkForwardWindow,
  randomSeed?: number,
): { context: ExecutionContext; barrier: TemporalBarrier } {
  const context = createBacktestContext({
    startDate: window.trainingStart,
    endDate: window.trainingEnd,
    randomSeed,
  });
  const barrier = new TemporalBarrier(window.trainingStart, { strict: true });
  return { context, barrier };
}

/** Create an execution context for a test window (learning frozen). */
export function createTestContext(
  window: WalkForwardWindow,
  randomSeed?: number,
): { context: ExecutionContext; barrier: TemporalBarrier } {
  const context = createEvaluationContext({
    startDate: window.testStart,
    endDate: window.testEnd,
    randomSeed,
  });
  // Freeze the context to prevent model updates during testing
  context.freeze();
  const barrier = new TemporalBarrier(window.testStart, { strict: true });
  return { context, barrier };
}

// ---------------------------------------------------------------------------
// Metrics Helpers
// ---------------------------------------------------------------------------

/** Create empty metrics for initialization. */
export function emptyMetrics(): WalkForwardMetrics {
  return {
    avgConviction: 0,
    totalIdeas: 0,
    takeProfitCount: 0,
    stopLossCount: 0,
    avgReturnPct: 0,
    hitRate: 0,
    temporalViolations: 0,
    failedFrameCount: 0,
  };
}

/** Average multiple WalkForwardMetrics into a single aggregate. */
export function averageMetrics(results: WalkForwardMetrics[]): WalkForwardMetrics {
  if (results.length === 0) return emptyMetrics();

  const sum = (fn: (m: WalkForwardMetrics) => number): number =>
    results.reduce((acc: number, m: WalkForwardMetrics) => acc + fn(m), 0) / results.length;

  return {
    avgConviction: round2(sum((m: WalkForwardMetrics) => m.avgConviction)),
    totalIdeas: round2(sum((m: WalkForwardMetrics) => m.totalIdeas)),
    takeProfitCount: round2(sum((m: WalkForwardMetrics) => m.takeProfitCount)),
    stopLossCount: round2(sum((m: WalkForwardMetrics) => m.stopLossCount)),
    avgReturnPct: round2(sum((m: WalkForwardMetrics) => m.avgReturnPct)),
    hitRate: round2(sum((m: WalkForwardMetrics) => m.hitRate)),
    temporalViolations: Math.round(sum((m: WalkForwardMetrics) => m.temporalViolations)),
    failedFrameCount: Math.round(results.reduce((acc, m) => acc + (m.failedFrameCount || 0), 0)),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Walk-Forward Runner
// ---------------------------------------------------------------------------

/**
 * Build the final walk-forward result from per-window results.
 * The actual frame-by-frame execution is performed by the caller
 * (orchestrator integration), as it requires the full pipeline context.
 */
export function buildWalkForwardResult(
  config: WalkForwardConfig,
  windowResults: WindowResult[],
  durationMs: number,
): WalkForwardResult {
  const trainingMetrics = averageMetrics(
    windowResults.map((wr: WindowResult) => wr.trainingMetrics),
  );
  const testMetrics = averageMetrics(
    windowResults.map((wr: WindowResult) => wr.testMetrics),
  );

  const overfitRatio =
    testMetrics.avgReturnPct !== 0
      ? round2(trainingMetrics.avgReturnPct / testMetrics.avgReturnPct)
      : trainingMetrics.avgReturnPct === 0
        ? 1
        : 9999;

  return {
    config,
    windows: windowResults,
    aggregateTestMetrics: testMetrics,
    aggregateTrainingMetrics: trainingMetrics,
    overfitRatio,
    durationMs,
  };
}

/**
 * Validate a walk-forward config before execution.
 * Returns an array of error messages (empty = valid).
 */
export function validateConfig(config: WalkForwardConfig): string[] {
  const errors: string[] = [];

  if (config.trainingWindowDays <= 0) {
    errors.push('trainingWindowDays must be positive');
  }
  if (config.testWindowDays <= 0) {
    errors.push('testWindowDays must be positive');
  }
  if (config.stepDays <= 0) {
    errors.push('stepDays must be positive');
  }
  if (config.totalPeriod.end.getTime() <= config.totalPeriod.start.getTime()) {
    errors.push('totalPeriod.end must be after totalPeriod.start');
  }

  const minDaysNeeded = config.trainingWindowDays + config.testWindowDays;
  const totalDays = (config.totalPeriod.end.getTime() - config.totalPeriod.start.getTime()) / MS_PER_DAY;
  if (totalDays < minDaysNeeded) {
    errors.push(
      `Total period (${Math.round(totalDays)} days) is shorter than one window ` +
      `(${minDaysNeeded} days = ${config.trainingWindowDays} training + ${config.testWindowDays} test)`
    );
  }

  const windows = generateWindows(config);
  if (windows.length === 0 && errors.length === 0) {
    errors.push('Configuration produces zero windows');
  }

  return errors;
}
