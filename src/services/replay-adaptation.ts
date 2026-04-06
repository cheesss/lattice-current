import type {
  ForwardReturnRecord,
  HistoricalReplayRun,
} from './historical-intelligence';
import { getPersistentCache, setPersistentCache } from './persistent-cache';
import {
  getCoveragePenaltyForTheme,
  mergeCoverageLedgerSnapshots,
  type CoverageLedgerSnapshot,
} from './coverage-ledger';

export type ReplayWorkflowStatus = 'ready' | 'watch' | 'blocked';

export interface ReplayWorkflowStep {
  id: string;
  label: string;
  status: ReplayWorkflowStatus;
  metric: number;
  summary: string;
}

export interface ReplayThemeHorizonMetric {
  horizonHours: number;
  sampleSize: number;
  hitRate: number;
  rawAvgReturnPct: number;
  costAdjustedAvgReturnPct: number;
  avgRealityScore: number;
  avgExecutionPenaltyPct: number;
  tradableRate: number;
  uniqueSymbolCount: number;
  utilityScore: number;
}

export interface ReplayThemeRegimeProfile {
  regimeId: string;
  sampleSize: number;
  hitRate: number;
  costAdjustedAvgReturnPct: number;
  confirmationScore: number;
  utilityScore: number;
}

export interface CurrentThemePerformanceMetric {
  themeId: string;
  activeCount: number;
  closedCount: number;
  hitRate: number;
  avgReturnPct: number;
  confirmationScore: number;
  updatedAt: string;
}

export interface ReplayThemeProfile {
  themeId: string;
  preferredHorizonHours: number;
  candidateHorizonHours: number[];
  timeframe: string;
  confidence: number;
  weightedSampleSize: number;
  hitRate: number;
  rawAvgReturnPct: number;
  costAdjustedAvgReturnPct: number;
  avgRealityScore: number;
  avgExecutionPenaltyPct: number;
  tradableRate: number;
  utilityScore: number;
  regimeMetrics: ReplayThemeRegimeProfile[];
  confirmationReliability: number;
  coverageAdjustedUtility: number;
  robustUtility: number;
  windowMedianUtility: number;
  windowUtilityStd: number;
  windowFlipRate: number;
  currentVsReplayDrift: number;
  horizonMetrics: ReplayThemeHorizonMetric[];
  updatedAt: string;
}

export interface ReplayWorkflowPerformance {
  updatedAt: string;
  runCount: number;
  themeCount: number;
  uniqueSymbolCount: number;
  frameCount: number;
  evaluationFrameCount: number;
  ideaRunCount: number;
  forwardReturnCount: number;
  costAdjustedHitRate: number;
  costAdjustedAvgReturnPct: number;
  avgRealityScore: number;
  avgExecutionPenaltyPct: number;
  nonTradableRate: number;
  coverageScore: number;
  qualityScore: number;
  executionScore: number;
  activityScore: number;
}

export interface PortfolioAccountingSummary {
  source: 'run' | 'inferred' | 'aggregated' | 'missing';
  available: boolean;
  weightedReturnPct: number | null;
  navStart: number | null;
  navEnd: number | null;
  navChangePct: number | null;
  cagrPct: number | null;
  maxDrawdownPct: number | null;
  sharpe: number | null;
  annualizedVolatilityPct: number | null;
  sampleCount: number;
  tradeCount: number;
  curvePointCount: number;
}

export interface ReplayRunDigestThemeMetric {
  themeId: string;
  horizonHours: number;
  sampleSize: number;
  hitRate: number;
  rawAvgReturnPct: number;
  costAdjustedAvgReturnPct: number;
  avgRealityScore: number;
  avgExecutionPenaltyPct: number;
  tradableRate: number;
  uniqueSymbolCount: number;
}

export interface ReplayRunDigest {
  id: string;
  label: string;
  mode: 'replay' | 'walk-forward';
  completedAt: string;
  frameCount: number;
  evaluationFrameCount: number;
  ideaRunCount: number;
  forwardReturnCount: number;
  uniqueThemeCount: number;
  uniqueSymbolCount: number;
  costAdjustedHitRate: number;
  costAdjustedAvgReturnPct: number;
  avgRealityScore: number;
  avgExecutionPenaltyPct: number;
  nonTradableRate: number;
  portfolio: PortfolioAccountingSummary | null;
  themeMetrics: ReplayRunDigestThemeMetric[];
  themeRegimeMetrics?: HistoricalReplayRun['themeRegimeMetrics'];
  coverageLedger?: CoverageLedgerSnapshot | null;
}

export interface ReplayAdaptationSnapshot {
  updatedAt: string;
  recentRuns: ReplayRunDigest[];
  themeProfiles: ReplayThemeProfile[];
  currentThemePerformance: CurrentThemePerformanceMetric[];
  coverageLedger: CoverageLedgerSnapshot | null;
  workflow: ReplayWorkflowPerformance;
}

export type BacktestOpsRunMode = 'replay' | 'walk-forward' | 'current-like';

export type BacktestOpsBadgeState = 'ready' | 'watch' | 'blocked' | 'degraded';

export interface BacktestOpsRunSummary {
  id: string;
  label: string;
  mode: BacktestOpsRunMode;
  phase: 'completed' | 'snapshot';
  status: BacktestOpsBadgeState;
  progressPct: number;
  frameCount: number;
  warmupFrameCount: number;
  evaluationFrameCount: number;
  ideaRunCount: number;
  forwardReturnCount: number;
  costAdjustedHitRate: number;
  costAdjustedAvgReturnPct: number;
  avgRealityScore: number;
  avgExecutionPenaltyPct: number;
  nonTradableRate: number;
  portfolio: PortfolioAccountingSummary | null;
  coverageScore: number;
  qualityScore: number;
  executionScore: number;
  activityScore: number;
  confirmationReliability: number;
  currentVsReplayDrift: number;
  preferredHorizonHours: number | null;
  themeHorizonHours: number[];
  themeCount: number;
  uniqueSymbolCount: number;
  updatedAt: string;
  note?: string;
}

export interface BacktestOpsSnapshot {
  updatedAt: string;
  latestReplay: BacktestOpsRunSummary | null;
  latestWalkForward: BacktestOpsRunSummary | null;
  currentLike: BacktestOpsRunSummary | null;
  recentRuns: BacktestOpsRunSummary[];
  workflow: ReplayWorkflowPerformance;
  coverageLedger: CoverageLedgerSnapshot | null;
  themeProfiles: ReplayThemeProfile[];
  currentThemePerformance: CurrentThemePerformanceMetric[];
  portfolio: PortfolioAccountingSummary | null;
  derived: {
    qualityScore: number;
    executionScore: number;
    activityScore: number;
    coverageScore: number;
    driftScore: number;
    readinessScore: number;
  };
  badges: {
    quality: BacktestOpsBadgeState;
    execution: BacktestOpsBadgeState;
    activity: BacktestOpsBadgeState;
    coverage: BacktestOpsBadgeState;
    drift: BacktestOpsBadgeState;
  };
}

interface PersistedReplayAdaptationStore {
  snapshot: ReplayAdaptationSnapshot | null;
}

const REPLAY_ADAPTATION_KEY = 'replay-adaptation:v1';
const MAX_REPLAY_DIGESTS = 36;
const RUN_HALF_LIFE_DAYS = 45;
const HORIZON_BAR_MULTIPLIERS = [1, 2, 3, 5, 8, 13, 21];

