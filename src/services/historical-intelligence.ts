import type { ClusteredEvent, MarketData, NewsItem } from '@/types';
import type { EventMarketTransmissionSnapshot } from './event-market-transmission';
import type {
  InvestmentIdeaCard,
  InvestmentIntelligenceContext,
  InvestmentLearningState,
  InvestmentDirection,
  InvestmentIntelligenceSnapshot,
  MappingPerformanceStats,
} from './investment-intelligence';
import type { ScheduledReport } from './scheduled-reports';
import type { SourceCredibilityProfile } from './source-credibility';
import { recomputeEventMarketTransmission } from './event-market-transmission';
import { assessExecutionReality } from './autonomy-constraints';
import { getPersistentCache, setPersistentCache } from './persistent-cache';
import {
  exportInvestmentLearningState,
  listMappingPerformanceStats,
  recomputeInvestmentIntelligence,
  resetInvestmentLearningState,
} from './investment-intelligence';
import {
  exportSourceCredibilityState,
  recomputeSourceCredibility,
  resetSourceCredibilityState,
} from './source-credibility';
import { archiveHistoricalReplayRun } from './historical-archive';
import {
  clonePortfolioAccountingSnapshot,
  computePortfolioAccountingSnapshot,
  type PortfolioAccountingSnapshot,
} from './portfolio-accounting';
import {
  buildBacktestOpsSnapshot,
  buildReplayDrivenWorkflow,
  deriveIntervalHorizonCandidates,
  getReplayAdaptationSnapshot,
  type BacktestOpsSnapshot,
  type ReplayAdaptationSnapshot,
  type ReplayThemeProfile,
  recordReplayRunAdaptation,
} from './replay-adaptation';
import {
  buildCoverageLedgerFromFrames,
  type CoverageLedgerSnapshot,
} from './coverage-ledger';
import { logSourceOpsEvent } from './source-ops-log';
import { measureResourceOperation } from './resource-telemetry';

