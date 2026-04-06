/**
 * Walk-Forward Orchestrator Bridge — FIX-2
 *
 * Connects WalkForwardRunner windows to the main investment intelligence
 * pipeline, enabling actual end-to-end backtesting through the orchestrator.
 */

import type { WalkForwardConfig, WalkForwardWindow, WindowResult, WalkForwardMetrics } from './walk-forward';
import {
  generateWindows,
  createTrainingContext,
  createTestContext,
  buildWalkForwardResult,
  validateConfig,
} from './walk-forward';
import type { WalkForwardResult } from './walk-forward';
import { recomputeInvestmentIntelligence } from '../investment/orchestrator';
import type { ClusteredEvent, MarketData } from '@/types';
import type { EventMarketTransmissionSnapshot } from '../event-market-transmission';
import type { SourceCredibilityProfile } from '../source-credibility';
import type { ScheduledReport } from '../scheduled-reports';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BacktestDataFrame {
  timestamp: string;
  clusters: ClusteredEvent[];
  markets: MarketData[];
  transmission: EventMarketTransmissionSnapshot | null;
  sourceCredibility: SourceCredibilityProfile[];
  reports: ScheduledReport[];
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Run a full walk-forward backtest by invoking the orchestrator pipeline
 * for each data frame within each window.
 */
export async function runWalkForwardBacktest(
  config: WalkForwardConfig,
  dataFrames: BacktestDataFrame[],
): Promise<WalkForwardResult> {
  const errors = validateConfig(config);
  if (errors.length > 0) {
    throw new Error(`Invalid walk-forward config: ${errors.join('; ')}`);
  }

  const startTime = Date.now();
  const windows = generateWindows(config);
  const windowResults: WindowResult[] = [];

  for (const window of windows) {
    const result = await runSingleWindow(window, dataFrames);
    windowResults.push(result);
  }

  return buildWalkForwardResult(config, windowResults, Date.now() - startTime);
}

/**
 * Execute a single walk-forward window (training + test phases).
 */
async function runSingleWindow(
  window: WalkForwardWindow,
  dataFrames: BacktestDataFrame[],
): Promise<WindowResult> {
  // Partition frames into training and test sets
  const trainingFrames = dataFrames.filter((frame) => {
    const ts = new Date(frame.timestamp).getTime();
    return ts >= window.trainingStart.getTime() && ts < window.trainingEnd.getTime();
  });
  const testFrames = dataFrames.filter((frame) => {
    const ts = new Date(frame.timestamp).getTime();
    return ts >= window.testStart.getTime() && ts < window.testEnd.getTime();
  });

  // Training phase
  const { context: trainCtx } = createTrainingContext(window);
  const trainingMetrics = await processFrames(trainingFrames, trainCtx);

  // Test phase (frozen model)
  const { context: testCtx } = createTestContext(window);
  const testMetrics = await processFrames(testFrames, testCtx);

  return {
    window,
    trainingMetrics,
    testMetrics,
    trainingFrameCount: trainingFrames.length,
    testFrameCount: testFrames.length,
  };
}

/**
 * Process a sequence of data frames through the orchestrator.
 */
async function processFrames(
  frames: BacktestDataFrame[],
  executionContext: import('../execution-context').ExecutionContext,
): Promise<WalkForwardMetrics> {
  let totalIdeas = 0;
  let sumConviction = 0;
  let takeProfitCount = 0;
  let stopLossCount = 0;
  let sumReturn = 0;
  let closedCount = 0;
  let frameCount = 0;
  let failedFrameCount = 0;

  for (const frame of frames) {
    try {
      const snapshot = await recomputeInvestmentIntelligence({
        clusters: frame.clusters,
        markets: frame.markets,
        transmission: frame.transmission,
        sourceCredibility: frame.sourceCredibility,
        reports: frame.reports,
        timestamp: frame.timestamp,
        context: 'backtest',
        executionContext,
        recordCurrentThemePerformance: false,
      });

      totalIdeas += snapshot.ideaCards.length;
      sumConviction += snapshot.ideaCards.reduce((s, c) => s + c.conviction, 0);

      // Track closed ideas for hit metrics
      for (const idea of snapshot.trackedIdeas) {
        if (idea.status === 'closed' && idea.realizedReturnPct != null) {
          closedCount++;
          sumReturn += idea.realizedReturnPct;
          if (idea.exitReason === 'take-profit') takeProfitCount++;
          if (idea.exitReason === 'stop-loss') stopLossCount++;
        }
      }

      // Advance knowledge boundary if executionContext supports it
      if (!executionContext.isFrozen) {
        executionContext.advanceKnowledgeBoundary(new Date(frame.timestamp));
      }

      frameCount++;
    } catch (error) {
      failedFrameCount++;
      if (failedFrameCount <= 5) {
        console.warn(
          `[backtest] frame ${failedFrameCount} failed (ts=${frame.timestamp}):`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  return {
    avgConviction: totalIdeas > 0 ? Math.round((sumConviction / totalIdeas) * 100) / 100 : 0,
    totalIdeas,
    takeProfitCount,
    stopLossCount,
    avgReturnPct: closedCount > 0 ? Math.round((sumReturn / closedCount) * 100) / 100 : 0,
    hitRate: closedCount > 0 ? Math.round((takeProfitCount / closedCount) * 100) / 100 : 0,
    temporalViolations: 0,
    failedFrameCount,
  };
}