let loaded = false;
let currentSnapshot: ReplayAdaptationSnapshot | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function asTs(value: string | null | undefined): number {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeThemeId(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readNumberFromKeys(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = Number(source[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function readFirstRecord(source: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const candidate = source[key];
    if (isRecord(candidate)) return candidate;
  }
  return null;
}

function collectCurvePoints(source: Record<string, unknown>): Array<{ timestamp: string; nav: number }> {
  const curveKeys = ['equityCurve', 'navCurve', 'portfolioCurve', 'curve', 'series'];
  for (const key of curveKeys) {
    const candidate = source[key];
    if (!Array.isArray(candidate)) continue;
    const points = candidate
      .map((item) => {
        if (!isRecord(item)) return null;
        const timestamp = String(item.timestamp || item.time || item.at || item.date || '').trim();
        const nav = readNumberFromKeys(item, ['nav', 'equity', 'value', 'portfolioValue', 'capital']);
        if (!timestamp || nav == null || !Number.isFinite(nav) || nav <= 0) return null;
        return { timestamp, nav };
      })
      .filter((point): point is { timestamp: string; nav: number } => Boolean(point))
      .sort((left, right) => asTs(left.timestamp) - asTs(right.timestamp));
    if (points.length > 0) return points;
  }
  return [];
}

function buildPortfolioMetricsFromCurve(points: Array<{ timestamp: string; nav: number }>): Omit<PortfolioAccountingSummary, 'source' | 'available'> | null {
  if (!points.length) return null;
  const normalized = points
    .slice()
    .filter((point) => point.nav > 0 && Number.isFinite(point.nav))
    .sort((left, right) => asTs(left.timestamp) - asTs(right.timestamp));
  if (!normalized.length) return null;

  const startNav = normalized[0]!.nav;
  const endNav = normalized[normalized.length - 1]!.nav;
  const navChangePct = startNav > 0 ? ((endNav - startNav) / startNav) * 100 : null;

  let peak = startNav;
  let maxDrawdownPct = 0;
  for (const point of normalized) {
    peak = Math.max(peak, point.nav);
    if (peak > 0) {
      const drawdownPct = ((point.nav - peak) / peak) * 100;
      maxDrawdownPct = Math.min(maxDrawdownPct, drawdownPct);
    }
  }

  const firstTs = asTs(normalized[0]!.timestamp);
  const lastTs = asTs(normalized[normalized.length - 1]!.timestamp);
  const durationDays = Math.max(1, (lastTs - firstTs) / 86_400_000);
  const cagrPct = startNav > 0 && endNav > 0
    ? (Math.pow(endNav / startNav, 365 / durationDays) - 1) * 100
    : null;
  const returns: number[] = [];
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1]!;
    const current = normalized[index]!;
    if (previous.nav > 0 && current.nav > 0) {
      returns.push((current.nav / previous.nav) - 1);
    }
  }
  const averageSpacingDays = normalized.length > 1
    ? Math.max(1 / 24, (lastTs - firstTs) / Math.max(1, normalized.length - 1) / 86_400_000)
    : 1;
  const periodsPerYear = clamp(365 / averageSpacingDays, 1, 365);
  const meanReturn = returns.length > 0 ? average(returns) : 0;
  const stdReturn = returns.length > 1
    ? Math.sqrt(average(returns.map((value) => (value - meanReturn) ** 2)))
    : 0;
  const sharpe = stdReturn > 0 ? (meanReturn / stdReturn) * Math.sqrt(periodsPerYear) : null;
  const annualizedVolatilityPct = stdReturn > 0 ? stdReturn * Math.sqrt(periodsPerYear) * 100 : null;

  return {
    weightedReturnPct: navChangePct,
    navStart: startNav,
    navEnd: endNav,
    navChangePct,
    cagrPct,
    maxDrawdownPct,
    sharpe,
    annualizedVolatilityPct,
    sampleCount: normalized.length,
    tradeCount: normalized.length,
    curvePointCount: normalized.length,
  };
}

function normalizePortfolioAccountingSummary(
  value: Partial<PortfolioAccountingSummary> & { source?: PortfolioAccountingSummary['source'] } | null | undefined,
): PortfolioAccountingSummary | null {
  if (!value) return null;
  const weightedReturnPct = Number.isFinite(Number(value.weightedReturnPct)) ? Number(value.weightedReturnPct) : null;
  const navStart = Number.isFinite(Number(value.navStart)) ? Number(value.navStart) : null;
  const navEnd = Number.isFinite(Number(value.navEnd)) ? Number(value.navEnd) : null;
  const navChangePct = Number.isFinite(Number(value.navChangePct))
    ? Number(value.navChangePct)
    : navStart != null && navEnd != null && navStart !== 0
      ? ((navEnd - navStart) / navStart) * 100
      : null;
  const cagrPct = Number.isFinite(Number(value.cagrPct)) ? Number(value.cagrPct) : null;
  const maxDrawdownPct = Number.isFinite(Number(value.maxDrawdownPct)) ? Number(value.maxDrawdownPct) : null;
  const sharpe = Number.isFinite(Number(value.sharpe)) ? Number(value.sharpe) : null;
  const annualizedVolatilityPct = Number.isFinite(Number(value.annualizedVolatilityPct))
    ? Number(value.annualizedVolatilityPct)
    : null;

  return {
    source: value.source || 'missing',
    available: value.source !== 'missing' && (
      weightedReturnPct != null
      || navStart != null
      || navEnd != null
      || navChangePct != null
      || cagrPct != null
      || maxDrawdownPct != null
      || sharpe != null
      || annualizedVolatilityPct != null
    ),
    weightedReturnPct,
    navStart,
    navEnd,
    navChangePct,
    cagrPct,
    maxDrawdownPct,
    sharpe,
    annualizedVolatilityPct,
    sampleCount: Math.max(0, Math.round(Number(value.sampleCount) || 0)),
    tradeCount: Math.max(0, Math.round(Number(value.tradeCount) || 0)),
    curvePointCount: Math.max(0, Math.round(Number(value.curvePointCount) || 0)),
  };
}

function readPortfolioAccountingSource(run: HistoricalReplayRun): Record<string, unknown> | null {
  const source: Record<string, unknown> = { ...run };
  const candidates = [
    source.portfolioAccounting,
    source.portfolioMetrics,
    source.portfolioSummary,
    source.portfolio,
    source.portfolioPerformance,
    source.accounting,
  ];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const nested = readFirstRecord(candidate, ['summary', 'metrics', 'accounting']);
    return nested || candidate;
  }
  return null;
}

function summarizePortfolioAccountingSnapshot(
  snapshot: HistoricalReplayRun['portfolioAccounting'],
): PortfolioAccountingSummary | null {
  if (!snapshot) return null;
  const summary = snapshot.summary;
  const curveMetrics = buildPortfolioMetricsFromCurve(Array.isArray(snapshot.equityCurve)
    ? snapshot.equityCurve
      .map((point) => ({
        timestamp: String(point.timestamp || '').trim(),
        nav: Number(point.nav) || 0,
      }))
      .filter((point) => Boolean(point.timestamp) && point.nav > 0)
    : []);
  return normalizePortfolioAccountingSummary({
    source: 'run',
    weightedReturnPct: Number.isFinite(Number(summary.weightedCostAdjustedReturnPct))
      ? Number(summary.weightedCostAdjustedReturnPct)
      : Number.isFinite(Number(summary.weightedReturnPct))
        ? Number(summary.weightedReturnPct)
        : null,
    navStart: Number.isFinite(Number(summary.initialCapital))
      ? Number(summary.initialCapital)
      : curveMetrics?.navStart ?? null,
    navEnd: Number.isFinite(Number(summary.finalCapital))
      ? Number(summary.finalCapital)
      : curveMetrics?.navEnd ?? null,
    navChangePct: Number.isFinite(Number(summary.totalReturnPct))
      ? Number(summary.totalReturnPct)
      : curveMetrics?.navChangePct ?? null,
    cagrPct: Number.isFinite(Number(summary.cagrPct))
      ? Number(summary.cagrPct)
      : curveMetrics?.cagrPct ?? null,
    maxDrawdownPct: Number.isFinite(Number(summary.maxDrawdownPct))
      ? Number(summary.maxDrawdownPct)
      : curveMetrics?.maxDrawdownPct ?? null,
    sharpe: Number.isFinite(Number(summary.sharpeRatio))
      ? Number(summary.sharpeRatio)
      : curveMetrics?.sharpe ?? null,
    annualizedVolatilityPct: Number.isFinite(Number(summary.volatilityPct))
      ? Number(summary.volatilityPct)
      : curveMetrics?.annualizedVolatilityPct ?? null,
    sampleCount: Math.max(0, Math.round(Number(summary.selectedTradeCount ?? summary.tradeCount) || 0)),
    tradeCount: Math.max(0, Math.round(Number(summary.tradeCount) || 0)),
    curvePointCount: Array.isArray(snapshot.equityCurve) ? snapshot.equityCurve.length : curveMetrics?.curvePointCount ?? 0,
  });
}

function summarizeHistoricalRunPortfolioAccounting(run: HistoricalReplayRun): PortfolioAccountingSummary | null {
  const direct = summarizePortfolioAccountingSnapshot(run.portfolioAccounting);
  if (direct) return direct;

  const source = readPortfolioAccountingSource(run);
  if (!source) return null;

  const summary = readFirstRecord(source, ['summary', 'metrics', 'accounting']) || source;
  const curvePoints = collectCurvePoints(source);
  const curveMetrics = buildPortfolioMetricsFromCurve(curvePoints);
  return normalizePortfolioAccountingSummary({
    source: curveMetrics ? 'inferred' : 'missing',
    weightedReturnPct: readNumberFromKeys(summary, [
      'weightedReturnPct',
      'weightedCostAdjustedReturnPct',
      'weightedCostAdjustedSignedReturnPct',
      'weightedReturn',
      'weightedSignedReturnPct',
    ]) ?? null,
    navStart: readNumberFromKeys(summary, ['navStart', 'initialCapital', 'capitalStart']) ?? curveMetrics?.navStart ?? null,
    navEnd: readNumberFromKeys(summary, ['navEnd', 'finalCapital', 'capitalEnd']) ?? curveMetrics?.navEnd ?? null,
    navChangePct: readNumberFromKeys(summary, ['navChangePct', 'totalReturnPct', 'returnPct']) ?? curveMetrics?.navChangePct ?? null,
    cagrPct: readNumberFromKeys(summary, ['cagrPct']) ?? curveMetrics?.cagrPct ?? null,
    maxDrawdownPct: readNumberFromKeys(summary, ['maxDrawdownPct']) ?? curveMetrics?.maxDrawdownPct ?? null,
    sharpe: readNumberFromKeys(summary, ['sharpe', 'sharpeRatio']) ?? curveMetrics?.sharpe ?? null,
    annualizedVolatilityPct: readNumberFromKeys(summary, ['annualizedVolatilityPct', 'volatilityPct']) ?? curveMetrics?.annualizedVolatilityPct ?? null,
    sampleCount: Math.max(
      0,
      Math.round(
        readNumberFromKeys(summary, ['sampleCount', 'selectedTradeCount', 'tradeCount', 'ideaRunCount'])
        ?? curveMetrics?.sampleCount
        ?? 0,
      ),
    ),
    tradeCount: Math.max(
      0,
      Math.round(
        readNumberFromKeys(summary, ['tradeCount', 'selectedTradeCount', 'ideaRunCount'])
        ?? curveMetrics?.tradeCount
        ?? 0,
      ),
    ),
    curvePointCount: Math.max(0, Math.round(curvePoints.length || curveMetrics?.curvePointCount || 0)),
  });
}

function pickAvailablePortfolioSummary(
  ...summaries: Array<PortfolioAccountingSummary | null | undefined>
): PortfolioAccountingSummary | null {
  for (const summary of summaries) {
    if (summary?.available) return summary;
  }
  return null;
}

function describeHours(hours: number): string {
  if (hours >= 24 * 7 && hours % (24 * 7) === 0) return `${Math.round(hours / (24 * 7))}w`;
  if (hours >= 24 && hours % 24 === 0) return `${Math.round(hours / 24)}d`;
  return `${hours}h`;
}

export function formatLearnedTimeframe(hours: number[]): string {
  const sorted = Array.from(new Set((hours || []).map((value) => Math.max(1, Math.round(value)))))
    .sort((a, b) => a - b);
  if (!sorted.length) return '1d-7d';
  if (sorted.length === 1) return describeHours(sorted[0]!);
  return `${describeHours(sorted[0]!)}-${describeHours(sorted[sorted.length - 1]!)}`;
}

export function parseThemeTimeframeCandidates(timeframe: string | null | undefined): number[] {
  const raw = String(timeframe || '').trim().toLowerCase();
  if (!raw) return [];
  const matches = Array.from(raw.matchAll(/(\d+)\s*([hdw])/g));
  if (!matches.length) return [];
  const hours = matches
    .map((match) => {
      const magnitude = Math.max(1, Math.round(Number(match[1] || 0)));
      const unit = match[2] || 'h';
      if (unit === 'w') return magnitude * 24 * 7;
      if (unit === 'd') return magnitude * 24;
      return magnitude;
    })
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!hours.length) return [];
  if (hours.length === 1) return [hours[0]!];
  const minHours = hours[0]!;
  const maxHours = hours[hours.length - 1]!;
  const geometricMid = Math.round(Math.sqrt(minHours * maxHours));
  return Array.from(new Set([minHours, geometricMid, maxHours])).sort((a, b) => a - b);
}