export interface HistoricalReplayFrame {
  id?: string;
  timestamp: string;
  validTimeStart?: string;
  validTimeEnd?: string | null;
  transactionTime?: string;
  knowledgeBoundary?: string;
  datasetId?: string;
  sourceVersion?: string | null;
  warmup?: boolean;
  news: NewsItem[];
  clusters: ClusteredEvent[];
  markets: MarketData[];
  reports?: ScheduledReport[];
  transmission?: EventMarketTransmissionSnapshot | null;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface BacktestIdeaRunSymbol {
  symbol: string;
  name: string;
  role: 'primary' | 'confirm' | 'hedge';
  direction: InvestmentDirection;
  sector?: string;
  assetKind?: 'etf' | 'equity' | 'commodity' | 'fx' | 'rate' | 'crypto';
  liquidityScore?: number | null;
  realityScore?: number | null;
  entryPrice: number | null;
}

export interface BacktestIdeaRun {
  id: string;
  runId: string;
  frameId: string;
  generatedAt: string;
  title: string;
  themeId: string;
  region: string;
  direction: InvestmentDirection;
  conviction: number;
  falsePositiveRisk: number;
  sizePct: number;
  timeframe: string;
  thesis: string;
  evidence: string[];
  triggers: string[];
  invalidation: string[];
  transmissionPath: string[];
  analogRefs: string[];
  preferredHorizonHours?: number | null;
  horizonCandidatesHours?: number[];
  horizonLearningConfidence?: number | null;
  symbols: BacktestIdeaRunSymbol[];
}

export interface ForwardReturnRecord {
  id: string;
  runId: string;
  ideaRunId: string;
  symbol: string;
  direction: InvestmentDirection;
  horizonHours: number;
  entryTimestamp: string;
  exitTimestamp: string | null;
  entryPrice: number | null;
  exitPrice: number | null;
  rawReturnPct: number | null;
  signedReturnPct: number | null;
  costAdjustedSignedReturnPct: number | null;
  executionPenaltyPct: number;
  realityScore: number;
  sessionState: 'always-on' | 'open' | 'extended' | 'closed';
  tradableNow: boolean;
  spreadBps: number;
  slippageBps: number;
  liquidityPenaltyPct: number;
  realityNotes: string[];
}

export interface RealityAwareBacktestSummary {
  primaryHorizonHours: number;
  rawHitRate: number;
  costAdjustedHitRate: number;
  rawAvgReturnPct: number;
  costAdjustedAvgReturnPct: number;
  avgExecutionPenaltyPct: number;
  avgRealityScore: number;
  nonTradableRate: number;
}

export interface ReplayThemeRegimeMetric {
  themeId: string;
  regimeId: string;
  sampleSize: number;
  hitRate: number;
  costAdjustedAvgReturnPct: number;
  confirmationScore: number;
}

export interface ReplayCheckpoint {
  id: string;
  timestamp: string;
  validTimeStart: string;
  validTimeEnd: string | null;
  transactionTime: string;
  knowledgeBoundary: string;
  evaluationEligible: boolean;
  frameId: string;
  newsCount: number;
  clusterCount: number;
  marketCount: number;
  ideaCount: number;
  trackedIdeaCount: number;
  sourceProfileCount: number;
  mappingStatCount: number;
}

export interface WalkForwardWindow {
  phase: 'train' | 'validate' | 'test';
  from: string;
  to: string;
  frameCount: number;
}

export interface HistoricalReplayRun {
  id: string;
  label: string;
  mode: 'replay' | 'walk-forward';
  startedAt: string;
  completedAt: string;
  temporalMode: 'bitemporal';
  retainLearningState: boolean;
  frameCount: number;
  warmupFrameCount: number;
  evaluationFrameCount: number;
  horizonsHours: number[];
  checkpoints: ReplayCheckpoint[];
  ideaRuns: BacktestIdeaRun[];
  forwardReturns: ForwardReturnRecord[];
  sourceProfiles: SourceCredibilityProfile[];
  mappingStats: MappingPerformanceStats[];
  banditStates?: InvestmentLearningState['banditStates'];
  candidateReviews?: InvestmentLearningState['candidateReviews'];
  workflow: InvestmentIntelligenceSnapshot['workflow'];
  themeHorizonProfiles?: ReplayThemeProfile[];
  themeRegimeMetrics?: ReplayThemeRegimeMetric[];
  coverageLedger?: CoverageLedgerSnapshot | null;
  realitySummary: RealityAwareBacktestSummary;
  portfolioAccounting?: PortfolioAccountingSnapshot | null;
  summaryLines: string[];
  windows?: WalkForwardWindow[];
}

export interface HistoricalReplayOptions {
  label?: string;
  horizonsHours?: number[];
  retainLearningState?: boolean;
  dedupeWindowHours?: number;
  warmupFrameCount?: number;
  warmupUntil?: string;
  transactionTimeCeiling?: string;
  knowledgeBoundaryCeiling?: string;
  seedState?: {
    sourceProfiles?: SourceCredibilityProfile[];
    investmentLearning?: Partial<InvestmentLearningState>;
  };
  recordAdaptation?: boolean;
  investmentContext?: InvestmentIntelligenceContext;
}

export interface WalkForwardBacktestOptions extends HistoricalReplayOptions {
  trainRatio?: number;
  validateRatio?: number;
}

export type {
  BacktestOpsBadgeState,
  BacktestOpsRunMode,
  BacktestOpsRunSummary,
  BacktestOpsSnapshot,
} from './replay-adaptation';

interface PersistedReplayRuns {
  runs: HistoricalReplayRun[];
}

interface PricePoint {
  timestamp: string;
  ts: number;
  transactionTs: number;
  price: number;
}

const REPLAY_RUNS_KEY = 'historical-intelligence-runs:v1';
const MAX_REPLAY_RUNS = 18;
const DEFAULT_HORIZONS_HOURS: number[] = [];

let loaded = false;
let replayRuns: HistoricalReplayRun[] = [];

function nowIso(): string {
  return new Date().toISOString();
}

function emptyReplayAdaptationSnapshot(): ReplayAdaptationSnapshot {
  const updatedAt = nowIso();
  return {
    updatedAt,
    recentRuns: [],
    themeProfiles: [],
    currentThemePerformance: [],
    coverageLedger: null,
    workflow: {
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
      nonTradableRate: 0,
      coverageScore: 0,
      qualityScore: 0,
      executionScore: 0,
      activityScore: 0,
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function asTs(value: string | null | undefined): number {
  const ts = Date.parse(String(value || ''));
  return Number.isFinite(ts) ? ts : 0;
}

function effectiveTransactionTime(frame: HistoricalReplayFrame): string {
  return frame.transactionTime || frame.knowledgeBoundary || frame.timestamp;
}

function effectiveKnowledgeBoundary(frame: HistoricalReplayFrame): string {
  return frame.knowledgeBoundary || effectiveTransactionTime(frame);
}

function effectiveValidTimeStart(frame: HistoricalReplayFrame): string {
  return frame.validTimeStart || frame.timestamp;
}

function parseMarketTimeMap(frame: HistoricalReplayFrame, key: 'marketTimestampJson' | 'marketKnowledgeBoundaryJson'): Record<string, string> {
  const raw = frame.metadata?.[key];
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([symbol, value]) =>
        typeof value === 'string' && value.trim() ? [[symbol, value]] : []),
    );
  } catch {
    return {};
  }
}

function mergeFrameMarketTimeMap(
  frames: HistoricalReplayFrame[],
  key: 'marketTimestampJson' | 'marketKnowledgeBoundaryJson',
): Record<string, string> {
  return Object.assign({}, ...frames.map((frame) => parseMarketTimeMap(frame, key)));
}

function normalizeMergeKey(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function newsItemKey(item: NewsItem): string {
  const pubDate = Date.parse(String(item.pubDate || ''));
  const normalizedPubDate = Number.isFinite(pubDate) ? new Date(pubDate).toISOString() : '';
  return [
    normalizeMergeKey(item.source),
    normalizeMergeKey(item.title),
    String(item.link || '').trim(),
    normalizedPubDate,
  ].join('::');
}

function clusteredEventKey(cluster: ClusteredEvent): string {
  const firstSeen = Date.parse(String(cluster.firstSeen || ''));
  const normalizedFirstSeen = Number.isFinite(firstSeen) ? new Date(firstSeen).toISOString() : '';
  return cluster.id || [
    normalizeMergeKey(cluster.primarySource),
    normalizeMergeKey(cluster.primaryTitle),
    normalizedFirstSeen,
  ].join('::');
}

function marketDataKey(market: MarketData): string {
  return normalizeMergeKey(market.symbol || market.name);
}

function scheduledReportKey(report: ScheduledReport): string {
  return [
    String(report.id || '').trim(),
    normalizeMergeKey(report.title || ''),
    String(report.generatedAt || '').trim(),
  ].join('::');
}

function transmissionEdgeKey(edge: NonNullable<EventMarketTransmissionSnapshot['edges']>[number]): string {
  return [
    normalizeMergeKey(edge.eventTitle),
    normalizeMergeKey(edge.eventSource),
    String(edge.marketSymbol || '').trim().toUpperCase(),
    edge.relationType,
    normalizeMergeKey(edge.reason),
  ].join('::');
}

function uniqueByKey<T>(items: T[], keyFor: (item: T) => string): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const item of items) {
    const key = keyFor(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function mergeTransmissionSnapshots(frames: HistoricalReplayFrame[]): EventMarketTransmissionSnapshot | null {
  const snapshots = frames
    .map((frame) => frame.transmission)
    .filter((snapshot): snapshot is EventMarketTransmissionSnapshot => Boolean(snapshot));
  if (snapshots.length === 0) return null;
  const edges = uniqueByKey(
    snapshots.flatMap((snapshot) => snapshot.edges || []),
    transmissionEdgeKey,
  );
  const summaryLines = Array.from(new Set(snapshots.flatMap((snapshot) => snapshot.summaryLines || [])));
  const regime = snapshots
    .map((snapshot) => snapshot.regime || null)
    .filter((candidate): candidate is NonNullable<EventMarketTransmissionSnapshot['regime']> => Boolean(candidate))
    .sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0))[0] ?? null;
  const generatedAt = frames
    .map((frame) => effectiveKnowledgeBoundary(frame))
    .sort((left, right) => asTs(right) - asTs(left))[0] || nowIso();
  return {
    generatedAt,
    edges,
    summaryLines,
    regime,
  };
}

function mergeFrameGroup(frames: HistoricalReplayFrame[], groupIndex: number): HistoricalReplayFrame {
  const sorted = frames
    .slice()
    .sort((left, right) => asTs(left.timestamp) - asTs(right.timestamp) || asTs(left.transactionTime || left.timestamp) - asTs(right.transactionTime || right.timestamp));
  const first = sorted[0]!;
  const datasetIds = Array.from(new Set(sorted.map((frame) => String(frame.datasetId || '').trim()).filter(Boolean)));
  const sourceVersions = Array.from(new Set(sorted.map((frame) => String(frame.sourceVersion || '').trim()).filter(Boolean)));
  const validTimeStarts = sorted.map((frame) => effectiveValidTimeStart(frame)).filter(Boolean);
  const validTimeEnds = sorted.map((frame) => frame.validTimeEnd).filter((value): value is string => Boolean(value));
  const transactionTimes = sorted.map((frame) => effectiveTransactionTime(frame)).filter(Boolean);
  const knowledgeBoundaries = sorted.map((frame) => effectiveKnowledgeBoundary(frame)).filter(Boolean);
  const mergedMarketTimestampMap = mergeFrameMarketTimeMap(sorted, 'marketTimestampJson');
  const mergedMarketKnowledgeMap = mergeFrameMarketTimeMap(sorted, 'marketKnowledgeBoundaryJson');
  const metadata = Object.assign({}, ...sorted.map((frame) => frame.metadata || {}), {
    mergedFrameCount: sorted.length,
    mergedDatasetIds: datasetIds.join(',') || null,
    marketTimestampJson:
      Object.keys(mergedMarketTimestampMap).length > 0 ? JSON.stringify(mergedMarketTimestampMap) : null,
    marketKnowledgeBoundaryJson:
      Object.keys(mergedMarketKnowledgeMap).length > 0 ? JSON.stringify(mergedMarketKnowledgeMap) : null,
  }) as Record<string, string | number | boolean | null>;
  return {
    ...first,
    id: sorted.length > 1
      ? `merged:${transactionTimes[0] || first.timestamp}:${groupIndex + 1}`
      : first.id || `frame-${groupIndex + 1}`,
    timestamp: sorted.map((frame) => frame.timestamp).sort((left, right) => asTs(left) - asTs(right))[0] || first.timestamp,
    validTimeStart: validTimeStarts.sort((left, right) => asTs(left) - asTs(right))[0] || first.validTimeStart || first.timestamp,
    validTimeEnd: validTimeEnds.length > 0
      ? validTimeEnds.sort((left, right) => asTs(right) - asTs(left))[0]
      : null,
    transactionTime: transactionTimes.sort((left, right) => asTs(left) - asTs(right))[0] || first.transactionTime || first.timestamp,
    knowledgeBoundary: knowledgeBoundaries.sort((left, right) => asTs(right) - asTs(left))[0] || first.knowledgeBoundary || first.timestamp,
    datasetId: datasetIds.length > 0 ? datasetIds.join('+') : first.datasetId,
    sourceVersion: sourceVersions.length > 0 ? sourceVersions.join('+') : first.sourceVersion,
    warmup: sorted.some((frame) => Boolean(frame.warmup)),
    news: uniqueByKey(sorted.flatMap((frame) => frame.news), newsItemKey),
    clusters: uniqueByKey(sorted.flatMap((frame) => frame.clusters), clusteredEventKey),
    markets: Array.from(
      sorted
        .flatMap((frame) => frame.markets)
        .reduce((map, market) => {
          const key = marketDataKey(market);
          if (key) map.set(key, market);
          return map;
        }, new Map<string, MarketData>())
        .values(),
    ),
    reports: uniqueByKey(sorted.flatMap((frame) => frame.reports || []), scheduledReportKey),
    transmission: mergeTransmissionSnapshots(sorted),
    metadata,
  };
}

function mergeFramesByTimestamp(frames: HistoricalReplayFrame[]): HistoricalReplayFrame[] {
  const groups = new Map<string, HistoricalReplayFrame[]>();
  for (const frame of frames) {
    const key = frame.timestamp || effectiveTransactionTime(frame);
    const bucket = groups.get(key) || [];
    bucket.push(frame);
    groups.set(key, bucket);
  }
  return Array.from(groups.entries())
    .sort((left, right) => asTs(left[0]) - asTs(right[0]))
    .map(([, group], index) => mergeFrameGroup(group, index));
}

function regionFromIdeaCard(card: InvestmentIdeaCard): string {
  const [, rawRegion] = card.title.split('|');
  return rawRegion?.trim() || 'Global';
}

function directionMultiplier(direction: InvestmentDirection): number {
  if (direction === 'short') return -1;
  if (direction === 'watch') return 0;
  return 1;
}

function normalizeForwardReturnRecord(record: ForwardReturnRecord): ForwardReturnRecord {
  return {
    ...record,
    costAdjustedSignedReturnPct: typeof record.costAdjustedSignedReturnPct === 'number'
      ? record.costAdjustedSignedReturnPct
      : record.signedReturnPct,
    executionPenaltyPct: Number(record.executionPenaltyPct) || 0,
    realityScore: Number(record.realityScore) || 0,
    sessionState: record.sessionState || 'closed',
    tradableNow: typeof record.tradableNow === 'boolean' ? record.tradableNow : false,
    spreadBps: Number(record.spreadBps) || 0,
    slippageBps: Number(record.slippageBps) || 0,
    liquidityPenaltyPct: Number(record.liquidityPenaltyPct) || 0,
    realityNotes: Array.isArray(record.realityNotes) ? record.realityNotes.slice(0, 4) : [],
  };
}

function normalizeReplayRun(run: HistoricalReplayRun): HistoricalReplayRun {
  const forwardReturns = Array.isArray(run.forwardReturns)
    ? run.forwardReturns.map((record) => normalizeForwardReturnRecord(record))
    : [];
  return {
    ...run,
    forwardReturns,
    themeHorizonProfiles: Array.isArray(run.themeHorizonProfiles)
      ? run.themeHorizonProfiles.map((profile) => ({
        ...profile,
        candidateHorizonHours: Array.isArray(profile.candidateHorizonHours) ? profile.candidateHorizonHours.slice() : [],
        horizonMetrics: Array.isArray(profile.horizonMetrics) ? profile.horizonMetrics.map((metric) => ({ ...metric })) : [],
      }))
      : [],
    realitySummary: run.realitySummary || buildRealitySummary(forwardReturns, Array.isArray(run.ideaRuns) ? run.ideaRuns : []),
    portfolioAccounting: clonePortfolioAccountingSnapshot(run.portfolioAccounting),
  };
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const cached = await getPersistentCache<PersistedReplayRuns>(REPLAY_RUNS_KEY);
    replayRuns = Array.isArray(cached?.data?.runs) ? cached!.data!.runs.map((run) => normalizeReplayRun(run)) : [];
  } catch (error) {
    console.warn('[historical-intelligence] load failed', error);
  }
}

