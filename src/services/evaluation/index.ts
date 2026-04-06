/**
 * Evaluation Framework — Phase 0 Public API
 */

// Types
export type {
  InvestmentDirection,
  BaselineSignal,
  BaselineStrategy,
  EvaluationMarketPoint,
  EvaluationNewsItem,
  EvaluationCluster,
  EvaluationFrame,
  EvaluationForwardReturn,
  EvaluationRun,
  StrategyComparison,
  ComparisonReport,
  AblationTarget,
  AblationConfig,
  AblationResult,
  AblationReport,
  CalibrationBucket,
  CalibrationReport,
} from './types';

// Baseline Strategies
export {
  RandomStrategy,
  SentimentOnlyStrategy,
  MomentumStrategy,
  AlwaysLongStrategy,
  ContraryStrategy,
  ALL_BASELINE_STRATEGIES,
  getBaselineStrategy,
} from './baseline-strategies';

// Evaluation Pipeline
export {
  resolveForwardReturns,
  runStrategy,
  compareStrategies,
  generateCalibrationReport,
} from './evaluation-pipeline';

// Ablation
export {
  createAblatedSystemStrategy,
  buildAblationConfigs,
  runAblation,
  runFullAblationSuite,
} from './ablation-runner';

// Statistics
export {
  mean,
  median,
  stddev,
  compoundedReturn,
  maxDrawdown,
  sharpeRatio,
  calmarRatio,
  profitFactor,
  welchTTest,
} from './statistics';