export function deriveIntervalHorizonCandidates(intervalHours: number): number[] {
  const safeInterval = clamp(Math.round(intervalHours || 24), 1, 24 * 30);
  return Array.from(new Set(
    HORIZON_BAR_MULTIPLIERS
      .map((multiplier) => Math.round(safeInterval * multiplier))
      .filter((value) => value >= safeInterval),
  )).sort((a, b) => a - b);
}

function decayWeight(timestamp: string, asOfTs: number): number {
  const ageMs = Math.max(0, asOfTs - asTs(timestamp));
  const ageDays = ageMs / 86_400_000;
  return Math.exp(-Math.log(2) * ageDays / RUN_HALF_LIFE_DAYS);
}

function softmax(values: number[], temperature = 6): number[] {
  if (!values.length) return [];
  const safeTemperature = Math.max(0.1, temperature);
  const maxValue = Math.max(...values);
  const exps = values.map((value) => Math.exp((value - maxValue) / safeTemperature));
  const total = exps.reduce((sum, value) => sum + value, 0) || 1;
  return exps.map((value) => value / total);
}

function computeThemeMetricUtility(metric: ReplayRunDigestThemeMetric): number {
  const confidenceWeight = 1 - Math.exp(-Math.max(0, metric.sampleSize || 0) / 24);
  return (
    (
      (Number(metric.costAdjustedAvgReturnPct) || 0) * 18
      + ((Number(metric.hitRate) || 0) - 50) * 0.6
      + ((Number(metric.avgRealityScore) || 0) - 50) * 0.12
      + ((Number(metric.tradableRate) || 0) - 50) * 0.08
      - (Number(metric.avgExecutionPenaltyPct) || 0) * 0.45
    ) * confidenceWeight
  );
}

function weightedMedian(values: number[], weights: number[]): number {
  if (!values.length || !weights.length || values.length !== weights.length) return 0;
  const pairs = values
    .map((value, index) => ({
      value: Number(value) || 0,
      weight: Math.max(0, Number(weights[index]) || 0),
    }))
    .filter((pair) => pair.weight > 0)
    .sort((left, right) => left.value - right.value);
  if (!pairs.length) return 0;
  const totalWeight = pairs.reduce((sum, pair) => sum + pair.weight, 0);
  let cumulativeWeight = 0;
  for (const pair of pairs) {
    cumulativeWeight += pair.weight;
    if (cumulativeWeight >= totalWeight / 2) return pair.value;
  }
  return pairs[pairs.length - 1]?.value || 0;
}

function weightedStdDev(values: number[], weights: number[]): number {
  if (!values.length || !weights.length || values.length !== weights.length) return 0;
  const mean = weightedAverageByCount(
    values.map((value, index) => ({ value, weight: weights[index] || 0 })),
    (item) => item.value,
    (item) => item.weight,
  );
  const variance = weightedAverageByCount(
    values.map((value, index) => ({ value, weight: weights[index] || 0 })),
    (item) => {
      const delta = item.value - mean;
      return delta * delta;
    },
    (item) => item.weight,
  );
  return Math.sqrt(Math.max(0, variance));
}

function normalizeThemeMetric(metric: ReplayRunDigestThemeMetric): ReplayRunDigestThemeMetric {
  return {
    themeId: normalizeThemeId(metric.themeId),
    horizonHours: Math.max(1, Math.round(Number(metric.horizonHours) || 24)),
    sampleSize: Math.max(0, Math.round(Number(metric.sampleSize) || 0)),
    hitRate: clamp(Number(metric.hitRate) || 0, 0, 100),
    rawAvgReturnPct: Number(metric.rawAvgReturnPct) || 0,
    costAdjustedAvgReturnPct: Number(metric.costAdjustedAvgReturnPct) || 0,
    avgRealityScore: clamp(Number(metric.avgRealityScore) || 0, 0, 100),
    avgExecutionPenaltyPct: Math.max(0, Number(metric.avgExecutionPenaltyPct) || 0),
    tradableRate: clamp(Number(metric.tradableRate) || 0, 0, 100),
    uniqueSymbolCount: Math.max(0, Math.round(Number(metric.uniqueSymbolCount) || 0)),
  };
}

function normalizeReplayRunDigest(digest: ReplayRunDigest): ReplayRunDigest {
  return {
    ...digest,
    completedAt: digest.completedAt || nowIso(),
    frameCount: Math.max(0, Math.round(Number(digest.frameCount) || 0)),
    evaluationFrameCount: Math.max(0, Math.round(Number(digest.evaluationFrameCount) || 0)),
    ideaRunCount: Math.max(0, Math.round(Number(digest.ideaRunCount) || 0)),
    forwardReturnCount: Math.max(0, Math.round(Number(digest.forwardReturnCount) || 0)),
    uniqueThemeCount: Math.max(0, Math.round(Number(digest.uniqueThemeCount) || 0)),
    uniqueSymbolCount: Math.max(0, Math.round(Number(digest.uniqueSymbolCount) || 0)),
    costAdjustedHitRate: clamp(Number(digest.costAdjustedHitRate) || 0, 0, 100),
    costAdjustedAvgReturnPct: Number(digest.costAdjustedAvgReturnPct) || 0,
    avgRealityScore: clamp(Number(digest.avgRealityScore) || 0, 0, 100),
    avgExecutionPenaltyPct: Math.max(0, Number(digest.avgExecutionPenaltyPct) || 0),
    nonTradableRate: clamp(Number(digest.nonTradableRate) || 0, 0, 100),
    themeMetrics: Array.isArray(digest.themeMetrics)
      ? digest.themeMetrics.map((metric) => normalizeThemeMetric(metric))
      : [],
    themeRegimeMetrics: Array.isArray(digest.themeRegimeMetrics)
      ? digest.themeRegimeMetrics.map((metric) => ({
        themeId: normalizeThemeId(metric?.themeId || ''),
        regimeId: String(metric?.regimeId || 'unknown').trim() || 'unknown',
        sampleSize: Math.max(0, Math.round(Number(metric?.sampleSize) || 0)),
        hitRate: clamp(Number(metric?.hitRate) || 0, 0, 100),
        costAdjustedAvgReturnPct: Number(metric?.costAdjustedAvgReturnPct) || 0,
        confirmationScore: clamp(Number(metric?.confirmationScore) || 0, 0, 100),
      }))
      : [],
    portfolio: normalizePortfolioAccountingSummary(digest.portfolio),
    coverageLedger: digest.coverageLedger || null,
  };
}

function normalizeThemeProfile(profile: ReplayThemeProfile): ReplayThemeProfile {
  return {
    ...profile,
    themeId: normalizeThemeId(profile.themeId),
    preferredHorizonHours: Math.max(1, Math.round(Number(profile.preferredHorizonHours) || 24)),
    candidateHorizonHours: Array.from(new Set(
      (profile.candidateHorizonHours || [])
        .map((value) => Math.max(1, Math.round(Number(value) || 0)))
        .filter(Boolean),
    )).sort((a, b) => a - b),
    timeframe: String(profile.timeframe || '').trim() || formatLearnedTimeframe([profile.preferredHorizonHours || 24]),
    confidence: clamp(Math.round(Number(profile.confidence) || 0), 0, 99),
    weightedSampleSize: Math.max(0, Number(profile.weightedSampleSize) || 0),
    hitRate: clamp(Number(profile.hitRate) || 0, 0, 100),
    rawAvgReturnPct: Number(profile.rawAvgReturnPct) || 0,
    costAdjustedAvgReturnPct: Number(profile.costAdjustedAvgReturnPct) || 0,
    avgRealityScore: clamp(Number(profile.avgRealityScore) || 0, 0, 100),
    avgExecutionPenaltyPct: Math.max(0, Number(profile.avgExecutionPenaltyPct) || 0),
    tradableRate: clamp(Number(profile.tradableRate) || 0, 0, 100),
    utilityScore: Number(profile.utilityScore) || 0,
    regimeMetrics: Array.isArray(profile.regimeMetrics)
      ? profile.regimeMetrics.map((metric) => ({
        regimeId: String(metric.regimeId || 'unknown').trim() || 'unknown',
        sampleSize: Math.max(0, Math.round(Number(metric.sampleSize) || 0)),
        hitRate: clamp(Number(metric.hitRate) || 0, 0, 100),
        costAdjustedAvgReturnPct: Number(metric.costAdjustedAvgReturnPct) || 0,
        confirmationScore: clamp(Number(metric.confirmationScore) || 0, 0, 100),
        utilityScore: Number(metric.utilityScore) || 0,
      }))
      : [],
    confirmationReliability: clamp(Number(profile.confirmationReliability) || 0, 0, 99),
    coverageAdjustedUtility: Number(profile.coverageAdjustedUtility) || 0,
    robustUtility: Number(profile.robustUtility) || 0,
    windowMedianUtility: Number(profile.windowMedianUtility) || 0,
    windowUtilityStd: Math.max(0, Number(profile.windowUtilityStd) || 0),
    windowFlipRate: clamp(Number(profile.windowFlipRate) || 0, 0, 1),
    currentVsReplayDrift: Number(profile.currentVsReplayDrift) || 0,
    horizonMetrics: Array.isArray(profile.horizonMetrics)
      ? profile.horizonMetrics.map((metric) => ({
        ...metric,
        horizonHours: Math.max(1, Math.round(Number(metric.horizonHours) || 24)),
        sampleSize: Math.max(0, Math.round(Number(metric.sampleSize) || 0)),
        hitRate: clamp(Number(metric.hitRate) || 0, 0, 100),
        rawAvgReturnPct: Number(metric.rawAvgReturnPct) || 0,
        costAdjustedAvgReturnPct: Number(metric.costAdjustedAvgReturnPct) || 0,
        avgRealityScore: clamp(Number(metric.avgRealityScore) || 0, 0, 100),
        avgExecutionPenaltyPct: Math.max(0, Number(metric.avgExecutionPenaltyPct) || 0),
        tradableRate: clamp(Number(metric.tradableRate) || 0, 0, 100),
        uniqueSymbolCount: Math.max(0, Math.round(Number(metric.uniqueSymbolCount) || 0)),
        utilityScore: Number(metric.utilityScore) || 0,
      }))
      : [],
    updatedAt: profile.updatedAt || nowIso(),
  };
}