async function persist(): Promise<void> {
  replayRuns = replayRuns
    .slice()
    .sort((a, b) => asTs(b.completedAt) - asTs(a.completedAt))
    .slice(0, MAX_REPLAY_RUNS);
  await setPersistentCache(REPLAY_RUNS_KEY, { runs: replayRuns });
}

function buildRunId(mode: HistoricalReplayRun['mode'], label: string): string {
  return `${mode}:${nowIso()}:${label.slice(0, 120)}`;
}

function normalizeFrames(frames: HistoricalReplayFrame[]): HistoricalReplayFrame[] {
  const normalized = frames
    .filter((frame) => Array.isArray(frame.news) && Array.isArray(frame.clusters) && Array.isArray(frame.markets))
    .map((frame, index) => ({
      ...frame,
      id: frame.id || `frame-${index + 1}`,
      validTimeStart: effectiveValidTimeStart(frame),
      validTimeEnd: frame.validTimeEnd ?? null,
      transactionTime: effectiveTransactionTime(frame),
      knowledgeBoundary: effectiveKnowledgeBoundary(frame),
      warmup: Boolean(frame.warmup),
    }))
    .sort((a, b) => {
      const txDelta = asTs(a.transactionTime || a.timestamp) - asTs(b.transactionTime || b.timestamp);
      if (txDelta !== 0) return txDelta;
      return asTs(a.timestamp) - asTs(b.timestamp);
    });
  return mergeFramesByTimestamp(normalized);
}

function buildPriceSeries(frames: HistoricalReplayFrame[]): Map<string, PricePoint[]> {
  const bySymbol = new Map<string, PricePoint[]>();
  for (const frame of frames) {
    const timestampBySymbol = parseMarketTimeMap(frame, 'marketTimestampJson');
    const knowledgeBySymbol = parseMarketTimeMap(frame, 'marketKnowledgeBoundaryJson');
    for (const market of frame.markets) {
      if (!market?.symbol || typeof market.price !== 'number' || !Number.isFinite(market.price)) continue;
      const pointTimestamp = timestampBySymbol[market.symbol] || effectiveValidTimeStart(frame);
      const transactionTime = knowledgeBySymbol[market.symbol] || effectiveTransactionTime(frame);
      const ts = asTs(pointTimestamp);
      const transactionTs = asTs(transactionTime);
      const bucket = bySymbol.get(market.symbol) || [];
      bucket.push({
        timestamp: pointTimestamp,
        ts,
        transactionTs,
        price: market.price,
      });
      bySymbol.set(market.symbol, bucket);
    }
  }

  for (const [symbol, series] of bySymbol.entries()) {
    const unique = new Map<number, PricePoint>();
    for (const point of series) unique.set(point.ts, point);
    bySymbol.set(symbol, Array.from(unique.values()).sort((a, b) => a.ts - b.ts));
  }
  return bySymbol;
}

