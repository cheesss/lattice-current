/**
 * historical-intelligence.ts — Facade / re-export entry point.
 *
 * All type definitions live in  ./backtest/backtest-types.ts
 * Replay orchestration lives in ./backtest/replay-workflow.ts
 * Walk-forward logic lives in   ./backtest/walk-forward.ts
 *
 * This file re-exports every public symbol so that existing
 * `import … from './historical-intelligence'` statements continue to work.
 */

// ── Types ────────────────────────────────────────────────────────
export type {
  HistoricalReplayFrame,
  BacktestIdeaRunSymbol,
  BacktestIdeaRun,
  ForwardReturnRecord,
  RealityAwareBacktestSummary,
  ReplayConfidenceInterval,
  ReplayStatisticalSummary,
  ReplayCpcvPathSummary,
  ReplayDsrSummary,
  ReplayPboSummary,
  ReplayPromotionDecision,
  ReplayGovernanceSummary,
  ReplayThemeRegimeMetric,
  ReplayDiagnosticRow,
  ReplayDiagnosticsSnapshot,
  LockedOosSummary,
  ReplayCheckpoint,
  WalkForwardWindow,
  WalkForwardFoldPlan,
  HistoricalReplayRun,
  HistoricalReplayOptions,
  WalkForwardBacktestOptions,
  PricePoint,
  PersistedReplayRuns,
} from './backtest/backtest-types';

// Re-export the BacktestOps types that were previously `export type { … } from './replay-adaptation'`
export type {
  BacktestOpsBadgeState,
  BacktestOpsRunMode,
  BacktestOpsRunSummary,
  BacktestOpsSnapshot,
} from './replay-adaptation';

// ── Replay workflow functions ────────────────────────────────────
export {
  runHistoricalReplay,
  listHistoricalReplayRuns,
  getHistoricalReplayRun,
  getBacktestOpsSnapshot,
  normalizeFrames,
  buildReplayStatisticalSummary,
  buildReplayGovernanceSummary,
} from './backtest/replay-workflow';

// ── Walk-forward functions ───────────────────────────────────────
export {
  runWalkForwardBacktest,
  splitWalkForwardWindows,
  buildWalkForwardFoldPlans,
  partitionWalkForwardFramesForHoldout,
} from './backtest/walk-forward';

// ── Test utilities ───────────────────────────────────────────────
import { normalizeFrames, buildReplayStatisticalSummary, buildReplayGovernanceSummary } from './backtest/replay-workflow';
import { splitWalkForwardWindows, buildWalkForwardFoldPlans, partitionWalkForwardFramesForHoldout } from './backtest/walk-forward';

export const __historicalReplayTestUtils = {
  normalizeFrames,
  buildReplayStatisticalSummary,
  buildReplayGovernanceSummary,
  splitWalkForwardWindows,
  buildWalkForwardFoldPlans,
  partitionWalkForwardFramesForHoldout,
};