function normalizeCurrentThemePerformanceMetric(metric: CurrentThemePerformanceMetric): CurrentThemePerformanceMetric {
  return {
    themeId: normalizeThemeId(metric.themeId),
    activeCount: Math.max(0, Math.round(Number(metric.activeCount) || 0)),
    closedCount: Math.max(0, Math.round(Number(metric.closedCount) || 0)),
    hitRate: clamp(Number(metric.hitRate) || 0, 0, 100),
    avgReturnPct: Number(metric.avgReturnPct) || 0,
    confirmationScore: clamp(Number(metric.confirmationScore) || 0, 0, 100),
    updatedAt: metric.updatedAt || nowIso(),
  };
}

function normalizeReplayWorkflowPerformance(workflow: ReplayWorkflowPerformance | null | undefined): ReplayWorkflowPerformance {
  return {
    updatedAt: workflow?.updatedAt || nowIso(),
    runCount: Math.max(0, Math.round(Number(workflow?.runCount) || 0)),
    themeCount: Math.max(0, Math.round(Number(workflow?.themeCount) || 0)),
    uniqueSymbolCount: Math.max(0, Math.round(Number(workflow?.uniqueSymbolCount) || 0)),
    frameCount: Math.max(0, Math.round(Number(workflow?.frameCount) || 0)),
    evaluationFrameCount: Math.max(0, Math.round(Number(workflow?.evaluationFrameCount) || 0)),
    ideaRunCount: Math.max(0, Math.round(Number(workflow?.ideaRunCount) || 0)),
    forwardReturnCount: Math.max(0, Math.round(Number(workflow?.forwardReturnCount) || 0)),
    costAdjustedHitRate: clamp(Number(workflow?.costAdjustedHitRate) || 0, 0, 100),
    costAdjustedAvgReturnPct: Number(workflow?.costAdjustedAvgReturnPct) || 0,
    avgRealityScore: clamp(Number(workflow?.avgRealityScore) || 0, 0, 100),
    avgExecutionPenaltyPct: Math.max(0, Number(workflow?.avgExecutionPenaltyPct) || 0),
    nonTradableRate: clamp(Number(workflow?.nonTradableRate) || 0, 0, 100),
    coverageScore: clamp(Math.round(Number(workflow?.coverageScore) || 0), 0, 100),
    qualityScore: clamp(Math.round(Number(workflow?.qualityScore) || 0), 0, 100),
    executionScore: clamp(Math.round(Number(workflow?.executionScore) || 0), 0, 100),
    activityScore: clamp(Math.round(Number(workflow?.activityScore) || 0), 0, 100),
  };
}

function mergeUniqueHours(values: Array<number | null | undefined>): number[] {
  return Array.from(new Set(
    values
      .map((value) => Math.max(1, Math.round(Number(value) || 0)))
      .filter((value) => Number.isFinite(value) && value > 0),
  )).sort((a, b) => a - b);
}

function backtestOpsStatusFromScore(score: number): BacktestOpsBadgeState {
  if (score >= 45) return 'ready';
  if (score >= 25) return 'watch';
  return 'blocked';
}

function deriveBadgeStateFromSummary(summary: BacktestOpsRunSummary): BacktestOpsBadgeState {
  if (summary.frameCount <= 0 || summary.evaluationFrameCount <= 0) return 'blocked';
  if (summary.nonTradableRate >= 80 || summary.qualityScore < 10) return 'degraded';
  if (summary.costAdjustedAvgReturnPct >= 0 && summary.executionScore >= 35 && summary.qualityScore >= 30) return 'ready';
  if (summary.qualityScore >= 20 || summary.executionScore >= 25) return 'watch';
  return 'degraded';
}

function weightedAverageByCount<T>(items: T[], valueFor: (item: T) => number, weightFor: (item: T) => number): number {
  let weightSum = 0;
  let weightedValue = 0;
  for (const item of items) {
    const weight = Math.max(0, Number(weightFor(item)) || 0);
    if (weight <= 0) continue;
    weightSum += weight;
    weightedValue += weight * (Number(valueFor(item)) || 0);
  }
  if (weightSum <= 0) return 0;
  return weightedValue / weightSum;
}

function summarizeThemeHours(
  run: HistoricalReplayRun,
  adaptationSnapshot: ReplayAdaptationSnapshot | null,
): number[] {
  const runThemeIds = new Set(
    (run.ideaRuns || [])
      .map((ideaRun) => normalizeThemeId(ideaRun.themeId))
      .filter(Boolean),
  );
  const matchingProfiles = (adaptationSnapshot?.themeProfiles || [])
    .filter((profile) => runThemeIds.size === 0 || runThemeIds.has(normalizeThemeId(profile.themeId)))
    .sort((left, right) => right.coverageAdjustedUtility - left.coverageAdjustedUtility || right.robustUtility - left.robustUtility || right.weightedSampleSize - left.weightedSampleSize)
    .slice(0, 5);
  const hours = matchingProfiles.flatMap((profile) => [
    profile.preferredHorizonHours,
    ...(profile.candidateHorizonHours || []),
  ]);
  if (hours.length > 0) return mergeUniqueHours(hours);
  return mergeUniqueHours(
    (run.themeHorizonProfiles || []).flatMap((profile) => [
      profile.preferredHorizonHours,
      ...(profile.candidateHorizonHours || []),
    ]),
  );
}

function summarizeCurrentVsReplayDrift(
  run: HistoricalReplayRun,
  adaptationSnapshot: ReplayAdaptationSnapshot | null,
): number {
  const runThemeIds = new Set(
    (run.ideaRuns || [])
      .map((ideaRun) => normalizeThemeId(ideaRun.themeId))
      .filter(Boolean),
  );
  const matchingProfiles = (adaptationSnapshot?.themeProfiles || [])
    .filter((profile) => runThemeIds.size === 0 || runThemeIds.has(normalizeThemeId(profile.themeId)));
  if (!matchingProfiles.length) return 0;
  return Number(weightedAverageByCount(
    matchingProfiles,
    (profile) => profile.currentVsReplayDrift,
    (profile) => Math.max(1, profile.weightedSampleSize || 0),
  ).toFixed(2));
}

function summarizeConfirmationReliability(
  run: HistoricalReplayRun,
  adaptationSnapshot: ReplayAdaptationSnapshot | null,
): number {
  const runThemeIds = new Set(
    (run.ideaRuns || [])
      .map((ideaRun) => normalizeThemeId(ideaRun.themeId))
      .filter(Boolean),
  );
  const matchingProfiles = (adaptationSnapshot?.themeProfiles || [])
    .filter((profile) => runThemeIds.size === 0 || runThemeIds.has(normalizeThemeId(profile.themeId)));
  if (!matchingProfiles.length) return 0;
  return clamp(
    Math.round(weightedAverageByCount(
      matchingProfiles,
      (profile) => profile.confirmationReliability,
      (profile) => Math.max(1, profile.weightedSampleSize || 0),
    )),
    0,
    99,
  );
}

function summarizeRunCards(
  run: HistoricalReplayRun,
  adaptationSnapshot: ReplayAdaptationSnapshot | null,
): {
  preferredHorizonHours: number | null;
  themeHorizonHours: number[];
  themeCount: number;
  uniqueSymbolCount: number;
  currentVsReplayDrift: number;
  confirmationReliability: number;
} {
  const themeIds = new Set(
    (run.ideaRuns || [])
      .map((ideaRun) => normalizeThemeId(ideaRun.themeId))
      .filter(Boolean),
  );
  const symbols = new Set(
    (run.ideaRuns || []).flatMap((ideaRun) => (ideaRun.symbols || []).map((symbol) => String(symbol.symbol || '').trim().toUpperCase()).filter(Boolean)),
  );
  const themeProfiles = (adaptationSnapshot?.themeProfiles || [])
    .filter((profile) => themeIds.size === 0 || themeIds.has(normalizeThemeId(profile.themeId)))
    .sort((left, right) => right.coverageAdjustedUtility - left.coverageAdjustedUtility || right.robustUtility - left.robustUtility || right.weightedSampleSize - left.weightedSampleSize);
  const preferredHorizonHours = themeProfiles[0]?.preferredHorizonHours
    ?? run.horizonsHours[0]
    ?? null;
  return {
    preferredHorizonHours: typeof preferredHorizonHours === 'number' ? Math.max(1, Math.round(preferredHorizonHours)) : null,
    themeHorizonHours: summarizeThemeHours(run, adaptationSnapshot),
    themeCount: themeIds.size || (themeProfiles.length > 0 ? themeProfiles.length : 0),
    uniqueSymbolCount: symbols.size,
    currentVsReplayDrift: summarizeCurrentVsReplayDrift(run, adaptationSnapshot),
    confirmationReliability: summarizeConfirmationReliability(run, adaptationSnapshot),
  };
}