function findNearestPrice(series: PricePoint[], targetTs: number, toleranceMs: number): PricePoint | null {
  let best: PricePoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const point of series) {
    const distance = Math.abs(point.ts - targetTs);
    if (distance > toleranceMs) continue;
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}

function findNextPriceAtOrAfter(series: PricePoint[], targetTs: number, lookaheadMs: number): PricePoint | null {
  for (const point of series) {
    if (point.ts < targetTs) continue;
    if (point.ts - targetTs > lookaheadMs) break;
    return point;
  }
  return null;
}

function estimateSeriesIntervalMs(series: PricePoint[]): number {
  if (series.length < 2) return 24 * 60 * 60 * 1000;
  const deltas: number[] = [];
  for (let index = 1; index < series.length; index += 1) {
    const delta = series[index]!.ts - series[index - 1]!.ts;
    if (delta > 0) deltas.push(delta);
  }
  if (!deltas.length) return 24 * 60 * 60 * 1000;
  deltas.sort((left, right) => left - right);
  return deltas[Math.floor(deltas.length / 2)] || 24 * 60 * 60 * 1000;
}

function seriesLookaheadMs(series: PricePoint[]): number {
  const intervalMs = estimateSeriesIntervalMs(series);
  return Math.max(12 * 60 * 60 * 1000, Math.min(21 * 24 * 60 * 60 * 1000, Math.round(intervalMs * 4.5)));
}

function sortUniqueHours(values: Array<number | null | undefined>): number[] {
  return Array.from(new Set(
    values
      .map((value) => Math.max(1, Math.round(Number(value) || 0)))
      .filter(Boolean),
  )).sort((a, b) => a - b);
}

function resolveIdeaRunHorizonCandidates(
  ideaRun: BacktestIdeaRun,
  series: PricePoint[],
  fallbackHours: number[],
): number[] {
  const explicit = sortUniqueHours(ideaRun.horizonCandidatesHours || []);
  if (explicit.length > 0) {
    return sortUniqueHours([
      ...explicit,
      ideaRun.preferredHorizonHours ?? null,
    ]);
  }
  const hinted = sortUniqueHours(fallbackHours);
  if (hinted.length > 0) {
    return sortUniqueHours([
      ...hinted,
      ideaRun.preferredHorizonHours ?? null,
    ]);
  }
  const intervalHours = Math.max(1, Math.round(estimateSeriesIntervalMs(series) / (60 * 60 * 1000)));
  return sortUniqueHours([
    ...deriveIntervalHorizonCandidates(intervalHours),
    ideaRun.preferredHorizonHours ?? null,
  ]);
}

function selectAdaptiveForwardReturns(
  forwardReturns: ForwardReturnRecord[],
  ideaRuns: BacktestIdeaRun[],
): ForwardReturnRecord[] {
  if (!forwardReturns.length) return [];
  const preferredByIdeaRun = new Map<string, number>();
  for (const run of ideaRuns) {
    if (typeof run.preferredHorizonHours === 'number' && Number.isFinite(run.preferredHorizonHours)) {
      preferredByIdeaRun.set(run.id, Math.max(1, Math.round(run.preferredHorizonHours)));
    }
  }
  const grouped = new Map<string, ForwardReturnRecord[]>();
  for (const record of forwardReturns) {
    const key = `${record.ideaRunId}::${record.symbol}`;
    const bucket = grouped.get(key) || [];
    bucket.push(record);
    grouped.set(key, bucket);
  }
  const selected: ForwardReturnRecord[] = [];
  for (const [key, bucket] of grouped.entries()) {
    const [ideaRunId = ''] = key.split('::');
    const preferred = preferredByIdeaRun.get(ideaRunId) ?? null;
    const sorted = bucket
      .slice()
      .sort((a, b) => a.horizonHours - b.horizonHours || asTs(a.exitTimestamp) - asTs(b.exitTimestamp));
    if (preferred == null) {
      selected.push(sorted[Math.floor(sorted.length / 2)] || sorted[0]!);
      continue;
    }
    const nearest = sorted.reduce<ForwardReturnRecord | null>((best, record) => {
      if (!best) return record;
      const recordDistance = Math.abs(record.horizonHours - preferred);
      const bestDistance = Math.abs(best.horizonHours - preferred);
      if (recordDistance !== bestDistance) return recordDistance < bestDistance ? record : best;
      return record.horizonHours < best.horizonHours ? record : best;
    }, null);
    if (nearest) selected.push(nearest);
  }
  return selected;
}

function buildIdeaRunsForFrame(
  runId: string,
  frame: HistoricalReplayFrame,
  snapshot: InvestmentIntelligenceSnapshot,
  lastRecordedByIdea: Map<string, { ts: number; conviction: number }>,
  dedupeWindowMs: number,
): BacktestIdeaRun[] {
  const signalTimestamp = effectiveKnowledgeBoundary(frame);
  const frameTs = asTs(signalTimestamp);
  const marketMap = new Map(
    frame.markets
      .filter((market) => typeof market.price === 'number' && Number.isFinite(market.price))
      .map((market) => [market.symbol, market.price as number] as const),
  );

  const runs: BacktestIdeaRun[] = [];
  for (const card of snapshot.ideaCards) {
    if (card.autonomyAction === 'abstain') continue;
    if ((card.sizePct || 0) <= 0) continue;
    if (typeof card.optimizedTargetWeightPct === 'number' && Math.abs(card.optimizedTargetWeightPct) <= 0) continue;
    const prev = lastRecordedByIdea.get(card.id);
    const duplicate =
      prev
      && frameTs - prev.ts < dedupeWindowMs
      && Math.abs(prev.conviction - card.conviction) < 8;
    if (duplicate) continue;

    const run: BacktestIdeaRun = {
      id: `${runId}:${frame.id}:${card.id}`,
      runId,
      frameId: frame.id || 'frame',
      generatedAt: signalTimestamp,
      title: card.title,
      themeId: card.themeId,
      region: regionFromIdeaCard(card),
      direction: card.direction,
      conviction: card.conviction,
      falsePositiveRisk: card.falsePositiveRisk,
      sizePct: card.sizePct,
      timeframe: card.timeframe,
      thesis: card.thesis,
      evidence: card.evidence.slice(),
      triggers: card.triggers.slice(),
      invalidation: card.invalidation.slice(),
      transmissionPath: card.transmissionPath.slice(),
      analogRefs: card.analogRefs.slice(),
      preferredHorizonHours: typeof card.preferredHorizonHours === 'number' ? card.preferredHorizonHours : null,
      horizonCandidatesHours: Array.isArray(card.horizonCandidatesHours) ? card.horizonCandidatesHours.slice() : [],
      horizonLearningConfidence: typeof card.horizonLearningConfidence === 'number' ? card.horizonLearningConfidence : null,
      symbols: card.symbols.map((symbol) => ({
        ...symbol,
        entryPrice: marketMap.get(symbol.symbol) ?? null,
      })),
    };
    runs.push(run);
    lastRecordedByIdea.set(card.id, { ts: frameTs, conviction: card.conviction });
  }

  return runs;
}

