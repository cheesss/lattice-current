/**
 * Evaluation Framework — Shared Types
 *
 * Phase 0 of the restructuring master plan.
 * Provides the type definitions for baseline comparison,
 * ablation testing, and strategy evaluation.
 */

// ---------------------------------------------------------------------------
// Baseline Strategy Types
// ---------------------------------------------------------------------------

export type InvestmentDirection = 'long' | 'short';

export interface BaselineSignal {
  symbol: string;
  direction: InvestmentDirection;
  conviction: number; // 0-100 normalised
  timestamp: string;
  reason: string;
}

export interface BaselineStrategy {
  name: string;
  description: string;
  generateSignals(frame: EvaluationFrame): BaselineSignal[];
}

// ---------------------------------------------------------------------------
// Evaluation Frame — a simplified replay frame for evaluation use
// ---------------------------------------------------------------------------

export interface EvaluationMarketPoint {
  symbol: string;
  price: number | null;
  changePercent: number | null;
  volume?: number | null;
}

export interface EvaluationNewsItem {
  headline: string;
  source: string;
  sentiment: number; // -1 to 1
  timestamp: string;
  region?: string;
}

export interface EvaluationCluster {
  id: string;
  label: string;
  severity: number; // 0-100
  eventCount: number;
  avgSentiment: number;
  keywords: string[];
}

export interface EvaluationFrame {
  id: string;
  timestamp: string;
  validTimeStart: string;
  validTimeEnd: string;
  markets: EvaluationMarketPoint[];
  news: EvaluationNewsItem[];
  clusters: EvaluationCluster[];
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Forward Return (simplified for evaluation)
// ---------------------------------------------------------------------------

export interface EvaluationForwardReturn {
  signalId: string;
  symbol: string;
  direction: InvestmentDirection;
  conviction: number;
  entryTimestamp: string;
  exitTimestamp: string | null;
  entryPrice: number | null;
  exitPrice: number | null;
  horizonHours: number;
  rawReturnPct: number | null;
  signedReturnPct: number | null;
  maxDrawdownPct: number | null;
  exitReason: 'target-horizon' | 'trailing-stop' | 'max-hold-fallback' | 'no-exit-price';
}

// ---------------------------------------------------------------------------
// Evaluation Run — a single strategy's performance over a period
// ---------------------------------------------------------------------------

export interface EvaluationRun {
  strategyName: string;
  period: { start: string; end: string };
  ideaCount: number;
  executedCount: number; // ideas where entry/exit price were available
  hitRate: number; // fraction of positive signed returns
  avgReturnPct: number;
  medianReturnPct: number;
  totalReturnPct: number; // compounded
  maxDrawdownPct: number;
  sharpeRatio: number;
  calmarRatio: number; // totalReturn / maxDrawdown
  profitFactor: number; // sum(wins) / abs(sum(losses))
  avgHoldingHours: number;
  signalCount: number;
  winCount: number;
  lossCount: number;
  returns: number[]; // individual signed returns for statistical tests
  runTimestamp: string;
}

// ---------------------------------------------------------------------------
// Comparison Report
// ---------------------------------------------------------------------------

export interface StrategyComparison {
  strategyA: string;
  strategyB: string;
  hitRateDiff: number;
  avgReturnDiff: number;
  sharpeDiff: number;
  /** Welch's t-test p-value comparing return distributions */
  pValue: number | null;
  significant: boolean; // p < 0.05
}

export interface ComparisonReport {
  generatedAt: string;
  period: { start: string; end: string };
  runs: EvaluationRun[];
  comparisons: StrategyComparison[];
  bestStrategy: string;
  systemBeatsBestBaseline: boolean;
  systemPValue: number | null;
}

// ---------------------------------------------------------------------------
// Ablation Types
// ---------------------------------------------------------------------------

export type AblationTarget =
  | 'kalman'
  | 'hmm'
  | 'hawkes'
  | 'bandit'
  | 'rmt'
  | 'truthDiscovery'
  | 'transferEntropy'
  | 'conviction';

export interface AblationConfig {
  label: string;
  disabledModels: AblationTarget[];
}

export interface AblationResult {
  config: AblationConfig;
  run: EvaluationRun;
}

export interface AblationReport {
  generatedAt: string;
  period: { start: string; end: string };
  fullSystemRun: EvaluationRun;
  ablations: AblationResult[];
  /** Marginal contribution of each model: fullSystem - ablatedWithout */
  contributions: { model: AblationTarget; hitRateDelta: number; avgReturnDelta: number; sharpeDelta: number }[];
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

export interface CalibrationBucket {
  convictionRange: { min: number; max: number };
  count: number;
  actualHitRate: number;
  expectedHitRate: number; // midpoint of range / 100
  avgReturnPct: number;
  bias: number; // actual - expected
}

export interface CalibrationReport {
  generatedAt: string;
  period: { start: string; end: string };
  buckets: CalibrationBucket[];
  overallBias: number;
  brierScore: number; // mean squared calibration error
}