export function buildBacktestOpsRunSummary(
  run: HistoricalReplayRun,
  adaptationSnapshot: ReplayAdaptationSnapshot | null,
  modeOverride?: BacktestOpsRunMode,
): BacktestOpsRunSummary {
  const workflow = adaptationSnapshot?.workflow || null;
  const reality = run.realitySummary || {
    primaryHorizonHours: run.horizonsHours[0] || 24,
    rawHitRate: 0,
    costAdjustedHitRate: 0,
    rawAvgReturnPct: 0,
    costAdjustedAvgReturnPct: 0,
    avgExecutionPenaltyPct: 0,
    avgRealityScore: 0,
    nonTradableRate: 100,
  };
  const summarySeed = summarizeRunCards(run, adaptationSnapshot);
  const frameCount = Math.max(0, Math.round(Number(run.frameCount) || 0));
  const evaluationFrameCount = Math.max(0, Math.round(Number(run.evaluationFrameCount) || 0));
  const ideaRunCount = Math.max(0, Math.round((run.ideaRuns || []).length));
  const forwardReturnCount = Math.max(0, Math.round((run.forwardReturns || []).length));
  const mode = modeOverride || run.mode || 'replay';
  const portfolio = summarizeHistoricalRunPortfolioAccounting(run);
  const progressPct = mode === 'current-like'
    ? clamp(Math.round((workflow?.coverageScore || 0) * 0.5 + (workflow?.qualityScore || 0) * 0.3 + (workflow?.executionScore || 0) * 0.2), 0, 100)
    : 100;
  const qualityScore = Math.round(workflow?.qualityScore ?? clamp(
    40
    + (reality.costAdjustedHitRate - 50) * 0.8
    + reality.costAdjustedAvgReturnPct * 16,
    0,
    100,
  ));
  const executionScore = Math.round(workflow?.executionScore ?? clamp(
    reality.avgRealityScore * 0.62
    + (100 - reality.nonTradableRate) * 0.22
    + Math.max(0, 100 - reality.avgExecutionPenaltyPct * 12) * 0.16,
    0,
    100,
  ));
  const activityScore = Math.round(workflow?.activityScore ?? clamp(
    Math.min(100, ((ideaRunCount + forwardReturnCount * 0.15) / Math.max(1, evaluationFrameCount)) * 48),
    0,
    100,
  ));
  const coverageScore = Math.round(workflow?.coverageScore ?? clamp(
    Math.min(100, (
      Math.log1p(summarySeed.themeCount) * 18
      + Math.log1p(summarySeed.uniqueSymbolCount) * 12
      + Math.log1p(Math.max(1, run.frameCount)) * 10
    )),
    0,
    100,
  ));
  const status = mode === 'current-like'
    ? backtestOpsStatusFromScore((coverageScore + qualityScore + executionScore) / 3)
    : deriveBadgeStateFromSummary({
      id: run.id,
      label: run.label,
      mode,
      phase: 'completed',
      status: 'watch',
      progressPct,
      frameCount,
      warmupFrameCount: Math.max(0, Math.round(Number(run.warmupFrameCount) || 0)),
      evaluationFrameCount,
      ideaRunCount,
      forwardReturnCount,
      costAdjustedHitRate: reality.costAdjustedHitRate,
      costAdjustedAvgReturnPct: reality.costAdjustedAvgReturnPct,
      avgRealityScore: reality.avgRealityScore,
      avgExecutionPenaltyPct: reality.avgExecutionPenaltyPct,
      nonTradableRate: reality.nonTradableRate,
      coverageScore,
      qualityScore,
      executionScore,
      activityScore,
      confirmationReliability: summarySeed.confirmationReliability,
      currentVsReplayDrift: summarySeed.currentVsReplayDrift,
      preferredHorizonHours: summarySeed.preferredHorizonHours,
      themeHorizonHours: summarySeed.themeHorizonHours,
      themeCount: summarySeed.themeCount,
      uniqueSymbolCount: summarySeed.uniqueSymbolCount,
      portfolio: portfolio ?? null,
      updatedAt: run.completedAt,
    });
  return {
    id: run.id,
    label: run.label,
    mode,
    phase: mode === 'current-like' ? 'snapshot' : 'completed',
    status,
    progressPct,
    frameCount,
    warmupFrameCount: Math.max(0, Math.round(Number(run.warmupFrameCount) || 0)),
    evaluationFrameCount,
    ideaRunCount,
    forwardReturnCount,
    costAdjustedHitRate: Number((reality.costAdjustedHitRate ?? 0).toFixed(2)),
    costAdjustedAvgReturnPct: Number((reality.costAdjustedAvgReturnPct ?? 0).toFixed(2)),
    avgRealityScore: Number((reality.avgRealityScore ?? 0).toFixed(2)),
    avgExecutionPenaltyPct: Number((reality.avgExecutionPenaltyPct ?? 0).toFixed(2)),
    nonTradableRate: Number((reality.nonTradableRate ?? 0).toFixed(2)),
    coverageScore,
    qualityScore: clamp(qualityScore, 0, 100),
    executionScore: clamp(executionScore, 0, 100),
    activityScore: clamp(activityScore, 0, 100),
    confirmationReliability: summarySeed.confirmationReliability,
    currentVsReplayDrift: summarySeed.currentVsReplayDrift,
    preferredHorizonHours: summarySeed.preferredHorizonHours,
    themeHorizonHours: summarySeed.themeHorizonHours,
    themeCount: summarySeed.themeCount,
    uniqueSymbolCount: summarySeed.uniqueSymbolCount,
    portfolio: portfolio ?? null,
    updatedAt: run.completedAt,
  };
}

function buildCurrentLikeBacktestOpsRunSummary(
  snapshot: ReplayAdaptationSnapshot,
): BacktestOpsRunSummary | null {
  if (!snapshot) return null;
  const workflow = snapshot.workflow;
  const themeProfiles = snapshot.themeProfiles
    .slice()
    .sort((left, right) => right.coverageAdjustedUtility - left.coverageAdjustedUtility || right.robustUtility - left.robustUtility || right.weightedSampleSize - left.weightedSampleSize);
  const primaryProfile = themeProfiles[0] || null;
  const preferredHorizonHours = primaryProfile?.preferredHorizonHours ?? null;
  const themeHorizonHours = mergeUniqueHours(
    themeProfiles.slice(0, 6).flatMap((profile) => [
      profile.preferredHorizonHours,
      ...(profile.candidateHorizonHours || []),
    ]),
  );
  const currentPerformance = snapshot.currentThemePerformance;
  const themeCount = themeProfiles.length;
  const uniqueSymbolCount = snapshot.workflow.uniqueSymbolCount;
  const confirmationReliability = clamp(
    Math.round(weightedAverageByCount(
      themeProfiles,
      (profile) => profile.confirmationReliability,
      (profile) => Math.max(1, profile.weightedSampleSize || 0),
    ) || weightedAverageByCount(
      currentPerformance,
      (metric) => metric.confirmationScore,
      (metric) => Math.max(1, metric.activeCount + metric.closedCount),
    )),
    0,
    99,
  );
  const currentVsReplayDrift = Number(weightedAverageByCount(
    themeProfiles,
    (profile) => profile.currentVsReplayDrift,
    (profile) => Math.max(1, profile.weightedSampleSize || 0),
  ).toFixed(2));
  const portfolio = pickAvailablePortfolioSummary(...snapshot.recentRuns.map((run) => run.portfolio));
  return {
    id: `current-like:${snapshot.updatedAt}`,
    label: 'Current Snapshot',
    mode: 'current-like',
    phase: 'snapshot',
    status: backtestOpsStatusFromScore((workflow.coverageScore + workflow.qualityScore + workflow.executionScore) / 3),
    progressPct: clamp(Math.round((workflow.coverageScore + workflow.qualityScore + workflow.executionScore) / 3), 0, 100),
    frameCount: workflow.frameCount,
    warmupFrameCount: 0,
    evaluationFrameCount: workflow.evaluationFrameCount,
    ideaRunCount: workflow.ideaRunCount,
    forwardReturnCount: workflow.forwardReturnCount,
    costAdjustedHitRate: Number(workflow.costAdjustedHitRate.toFixed(2)),
    costAdjustedAvgReturnPct: Number(workflow.costAdjustedAvgReturnPct.toFixed(2)),
    avgRealityScore: Number(workflow.avgRealityScore.toFixed(2)),
    avgExecutionPenaltyPct: Number(workflow.avgExecutionPenaltyPct.toFixed(2)),
    nonTradableRate: Number(workflow.nonTradableRate.toFixed(2)),
    coverageScore: workflow.coverageScore,
    qualityScore: workflow.qualityScore,
    executionScore: workflow.executionScore,
    activityScore: workflow.activityScore,
    confirmationReliability,
    currentVsReplayDrift,
    preferredHorizonHours: typeof preferredHorizonHours === 'number' ? Math.max(1, Math.round(preferredHorizonHours)) : null,
    themeHorizonHours,
    themeCount,
    uniqueSymbolCount,
    portfolio,
    updatedAt: snapshot.updatedAt,
  };
}

export function buildBacktestOpsSnapshot(
  runs: HistoricalReplayRun[],
  adaptationSnapshot: ReplayAdaptationSnapshot | null,
): BacktestOpsSnapshot {
  const normalizedRuns = (runs || [])
    .slice()
    .sort((left, right) => asTs(right.completedAt) - asTs(left.completedAt));
  const recentRuns = normalizedRuns
    .slice(0, 8)
    .map((run) => buildBacktestOpsRunSummary(run, adaptationSnapshot));
  const latestReplayRun = normalizedRuns.find((run) => run.mode === 'replay') || null;
  const latestWalkForwardRun = normalizedRuns.find((run) => run.mode === 'walk-forward') || null;
  const latestReplay = latestReplayRun ? buildBacktestOpsRunSummary(latestReplayRun, adaptationSnapshot, 'replay') : null;
  const latestWalkForward = latestWalkForwardRun ? buildBacktestOpsRunSummary(latestWalkForwardRun, adaptationSnapshot, 'walk-forward') : null;
  const currentLike = adaptationSnapshot ? buildCurrentLikeBacktestOpsRunSummary(adaptationSnapshot) : null;
  const workflow = adaptationSnapshot?.workflow || normalizeReplayWorkflowPerformance(null);
  const coverageLedger = adaptationSnapshot?.coverageLedger || null;
  const qualityScore = currentLike?.qualityScore ?? workflow.qualityScore;
  const executionScore = currentLike?.executionScore ?? workflow.executionScore;
  const activityScore = currentLike?.activityScore ?? workflow.activityScore;
  const coverageScore = currentLike?.coverageScore ?? workflow.coverageScore;
  const driftScore = clamp(Math.round(100 - Math.min(100, Math.abs(currentLike?.currentVsReplayDrift ?? 0) * 6)), 0, 100);
  const readinessScore = clamp(Math.round((qualityScore + executionScore + activityScore + coverageScore + driftScore) / 5), 0, 100);
  const portfolio = pickAvailablePortfolioSummary(
    currentLike?.portfolio,
    latestReplay?.portfolio,
    latestWalkForward?.portfolio,
    ...recentRuns.map((run) => run.portfolio),
  );
  return {
    updatedAt: adaptationSnapshot?.updatedAt || (recentRuns[0]?.updatedAt || nowIso()),
    latestReplay,
    latestWalkForward,
    currentLike,
    recentRuns,
    workflow,
    coverageLedger,
    themeProfiles: adaptationSnapshot?.themeProfiles || [],
    currentThemePerformance: adaptationSnapshot?.currentThemePerformance || [],
    portfolio,
    derived: {
      qualityScore,
      executionScore,
      activityScore,
      coverageScore,
      driftScore,
      readinessScore,
    },
    badges: {
      quality: backtestOpsStatusFromScore(qualityScore),
      execution: backtestOpsStatusFromScore(executionScore),
      activity: backtestOpsStatusFromScore(activityScore),
      coverage: backtestOpsStatusFromScore(coverageScore),
      drift: backtestOpsStatusFromScore(driftScore),
    },
  };
}