function buildForwardReturns(
  runId: string,
  ideaRuns: BacktestIdeaRun[],
  priceSeries: Map<string, PricePoint[]>,
  horizonsHours: number[],
): ForwardReturnRecord[] {
  const records: ForwardReturnRecord[] = [];
  for (const ideaRun of ideaRuns) {
    const signalTs = asTs(ideaRun.generatedAt);
    for (const symbolState of ideaRun.symbols) {
      const series = priceSeries.get(symbolState.symbol) || [];
      const symbolHorizonCandidates = resolveIdeaRunHorizonCandidates(ideaRun, series, horizonsHours);
      const intervalMs = estimateSeriesIntervalMs(series);
      const entryLookaheadMs = seriesLookaheadMs(series);
      const entryPoint =
        findNextPriceAtOrAfter(series, signalTs, entryLookaheadMs)
        || findNearestPrice(series, signalTs, Math.max(30 * 60 * 1000, intervalMs));
      const entryTimestamp = entryPoint?.timestamp ?? ideaRun.generatedAt;
      const entryTs = entryPoint?.ts ?? signalTs;
      const entryPrice =
        entryPoint?.price
        ?? (typeof symbolState.entryPrice === 'number' && Number.isFinite(symbolState.entryPrice)
          ? symbolState.entryPrice
          : null);
      const reality = assessExecutionReality({
        assetKind: symbolState.assetKind || 'equity',
        liquidityScore: typeof symbolState.liquidityScore === 'number' ? symbolState.liquidityScore : 58,
        marketMovePct: null,
        timestamp: entryTimestamp,
      });

      for (const horizonHours of symbolHorizonCandidates) {
        const targetTs = entryTs + horizonHours * 60 * 60 * 1000;
        const exitLookaheadMs = Math.max(
          seriesLookaheadMs(series),
          Math.max(intervalMs, Math.max(2, horizonHours / 2) * 60 * 60 * 1000),
        );
        const exitPoint =
          findNextPriceAtOrAfter(
            series,
            targetTs,
            exitLookaheadMs,
          )
          || findNearestPrice(series, targetTs, exitLookaheadMs);
        const exitPrice = exitPoint?.price ?? null;
        const rawReturnPct =
          entryPrice && exitPrice
            ? Number((((exitPrice - entryPrice) / entryPrice) * 100).toFixed(2))
            : null;
        const signedReturnPct =
          rawReturnPct == null
            ? null
            : Number((rawReturnPct * directionMultiplier(symbolState.direction)).toFixed(2));
        const costAdjustedSignedReturnPct =
          signedReturnPct == null
            ? null
            : Number((signedReturnPct - reality.executionPenaltyPct).toFixed(2));

        records.push({
          id: `${ideaRun.id}:${symbolState.symbol}:${horizonHours}h`,
          runId,
          ideaRunId: ideaRun.id,
          symbol: symbolState.symbol,
          direction: symbolState.direction,
          horizonHours,
          entryTimestamp,
          exitTimestamp: exitPoint?.timestamp ?? null,
          entryPrice,
          exitPrice,
          rawReturnPct,
          signedReturnPct,
          costAdjustedSignedReturnPct,
          executionPenaltyPct: reality.executionPenaltyPct,
          realityScore: reality.realityScore,
          sessionState: reality.sessionState,
          tradableNow: reality.tradableNow,
          spreadBps: reality.spreadBps,
          slippageBps: reality.slippageBps,
          liquidityPenaltyPct: reality.liquidityPenaltyPct,
          realityNotes: reality.notes.slice(0, 4),
        });
      }
    }
  }
  return records;
}

function buildSummaryLines(
  frameCount: number,
  warmupFrameCount: number,
  ideaRuns: BacktestIdeaRun[],
  forwardReturns: ForwardReturnRecord[],
  sourceProfiles: SourceCredibilityProfile[],
  mappingStats: MappingPerformanceStats[],
  _checkpoints: ReplayCheckpoint[],
  themeProfiles: ReplayThemeProfile[],
  windows?: WalkForwardWindow[],
  portfolioAccounting?: PortfolioAccountingSnapshot | null,
): string[] {
  const reality = buildRealitySummary(forwardReturns, ideaRuns);
  const avgCredibility = sourceProfiles.length > 0
    ? Math.round(average(sourceProfiles.map((row) => row.posteriorAccuracyScore)))
    : 0;
  const avgMappingPosterior = mappingStats.length > 0
    ? Math.round(average(mappingStats.map((row) => row.posteriorWinRate)))
    : 0;
  const topThemeLines = themeProfiles
    .slice(0, 4)
    .map((profile) => `${profile.themeId}:${profile.timeframe} (${profile.confidence})`);
  const portfolio = portfolioAccounting?.summary || null;

  return [
    `${frameCount} point-in-time frames processed, ${Math.max(0, frameCount - warmupFrameCount)} evaluated, ${warmupFrameCount} reserved for warm-up.`,
    `${forwardReturns.length} forward-return labels generated across ${new Set(forwardReturns.map((row) => row.symbol)).size} symbols and ${new Set(forwardReturns.map((row) => row.horizonHours)).size} horizons.`,
    `${reality.primaryHorizonHours}h adaptive primary horizon raw hit-rate ${reality.rawHitRate}% / cost-adjusted hit-rate ${reality.costAdjustedHitRate}% with raw avg ${reality.rawAvgReturnPct}% and cost-adjusted avg ${reality.costAdjustedAvgReturnPct}%.`,
    `Avg execution penalty ${reality.avgExecutionPenaltyPct}% with reality score ${reality.avgRealityScore} and non-tradable rate ${reality.nonTradableRate}%.`,
    portfolio
      ? `Portfolio accounting: NAV ${portfolio.initialCapital} -> ${portfolio.finalCapital} (${portfolio.totalReturnPct}%), CAGR ${portfolio.cagrPct}%, max drawdown ${portfolio.maxDrawdownPct}%, Sharpe ${portfolio.sharpeRatio}, avg cash ${portfolio.avgCashPct}%, avg gross exposure ${portfolio.avgGrossExposurePct}%.`
      : 'Portfolio accounting snapshot not available yet.',
    `Learned source posterior avg ${avgCredibility} and mapping posterior avg ${avgMappingPosterior}.`,
    topThemeLines.length > 0
      ? `Learned theme horizons: ${topThemeLines.join(' | ')}.`
      : 'No replay-backed theme horizon profiles learned yet.',
    windows && windows.length > 0
      ? `${windows.map((window) => `${window.phase}:${window.frameCount}`).join(' | ')}`
      : 'Single replay window executed.',
  ];
}