function normalizeReplayAdaptationSnapshot(snapshot: ReplayAdaptationSnapshot | null | undefined): ReplayAdaptationSnapshot | null {
  if (!snapshot) return null;
  return {
    updatedAt: snapshot.updatedAt || nowIso(),
    recentRuns: Array.isArray(snapshot.recentRuns)
      ? snapshot.recentRuns.map((digest) => normalizeReplayRunDigest(digest))
      : [],
    themeProfiles: Array.isArray(snapshot.themeProfiles)
      ? snapshot.themeProfiles.map((profile) => normalizeThemeProfile(profile))
      : [],
    currentThemePerformance: Array.isArray(snapshot.currentThemePerformance)
      ? snapshot.currentThemePerformance.map((metric) => normalizeCurrentThemePerformanceMetric(metric))
      : [],
    coverageLedger: snapshot.coverageLedger || null,
    workflow: normalizeReplayWorkflowPerformance(snapshot.workflow),
  };
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const cached = await getPersistentCache<PersistedReplayAdaptationStore>(REPLAY_ADAPTATION_KEY);
    currentSnapshot = normalizeReplayAdaptationSnapshot(cached?.data?.snapshot ?? null);
  } catch (error) {
    console.warn('[replay-adaptation] load failed', error);
  }
}

async function persist(): Promise<void> {
  await setPersistentCache(REPLAY_ADAPTATION_KEY, { snapshot: currentSnapshot });
}

function buildRunDigest(run: HistoricalReplayRun): ReplayRunDigest {
  const themeByIdeaRunId = new Map<string, string>();
  const uniqueThemes = new Set<string>();
  const uniqueSymbols = new Set<string>();
  for (const ideaRun of run.ideaRuns || []) {
    const themeId = normalizeThemeId(ideaRun.themeId);
    if (!themeId) continue;
    themeByIdeaRunId.set(ideaRun.id, themeId);
    uniqueThemes.add(themeId);
    for (const symbol of ideaRun.symbols || []) {
      if (symbol.symbol) uniqueSymbols.add(String(symbol.symbol).toUpperCase());
    }
  }

  const buckets = new Map<string, ForwardReturnRecord[]>();
  for (const record of run.forwardReturns || []) {
    const themeId = themeByIdeaRunId.get(record.ideaRunId);
    if (!themeId) continue;
    const key = `${themeId}::${Math.max(1, Math.round(Number(record.horizonHours) || 0))}`;
    const bucket = buckets.get(key) || [];
    bucket.push(record);
    buckets.set(key, bucket);
  }

  const themeMetrics: ReplayRunDigestThemeMetric[] = Array.from(buckets.entries()).map(([key, bucket]) => {
    const [themeId = 'unknown', horizonValue = '24'] = key.split('::');
    const executable = bucket.filter((record) => typeof record.costAdjustedSignedReturnPct === 'number');
    const rawRows = bucket.filter((record) => typeof record.signedReturnPct === 'number');
    const positives = executable.filter((record) => (record.costAdjustedSignedReturnPct || 0) > 0).length;
    const tradableCount = bucket.filter((record) => record.tradableNow !== false).length;
    const symbolCount = new Set(bucket.map((record) => String(record.symbol || '').toUpperCase()).filter(Boolean)).size;
    return {
      themeId,
      horizonHours: Math.max(1, Math.round(Number(horizonValue) || 24)),
      sampleSize: executable.length,
      hitRate: executable.length > 0 ? Math.round((positives / executable.length) * 100) : 0,
      rawAvgReturnPct: rawRows.length > 0 ? Number(average(rawRows.map((record) => record.signedReturnPct || 0)).toFixed(2)) : 0,
      costAdjustedAvgReturnPct: executable.length > 0 ? Number(average(executable.map((record) => record.costAdjustedSignedReturnPct || 0)).toFixed(2)) : 0,
      avgRealityScore: bucket.length > 0 ? Number(average(bucket.map((record) => record.realityScore || 0)).toFixed(2)) : 0,
      avgExecutionPenaltyPct: bucket.length > 0 ? Number(average(bucket.map((record) => record.executionPenaltyPct || 0)).toFixed(2)) : 0,
      tradableRate: bucket.length > 0 ? Math.round((tradableCount / bucket.length) * 100) : 0,
      uniqueSymbolCount: symbolCount,
    };
  }).filter((metric) => metric.sampleSize > 0);

  return normalizeReplayRunDigest({
    id: run.id,
    label: run.label,
    mode: run.mode,
    completedAt: run.completedAt,
    frameCount: run.frameCount,
    evaluationFrameCount: run.evaluationFrameCount,
    ideaRunCount: run.ideaRuns.length,
    forwardReturnCount: run.forwardReturns.length,
    uniqueThemeCount: uniqueThemes.size,
    uniqueSymbolCount: uniqueSymbols.size,
    costAdjustedHitRate: run.realitySummary?.costAdjustedHitRate ?? 0,
    costAdjustedAvgReturnPct: run.realitySummary?.costAdjustedAvgReturnPct ?? 0,
    avgRealityScore: run.realitySummary?.avgRealityScore ?? 0,
    avgExecutionPenaltyPct: run.realitySummary?.avgExecutionPenaltyPct ?? 0,
    nonTradableRate: run.realitySummary?.nonTradableRate ?? 0,
    portfolio: summarizeHistoricalRunPortfolioAccounting(run),
    themeMetrics,
    themeRegimeMetrics: run.themeRegimeMetrics || [],
    coverageLedger: run.coverageLedger || null,
  });
}