function buildRealitySummary(
  forwardReturns: ForwardReturnRecord[],
  ideaRuns: BacktestIdeaRun[],
): RealityAwareBacktestSummary {
  const adaptivePrimary = selectAdaptiveForwardReturns(forwardReturns, ideaRuns)
    .filter((row) => typeof row.signedReturnPct === 'number');
  const primary = adaptivePrimary.length > 0 ? adaptivePrimary : forwardReturns.filter((row) => typeof row.signedReturnPct === 'number');
  const horizonCounts = new Map<number, number>();
  for (const row of primary) {
    horizonCounts.set(row.horizonHours, (horizonCounts.get(row.horizonHours) || 0) + 1);
  }
  const primaryHorizonHours = Array.from(horizonCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] || 24;
  const rawHitRate = primary.length > 0
    ? Math.round((primary.filter((row) => (row.signedReturnPct || 0) > 0).length / primary.length) * 100)
    : 0;
  const costAdjustedRows = primary.filter((row) => typeof row.costAdjustedSignedReturnPct === 'number');
  const costAdjustedHitRate = costAdjustedRows.length > 0
    ? Math.round((costAdjustedRows.filter((row) => (row.costAdjustedSignedReturnPct || 0) > 0).length / costAdjustedRows.length) * 100)
    : 0;
  const rawAvgReturnPct = primary.length > 0
    ? Number(average(primary.map((row) => row.signedReturnPct || 0)).toFixed(2))
    : 0;
  const costAdjustedAvgReturnPct = costAdjustedRows.length > 0
    ? Number(average(costAdjustedRows.map((row) => row.costAdjustedSignedReturnPct || 0)).toFixed(2))
    : 0;
  const avgExecutionPenaltyPct = primary.length > 0
    ? Number(average(primary.map((row) => row.executionPenaltyPct || 0)).toFixed(2))
    : 0;
  const avgRealityScore = primary.length > 0
    ? Math.round(average(primary.map((row) => row.realityScore || 0)))
    : 0;
  const nonTradableRate = primary.length > 0
    ? Math.round((primary.filter((row) => !row.tradableNow).length / primary.length) * 100)
    : 0;

  return {
    primaryHorizonHours,
    rawHitRate,
    costAdjustedHitRate,
    rawAvgReturnPct,
    costAdjustedAvgReturnPct,
    avgExecutionPenaltyPct,
    avgRealityScore,
    nonTradableRate,
  };
}

function buildThemeRegimeMetrics(
  frames: HistoricalReplayFrame[],
  ideaRuns: BacktestIdeaRun[],
  forwardReturns: ForwardReturnRecord[],
): ReplayThemeRegimeMetric[] {
  const frameById = new Map(frames.map((frame) => [String(frame.id || ''), frame] as const));
  const ideaRunById = new Map(ideaRuns.map((ideaRun) => [ideaRun.id, ideaRun] as const));
  const buckets = new Map<string, {
    themeId: string;
    regimeId: string;
    sampleSize: number;
    positives: number;
    returns: number[];
    confirmationScores: number[];
  }>();

  for (const record of forwardReturns) {
    if (typeof record.costAdjustedSignedReturnPct !== 'number') continue;
    const ideaRun = ideaRunById.get(record.ideaRunId);
    if (!ideaRun) continue;
    const frame = frameById.get(String(ideaRun.frameId || ''));
    const regimeId = String(frame?.transmission?.regime?.id || 'unknown').trim() || 'unknown';
    const themeId = String(ideaRun.themeId || '').trim().toLowerCase();
    if (!themeId) continue;
    const bucketKey = `${themeId}::${regimeId}`;
    const bucket = buckets.get(bucketKey) || {
      themeId,
      regimeId,
      sampleSize: 0,
      positives: 0,
      returns: [],
      confirmationScores: [],
    };
    const avgReality = ideaRun.symbols.length > 0
      ? average(ideaRun.symbols.map((symbol) => Number(symbol.realityScore) || 0))
      : 0;
    bucket.sampleSize += 1;
    if ((record.costAdjustedSignedReturnPct || 0) > 0) bucket.positives += 1;
    bucket.returns.push(record.costAdjustedSignedReturnPct || 0);
    bucket.confirmationScores.push(
      clamp(Math.round(ideaRun.conviction * 0.5 + avgReality * 0.35 + (record.tradableNow ? 15 : 0)), 0, 100),
    );
    buckets.set(bucketKey, bucket);
  }

  return Array.from(buckets.values())
    .filter((bucket) => bucket.sampleSize > 0)
    .map((bucket) => ({
      themeId: bucket.themeId,
      regimeId: bucket.regimeId,
      sampleSize: bucket.sampleSize,
      hitRate: Math.round((bucket.positives / Math.max(1, bucket.sampleSize)) * 100),
      costAdjustedAvgReturnPct: Number(average(bucket.returns).toFixed(2)),
      confirmationScore: Number(average(bucket.confirmationScores).toFixed(2)),
    }))
    .sort((a, b) => b.sampleSize - a.sampleSize || b.confirmationScore - a.confirmationScore);
}