function buildThemeProfiles(
  digests: ReplayRunDigest[],
  updatedAt: string,
  coverageLedger: CoverageLedgerSnapshot | null,
  currentThemePerformance: CurrentThemePerformanceMetric[],
): ReplayThemeProfile[] {
  const asOfTs = asTs(updatedAt) || Date.now();
  const aggregated = new Map<string, {
    horizonHours: number;
    weightedSamples: number;
    weightedHitCount: number;
    weightedRawReturn: number;
    weightedCostAdjustedReturn: number;
    weightedReality: number;
    weightedPenalty: number;
    weightedTradable: number;
    weightedSymbols: number;
  }>();
  const regimeAggregated = new Map<string, {
    themeId: string;
    regimeId: string;
    weightedSamples: number;
    weightedHitCount: number;
    weightedReturn: number;
    weightedConfirmation: number;
  }>();
  const themeWindowBuckets = new Map<string, Array<{
    utility: number;
    returnPct: number;
    sampleWeight: number;
  }>>();

  for (const digest of digests) {
    const runWeight = decayWeight(digest.completedAt, asOfTs);
    const digestThemeBest = new Map<string, {
      utility: number;
      returnPct: number;
      sampleWeight: number;
    }>();
    for (const metric of digest.themeMetrics) {
      if (!metric.themeId || metric.sampleSize <= 0) continue;
      const key = `${metric.themeId}::${metric.horizonHours}`;
      const previous = aggregated.get(key) || {
        horizonHours: metric.horizonHours,
        weightedSamples: 0,
        weightedHitCount: 0,
        weightedRawReturn: 0,
        weightedCostAdjustedReturn: 0,
        weightedReality: 0,
        weightedPenalty: 0,
        weightedTradable: 0,
        weightedSymbols: 0,
      };
      const sampleWeight = runWeight * metric.sampleSize;
      previous.weightedSamples += sampleWeight;
      previous.weightedHitCount += sampleWeight * (metric.hitRate / 100);
      previous.weightedRawReturn += sampleWeight * metric.rawAvgReturnPct;
      previous.weightedCostAdjustedReturn += sampleWeight * metric.costAdjustedAvgReturnPct;
      previous.weightedReality += sampleWeight * metric.avgRealityScore;
      previous.weightedPenalty += sampleWeight * metric.avgExecutionPenaltyPct;
      previous.weightedTradable += sampleWeight * metric.tradableRate;
      previous.weightedSymbols += runWeight * metric.uniqueSymbolCount;
      aggregated.set(key, previous);

      const themeId = normalizeThemeId(metric.themeId);
      const utility = computeThemeMetricUtility(metric);
      const best = digestThemeBest.get(themeId);
      if (!best || utility > best.utility) {
        digestThemeBest.set(themeId, {
          utility,
          returnPct: Number(metric.costAdjustedAvgReturnPct) || 0,
          sampleWeight,
        });
      }
    }
    for (const [themeId, best] of digestThemeBest.entries()) {
      const bucket = themeWindowBuckets.get(themeId) || [];
      bucket.push(best);
      themeWindowBuckets.set(themeId, bucket);
    }
    for (const metric of digest.themeRegimeMetrics || []) {
      if (!metric.themeId || metric.sampleSize <= 0) continue;
      const key = `${metric.themeId}::${metric.regimeId}`;
      const previous = regimeAggregated.get(key) || {
        themeId: normalizeThemeId(metric.themeId),
        regimeId: String(metric.regimeId || 'unknown').trim() || 'unknown',
        weightedSamples: 0,
        weightedHitCount: 0,
        weightedReturn: 0,
        weightedConfirmation: 0,
      };
      const sampleWeight = runWeight * metric.sampleSize;
      previous.weightedSamples += sampleWeight;
      previous.weightedHitCount += sampleWeight * (metric.hitRate / 100);
      previous.weightedReturn += sampleWeight * metric.costAdjustedAvgReturnPct;
      previous.weightedConfirmation += sampleWeight * metric.confirmationScore;
      regimeAggregated.set(key, previous);
    }
  }

  const themeBuckets = new Map<string, ReplayThemeHorizonMetric[]>();
  for (const [key, value] of aggregated.entries()) {
    const [themeId = 'unknown'] = key.split('::');
    if (value.weightedSamples <= 0) continue;
    const hitRate = (value.weightedHitCount / value.weightedSamples) * 100;
    const rawAvgReturnPct = value.weightedRawReturn / value.weightedSamples;
    const costAdjustedAvgReturnPct = value.weightedCostAdjustedReturn / value.weightedSamples;
    const avgRealityScore = value.weightedReality / value.weightedSamples;
    const avgExecutionPenaltyPct = value.weightedPenalty / value.weightedSamples;
    const tradableRate = value.weightedTradable / value.weightedSamples;
    const confidenceWeight = 1 - Math.exp(-value.weightedSamples / 24);
    const utilityScore = Number((
      (
        costAdjustedAvgReturnPct * 18
        + (hitRate - 50) * 0.6
        + (avgRealityScore - 50) * 0.12
        + (tradableRate - 50) * 0.08
        - avgExecutionPenaltyPct * 0.45
      ) * confidenceWeight
    ).toFixed(2));
    const metric: ReplayThemeHorizonMetric = {
      horizonHours: value.horizonHours,
      sampleSize: Math.round(value.weightedSamples),
      hitRate: Number(hitRate.toFixed(2)),
      rawAvgReturnPct: Number(rawAvgReturnPct.toFixed(2)),
      costAdjustedAvgReturnPct: Number(costAdjustedAvgReturnPct.toFixed(2)),
      avgRealityScore: Number(avgRealityScore.toFixed(2)),
      avgExecutionPenaltyPct: Number(avgExecutionPenaltyPct.toFixed(2)),
      tradableRate: Number(tradableRate.toFixed(2)),
      uniqueSymbolCount: Math.round(value.weightedSymbols),
      utilityScore,
    };
    const bucket = themeBuckets.get(themeId) || [];
      bucket.push(metric);
    themeBuckets.set(themeId, bucket);
  }

  const themeRegimeBuckets = new Map<string, ReplayThemeRegimeProfile[]>();
  for (const entry of regimeAggregated.values()) {
    if (entry.weightedSamples <= 0) continue;
    const hitRate = (entry.weightedHitCount / entry.weightedSamples) * 100;
    const costAdjustedAvgReturnPct = entry.weightedReturn / entry.weightedSamples;
    const confirmationScore = entry.weightedConfirmation / entry.weightedSamples;
    const confidenceWeight = 1 - Math.exp(-entry.weightedSamples / 16);
    const utilityScore = Number((
      (
        costAdjustedAvgReturnPct * 18
        + (hitRate - 50) * 0.62
        + (confirmationScore - 50) * 0.22
      ) * confidenceWeight
    ).toFixed(2));
    const bucket = themeRegimeBuckets.get(entry.themeId) || [];
    bucket.push({
      regimeId: entry.regimeId,
      sampleSize: Math.round(entry.weightedSamples),
      hitRate: Number(hitRate.toFixed(2)),
      costAdjustedAvgReturnPct: Number(costAdjustedAvgReturnPct.toFixed(2)),
      confirmationScore: Number(confirmationScore.toFixed(2)),
      utilityScore,
    });
    themeRegimeBuckets.set(entry.themeId, bucket);
  }

  return Array.from(themeBuckets.entries()).map(([themeId, metrics]) => {
    const sorted = metrics
      .slice()
      .sort((a, b) => b.utilityScore - a.utilityScore || b.sampleSize - a.sampleSize || a.horizonHours - b.horizonHours);
    const top = sorted[0]!;
    const probs = softmax(sorted.map((metric) => metric.utilityScore));
    const guaranteedHorizonHours = sorted
      .slice(0, Math.min(2, sorted.length))
      .map((metric) => metric.horizonHours);
    const probabilisticHorizonHours = sorted
      .map((metric, index) => ({ horizonHours: metric.horizonHours, prob: probs[index] || 0 }))
      .filter((item, index) => item.prob >= 0.12 || index === 0)
      .slice(0, 3)
      .map((item) => item.horizonHours);
    const candidateHorizonHours = Array.from(new Set([
      ...guaranteedHorizonHours,
      ...probabilisticHorizonHours,
    ]))
      .sort((a, b) => a - b);
    const runnerUpScore = sorted[1]?.utilityScore ?? top.utilityScore;
    const separation = Math.max(0, top.utilityScore - runnerUpScore);
    const topProb = probs[0] || 1;
    const coverage = getCoveragePenaltyForTheme(coverageLedger, themeId);
    const current = currentThemePerformance.find((metric) => metric.themeId === themeId) || null;
    const currentVsReplayDrift = current ? Number((current.avgReturnPct - top.costAdjustedAvgReturnPct).toFixed(2)) : 0;
    const coverageAdjustedUtility = Number((
      top.utilityScore
      - coverage.coveragePenalty * 0.28
      + Math.max(0, coverage.completenessScore - 50) * 0.08
    ).toFixed(2));
    const windowEntries = themeWindowBuckets.get(themeId) || [];
    const windowUtilities = windowEntries.map((entry) => entry.utility);
    const windowWeights = windowEntries.map((entry) => Math.max(1, entry.sampleWeight));
    const windowReturns = windowEntries.map((entry) => entry.returnPct);
    const weightedWindowSamples = windowWeights.reduce((sum, value) => sum + value, 0);
    const windowMedianUtility = Number(weightedMedian(windowUtilities, windowWeights).toFixed(2));
    const windowUtilityStd = Number(weightedStdDev(windowUtilities, windowWeights).toFixed(2));
    const windowFlipRate = Number((
      windowUtilities.length
        ? weightedAverageByCount(
          windowUtilities.map((value, index) => ({
            value,
            weight: windowWeights[index] || 0,
            flipped: Math.sign(value) !== Math.sign(windowMedianUtility) ? 1 : 0,
          })),
          (item) => item.flipped,
          (item) => item.weight,
        )
        : 0
    ).toFixed(3));
    const negativeWindowShare = Number((
      windowReturns.length
        ? weightedAverageByCount(
          windowReturns.map((value, index) => ({
            value,
            weight: windowWeights[index] || 0,
            negative: value < 0 ? 1 : 0,
          })),
          (item) => item.negative,
          (item) => item.weight,
        )
        : (top.costAdjustedAvgReturnPct < 0 ? 1 : 0)
    ).toFixed(3));
    const shrink = weightedWindowSamples / (weightedWindowSamples + 28);
    const robustUtility = Number((
      windowMedianUtility * (0.35 + shrink * 0.65)
      - windowUtilityStd * (0.48 + negativeWindowShare * 0.32)
      - windowFlipRate * 6.4
      - Math.max(0, -currentVsReplayDrift) * 1.35
      - Math.max(0, -coverageAdjustedUtility) * 0.16
    ).toFixed(2));
    const confirmationReliability = clamp(
      Math.round(
        (current ? current.confirmationScore : 24) * 0.34
        + coverage.completenessScore * 0.28
        + coverage.coverageDensity * 0.14
        + Math.min(14, coverage.sourceFamilyDiversity * 6)
        + Math.min(12, coverage.featureFamilyDiversity * 6)
        + top.tradableRate * 0.1
        - Math.min(18, Math.abs(currentVsReplayDrift) * 8),
      ),
      0,
      99,
    );
    const confidence = clamp(
      Math.round(
        (1 - Math.exp(-top.sampleSize / 18)) * 58
        + topProb * 18
        + Math.min(8, separation * 1.5)
        + coverage.completenessScore * 0.12
        + (current ? current.confirmationScore * 0.08 : 0),
      ),
      8,
      99,
    );
    return normalizeThemeProfile({
      themeId,
      preferredHorizonHours: top.horizonHours,
      candidateHorizonHours,
      timeframe: formatLearnedTimeframe(candidateHorizonHours),
      confidence,
      weightedSampleSize: top.sampleSize,
      hitRate: top.hitRate,
      rawAvgReturnPct: top.rawAvgReturnPct,
      costAdjustedAvgReturnPct: top.costAdjustedAvgReturnPct,
      avgRealityScore: top.avgRealityScore,
      avgExecutionPenaltyPct: top.avgExecutionPenaltyPct,
      tradableRate: top.tradableRate,
      utilityScore: top.utilityScore,
      regimeMetrics: (themeRegimeBuckets.get(themeId) || [])
        .slice()
        .sort((a, b) => b.utilityScore - a.utilityScore || b.sampleSize - a.sampleSize)
        .slice(0, 6),
      confirmationReliability,
      coverageAdjustedUtility,
      robustUtility,
      windowMedianUtility,
      windowUtilityStd,
      windowFlipRate,
      currentVsReplayDrift,
      horizonMetrics: sorted,
      updatedAt,
    });
  }).sort((a, b) => b.coverageAdjustedUtility - a.coverageAdjustedUtility || b.robustUtility - a.robustUtility || b.weightedSampleSize - a.weightedSampleSize);
}