async function executeReplay(args: {
  mode: HistoricalReplayRun['mode'];
  label: string;
  frames: HistoricalReplayFrame[];
  horizonsHours: number[];
  retainLearningState: boolean;
  recordAdaptation?: boolean;
  investmentContext?: InvestmentIntelligenceContext;
  dedupeWindowHours?: number;
  warmupFrameCount?: number;
  warmupUntil?: string;
  transactionTimeCeiling?: string;
  knowledgeBoundaryCeiling?: string;
  seedState?: HistoricalReplayOptions['seedState'];
  windows?: WalkForwardWindow[];
}): Promise<HistoricalReplayRun> {
  await ensureLoaded();
  const frames = normalizeFrames(args.frames).filter((frame) => {
    const transactionAllowed =
      !args.transactionTimeCeiling
      || asTs(frame.transactionTime || frame.timestamp) <= asTs(args.transactionTimeCeiling);
    const knowledgeAllowed =
      !args.knowledgeBoundaryCeiling
      || asTs(frame.knowledgeBoundary || frame.timestamp) <= asTs(args.knowledgeBoundaryCeiling);
    return transactionAllowed && knowledgeAllowed;
  });
  const runId = buildRunId(args.mode, args.label);
  const originalSourceState = await exportSourceCredibilityState();
  const originalInvestmentState = await exportInvestmentLearningState();
  const dedupeWindowMs = Math.max(1, args.dedupeWindowHours ?? 6) * 60 * 60 * 1000;
  const warmupUntilTs = args.warmupUntil ? asTs(args.warmupUntil) : 0;

  try {
    await resetSourceCredibilityState(args.seedState?.sourceProfiles ?? []);
    await resetInvestmentLearningState(args.seedState?.investmentLearning);
    const baseReplayAdaptation = await getReplayAdaptationSnapshot();

    const checkpoints: ReplayCheckpoint[] = [];
    const ideaRuns: BacktestIdeaRun[] = [];
    const lastRecordedByIdea = new Map<string, { ts: number; conviction: number }>();
    let lastWorkflowWithSignal: InvestmentIntelligenceSnapshot['workflow'] = [];
    let lastWorkflowWithExecution: InvestmentIntelligenceSnapshot['workflow'] = [];
    let lastWorkflowWithIdeaCards: InvestmentIntelligenceSnapshot['workflow'] = [];
    let warmupFramesApplied = 0;
    let evaluationFrameCount = 0;

    for (const [index, frame] of frames.entries()) {
      const warmupByCount = Number(args.warmupFrameCount || 0) > 0 && index < Number(args.warmupFrameCount || 0);
      const warmupByTime = warmupUntilTs > 0 && asTs(frame.transactionTime || frame.timestamp) <= warmupUntilTs;
      const evaluationEligible = !(Boolean(frame.warmup) || warmupByCount || warmupByTime);
      if (!evaluationEligible) warmupFramesApplied += 1;
      else evaluationFrameCount += 1;

      const sourceProfiles = await recomputeSourceCredibility(frame.news, frame.clusters);
      const transmission = frame.transmission
        ?? (
          frame.markets.length > 0 && (frame.news.length > 0 || frame.clusters.length > 0)
            ? await recomputeEventMarketTransmission({
              news: frame.news,
              clusters: frame.clusters,
              markets: frame.markets,
              keywordGraph: null,
            }).catch(() => null)
            : null
        );
      const snapshot = await recomputeInvestmentIntelligence({
        clusters: frame.clusters,
        markets: frame.markets,
        transmission,
        sourceCredibility: sourceProfiles,
        reports: frame.reports ?? [],
        keywordGraph: null,
        timestamp: frame.transactionTime || frame.timestamp,
        context: args.investmentContext || 'replay',
        replayAdaptation: baseReplayAdaptation,
        recordCurrentThemePerformance: false,
      });
      if (evaluationEligible && (snapshot.falsePositive.kept > 0 || snapshot.directMappings.length > 0 || snapshot.ideaCards.length > 0)) {
        lastWorkflowWithSignal = snapshot.workflow.slice();
        if (snapshot.directMappings.length > 0) {
          lastWorkflowWithExecution = snapshot.workflow.slice();
        }
        if (snapshot.ideaCards.length > 0) {
          lastWorkflowWithIdeaCards = snapshot.workflow.slice();
        }
      }

      checkpoints.push({
        id: `${runId}:${frame.id}`,
        timestamp: frame.timestamp,
        validTimeStart: frame.validTimeStart || frame.timestamp,
        validTimeEnd: frame.validTimeEnd ?? null,
        transactionTime: frame.transactionTime || frame.timestamp,
        knowledgeBoundary: frame.knowledgeBoundary || frame.timestamp,
        evaluationEligible,
        frameId: frame.id || 'frame',
        newsCount: frame.news.length,
        clusterCount: frame.clusters.length,
        marketCount: frame.markets.length,
        ideaCount: snapshot.ideaCards.length,
        trackedIdeaCount: snapshot.trackedIdeas.length,
        sourceProfileCount: sourceProfiles.length,
        mappingStatCount: (await listMappingPerformanceStats(10_000)).length,
      });

      if (evaluationEligible) {
        ideaRuns.push(
          ...buildIdeaRunsForFrame(runId, frame, snapshot, lastRecordedByIdea, dedupeWindowMs),
        );
      }
    }

    const mappingStats = await listMappingPerformanceStats(10_000);
    const sourceProfiles = await exportSourceCredibilityState();
    const priceSeries = buildPriceSeries(frames);
    const forwardReturns = buildForwardReturns(runId, ideaRuns, priceSeries, args.horizonsHours);
    const realitySummary = buildRealitySummary(forwardReturns, ideaRuns);
    const coverageLedger = buildCoverageLedgerFromFrames(
      frames,
      ideaRuns.map((ideaRun) => ({ frameId: ideaRun.frameId, themeId: ideaRun.themeId })),
    );
    const themeRegimeMetrics = buildThemeRegimeMetrics(frames, ideaRuns, forwardReturns);
    const portfolioAccounting = computePortfolioAccountingSnapshot({
      frames,
      ideaRuns,
      forwardReturns,
      initialCapital: 100,
    });
    const finalSnapshot = await exportInvestmentLearningState();

    let run: HistoricalReplayRun = {
      id: runId,
      label: args.label,
      mode: args.mode,
      startedAt: frames[0]?.timestamp || nowIso(),
      completedAt: nowIso(),
      temporalMode: 'bitemporal',
      retainLearningState: args.retainLearningState,
      frameCount: frames.length,
      warmupFrameCount: warmupFramesApplied,
      evaluationFrameCount,
      horizonsHours: sortUniqueHours(forwardReturns.map((record) => record.horizonHours)),
      checkpoints,
      ideaRuns,
      forwardReturns,
      sourceProfiles,
      mappingStats,
      banditStates: finalSnapshot.banditStates,
      candidateReviews: finalSnapshot.candidateReviews,
      workflow: [],
      themeHorizonProfiles: [],
      themeRegimeMetrics,
      coverageLedger,
      realitySummary,
      portfolioAccounting,
      summaryLines: [],
      windows: args.windows,
    };
    const adaptationSnapshot = args.recordAdaptation === false
      ? (await getReplayAdaptationSnapshot()) || emptyReplayAdaptationSnapshot()
      : await recordReplayRunAdaptation(run);
    const runThemeIds = new Set(run.ideaRuns.map((ideaRun) => String(ideaRun.themeId || '').trim().toLowerCase()).filter(Boolean));
    const runThemeProfiles = adaptationSnapshot.themeProfiles
      .filter((profile) => runThemeIds.has(String(profile.themeId || '').trim().toLowerCase()))
      .slice(0, 12);
    run = {
      ...run,
      workflow: buildReplayDrivenWorkflow(adaptationSnapshot, {
        detectCount: finalSnapshot.snapshot?.falsePositive?.kept ?? lastWorkflowWithSignal[0]?.metric ?? 0,
        mappingCount: finalSnapshot.snapshot?.directMappings?.length ?? lastWorkflowWithExecution[2]?.metric ?? 0,
        ideaCount: finalSnapshot.snapshot?.ideaCards?.length ?? lastWorkflowWithIdeaCards[4]?.metric ?? 0,
        trackedOpen: finalSnapshot.snapshot?.trackedIdeas?.filter((idea) => idea.status === 'open').length ?? 0,
        trackedClosed: finalSnapshot.snapshot?.trackedIdeas?.filter((idea) => idea.status === 'closed').length ?? 0,
      }),
      themeHorizonProfiles: runThemeProfiles,
      summaryLines: buildSummaryLines(
        frames.length,
        warmupFramesApplied,
        ideaRuns,
        forwardReturns,
        sourceProfiles,
        mappingStats,
        checkpoints,
        runThemeProfiles,
        args.windows,
        portfolioAccounting,
      ),
    };

    if (args.recordAdaptation !== false) {
      replayRuns.unshift(run);
      await persist();
    }
    await logSourceOpsEvent({
      kind: 'report',
      action: 'generated',
      actor: 'system',
      title: args.mode === 'walk-forward' ? 'Walk-forward backtest completed' : 'Historical replay completed',
      detail: `frames=${run.frameCount} ideaRuns=${ideaRuns.length} forwardReturns=${forwardReturns.length} retain=${args.retainLearningState ? 'yes' : 'no'}`,
      status: 'ok',
      category: 'backtest',
    });
    if (args.recordAdaptation !== false) {
      await archiveHistoricalReplayRun(run).catch(() => false);
    }
    return run;
  } finally {
    if (!args.retainLearningState) {
      await resetSourceCredibilityState(originalSourceState);
      await resetInvestmentLearningState(originalInvestmentState);
    }
  }
}

function splitWalkForwardWindows(
  frames: HistoricalReplayFrame[],
  trainRatio: number,
  validateRatio: number,
): WalkForwardWindow[] {
  const total = frames.length;
  if (total < 6) {
    return [
      {
        phase: 'train',
        from: frames[0]?.timestamp || nowIso(),
        to: frames[Math.max(0, total - 1)]?.timestamp || nowIso(),
        frameCount: total,
      },
    ];
  }

  const safeTrainRatio = clamp(trainRatio, 0.4, 0.8);
  const safeValidateRatio = clamp(validateRatio, 0.1, 0.3);
  const trainCount = Math.max(2, Math.floor(total * safeTrainRatio));
  const validateCount = Math.max(2, Math.floor(total * safeValidateRatio));
  const testCount = Math.max(2, total - trainCount - validateCount);
  const adjustedTrainCount = total - validateCount - testCount;

  const windows: WalkForwardWindow[] = [];
  const trainFrames = frames.slice(0, adjustedTrainCount);
  if (trainFrames.length > 0) {
    windows.push({
      phase: 'train',
      from: trainFrames[0]!.timestamp,
      to: trainFrames[trainFrames.length - 1]!.timestamp,
      frameCount: trainFrames.length,
    });
  }
  const validateFrames = frames.slice(adjustedTrainCount, adjustedTrainCount + validateCount);
  if (validateFrames.length > 0) {
    windows.push({
      phase: 'validate',
      from: validateFrames[0]!.timestamp,
      to: validateFrames[validateFrames.length - 1]!.timestamp,
      frameCount: validateFrames.length,
    });
  }
  const testFrames = frames.slice(adjustedTrainCount + validateCount);
  if (testFrames.length > 0) {
    windows.push({
      phase: 'test',
      from: testFrames[0]!.timestamp,
      to: testFrames[testFrames.length - 1]!.timestamp,
      frameCount: testFrames.length,
    });
  }
  return windows;
}

export async function runHistoricalReplay(
  frames: HistoricalReplayFrame[],
  options: HistoricalReplayOptions = {},
): Promise<HistoricalReplayRun> {
  const normalized = normalizeFrames(frames);
  return measureResourceOperation(
    'backtest:historical-replay',
    {
      label: options.label || 'Historical Replay',
      kind: 'backtest',
      feature: 'historical-replay',
      inputCount: normalized.length,
      sampleStorage: true,
    },
    async () => executeReplay({
      mode: 'replay',
      label: options.label || 'Historical Replay',
      frames: normalized,
      horizonsHours: (options.horizonsHours || DEFAULT_HORIZONS_HOURS).slice(),
      retainLearningState: Boolean(options.retainLearningState),
      dedupeWindowHours: options.dedupeWindowHours,
      warmupFrameCount: options.warmupFrameCount,
      warmupUntil: options.warmupUntil,
      transactionTimeCeiling: options.transactionTimeCeiling,
      knowledgeBoundaryCeiling: options.knowledgeBoundaryCeiling,
      seedState: options.seedState,
      recordAdaptation: options.recordAdaptation,
      investmentContext: options.investmentContext,
    }),
    (run) => ({
      outputCount: run.ideaRuns.length + run.forwardReturns.length,
      sampleStorage: true,
    }),
  );
}

export async function runWalkForwardBacktest(
  frames: HistoricalReplayFrame[],
  options: WalkForwardBacktestOptions = {},
): Promise<HistoricalReplayRun> {
  const normalized = normalizeFrames(frames);
  return measureResourceOperation(
    'backtest:walk-forward',
    {
      label: options.label || 'Walk-Forward Backtest',
      kind: 'backtest',
      feature: 'walk-forward',
      inputCount: normalized.length,
      sampleStorage: true,
    },
    async () => {
      const windows = splitWalkForwardWindows(normalized, options.trainRatio ?? 0.6, options.validateRatio ?? 0.2);

      const trainWindow = windows.find((window) => window.phase === 'train');
      const validateWindow = windows.find((window) => window.phase === 'validate');
      const testWindow = windows.find((window) => window.phase === 'test');
      const trainFrames = normalized.slice(0, trainWindow?.frameCount ?? normalized.length);

      const trainRun = await executeReplay({
        mode: 'replay',
        label: `${options.label || 'Walk-Forward'} / train`,
        frames: trainFrames,
        horizonsHours: (options.horizonsHours || DEFAULT_HORIZONS_HOURS).slice(),
        retainLearningState: false,
        dedupeWindowHours: options.dedupeWindowHours,
        warmupFrameCount: trainFrames.length,
        warmupUntil: trainFrames[trainFrames.length - 1]?.transactionTime || trainFrames[trainFrames.length - 1]?.timestamp,
        transactionTimeCeiling: trainFrames[trainFrames.length - 1]?.transactionTime || trainFrames[trainFrames.length - 1]?.timestamp,
        knowledgeBoundaryCeiling: trainFrames[trainFrames.length - 1]?.knowledgeBoundary || trainFrames[trainFrames.length - 1]?.timestamp,
        seedState: options.seedState,
        windows: trainWindow ? [trainWindow] : undefined,
        recordAdaptation: options.recordAdaptation,
        investmentContext: options.investmentContext,
      });

      const trainingState = {
        sourceProfiles: trainRun.sourceProfiles,
        investmentLearning: {
          mappingStats: trainRun.mappingStats,
          banditStates: trainRun.banditStates ?? [],
          candidateReviews: trainRun.candidateReviews ?? [],
        } satisfies Partial<InvestmentLearningState>,
      };

      const evalStart = trainWindow?.frameCount ?? 0;
      const validateFrames = validateWindow ? normalized.slice(evalStart, evalStart + validateWindow.frameCount) : [];
      const testFrames = testWindow ? normalized.slice(evalStart + validateFrames.length) : [];
      const evalFrames = [...validateFrames, ...testFrames];

      return executeReplay({
        mode: 'walk-forward',
        label: options.label || 'Walk-Forward Backtest',
        frames: evalFrames,
        horizonsHours: (options.horizonsHours || DEFAULT_HORIZONS_HOURS).slice(),
        retainLearningState: Boolean(options.retainLearningState),
        dedupeWindowHours: options.dedupeWindowHours,
        warmupFrameCount: options.warmupFrameCount,
        warmupUntil: options.warmupUntil,
        transactionTimeCeiling: options.transactionTimeCeiling,
        knowledgeBoundaryCeiling: options.knowledgeBoundaryCeiling,
        seedState: trainingState,
        windows: windows.filter((window) => window.phase !== 'train'),
        recordAdaptation: options.recordAdaptation,
        investmentContext: options.investmentContext,
      });
    },
    (run) => ({
      outputCount: run.ideaRuns.length + run.forwardReturns.length,
      sampleStorage: true,
    }),
  );
}

export async function listHistoricalReplayRuns(limit = 10): Promise<HistoricalReplayRun[]> {
  await ensureLoaded();
  return replayRuns.slice(0, Math.max(1, limit));
}

export async function getHistoricalReplayRun(runId: string): Promise<HistoricalReplayRun | null> {
  await ensureLoaded();
  return replayRuns.find((run) => run.id === runId) || null;
}

export async function getBacktestOpsSnapshot(limit = 6): Promise<BacktestOpsSnapshot> {
  await ensureLoaded();
  const recentRuns = replayRuns
    .slice()
    .sort((left, right) => asTs(right.completedAt) - asTs(left.completedAt))
    .slice(0, Math.max(1, limit));
  const adaptationSnapshot = await getReplayAdaptationSnapshot();
  return buildBacktestOpsSnapshot(recentRuns, adaptationSnapshot);
}