function buildWorkflowPerformance(digests: ReplayRunDigest[], themeProfiles: ReplayThemeProfile[], updatedAt: string): ReplayWorkflowPerformance {
  if (!digests.length) {
    return normalizeReplayWorkflowPerformance({
      updatedAt,
      runCount: 0,
      themeCount: 0,
      uniqueSymbolCount: 0,
      frameCount: 0,
      evaluationFrameCount: 0,
      ideaRunCount: 0,
      forwardReturnCount: 0,
      costAdjustedHitRate: 0,
      costAdjustedAvgReturnPct: 0,
      avgRealityScore: 0,
      avgExecutionPenaltyPct: 0,
      nonTradableRate: 100,
      coverageScore: 0,
      qualityScore: 0,
      executionScore: 0,
      activityScore: 0,
    });
  }

  const asOfTs = asTs(updatedAt) || Date.now();
  let weightSum = 0;
  let frameCount = 0;
  let evaluationFrameCount = 0;
  let ideaRunCount = 0;
  let forwardReturnCount = 0;
  let uniqueThemeCount = 0;
  let uniqueSymbolCount = 0;
  let costAdjustedHitRate = 0;
  let costAdjustedAvgReturnPct = 0;
  let avgRealityScore = 0;
  let avgExecutionPenaltyPct = 0;
  let nonTradableRate = 0;

  for (const digest of digests) {
    const weight = decayWeight(digest.completedAt, asOfTs);
    weightSum += weight;
    frameCount += digest.frameCount * weight;
    evaluationFrameCount += digest.evaluationFrameCount * weight;
    ideaRunCount += digest.ideaRunCount * weight;
    forwardReturnCount += digest.forwardReturnCount * weight;
    uniqueThemeCount += digest.uniqueThemeCount * weight;
    uniqueSymbolCount += digest.uniqueSymbolCount * weight;
    costAdjustedHitRate += digest.costAdjustedHitRate * weight;
    costAdjustedAvgReturnPct += digest.costAdjustedAvgReturnPct * weight;
    avgRealityScore += digest.avgRealityScore * weight;
    avgExecutionPenaltyPct += digest.avgExecutionPenaltyPct * weight;
    nonTradableRate += digest.nonTradableRate * weight;
  }

  const divisor = Math.max(weightSum, 1e-6);
  const avgFrames = frameCount / divisor;
  const avgEvalFrames = evaluationFrameCount / divisor;
  const avgIdeaRuns = ideaRunCount / divisor;
  const avgForwardReturns = forwardReturnCount / divisor;
  const avgThemes = uniqueThemeCount / divisor;
  const avgSymbols = uniqueSymbolCount / divisor;
  const avgHitRate = costAdjustedHitRate / divisor;
  const avgReturn = costAdjustedAvgReturnPct / divisor;
  const avgReality = avgRealityScore / divisor;
  const avgPenalty = avgExecutionPenaltyPct / divisor;
  const avgNonTradable = nonTradableRate / divisor;
  const readinessThemes = themeProfiles.filter((profile) => profile.utilityScore > 0).length;
  const coverageScore = clamp(
    Math.round(
      Math.min(100, (
        Math.log1p(avgThemes) * 18
        + Math.log1p(avgSymbols) * 12
        + Math.log1p(digests.length) * 16
        + Math.min(24, readinessThemes * 2.5)
      )),
    ),
    0,
    100,
  );
  const qualityScore = clamp(
    Math.round(
      50
      + (avgHitRate - 30) * 0.8
      + avgReturn * 16
      + (average(themeProfiles.slice(0, 8).map((profile) => profile.coverageAdjustedUtility)) || 0) * 0.24,
    ),
    0,
    100,
  );
  const executionScore = clamp(
    Math.round(
      avgReality * 0.62
      + (100 - avgNonTradable) * 0.22
      + Math.max(0, 100 - avgPenalty * 12) * 0.16,
    ),
    0,
    100,
  );
  const activityScore = clamp(
    Math.round(
      Math.min(100, ((avgIdeaRuns + avgForwardReturns * 0.15) / Math.max(1, avgEvalFrames)) * 48),
    ),
    0,
    100,
  );

  return normalizeReplayWorkflowPerformance({
    updatedAt,
    runCount: digests.length,
    themeCount: Math.round(avgThemes),
    uniqueSymbolCount: Math.round(avgSymbols),
    frameCount: Math.round(avgFrames),
    evaluationFrameCount: Math.round(avgEvalFrames),
    ideaRunCount: Math.round(avgIdeaRuns),
    forwardReturnCount: Math.round(avgForwardReturns),
    costAdjustedHitRate: Number(avgHitRate.toFixed(2)),
    costAdjustedAvgReturnPct: Number(avgReturn.toFixed(2)),
    avgRealityScore: Number(avgReality.toFixed(2)),
    avgExecutionPenaltyPct: Number(avgPenalty.toFixed(2)),
    nonTradableRate: Number(avgNonTradable.toFixed(2)),
    coverageScore,
    qualityScore,
    executionScore,
    activityScore,
  });
}

function rebuildSnapshot(
  digests: ReplayRunDigest[],
  currentThemePerformance: CurrentThemePerformanceMetric[] = currentSnapshot?.currentThemePerformance || [],
): ReplayAdaptationSnapshot {
  const updatedAt = nowIso();
  const sortedDigests = digests
    .slice()
    .map((digest) => normalizeReplayRunDigest(digest))
    .sort((a, b) => asTs(b.completedAt) - asTs(a.completedAt))
    .slice(0, MAX_REPLAY_DIGESTS);
  const coverageLedger = mergeCoverageLedgerSnapshots(sortedDigests.map((digest) => digest.coverageLedger || null));
  const normalizedCurrent = currentThemePerformance.map((metric) => normalizeCurrentThemePerformanceMetric(metric));
  const themeProfiles = buildThemeProfiles(sortedDigests, updatedAt, coverageLedger, normalizedCurrent);
  const workflow = buildWorkflowPerformance(sortedDigests, themeProfiles, updatedAt);
  return {
    updatedAt,
    recentRuns: sortedDigests,
    themeProfiles,
    currentThemePerformance: normalizedCurrent,
    coverageLedger,
    workflow,
  };
}

function statusFromScore(score: number): ReplayWorkflowStatus {
  if (score >= 67) return 'ready';
  if (score >= 40) return 'watch';
  return 'blocked';
}

export function buildReplayDrivenWorkflow(snapshot: ReplayAdaptationSnapshot | null, live?: {
  detectCount?: number;
  mappingCount?: number;
  ideaCount?: number;
  trackedOpen?: number;
  trackedClosed?: number;
}): ReplayWorkflowStep[] {
  if (!snapshot) {
    return [
      { id: 'detect', label: 'Detect', status: 'blocked', metric: 0, summary: 'No replay-backed performance history is available yet.' },
      { id: 'validate', label: 'Validate', status: 'blocked', metric: 0, summary: 'Validation is waiting for replay samples.' },
      { id: 'map', label: 'Map', status: 'blocked', metric: 0, summary: 'No replay-backed asset map exists yet.' },
      { id: 'stress-test', label: 'Stress Test', status: 'blocked', metric: 0, summary: 'No replay or walk-forward runs have been recorded.' },
      { id: 'size', label: 'Size', status: 'blocked', metric: 0, summary: 'Sizing remains blocked until execution-quality samples accumulate.' },
      { id: 'constrain', label: 'Constrain', status: 'blocked', metric: 0, summary: 'Execution-reality telemetry is unavailable.' },
      { id: 'monitor', label: 'Shadow', status: 'blocked', metric: 0, summary: 'Monitoring will unlock after the first replay-backed theme profile is learned.' },
    ];
  }

  const workflow = snapshot.workflow;
  const liveDetect = Math.max(0, Math.round(Number(live?.detectCount) || 0));
  const liveMap = Math.max(0, Math.round(Number(live?.mappingCount) || 0));
  const liveIdeas = Math.max(0, Math.round(Number(live?.ideaCount) || 0));
  const trackedOpen = Math.max(0, Math.round(Number(live?.trackedOpen) || 0));
  const trackedClosed = Math.max(0, Math.round(Number(live?.trackedClosed) || 0));

  return [
    {
      id: 'detect',
      label: 'Detect',
      status: statusFromScore(workflow.coverageScore),
      metric: workflow.themeCount,
      summary: `${workflow.themeCount} replay-backed themes are live across ${workflow.runCount} recent runs; the current screen kept ${liveDetect} candidates.`,
    },
    {
      id: 'validate',
      label: 'Validate',
      status: statusFromScore(workflow.qualityScore),
      metric: workflow.qualityScore,
      summary: `Recent replay quality scored ${workflow.qualityScore}/100 with cost-adjusted hit-rate ${workflow.costAdjustedHitRate}% and avg ${workflow.costAdjustedAvgReturnPct}%.`,
    },
    {
      id: 'map',
      label: 'Map',
      status: statusFromScore((workflow.coverageScore + workflow.activityScore) / 2),
      metric: workflow.uniqueSymbolCount,
      summary: `${workflow.uniqueSymbolCount} symbols have replay-backed theme linkage; the current snapshot exposed ${liveMap} live mappings.`,
    },
    {
      id: 'stress-test',
      label: 'Stress Test',
      status: statusFromScore((workflow.coverageScore + workflow.qualityScore) / 2),
      metric: workflow.forwardReturnCount,
      summary: `${workflow.forwardReturnCount} recent forward-return labels and ${workflow.evaluationFrameCount} evaluated frames are informing the model.`,
    },
    {
      id: 'size',
      label: 'Size',
      status: statusFromScore((workflow.activityScore + workflow.executionScore + workflow.qualityScore) / 3),
      metric: workflow.ideaRunCount,
      summary: `${workflow.ideaRunCount} replay idea runs inform sizing; the live snapshot currently holds ${liveIdeas} idea cards.`,
    },
    {
      id: 'constrain',
      label: 'Constrain',
      status: statusFromScore(workflow.executionScore),
      metric: workflow.executionScore,
      summary: `Execution quality scored ${workflow.executionScore}/100 with reality ${workflow.avgRealityScore}, penalty ${workflow.avgExecutionPenaltyPct}%, non-tradable ${workflow.nonTradableRate}%.`,
    },
    {
      id: 'monitor',
      label: 'Shadow',
      status: statusFromScore((workflow.activityScore + workflow.coverageScore) / 2),
      metric: trackedOpen || workflow.runCount,
      summary: `${trackedOpen || workflow.runCount} active monitoring streams with ${trackedClosed} closed live samples and ${snapshot.themeProfiles.length} learned horizon profiles.`,
    },
  ];
}

export function getReplayThemeProfileFromSnapshot(
  snapshot: ReplayAdaptationSnapshot | null,
  themeId: string,
): ReplayThemeProfile | null {
  if (!snapshot) return null;
  const normalizedThemeId = normalizeThemeId(themeId);
  const themeProfiles = Array.isArray(snapshot.themeProfiles) ? snapshot.themeProfiles : [];
  return themeProfiles.find((profile) => profile.themeId === normalizedThemeId) || null;
}

export function getCurrentThemePerformanceFromSnapshot(
  snapshot: ReplayAdaptationSnapshot | null,
  themeId: string,
): CurrentThemePerformanceMetric | null {
  if (!snapshot) return null;
  const normalizedThemeId = normalizeThemeId(themeId);
  const currentThemePerformance = Array.isArray(snapshot.currentThemePerformance) ? snapshot.currentThemePerformance : [];
  return currentThemePerformance.find((metric) => metric.themeId === normalizedThemeId) || null;
}

export async function getReplayAdaptationSnapshot(): Promise<ReplayAdaptationSnapshot | null> {
  await ensureLoaded();
  return currentSnapshot;
}

export function getReplayAdaptationSnapshotSync(): ReplayAdaptationSnapshot | null {
  return currentSnapshot;
}

export async function resetReplayAdaptationSnapshot(): Promise<void> {
  await ensureLoaded();
  currentSnapshot = rebuildSnapshot([]);
  await persist();
}

export async function recordReplayRunAdaptation(run: HistoricalReplayRun): Promise<ReplayAdaptationSnapshot> {
  await ensureLoaded();
  const digest = buildRunDigest(run);
  const existing = currentSnapshot?.recentRuns || [];
  const merged = [digest, ...existing.filter((item) => item.id !== digest.id)];
  currentSnapshot = rebuildSnapshot(merged, currentSnapshot?.currentThemePerformance || []);
  await persist();
  return currentSnapshot;
}

export async function recordCurrentThemePerformance(metrics: CurrentThemePerformanceMetric[]): Promise<ReplayAdaptationSnapshot> {
  await ensureLoaded();
  currentSnapshot = rebuildSnapshot(currentSnapshot?.recentRuns || [], metrics);
  await persist();
  return currentSnapshot;
}
