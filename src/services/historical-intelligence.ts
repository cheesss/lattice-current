import type { ClusteredEvent, MarketData, NewsItem } from '@/types';
import { BACKTEST_REPLAY_TUNING } from '@/config/intelligence-tuning';
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
import { assessExecutionReality } from './autonomy-constraints';
import { getPersistentCache, setPersistentCache } from './persistent-cache';
import {
  exportInvestmentLearningState,
  listMappingPerformanceStats,
  resetInvestmentLearningState,
} from './investment-intelligence';
import { mappingStats as mappingStatsMap } from './investment/module-state';
import { appendMarketHistory, updateTrackedIdeas } from './investment/idea-tracker';
import { updateMappingPerformanceStats } from './investment/mapping-performance';
import { buildEventCandidates, buildDirectMappings, buildIdeaCards, applyAdaptiveConfirmationLayer } from './investment/idea-generator';
import { applyPortfolioExecutionControls } from './investment/portfolio-optimizer';
import { buildShadowControlState } from './autonomy-constraints';
import { buildMacroRiskOverlay } from './macro-risk-overlay';
import { buildCoverageLedgerFromMappings } from './coverage-ledger';
import { getActiveWeightProfileSync } from './experiment-registry';
import { optimizeAdmissionThresholds } from './investment/adaptive-params/threshold-optimizer.js';
import type { AdmissionThresholds } from './investment/adaptive-params/threshold-optimizer.js';
import { createInitialMLState, extractMLTrainingSamples, trainEnsembleModels, buildPreTrainingQuery, convertPreTrainingRows, type MLWalkForwardState } from './investment/adaptive-params/ml-walk-forward.js';
import { computeCPCV, permutationTest as runPermutationTest } from './investment/adaptive-params/cpcv.js';
import { knnPredictionFromRagCases, type KNNPrediction } from './investment/adaptive-params/embedding-knn.js';
import { computeGDELTTransmissionProxy, type GDELTDailyAgg, type TransmissionProxy } from './investment/adaptive-params/transmission-proxy.js';
import {
  exportSourceCredibilityState,
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
  themeClassification?: InvestmentIdeaCard['themeClassification'];
  region: string;
  direction: InvestmentDirection;
  conviction: number;
  falsePositiveRisk: number;
  sizePct: number;
  timeframe: string;
  calibratedConfidence?: number;
  realityScore?: number;
  graphSignalScore?: number;
  narrativeAlignmentScore?: number;
  narrativeShadowState?: InvestmentIdeaCard['narrativeShadowState'];
  narrativeShadowPosterior?: number;
  narrativeShadowDisagreement?: number;
  narrativeShadowTopThemeId?: string | null;
  recentEvidenceScore?: number;
  corroborationQuality?: number;
  transferEntropy?: number;
  banditScore?: number;
  regimeMultiplier?: number;
  confirmationScore?: number;
  confirmationState?: InvestmentIdeaCard['confirmationState'];
  coveragePenalty?: number;
  metaHitProbability?: number;
  metaExpectedReturnPct?: number;
  metaDecisionScore?: number;
  admissionState?: InvestmentIdeaCard['admissionState'];
  continuousConviction?: number;
  clusterConfidence?: number;
  marketStressPrior?: number;
  transmissionStress?: number | null;
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
  maxDrawdownPct: number | null;
  riskAdjustedReturn: number | null;
  bestReturnPct: number | null;
  priceGapPct: number | null;
  maxHoldingHours: number;
  exitReason: 'target-horizon' | 'trailing-stop' | 'max-hold-fallback' | 'no-exit-price';
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

export interface ReplayConfidenceInterval {
  lower: number;
  upper: number;
  confidenceLevel: number;
  sampleSize: number;
}

export interface ReplayStatisticalSummary {
  costAdjustedAvgReturnPctCi95: ReplayConfidenceInterval | null;
  costAdjustedHitRateCi95: ReplayConfidenceInterval | null;
  rawAvgReturnPctCi95: ReplayConfidenceInterval | null;
  sharpeRatioCi95: ReplayConfidenceInterval | null;
}

export interface ReplayCpcvPathSummary {
  pathCount: number;
  combinationSize: number;
  returnPct05: number;
  returnPct50: number;
  returnPct95: number;
  sharpePct05: number;
  sharpePct50: number;
  sharpePct95: number;
  maxDrawdownPct05: number;
}

export interface ReplayDsrSummary {
  observedSharpe: number;
  benchmarkSharpe: number;
  deflatedSharpeRatio: number;
  trialCount: number;
  sampleSize: number;
}

export interface ReplayPboSummary {
  probability: number;
  negativePathShare: number;
  pathCount: number;
  method: 'fold-combination-proxy';
}

export interface ReplayPromotionDecision {
  state: 'promote' | 'shadow' | 'reject';
  score: number;
  reasons: string[];
}

export interface ReplayGovernanceSummary {
  cpcv: ReplayCpcvPathSummary | null;
  dsr: ReplayDsrSummary | null;
  pbo: ReplayPboSummary | null;
  cpcvReal?: { pbo: number; oosRankMedian: number; logitPBO: number; pathCount: number } | null;
  permutationTest?: { observedSharpe: number; pValue: number; nPermutations: number } | null;
  promotion: ReplayPromotionDecision;
}

export interface ReplayThemeRegimeMetric {
  themeId: string;
  regimeId: string;
  sampleSize: number;
  hitRate: number;
  costAdjustedAvgReturnPct: number;
  confirmationScore: number;
}

export interface ReplayDiagnosticRow {
  key: string;
  label: string;
  sampleSize: number;
  hitRate: number;
  rawAvgReturnPct: number;
  costAdjustedAvgReturnPct: number;
  avgExecutionPenaltyPct: number;
  tradableRate: number;
  avgConviction: number;
  avgFalsePositiveRisk: number;
  sharePct: number;
}

export interface ReplayDiagnosticsSnapshot {
  generatedAt: string;
  themes: ReplayDiagnosticRow[];
  symbols: ReplayDiagnosticRow[];
  horizons: ReplayDiagnosticRow[];
}

export interface LockedOosSummary {
  frameCount: number;
  ideaRunCount: number;
  forwardReturnCount: number;
  realitySummary: RealityAwareBacktestSummary;
  statisticalSummary?: ReplayStatisticalSummary | null;
  diagnostics?: ReplayDiagnosticsSnapshot | null;
  portfolioAccounting?: PortfolioAccountingSnapshot | null;
  governance?: ReplayGovernanceSummary | null;
  windows?: WalkForwardWindow[];
  summaryLines: string[];
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
  fold: number;
  phase: 'train' | 'validate' | 'test' | 'oos';
  from: string;
  to: string;
  frameCount: number;
}

interface WalkForwardFoldPlan {
  fold: number;
  trainWindow: WalkForwardWindow;
  evaluationWindows: WalkForwardWindow[];
  trainFrames: HistoricalReplayFrame[];
  evaluationFrames: HistoricalReplayFrame[];
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
  diagnostics?: ReplayDiagnosticsSnapshot | null;
  coverageLedger?: CoverageLedgerSnapshot | null;
  realitySummary: RealityAwareBacktestSummary;
  statisticalSummary?: ReplayStatisticalSummary | null;
  portfolioAccounting?: PortfolioAccountingSnapshot | null;
  lockedOosSummary?: LockedOosSummary | null;
  governance?: ReplayGovernanceSummary | null;
  summaryLines: string[];
  windows?: WalkForwardWindow[];
}

export interface HistoricalReplayOptions {
  label?: string;
  horizonsHours?: number[];
  retainLearningState?: boolean;
  causalIntegrityMode?: 'strict' | 'batched';
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
  foldCount?: number;
  holdoutRatio?: number;
  holdoutMinFrames?: number;
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
const DEFAULT_HORIZONS_HOURS: number[] = [48, 168, 336];

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

function assertFrameTemporalConsistency(frame: HistoricalReplayFrame): void {
  const validTimeStartTs = asTs(frame.validTimeStart || frame.timestamp);
  const transactionTimeTs = asTs(frame.transactionTime || frame.knowledgeBoundary || frame.timestamp);
  const knowledgeBoundaryTs = asTs(frame.knowledgeBoundary || frame.transactionTime || frame.timestamp);

  if (validTimeStartTs > transactionTimeTs) {
    throw new Error(
      `[historical-intelligence] invalid frame order: validTimeStart > transactionTime for frame=${frame.id || frame.timestamp}`,
    );
  }
  if (transactionTimeTs > knowledgeBoundaryTs) {
    throw new Error(
      `[historical-intelligence] invalid frame order: transactionTime > knowledgeBoundary for frame=${frame.id || frame.timestamp}`,
    );
  }
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
  const uniqueTransactionTimes = Array.from(new Set(transactionTimes));
  const mergeConflictReasons = [
    datasetIds.length > 1 ? `datasets=${datasetIds.length}` : '',
    sourceVersions.length > 1 ? `sourceVersions=${sourceVersions.length}` : '',
    uniqueTransactionTimes.length > 1 ? `transactionTimes=${uniqueTransactionTimes.length}` : '',
  ].filter(Boolean);
  const mergedMarketTimestampMap = mergeFrameMarketTimeMap(sorted, 'marketTimestampJson');
  const mergedMarketKnowledgeMap = mergeFrameMarketTimeMap(sorted, 'marketKnowledgeBoundaryJson');
  const metadata = Object.assign({}, ...sorted.map((frame) => frame.metadata || {}), {
    mergedFrameCount: sorted.length,
    mergedDatasetIds: datasetIds.join(',') || null,
    mergedConflictCount: mergeConflictReasons.length,
    mergedConflictReasons: mergeConflictReasons.join(',') || null,
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
    const key = `${frame.timestamp || ''}::${effectiveTransactionTime(frame)}::${effectiveKnowledgeBoundary(frame)}`;
    const bucket = groups.get(key) || [];
    bucket.push(frame);
    groups.set(key, bucket);
  }
  return Array.from(groups.entries())
    .sort((left, right) => {
      const [leftTimestamp = '', leftTransaction = ''] = left[0].split('::');
      const [rightTimestamp = '', rightTransaction = ''] = right[0].split('::');
      return asTs(leftTransaction || leftTimestamp) - asTs(rightTransaction || rightTimestamp);
    })
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

function buildReplayIdeaSignature(card: Pick<BacktestIdeaRun, 'themeId' | 'direction' | 'symbols'>): string {
  const primarySymbols = card.symbols
    .filter((symbol) => symbol.role !== 'hedge')
    .map((symbol) => String(symbol.symbol || '').trim().toUpperCase())
    .filter(Boolean)
    .sort()
    .slice(0, 3);
  const fallback = card.symbols
    .map((symbol) => String(symbol.symbol || '').trim().toUpperCase())
    .filter(Boolean)
    .sort()
    .slice(0, 2);
  return [
    String(card.themeId || '').trim().toLowerCase(),
    card.direction,
    ...(primarySymbols.length > 0 ? primarySymbols : fallback),
  ].join('::');
}

function buildReplayDiagnostics(
  ideaRuns: BacktestIdeaRun[],
  forwardReturns: ForwardReturnRecord[],
): ReplayDiagnosticsSnapshot {
  const ideaRunById = new Map(ideaRuns.map((ideaRun) => [ideaRun.id, ideaRun] as const));
  const total = Math.max(1, forwardReturns.length);
  const buildRows = (
    keyFor: (record: ForwardReturnRecord, ideaRun: BacktestIdeaRun) => { key: string; label: string } | null,
  ): ReplayDiagnosticRow[] => {
    const buckets = new Map<string, {
      key: string;
      label: string;
      sampleSize: number;
      positives: number;
      rawReturns: number[];
      costAdjustedReturns: number[];
      executionPenalties: number[];
      tradableCount: number;
      convictions: number[];
      fpRisks: number[];
    }>();

    for (const record of forwardReturns) {
      const ideaRun = ideaRunById.get(record.ideaRunId);
      if (!ideaRun) continue;
      const keyInfo = keyFor(record, ideaRun);
      if (!keyInfo) continue;
      const bucket = buckets.get(keyInfo.key) || {
        key: keyInfo.key,
        label: keyInfo.label,
        sampleSize: 0,
        positives: 0,
        rawReturns: [],
        costAdjustedReturns: [],
        executionPenalties: [],
        tradableCount: 0,
        convictions: [],
        fpRisks: [],
      };
      bucket.sampleSize += 1;
      if ((record.costAdjustedSignedReturnPct ?? record.signedReturnPct ?? -Infinity) > 0) bucket.positives += 1;
      if (typeof record.signedReturnPct === 'number') bucket.rawReturns.push(record.signedReturnPct);
      if (typeof record.costAdjustedSignedReturnPct === 'number') bucket.costAdjustedReturns.push(record.costAdjustedSignedReturnPct);
      bucket.executionPenalties.push(record.executionPenaltyPct || 0);
      if (record.tradableNow) bucket.tradableCount += 1;
      bucket.convictions.push(ideaRun.conviction || 0);
      bucket.fpRisks.push(ideaRun.falsePositiveRisk || 0);
      buckets.set(keyInfo.key, bucket);
    }

    return Array.from(buckets.values())
      .map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        sampleSize: bucket.sampleSize,
        hitRate: Math.round((bucket.positives / Math.max(1, bucket.sampleSize)) * 100),
        rawAvgReturnPct: Number(average(bucket.rawReturns).toFixed(2)),
        costAdjustedAvgReturnPct: Number(average(bucket.costAdjustedReturns).toFixed(2)),
        avgExecutionPenaltyPct: Number(average(bucket.executionPenalties).toFixed(2)),
        tradableRate: Math.round((bucket.tradableCount / Math.max(1, bucket.sampleSize)) * 100),
        avgConviction: Number(average(bucket.convictions).toFixed(2)),
        avgFalsePositiveRisk: Number(average(bucket.fpRisks).toFixed(2)),
        sharePct: Number(((bucket.sampleSize / total) * 100).toFixed(2)),
      }))
      .sort((left, right) =>
        right.sampleSize - left.sampleSize
        || right.costAdjustedAvgReturnPct - left.costAdjustedAvgReturnPct
        || right.hitRate - left.hitRate)
      .slice(0, 24);
  };

  return {
    generatedAt: nowIso(),
    themes: buildRows((_record, ideaRun) => ({
      key: ideaRun.themeId,
      label: ideaRun.themeId,
    })),
    symbols: buildRows((record, _ideaRun) => ({
      key: record.symbol,
      label: record.symbol,
    })),
    horizons: buildRows((record, _ideaRun) => ({
      key: `${record.horizonHours}h`,
      label: `${record.horizonHours}h`,
    })),
  };
}

function normalizeForwardReturnRecord(record: ForwardReturnRecord): ForwardReturnRecord {
  return {
    ...record,
    costAdjustedSignedReturnPct: typeof record.costAdjustedSignedReturnPct === 'number'
      ? record.costAdjustedSignedReturnPct
      : record.signedReturnPct,
    maxDrawdownPct: typeof record.maxDrawdownPct === 'number' ? record.maxDrawdownPct : null,
    riskAdjustedReturn: typeof record.riskAdjustedReturn === 'number' ? record.riskAdjustedReturn : null,
    bestReturnPct: typeof record.bestReturnPct === 'number' ? record.bestReturnPct : null,
    priceGapPct: typeof record.priceGapPct === 'number' ? record.priceGapPct : null,
    maxHoldingHours: Math.max(1, Math.round(Number(record.maxHoldingHours) || Math.max(1, Number(record.horizonHours) || 1))),
    exitReason: record.exitReason || 'no-exit-price',
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
  const portfolioAccounting = clonePortfolioAccountingSnapshot(run.portfolioAccounting);
  const cloneGovernance = (governance: ReplayGovernanceSummary | null | undefined): ReplayGovernanceSummary | null =>
    governance
      ? {
          cpcv: governance.cpcv ? { ...governance.cpcv } : null,
          dsr: governance.dsr ? { ...governance.dsr } : null,
          pbo: governance.pbo ? { ...governance.pbo } : null,
          promotion: governance.promotion ? { ...governance.promotion, reasons: governance.promotion.reasons.slice() } : { state: 'shadow', score: 0, reasons: [] },
        }
      : null;
  const lockedOosSummary = run.lockedOosSummary
    ? {
        ...run.lockedOosSummary,
        statisticalSummary: run.lockedOosSummary.statisticalSummary ? { ...run.lockedOosSummary.statisticalSummary } : null,
        diagnostics: run.lockedOosSummary.diagnostics
          ? {
              generatedAt: run.lockedOosSummary.diagnostics.generatedAt || nowIso(),
              themes: Array.isArray(run.lockedOosSummary.diagnostics.themes) ? run.lockedOosSummary.diagnostics.themes.map((row) => ({ ...row })) : [],
              symbols: Array.isArray(run.lockedOosSummary.diagnostics.symbols) ? run.lockedOosSummary.diagnostics.symbols.map((row) => ({ ...row })) : [],
              horizons: Array.isArray(run.lockedOosSummary.diagnostics.horizons) ? run.lockedOosSummary.diagnostics.horizons.map((row) => ({ ...row })) : [],
            }
          : null,
        portfolioAccounting: clonePortfolioAccountingSnapshot(run.lockedOosSummary.portfolioAccounting),
        governance: cloneGovernance(run.lockedOosSummary.governance),
        windows: Array.isArray(run.lockedOosSummary.windows) ? run.lockedOosSummary.windows.map((window) => ({ ...window })) : [],
        summaryLines: Array.isArray(run.lockedOosSummary.summaryLines) ? run.lockedOosSummary.summaryLines.slice() : [],
      }
    : null;
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
    diagnostics: run.diagnostics
      ? {
        generatedAt: run.diagnostics.generatedAt || nowIso(),
        themes: Array.isArray(run.diagnostics.themes) ? run.diagnostics.themes.map((row) => ({ ...row })) : [],
        symbols: Array.isArray(run.diagnostics.symbols) ? run.diagnostics.symbols.map((row) => ({ ...row })) : [],
        horizons: Array.isArray(run.diagnostics.horizons) ? run.diagnostics.horizons.map((row) => ({ ...row })) : [],
      }
      : null,
    realitySummary: run.realitySummary || buildRealitySummary(forwardReturns, Array.isArray(run.ideaRuns) ? run.ideaRuns : []),
    statisticalSummary: run.statisticalSummary || buildReplayStatisticalSummary(forwardReturns, portfolioAccounting),
    portfolioAccounting,
    lockedOosSummary,
    governance: cloneGovernance(run.governance),
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
    .map((frame, index) => {
      const normalizedFrame = {
        ...frame,
        id: frame.id || `frame-${index + 1}`,
        validTimeStart: effectiveValidTimeStart(frame),
        validTimeEnd: frame.validTimeEnd ?? null,
        transactionTime: effectiveTransactionTime(frame),
        knowledgeBoundary: effectiveKnowledgeBoundary(frame),
        warmup: Boolean(frame.warmup),
      };
      assertFrameTemporalConsistency(normalizedFrame);
      return normalizedFrame;
    })
    .sort((a, b) => {
      const txDelta = asTs(a.transactionTime || a.timestamp) - asTs(b.transactionTime || b.timestamp);
      if (txDelta !== 0) return txDelta;
      return asTs(a.timestamp) - asTs(b.timestamp);
    });
  return mergeFramesByTimestamp(normalized);
}

function percentile(values: number[], pct: number): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const index = clamp(Math.round((sorted.length - 1) * pct), 0, sorted.length - 1);
  return sorted[index] || 0;
}

function computeSharpeRatioSample(returns: number[]): number {
  if (returns.length < 2) return 0;
  const avg = average(returns);
  const variance = average(returns.map((value) => (value - avg) ** 2));
  const stdDev = Math.sqrt(Math.max(variance, 0));
  if (!(stdDev > 0)) return 0;
  return avg / stdDev;
}

function buildConfidenceInterval(
  values: number[],
  metric: (sample: number[]) => number,
  confidenceLevel = 0.95,
  iterations = 400,
): ReplayConfidenceInterval | null {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < 8) return null;
  const samples: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample: number[] = [];
    for (let index = 0; index < clean.length; index += 1) {
      sample.push(clean[Math.floor(Math.random() * clean.length)] || 0);
    }
    samples.push(metric(sample));
  }
  const alpha = (1 - confidenceLevel) / 2;
  return {
    lower: Number(percentile(samples, alpha).toFixed(4)),
    upper: Number(percentile(samples, 1 - alpha).toFixed(4)),
    confidenceLevel,
    sampleSize: clean.length,
  };
}

function buildReplayStatisticalSummary(
  forwardReturns: ForwardReturnRecord[],
  portfolioAccounting?: PortfolioAccountingSnapshot | null,
): ReplayStatisticalSummary {
  const signed = forwardReturns
    .map((record) => Number(record.signedReturnPct))
    .filter((value) => Number.isFinite(value));
  const costAdjusted = forwardReturns
    .map((record) => Number(record.costAdjustedSignedReturnPct))
    .filter((value) => Number.isFinite(value));
  const hitSeries = forwardReturns
    .map((record) => {
      const value = Number(record.costAdjustedSignedReturnPct);
      if (!Number.isFinite(value)) return Number.NaN;
      return value > 0 ? 1 : 0;
    })
    .filter((value) => Number.isFinite(value));
  const navReturns = Array.isArray(portfolioAccounting?.equityCurve)
    ? portfolioAccounting!.equityCurve
      .map((point) => Number(point.realizedReturnPct))
      .filter((value) => Number.isFinite(value))
    : [];

  return {
    costAdjustedAvgReturnPctCi95: buildConfidenceInterval(costAdjusted, (sample) => average(sample)),
    costAdjustedHitRateCi95: buildConfidenceInterval(hitSeries, (sample) => average(sample) * 100),
    rawAvgReturnPctCi95: buildConfidenceInterval(signed, (sample) => average(sample)),
    sharpeRatioCi95: buildConfidenceInterval(navReturns, (sample) => computeSharpeRatioSample(sample)),
  };
}

interface GovernanceFoldMetric {
  frameCount: number;
  returnPct: number;
  sharpe: number;
  maxDrawdownPct: number;
}

interface GovernancePathMetric {
  returnPct: number;
  sharpe: number;
  maxDrawdownPct: number;
}

function quantile(values: number[], pct: number): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const index = clamp(Math.round((sorted.length - 1) * pct), 0, sorted.length - 1);
  return sorted[index] || 0;
}

function sampleSkewness(values: number[]): number {
  if (values.length < 3) return 0;
  const mean = average(values);
  const centered = values.map((value) => value - mean);
  const variance = average(centered.map((value) => value * value));
  if (!(variance > 0)) return 0;
  const stdDev = Math.sqrt(variance);
  return average(centered.map((value) => Math.pow(value / stdDev, 3)));
}

function sampleKurtosis(values: number[]): number {
  if (values.length < 4) return 3;
  const mean = average(values);
  const centered = values.map((value) => value - mean);
  const variance = average(centered.map((value) => value * value));
  if (!(variance > 0)) return 3;
  const stdDev = Math.sqrt(variance);
  return average(centered.map((value) => Math.pow(value / stdDev, 4)));
}

function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function normalQuantile(probability: number): number {
  const p = Math.min(1 - 1e-9, Math.max(1e-9, probability));
  const a = [
    -3.969683028665376e+01,
    2.209460984245205e+02,
    -2.759285104469687e+02,
    1.38357751867269e+02,
    -3.066479806614716e+01,
    2.506628277459239e+00,
  ];
  const b = [
    -5.447609879822406e+01,
    1.615858368580409e+02,
    -1.556989798598866e+02,
    6.680131188771972e+01,
    -1.328068155288572e+01,
  ];
  const c = [
    -7.784894002430293e-03,
    -3.223964580411365e-01,
    -2.400758277161838e+00,
    -2.549732539343734e+00,
    4.374664141464968e+00,
    2.938163982698783e+00,
  ];
  const d = [
    7.784695709041462e-03,
    3.224671290700398e-01,
    2.445134137142996e+00,
    3.754408661907416e+00,
  ];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q = 0;
  let r = 0;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!)
      / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > phigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!)
      / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q
    / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

function buildCombinationIndexes(total: number, size: number): number[][] {
  if (total <= 0 || size <= 0 || size > total) return [];
  const results: number[][] = [];
  const current: number[] = [];
  const walk = (start: number): void => {
    if (current.length === size) {
      results.push(current.slice());
      return;
    }
    for (let index = start; index <= total - (size - current.length); index += 1) {
      current.push(index);
      walk(index + 1);
      current.pop();
    }
  };
  walk(0);
  return results;
}

function buildGovernancePaths(foldMetrics: GovernanceFoldMetric[]): GovernancePathMetric[] {
  if (foldMetrics.length === 0) return [];
  if (foldMetrics.length === 1) {
    const fold = foldMetrics[0]!;
    return [{
      returnPct: fold.returnPct,
      sharpe: fold.sharpe,
      maxDrawdownPct: fold.maxDrawdownPct,
    }];
  }
  const combinationSize = Math.max(1, Math.floor(foldMetrics.length / 2));
  const combinations = buildCombinationIndexes(foldMetrics.length, combinationSize);
  return combinations.map((indexes) => {
    const selected = indexes.map((index) => foldMetrics[index]!);
    const totalFrames = Math.max(1, selected.reduce((sum, fold) => sum + fold.frameCount, 0));
    return {
      returnPct: Number((selected.reduce((sum, fold) => sum + (fold.returnPct * fold.frameCount), 0) / totalFrames).toFixed(4)),
      sharpe: Number((selected.reduce((sum, fold) => sum + (fold.sharpe * fold.frameCount), 0) / totalFrames).toFixed(4)),
      maxDrawdownPct: Number(Math.min(...selected.map((fold) => fold.maxDrawdownPct)).toFixed(4)),
    };
  });
}

function buildReplayGovernanceSummary(args: {
  evaluationRuns: HistoricalReplayRun[];
  portfolioAccounting?: PortfolioAccountingSnapshot | null;
  lockedOosSummary?: LockedOosSummary | null;
}): ReplayGovernanceSummary {
  const foldMetrics: GovernanceFoldMetric[] = args.evaluationRuns
    .map((run) => {
      const summary = run.portfolioAccounting?.summary;
      if (!summary) return null;
      return {
        frameCount: Math.max(1, run.evaluationFrameCount || run.frameCount || 0),
        returnPct: Number(summary.totalReturnPct || 0),
        sharpe: Number(summary.sharpeRatio || 0),
        maxDrawdownPct: Number(summary.maxDrawdownPct || 0),
      };
    })
    .filter((row): row is GovernanceFoldMetric => Boolean(row));
  const paths = buildGovernancePaths(foldMetrics);
  const cpcv = paths.length > 0
    ? {
        pathCount: paths.length,
        combinationSize: Math.max(1, Math.floor(Math.max(foldMetrics.length, 1) / 2)),
        returnPct05: Number(quantile(paths.map((row) => row.returnPct), 0.05).toFixed(2)),
        returnPct50: Number(quantile(paths.map((row) => row.returnPct), 0.5).toFixed(2)),
        returnPct95: Number(quantile(paths.map((row) => row.returnPct), 0.95).toFixed(2)),
        sharpePct05: Number(quantile(paths.map((row) => row.sharpe), 0.05).toFixed(2)),
        sharpePct50: Number(quantile(paths.map((row) => row.sharpe), 0.5).toFixed(2)),
        sharpePct95: Number(quantile(paths.map((row) => row.sharpe), 0.95).toFixed(2)),
        maxDrawdownPct05: Number(quantile(paths.map((row) => row.maxDrawdownPct), 0.05).toFixed(2)),
      } satisfies ReplayCpcvPathSummary
    : null;

  const realizedSeries = Array.isArray(args.portfolioAccounting?.equityCurve)
    ? args.portfolioAccounting!.equityCurve
      .map((point) => Number(point.realizedReturnPct) / 100)
      .filter((value) => Number.isFinite(value))
    : [];
  const observedSharpe = Number(args.portfolioAccounting?.summary?.sharpeRatio || 0);
  const trialCount = Math.max(1, paths.length || foldMetrics.length || 1);
  const dsr = (() => {
    if (realizedSeries.length < 8) return null;
    const skewness = sampleSkewness(realizedSeries);
    const kurtosis = sampleKurtosis(realizedSeries);
    const sharpeStd = Math.sqrt(
      Math.max(
        (1 - skewness * observedSharpe + ((kurtosis - 1) / 4) * observedSharpe * observedSharpe)
        / Math.max(realizedSeries.length - 1, 1),
        1e-6,
      ),
    );
    const benchmarkSharpe = trialCount > 1
      ? Number((sharpeStd * (
          (1 - 0.5772156649) * normalQuantile(1 - 1 / trialCount)
          + 0.5772156649 * normalQuantile(1 - 1 / (trialCount * Math.E))
        )).toFixed(4))
      : 0;
    const deflatedSharpeRatio = Number(normalCdf((observedSharpe - benchmarkSharpe) / sharpeStd).toFixed(4));
    return {
      observedSharpe: Number(observedSharpe.toFixed(4)),
      benchmarkSharpe,
      deflatedSharpeRatio,
      trialCount,
      sampleSize: realizedSeries.length,
    } satisfies ReplayDsrSummary;
  })();

  const pbo = paths.length > 0
    ? {
        probability: Number((paths.filter((row) => row.sharpe <= 0 || row.returnPct <= 0).length / paths.length).toFixed(4)),
        negativePathShare: Number((paths.filter((row) => row.returnPct <= 0).length / paths.length).toFixed(4)),
        pathCount: paths.length,
        method: 'fold-combination-proxy' as const,
      } satisfies ReplayPboSummary
    : null;

  const oosSummary = args.lockedOosSummary?.portfolioAccounting?.summary || null;
  const reasons: string[] = [];
  if (!oosSummary) reasons.push('locked_oos_missing');
  if (oosSummary && oosSummary.totalReturnPct <= 0) reasons.push('locked_oos_return_non_positive');
  if (oosSummary && oosSummary.sharpeRatio < 0.35) reasons.push('locked_oos_sharpe_below_floor');
  if (oosSummary && oosSummary.maxDrawdownPct < -10) reasons.push('locked_oos_drawdown_breach');
  if (cpcv && cpcv.returnPct05 <= -1) reasons.push('cpcv_left_tail_negative');
  if (cpcv && cpcv.sharpePct05 < 0) reasons.push('cpcv_sharpe_tail_negative');
  if (dsr && dsr.deflatedSharpeRatio < 0.5) reasons.push('dsr_below_floor');
  if (pbo && pbo.probability > 0.35) reasons.push('pbo_too_high');

  const promotion = (() => {
    const score =
      (oosSummary ? Math.max(-2, Math.min(2, oosSummary.totalReturnPct / 4)) : -1.2)
      + (oosSummary ? Math.max(-1.5, Math.min(1.5, oosSummary.sharpeRatio)) : -0.8)
      + (dsr ? (dsr.deflatedSharpeRatio - 0.5) * 2 : -0.5)
      - (pbo ? pbo.probability * 2 : 0.8)
      + (cpcv ? Math.max(-1, Math.min(1, cpcv.returnPct05 / 3)) : -0.5);
    if (reasons.length === 0 && score >= 1.1) {
      return { state: 'promote', score: Number(score.toFixed(2)), reasons: [] } satisfies ReplayPromotionDecision;
    }
    if (reasons.some((reason) => reason.includes('missing') || reason.includes('too_high') || reason.includes('breach'))) {
      return { state: 'reject', score: Number(score.toFixed(2)), reasons } satisfies ReplayPromotionDecision;
    }
    return { state: 'shadow', score: Number(score.toFixed(2)), reasons } satisfies ReplayPromotionDecision;
  })();

  // Real CPCV (López de Prado method)
  let cpcvReal: ReplayGovernanceSummary['cpcvReal'] = null;
  let permTestResult: ReplayGovernanceSummary['permutationTest'] = null;
  if (foldMetrics.length >= 3) {
    const foldReturnArrays = args.evaluationRuns.map(run => {
      const curve = run.portfolioAccounting?.equityCurve;
      if (!Array.isArray(curve)) return [];
      return curve.map(p => Number(p.realizedReturnPct ?? 0) / 100).filter(v => Number.isFinite(v));
    });
    try {
      const realCpcv = computeCPCV(foldReturnArrays, 5);
      cpcvReal = { pbo: realCpcv.pbo, oosRankMedian: realCpcv.oosRankMedian, logitPBO: realCpcv.logitPBO, pathCount: realCpcv.pathCount };
    } catch { /* skip on error */ }
  }
  if (realizedSeries.length >= 20) {
    try {
      const pt = runPermutationTest(realizedSeries, 200);
      permTestResult = { observedSharpe: pt.observedSharpe, pValue: pt.pValue, nPermutations: pt.nPermutations };
    } catch { /* skip on error */ }
  }

  return {
    cpcv,
    dsr,
    pbo,
    cpcvReal,
    permutationTest: permTestResult,
    promotion,
  };
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

function appendFramePrices(target: Map<string, PricePoint[]>, frame: HistoricalReplayFrame): void {
  const timestampBySymbol = parseMarketTimeMap(frame, 'marketTimestampJson');
  const knowledgeBySymbol = parseMarketTimeMap(frame, 'marketKnowledgeBoundaryJson');
  for (const market of frame.markets) {
    if (!market?.symbol || typeof market.price !== 'number' || !Number.isFinite(market.price)) continue;
    const pointTimestamp = timestampBySymbol[market.symbol] || effectiveValidTimeStart(frame);
    const transactionTime = knowledgeBySymbol[market.symbol] || effectiveTransactionTime(frame);
    const ts = asTs(pointTimestamp);
    const transactionTs = asTs(transactionTime);
    const bucket = target.get(market.symbol) || [];
    const nextPoint = {
      timestamp: pointTimestamp,
      ts,
      transactionTs,
      price: market.price,
    } satisfies PricePoint;
    if ((bucket[bucket.length - 1]?.ts || -1) === ts) bucket[bucket.length - 1] = nextPoint;
    else bucket.push(nextPoint);
    target.set(market.symbol, bucket);
  }
}

function bisectPriceAtOrAfter(series: PricePoint[], targetTs: number): number {
  let lo = 0;
  let hi = series.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (series[mid]!.ts < targetTs) lo = mid + 1;
    else hi = mid;
  }
  return lo < series.length ? lo : -1;
}

function findNearestPrice(series: PricePoint[], targetTs: number, toleranceMs: number): PricePoint | null {
  const rightIndex = bisectPriceAtOrAfter(series, targetTs);
  const leftIndex = rightIndex < 0 ? series.length - 1 : rightIndex - 1;
  const leftPoint = leftIndex >= 0 ? series[leftIndex]! : null;
  const rightPoint = rightIndex >= 0 ? series[rightIndex]! : null;
  let best: PricePoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  if (leftPoint) {
    const distance = Math.abs(leftPoint.ts - targetTs);
    if (distance <= toleranceMs) {
      best = leftPoint;
      bestDistance = distance;
    }
  }
  if (rightPoint) {
    const distance = Math.abs(rightPoint.ts - targetTs);
    if (distance <= toleranceMs && distance < bestDistance) {
      best = rightPoint;
    }
  }
  return best;
}

function findNextPriceAtOrAfter(series: PricePoint[], targetTs: number, lookaheadMs: number): PricePoint | null {
  const index = bisectPriceAtOrAfter(series, targetTs);
  if (index < 0) return null;
  const point = series[index]!;
  return point.ts - targetTs <= lookaheadMs ? point : null;
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
  return Math.max(
    BACKTEST_REPLAY_TUNING.seriesLookaheadMinHours * 60 * 60 * 1000,
    Math.min(
      BACKTEST_REPLAY_TUNING.seriesLookaheadMaxDays * 24 * 60 * 60 * 1000,
      Math.round(intervalMs * BACKTEST_REPLAY_TUNING.seriesLookaheadIntervalMultiplier),
    ),
  );
}

/**
 * Compute the realized market move % over the N intervals immediately before
 * targetTs. Used to feed a dynamic volatility adjustment into execution cost
 * modelling (spread/slippage widen on high-volatility entries).
 * Returns null when fewer than 2 price points are available in the window.
 */
function computeRecentMarketMovePct(
  series: PricePoint[],
  targetTs: number,
  lookbackIntervals = 5,
): number | null {
  const intervalMs = estimateSeriesIntervalMs(series);
  const windowStart = targetTs - lookbackIntervals * intervalMs;
  const candidates = series.filter((p) => p.ts >= windowStart && p.ts <= targetTs);
  if (candidates.length < 2) return null;
  const oldest = candidates[0]!.price;
  const newest = candidates[candidates.length - 1]!.price;
  if (!oldest || oldest <= 0) return null;
  return ((newest - oldest) / oldest) * 100;
}

function sortUniqueHours(values: Array<number | null | undefined>): number[] {
  return Array.from(new Set(
    values
      .map((value) => Math.max(1, Math.round(Number(value) || 0)))
      .filter(Boolean),
  )).sort((a, b) => a - b);
}

const MAX_HORIZON_CANDIDATES = BACKTEST_REPLAY_TUNING.maxHorizonCandidates;

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
    ]).slice(0, MAX_HORIZON_CANDIDATES);
  }
  const hinted = sortUniqueHours(fallbackHours);
  if (hinted.length > 0) {
    return sortUniqueHours([
      ...hinted,
      ideaRun.preferredHorizonHours ?? null,
    ]).slice(0, MAX_HORIZON_CANDIDATES);
  }
  const intervalHours = Math.max(1, Math.round(estimateSeriesIntervalMs(series) / (60 * 60 * 1000)));
  return sortUniqueHours([
    ...deriveIntervalHorizonCandidates(intervalHours),
    ideaRun.preferredHorizonHours ?? null,
  ]).slice(0, MAX_HORIZON_CANDIDATES);
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
    if (card.autonomyAction === 'abstain' && (card.sizePct || 0) <= 0) continue;
    if ((card.sizePct || 0) <= 0) continue;
    if (typeof card.optimizedTargetWeightPct === 'number' && Math.abs(card.optimizedTargetWeightPct) <= 0) continue;
    const preferredHorizonHours = Math.max(
      168, // minimum 1 week — signal needs time to manifest (labeled_outcomes 2w hit=60%)
      Math.round(
        Number(card.preferredHorizonHours)
        || Number(card.horizonCandidatesHours?.[0])
        || 336, // default 2 weeks
      ),
    );
    const dynamicCooldownMs = Math.max(
      dedupeWindowMs,
      Math.min(
        BACKTEST_REPLAY_TUNING.dedupeMaxHours,
        Math.max(
          BACKTEST_REPLAY_TUNING.dedupeMinHours,
          Math.round(preferredHorizonHours * BACKTEST_REPLAY_TUNING.dedupePreferredHorizonFactor),
        ),
      ) * 60 * 60 * 1000,
    );
    const dedupeKey = buildReplayIdeaSignature({
      themeId: card.themeId,
      direction: card.direction,
      symbols: card.symbols.map((symbol) => ({
        symbol: symbol.symbol,
        role: symbol.role,
        direction: symbol.direction,
        name: symbol.name,
        entryPrice: null,
      })),
    });
    const prev = lastRecordedByIdea.get(dedupeKey);
    const duplicate =
      prev
      && frameTs - prev.ts < dynamicCooldownMs
      && Math.abs(prev.conviction - card.conviction) < BACKTEST_REPLAY_TUNING.convictionDedupeTolerance;
    if (duplicate) continue;

    const run: BacktestIdeaRun = {
      id: `${runId}:${frame.id}:${card.id}`,
      runId,
      frameId: frame.id || 'frame',
      generatedAt: signalTimestamp,
      title: card.title,
      themeId: card.themeId,
      themeClassification: card.themeClassification,
      region: regionFromIdeaCard(card),
      direction: card.direction,
      conviction: card.conviction,
      falsePositiveRisk: card.falsePositiveRisk,
      sizePct: card.sizePct,
      timeframe: card.timeframe,
      calibratedConfidence: card.calibratedConfidence,
      realityScore: card.realityScore,
      graphSignalScore: card.graphSignalScore,
      narrativeAlignmentScore: card.narrativeAlignmentScore,
      narrativeShadowState: card.narrativeShadowState,
      narrativeShadowPosterior: card.narrativeShadowPosterior,
      narrativeShadowDisagreement: card.narrativeShadowDisagreement,
      narrativeShadowTopThemeId: card.narrativeShadowTopThemeId,
      recentEvidenceScore: card.recentEvidenceScore,
      corroborationQuality: card.corroborationQuality,
      transferEntropy: card.transferEntropy,
      banditScore: card.banditScore,
      regimeMultiplier: card.regimeMultiplier,
      confirmationScore: card.confirmationScore,
      confirmationState: card.confirmationState,
      coveragePenalty: card.coveragePenalty,
      metaHitProbability: card.metaHitProbability,
      metaExpectedReturnPct: card.metaExpectedReturnPct,
      metaDecisionScore: card.metaDecisionScore,
      admissionState: card.admissionState,
      continuousConviction: card.continuousConviction,
      clusterConfidence: card.clusterConfidence,
      marketStressPrior: card.marketStressPrior,
      transmissionStress: card.transmissionStress,
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
    lastRecordedByIdea.set(dedupeKey, { ts: frameTs, conviction: card.conviction });
  }

  return runs;
}

function resolveIdeaMaxHoldHours(ideaRun: BacktestIdeaRun, horizonHours: number): number {
  const preferred = Math.max(1, Math.round(
    Number(ideaRun.preferredHorizonHours)
    || Number(ideaRun.horizonCandidatesHours?.[0])
    || Number(horizonHours)
    || 24,
  ));
  if (preferred <= BACKTEST_REPLAY_TUNING.shortHorizonMaxHoldHours) {
    return BACKTEST_REPLAY_TUNING.shortHorizonMaxHoldHours;
  }
  if (preferred <= BACKTEST_REPLAY_TUNING.mediumHorizonMaxHoldHours) {
    return BACKTEST_REPLAY_TUNING.mediumHorizonMaxHoldHours;
  }
  return BACKTEST_REPLAY_TUNING.longHorizonMaxHoldHours;
}

function directedReturnPct(direction: InvestmentDirection, entryPrice: number, nextPrice: number): number {
  const rawReturn = ((nextPrice - entryPrice) / Math.max(entryPrice, 1e-6)) * 100;
  return Number((rawReturn * directionMultiplier(direction)).toFixed(4));
}

function evaluateExitPath(args: {
  series: PricePoint[];
  direction: InvestmentDirection;
  entryTs: number;
  entryPrice: number;
  targetTs: number;
  maxHoldTs: number;
}): {
  exitPoint: PricePoint | null;
  exitReason: ForwardReturnRecord['exitReason'];
  bestReturnPct: number | null;
  maxDrawdownPct: number | null;
  priceGapPct: number | null;
} {
  const path = args.series.filter((point) => point.ts >= args.entryTs && point.ts <= args.maxHoldTs);
  if (path.length === 0) {
    return {
      exitPoint: null,
      exitReason: 'no-exit-price',
      bestReturnPct: null,
      maxDrawdownPct: null,
      priceGapPct: null,
    };
  }

  let peakEquity = 1;
  let maxDrawdownPct = 0;
  let bestReturnPct = -Infinity;
  let trailingExit: PricePoint | null = null;
  let previousReturnPct = 0;
  const targetReturn = Math.max(
    BACKTEST_REPLAY_TUNING.targetReturnMinPct,
    Math.min(
      BACKTEST_REPLAY_TUNING.targetReturnMaxPct,
      (args.targetTs - args.entryTs) / 3_600_000 / BACKTEST_REPLAY_TUNING.targetReturnHorizonDivisor,
    ),
  );
  const trailingStopPct = Math.max(
    BACKTEST_REPLAY_TUNING.trailingStopMinPct,
    targetReturn * BACKTEST_REPLAY_TUNING.trailingStopTargetFactor,
  );

  for (const point of path) {
    const directedReturn = directedReturnPct(args.direction, args.entryPrice, point.price);
    bestReturnPct = Math.max(bestReturnPct, directedReturn);
    const equity = Math.max(0.01, 1 + directedReturn / 100);
    peakEquity = Math.max(peakEquity, equity);
    const drawdownPct = ((equity / peakEquity) - 1) * 100;
    maxDrawdownPct = Math.min(maxDrawdownPct, drawdownPct);
    const gapPct = Math.abs(directedReturn - previousReturnPct);
    previousReturnPct = directedReturn;
    if (!trailingExit && bestReturnPct >= trailingStopPct && (bestReturnPct - directedReturn) >= trailingStopPct) {
      trailingExit = point;
      return {
        exitPoint: point,
        exitReason: 'trailing-stop',
        bestReturnPct: Number(bestReturnPct.toFixed(2)),
        maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
        priceGapPct: Number(gapPct.toFixed(2)),
      };
    }
  }

  const targetExit = path.find((point) => point.ts >= args.targetTs) || null;
  if (targetExit) {
    const targetReturnPct = directedReturnPct(args.direction, args.entryPrice, targetExit.price);
    const previousPoint = path
      .filter((point) => point.ts < targetExit.ts)
      .slice(-1)[0] || null;
    return {
      exitPoint: targetExit,
      exitReason: 'target-horizon',
      bestReturnPct: Number(bestReturnPct.toFixed(2)),
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
      priceGapPct: previousPoint
        ? Number(Math.abs(targetReturnPct - directedReturnPct(args.direction, args.entryPrice, previousPoint.price)).toFixed(2))
        : 0,
    };
  }

  const fallback = path[path.length - 1] || null;
  return {
    exitPoint: fallback,
    exitReason: fallback ? 'max-hold-fallback' : 'no-exit-price',
    bestReturnPct: Number(bestReturnPct.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    priceGapPct: fallback && path.length >= 2
      ? Number(Math.abs(
        directedReturnPct(args.direction, args.entryPrice, fallback.price)
        - directedReturnPct(args.direction, args.entryPrice, path[path.length - 2]!.price),
      ).toFixed(2))
      : 0,
  };
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
      // Limit entry lookahead to 1× median interval (next available bar after signal).
      // Using seriesLookaheadMs (4.5×) here introduced look-ahead bias: daily data
      // allowed entries up to 4.5 days in the future, inflating results ~20–30%.
      const entryLookaheadMs = Math.max(
        BACKTEST_REPLAY_TUNING.entryLookaheadMinMinutes * 60 * 1000,
        intervalMs,
      );
      const entryPoint =
        findNextPriceAtOrAfter(series, signalTs, entryLookaheadMs)
        || findNearestPrice(series, signalTs, entryLookaheadMs);
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
        marketMovePct: computeRecentMarketMovePct(series, entryTs),
        timestamp: entryTimestamp,
      });

      for (const horizonHours of symbolHorizonCandidates) {
        const targetTs = entryTs + horizonHours * 60 * 60 * 1000;
        const maxHoldingHours = resolveIdeaMaxHoldHours(ideaRun, horizonHours);
        const maxHoldTs = entryTs + maxHoldingHours * 60 * 60 * 1000;
        const exitEval = entryPrice != null
          ? evaluateExitPath({
            series,
            direction: symbolState.direction,
            entryTs,
            entryPrice,
            targetTs,
            maxHoldTs,
          })
          : {
            exitPoint: null,
            exitReason: 'no-exit-price' as const,
            bestReturnPct: null,
            maxDrawdownPct: null,
            priceGapPct: null,
          };
        const exitLookaheadMs = Math.max(
          seriesLookaheadMs(series),
          Math.max(intervalMs, BACKTEST_REPLAY_TUNING.exitLookaheadMinHours * 60 * 60 * 1000),
        );
        const exitPoint = exitEval.exitPoint
          || findNextPriceAtOrAfter(series, Math.min(targetTs, maxHoldTs), exitLookaheadMs)
          || findNearestPrice(series, Math.min(targetTs, maxHoldTs), exitLookaheadMs);
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
        const denominator = Math.max(
          Math.abs(exitEval.maxDrawdownPct ?? 0),
          BACKTEST_REPLAY_TUNING.minDrawdownDenominatorPct,
        );
        const riskAdjustedReturn =
          costAdjustedSignedReturnPct == null
            ? null
            : Number((costAdjustedSignedReturnPct / denominator).toFixed(4));

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
          maxDrawdownPct: exitEval.maxDrawdownPct,
          riskAdjustedReturn,
          bestReturnPct: exitEval.bestReturnPct,
          priceGapPct: exitEval.priceGapPct,
          maxHoldingHours,
          exitReason: exitEval.exitReason,
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
  lockedOosSummary?: LockedOosSummary | null,
  governance?: ReplayGovernanceSummary | null,
): string[] {
  const reality = buildRealitySummary(forwardReturns, ideaRuns);
  const avgMaxDrawdownPct = forwardReturns.filter((row) => typeof row.maxDrawdownPct === 'number').length > 0
    ? Number(average(forwardReturns.map((row) => row.maxDrawdownPct || 0)).toFixed(2))
    : 0;
  const avgRiskAdjustedReturn = forwardReturns.filter((row) => typeof row.riskAdjustedReturn === 'number').length > 0
    ? Number(average(forwardReturns.map((row) => row.riskAdjustedReturn || 0)).toFixed(2))
    : 0;
  const avgCredibility = sourceProfiles.length > 0
    ? Math.round(average(sourceProfiles.map((row) => row.posteriorAccuracyScore)))
    : 0;
  const avgMappingPosterior = mappingStats.length > 0
    ? Math.round(average(mappingStats.map((row) => row.posteriorWinRate)))
    : 0;
  const topThemeLines = themeProfiles
    .slice(0, 4)
    .map((profile) => `${profile.themeId}:${profile.timeframe} (${profile.confidence})`);
  const diagnostics = buildReplayDiagnostics(ideaRuns, forwardReturns);
  const weakestTheme = diagnostics.themes
    .filter((row) => row.sampleSize >= 12)
    .sort((left, right) => left.costAdjustedAvgReturnPct - right.costAdjustedAvgReturnPct || left.hitRate - right.hitRate)[0];
  const busiestSymbol = diagnostics.symbols[0];
  const portfolio = portfolioAccounting?.summary || null;
  const acceptedIdeas = ideaRuns.filter((ideaRun) => ideaRun.admissionState === 'accepted');
  const watchIdeas = ideaRuns.filter((ideaRun) => ideaRun.admissionState === 'watch');
  const rejectedIdeas = ideaRuns.filter((ideaRun) => ideaRun.admissionState === 'rejected');
  const avgMetaHitProbability = ideaRuns.filter((ideaRun) => typeof ideaRun.metaHitProbability === 'number').length > 0
    ? Number(average(ideaRuns.map((ideaRun) => Number(ideaRun.metaHitProbability) || 0)).toFixed(2))
    : 0;
  const avgMetaDecisionScore = ideaRuns.filter((ideaRun) => typeof ideaRun.metaDecisionScore === 'number').length > 0
    ? Number(average(ideaRuns.map((ideaRun) => Number(ideaRun.metaDecisionScore) || 0)).toFixed(2))
    : 0;
  const avgNarrativeShadowPosterior = ideaRuns.filter((ideaRun) => typeof ideaRun.narrativeShadowPosterior === 'number').length > 0
    ? Number(average(ideaRuns.map((ideaRun) => Number(ideaRun.narrativeShadowPosterior) || 0)).toFixed(2))
    : 0;
  const avgNarrativeShadowDisagreement = ideaRuns.filter((ideaRun) => typeof ideaRun.narrativeShadowDisagreement === 'number').length > 0
    ? Number(average(ideaRuns.map((ideaRun) => Number(ideaRun.narrativeShadowDisagreement) || 0)).toFixed(2))
    : 0;
  const statisticalSummary = buildReplayStatisticalSummary(forwardReturns, portfolioAccounting);

  return [
    `${frameCount} point-in-time frames processed, ${Math.max(0, frameCount - warmupFrameCount)} evaluated, ${warmupFrameCount} reserved for warm-up.`,
    `${forwardReturns.length} forward-return labels generated across ${new Set(forwardReturns.map((row) => row.symbol)).size} symbols and ${new Set(forwardReturns.map((row) => row.horizonHours)).size} horizons.`,
    `${reality.primaryHorizonHours}h adaptive primary horizon raw hit-rate ${reality.rawHitRate}% / cost-adjusted hit-rate ${reality.costAdjustedHitRate}% with raw avg ${reality.rawAvgReturnPct}% and cost-adjusted avg ${reality.costAdjustedAvgReturnPct}%.`,
    `Path risk: average max drawdown ${avgMaxDrawdownPct}% and average risk-adjusted return ${avgRiskAdjustedReturn}.`,
    `Avg execution penalty ${reality.avgExecutionPenaltyPct}% with reality score ${reality.avgRealityScore} and non-tradable rate ${reality.nonTradableRate}%.`,
    statisticalSummary.costAdjustedAvgReturnPctCi95
      ? `95% CI cost-adjusted avg return ${statisticalSummary.costAdjustedAvgReturnPctCi95.lower}% to ${statisticalSummary.costAdjustedAvgReturnPctCi95.upper}% and hit-rate ${statisticalSummary.costAdjustedHitRateCi95?.lower ?? 0}% to ${statisticalSummary.costAdjustedHitRateCi95?.upper ?? 0}%.`
      : 'Statistical confidence intervals are unavailable because replay sample size is still too small.',
    portfolio
      ? `Portfolio accounting: NAV ${portfolio.initialCapital} -> ${portfolio.finalCapital} (${portfolio.totalReturnPct}%), CAGR ${portfolio.cagrPct}%, max drawdown ${portfolio.maxDrawdownPct}%, Sharpe ${portfolio.sharpeRatio}, VaR95 ${portfolio.dailyVar95Pct}%, CVaR95 ${portfolio.dailyCvar95Pct}%, avg cash ${portfolio.avgCashPct}%, avg gross exposure ${portfolio.avgGrossExposurePct}%.`
      : 'Portfolio accounting snapshot not available yet.',
    lockedOosSummary?.portfolioAccounting?.summary
      ? `Locked OOS: ${lockedOosSummary.frameCount} frames, NAV ${lockedOosSummary.portfolioAccounting.summary.initialCapital} -> ${lockedOosSummary.portfolioAccounting.summary.finalCapital} (${lockedOosSummary.portfolioAccounting.summary.totalReturnPct}%), Sharpe ${lockedOosSummary.portfolioAccounting.summary.sharpeRatio}, max drawdown ${lockedOosSummary.portfolioAccounting.summary.maxDrawdownPct}%.`
      : (lockedOosSummary
          ? `Locked OOS: ${lockedOosSummary.frameCount} frames, ${lockedOosSummary.ideaRunCount} idea runs, ${lockedOosSummary.forwardReturnCount} forward returns.`
          : 'Locked OOS holdout not enabled.'),
    governance?.cpcv
      ? `CPCV proxy: ${governance.cpcv.pathCount} paths, return p05 ${governance.cpcv.returnPct05}% / p50 ${governance.cpcv.returnPct50}% / p95 ${governance.cpcv.returnPct95}%, Sharpe p05 ${governance.cpcv.sharpePct05}.`
      : 'CPCV proxy unavailable.',
    governance?.dsr
      ? `DSR ${governance.dsr.deflatedSharpeRatio} with observed Sharpe ${governance.dsr.observedSharpe} vs benchmark ${governance.dsr.benchmarkSharpe} across ${governance.dsr.sampleSize} samples.`
      : 'DSR unavailable.',
    governance?.pbo
      ? `PBO proxy ${Math.round(governance.pbo.probability * 100)}% with negative-path share ${Math.round(governance.pbo.negativePathShare * 100)}%.`
      : 'PBO proxy unavailable.',
    governance
      ? `Promotion policy: ${governance.promotion.state} (score ${governance.promotion.score})${governance.promotion.reasons.length ? ` reasons=${governance.promotion.reasons.join(',')}` : ''}.`
      : 'Promotion policy unavailable.',
    `Admission states: accepted ${acceptedIdeas.length}, watch ${watchIdeas.length}, rejected ${rejectedIdeas.length}. Avg meta hit ${avgMetaHitProbability}% / avg meta score ${avgMetaDecisionScore}.`,
    `Narrative shadow telemetry: avg posterior ${avgNarrativeShadowPosterior}% / avg disagreement ${avgNarrativeShadowDisagreement}.`,
    `Learned source posterior avg ${avgCredibility} and mapping posterior avg ${avgMappingPosterior}.`,
    topThemeLines.length > 0
      ? `Learned theme horizons: ${topThemeLines.join(' | ')}.`
      : 'No replay-backed theme horizon profiles learned yet.',
    weakestTheme
      ? `Weakest replay theme: ${weakestTheme.label} hit-rate ${weakestTheme.hitRate}% / cost-adjusted avg ${weakestTheme.costAdjustedAvgReturnPct}% across ${weakestTheme.sampleSize} labels.`
      : 'Theme diagnostics are still sparse.',
    busiestSymbol
      ? `Most active symbol: ${busiestSymbol.label} handled ${busiestSymbol.sampleSize} labels with ${busiestSymbol.hitRate}% hit-rate and ${busiestSymbol.costAdjustedAvgReturnPct}% cost-adjusted avg return.`
      : 'Symbol diagnostics are still sparse.',
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
  causalIntegrityMode: 'strict' | 'batched';
  recordAdaptation?: boolean;
  investmentContext?: InvestmentIntelligenceContext;
  dedupeWindowHours?: number;
  warmupFrameCount?: number;
  warmupUntil?: string;
  transactionTimeCeiling?: string;
  knowledgeBoundaryCeiling?: string;
  seedState?: HistoricalReplayOptions['seedState'];
  windows?: WalkForwardWindow[];
  admissionThresholds?: AdmissionThresholds | null;
  ensembleModels?: import('./investment/adaptive-params/ensemble-predictor').EnsembleModels | null;
  mlNormalization?: { mean: number[]; std: number[] } | null;
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
  const dedupeWindowMs = Math.max(1, args.dedupeWindowHours ?? 1) * 60 * 60 * 1000;
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

    // ──────────────────────────────────────────────────────────
    // Phase 0: Classify frames and collect all data
    // ──────────────────────────────────────────────────────────
    const frameEligibility: boolean[] = [];
    const allNews: typeof frames[0]['news'] = [];
    const allClusters: typeof frames[0]['clusters'] = [];
    const allMarkets: typeof frames[0]['markets'] = [];
    const signalFrameIndices: number[] = [];

    for (const [index, frame] of frames.entries()) {
      const warmupByCount = Number(args.warmupFrameCount || 0) > 0 && index < Number(args.warmupFrameCount || 0);
      const warmupByTime = warmupUntilTs > 0 && asTs(frame.transactionTime || frame.timestamp) <= warmupUntilTs;
      const eligible = !(Boolean(frame.warmup) || warmupByCount || warmupByTime);
      frameEligibility.push(eligible);
      if (!eligible) warmupFramesApplied++;
      else evaluationFrameCount++;

      if (frame.news.length > 0 || frame.clusters.length > 0) {
        allNews.push(...frame.news);
        allClusters.push(...frame.clusters);
        signalFrameIndices.push(index);
      }
      if (frame.markets.length > 0) {
        allMarkets.push(...frame.markets);
      }
    }

    process.stderr.write(`[replay:batch] frames=${frames.length} signal=${signalFrameIndices.length} empty=${frames.length - signalFrameIndices.length} warmup=${warmupFramesApplied}\n`);

    // ──────────────────────────────────────────────────────────
    // Phase 1: Batch learning — single pass over all data
    // ──────────────────────────────────────────────────────────
    let batchSourceProfiles: SourceCredibilityProfile[] = [];
    let batchTransmission: EventMarketTransmissionSnapshot | null = null;
    if (args.causalIntegrityMode === 'batched') {
      [batchSourceProfiles, batchTransmission] = await Promise.all([
        allNews.length > 0 || allClusters.length > 0
          ? (await import('./source-credibility')).batchComputeSourceCredibility(allNews, allClusters)
          : Promise.resolve([] as SourceCredibilityProfile[]),
        allMarkets.length > 0 && (allNews.length > 0 || allClusters.length > 0)
          ? (await import('./event-market-transmission')).batchComputeTransmission(allNews, allClusters, allMarkets)
          : Promise.resolve(null as EventMarketTransmissionSnapshot | null),
      ]);
    }

    process.stderr.write(`[replay:batch] mode=${args.causalIntegrityMode} sourceProfiles=${batchSourceProfiles.length} transmission=${batchTransmission?.edges?.length ?? 0} edges\n`);

    // ──────────────────────────────────────────────────────────
    // Phase 1b: Compute adaptive parameters from data
    // ──────────────────────────────────────────────────────────
    const { initAdaptiveParamStore, computeAdaptiveParams } = await import('./investment/adaptive-params');
    initAdaptiveParamStore({ enabled: true });
    if (args.causalIntegrityMode === 'batched') {
      computeAdaptiveParams({
        priceSeries: buildPriceSeries(frames),
        forwardReturns: [],
        ideaRuns: [],
        sourceProfiles: batchSourceProfiles,
        mappingStats: mappingStatsMap,
        themeHorizonProfiles: baseReplayAdaptation?.themeProfiles || [],
      });
    }

    // ──────────────────────────────────────────────────────────
    // Phase 2: Lightweight per-frame evaluation
    // Uses batch credibility/transmission, runs only core signal chain:
    // buildEventCandidates → buildDirectMappings → buildIdeaCards
    // Skips: hidden discovery, sensitivity, risk gate, coverage, UI diagnostics
    // ──────────────────────────────────────────────────────────
    const ragModule = args.causalIntegrityMode === 'batched'
      ? await import('./investment/rag-retriever.js').catch(() => null)
      : null;
    let ragAvailable = Boolean(ragModule);

    // Pre-load GDELT daily aggregation for transmission proxy
    const gdeltByDate = new Map<string, GDELTDailyAgg[]>();
    if (ragModule && frames.length > 0) {
      try {
        const pool = (ragModule as { getRagPool?: () => { query: (q: string, v: string[]) => Promise<{ rows: Array<{ date: string; avg_goldstein: string; avg_tone: string; event_count: string }> }> } | null }).getRagPool?.();
        if (pool) {
          const startDate = (frames[0]?.timestamp ?? '').slice(0, 10);
          const endDate = (frames[frames.length - 1]?.timestamp ?? '').slice(0, 10);
          const gdeltResult = await pool.query(
            `SELECT date::text as date, AVG(avg_goldstein)::float as avg_goldstein, AVG(avg_tone)::float as avg_tone, SUM(event_count)::int as event_count
             FROM gdelt_daily_agg WHERE date >= $1::date AND date <= $2::date AND cameo_root IN ('14','17','18','19','20')
             GROUP BY date ORDER BY date`,
            [startDate, endDate],
          );
          for (const row of gdeltResult.rows) {
            const dateKey = String(row.date).slice(0, 10);
            const bucket = gdeltByDate.get(dateKey) ?? [];
            bucket.push({ date: dateKey, avgGoldstein: Number(row.avg_goldstein) || 0, avgTone: Number(row.avg_tone) || 0, eventCount: Number(row.event_count) || 0 });
            gdeltByDate.set(dateKey, bucket);
          }
        }
      } catch { /* GDELT proxy unavailable — non-fatal */ }
    }

    // Pre-load FRED macro indicators for ML features
    const fredByDate = new Map<string, { vix: number; yieldSpread: number; dollarIndex: number; oilPrice: number }>();
    if (ragModule && frames.length > 0) {
      try {
        const pool = (ragModule as { getRagPool?: () => { query: (q: string, v: string[]) => Promise<{ rows: Array<{ date: string; symbol: string; price: string }> }> } | null }).getRagPool?.();
        if (pool) {
          const startDate = (frames[0]?.timestamp ?? '').slice(0, 10);
          const endDate = (frames[frames.length - 1]?.timestamp ?? '').slice(0, 10);
          const fredResult = await pool.query(
            `SELECT valid_time_start::date::text AS date, symbol, price::float AS price
             FROM worldmonitor_intel.historical_raw_items
             WHERE provider = 'fred' AND symbol IN ('VIXCLS','T10Y2Y','DTWEXBGS','DCOILWTICO')
               AND valid_time_start >= $1::date AND valid_time_start <= $2::date
             ORDER BY valid_time_start`,
            [startDate, endDate],
          );
          for (const row of fredResult.rows) {
            const dateKey = String(row.date).slice(0, 10);
            const existing = fredByDate.get(dateKey) ?? { vix: 0, yieldSpread: 0, dollarIndex: 0, oilPrice: 0 };
            const price = Number(row.price) || 0;
            if (row.symbol === 'VIXCLS') existing.vix = price;
            else if (row.symbol === 'T10Y2Y') existing.yieldSpread = price;
            else if (row.symbol === 'DTWEXBGS') existing.dollarIndex = price;
            else if (row.symbol === 'DCOILWTICO') existing.oilPrice = price;
            fredByDate.set(dateKey, existing);
          }
        }
      } catch { /* FRED loading is non-fatal */ }
    }

    const totalFrames = frames.length;
    let lastProgressPct = 0;
    const prefixNews: NewsItem[] = [];
    const prefixClusters: ClusteredEvent[] = [];
    const prefixMarkets: MarketData[] = [];
    const incrementalPriceSeries = new Map<string, PricePoint[]>();

    for (const [index, frame] of frames.entries()) {
      const pct = Math.floor((index / totalFrames) * 100);
      if (pct >= lastProgressPct + 5) {
        lastProgressPct = pct;
        const accepted = ideaRuns.filter(r => r.admissionState === 'accepted').length;
        process.stderr.write(`[replay:progress] ${pct}% (${index}/${totalFrames} frames) ideas=${ideaRuns.length} accepted=${accepted}\n`);
      }

      const eligible = frameEligibility[index]!;
      const hasSignal = frame.news.length > 0 || frame.clusters.length > 0;

      if (frame.news.length > 0) prefixNews.push(...frame.news);
      if (frame.clusters.length > 0) prefixClusters.push(...frame.clusters);
      if (frame.markets.length > 0) prefixMarkets.push(...frame.markets);
      appendFramePrices(incrementalPriceSeries, frame);

      if (frame.markets.length > 0) {
        appendMarketHistory(frame.markets, frame.transactionTime || frame.timestamp);
      }

      if (!hasSignal) continue;

      // Lightweight signal chain: candidates → themes → mappings → ideas
      let frameSourceProfiles = batchSourceProfiles;
      let transmission = frame.transmission ?? batchTransmission;

      // GDELT transmission proxy: fill marketStress when transmission data is absent
      let gdeltProxy: TransmissionProxy | null = null;
      if (gdeltByDate.size > 0) {
        const frameDate = (frame.transactionTime || frame.timestamp || '').slice(0, 10);
        // Collect last 30 days of GDELT aggs for the proxy
        const lookback: GDELTDailyAgg[] = [];
        const frameDateMs = new Date(frameDate).getTime();
        for (const [dateKey, aggs] of gdeltByDate) {
          const dMs = new Date(dateKey).getTime();
          if (dMs <= frameDateMs && frameDateMs - dMs <= 30 * 24 * 60 * 60 * 1000) {
            lookback.push(...aggs);
          }
        }
        if (lookback.length > 0) {
          gdeltProxy = computeGDELTTransmissionProxy(lookback);
        }
      }
      if (args.causalIntegrityMode === 'strict') {
        const [{ recomputeSourceCredibility }, { recomputeEventMarketTransmission }] = await Promise.all([
          import('./source-credibility'),
          import('./event-market-transmission'),
        ]);
        frameSourceProfiles = prefixNews.length > 0 || prefixClusters.length > 0
          ? await recomputeSourceCredibility(prefixNews, prefixClusters, { skipPersist: true })
          : [];
        transmission = prefixMarkets.length > 0 && (prefixNews.length > 0 || prefixClusters.length > 0)
          ? await recomputeEventMarketTransmission({
            news: prefixNews,
            clusters: prefixClusters,
            markets: prefixMarkets,
            keywordGraph: null,
            skipPersist: true,
          })
          : null;
        computeAdaptiveParams({
          priceSeries: incrementalPriceSeries,
          forwardReturns: [],
          ideaRuns: [],
          sourceProfiles: frameSourceProfiles,
          mappingStats: mappingStatsMap,
          themeHorizonProfiles: baseReplayAdaptation?.themeProfiles || [],
        });
      }
      const macroOverlay = buildMacroRiskOverlay({
        regime: transmission?.regime ?? null,
        markets: prefixMarkets.slice(-24),
        clusters: prefixClusters.slice(-40),
        weightProfile: null,
      });
      let ragHitRate: number | null = null;
      let ragConfidence = 0;
      let frameKnnPrediction: KNNPrediction | null = null;
      if (ragAvailable && ragModule) {
        const frameText = Array.from(new Set(
          frame.clusters
            .map((cluster) => String(cluster.primaryTitle || '').trim())
            .filter(Boolean),
        )).join('\n');
        if (frameText) {
          try {
            const embedding = await ragModule.getEmbedding(frameText);
            const similarCases = await ragModule.retrieveSimilarCases(embedding, new Date(frame.timestamp));
            const ragSummary = ragModule.computeRagHitRate(similarCases);
            ragHitRate = ragSummary.hitRate;
            ragConfidence = ragSummary.confidence;
            // Convert to KNNPrediction for ML ensemble
            frameKnnPrediction = knnPredictionFromRagCases(similarCases, frame.timestamp);
          } catch {
            ragAvailable = false;
            ragHitRate = null;
            ragConfidence = 0;
          }
        }
      }
      const timestamp = frame.transactionTime || frame.timestamp;
      const { kept, falsePositive: fp } = buildEventCandidates({
        clusters: frame.clusters,
        transmission,
        sourceCredibility: frameSourceProfiles,
      });

      let frameIdeaCards: InvestmentIdeaCard[] = [];
      let frameMappingCount = 0;

      if (kept.length > 0) {
        const rawMappings = buildDirectMappings({
          candidates: kept,
          markets: frame.markets,
          transmission,
          timestamp,
          autonomy: buildShadowControlState([], timestamp),
          keywordGraph: null,
          weightProfile: getActiveWeightProfileSync(),
          macroOverlay,
        });
        const coverageLedger = buildCoverageLedgerFromMappings(rawMappings);
        const mappings = applyAdaptiveConfirmationLayer(rawMappings, baseReplayAdaptation, coverageLedger, {
          context: (args.investmentContext || 'replay') as any,
          referenceTimestamp: timestamp,
          currentThemePerformance: [],
        });
        frameMappingCount = mappings.length;
        frameIdeaCards = applyPortfolioExecutionControls(
          buildIdeaCards(mappings, [], macroOverlay, baseReplayAdaptation, {
            ragHitRate,
            ragConfidence,
            admissionThresholds: args.admissionThresholds,
            ensembleModels: args.ensembleModels ?? null,
            mlNormalization: args.mlNormalization ?? null,
            knnPrediction: frameKnnPrediction,
            gdeltProxy,
            macroIndicators: fredByDate.get((frame.transactionTime || frame.timestamp || '').slice(0, 10)) ?? null,
          }),
          macroOverlay,
        );

        // Update mapping performance stats so subsequent frames benefit from learned win rates
        if (frameIdeaCards.length > 0) {
          const tracked = updateTrackedIdeas(frameIdeaCards, frame.markets, timestamp);
          updateMappingPerformanceStats(tracked, 1.0);
        }
      }

      // Build a minimal snapshot-like object for buildIdeaRunsForFrame
      const minimalSnapshot = {
        falsePositive: { kept: fp.kept, screened: fp.screened, rejected: fp.rejected, reasons: fp.reasons },
        directMappings: Array(frameMappingCount).fill(null),
        ideaCards: frameIdeaCards,
        trackedIdeas: [] as any[],
        workflow: [] as any[],
      } as InvestmentIntelligenceSnapshot;

      if (eligible && (fp.kept > 0 || frameMappingCount > 0 || frameIdeaCards.length > 0)) {
        lastWorkflowWithSignal = [];
        if (frameMappingCount > 0) lastWorkflowWithExecution = [];
        if (frameIdeaCards.length > 0) lastWorkflowWithIdeaCards = [];
      }

      checkpoints.push({
        id: `${runId}:${frame.id}`,
        timestamp: frame.timestamp,
        validTimeStart: frame.validTimeStart || frame.timestamp,
        validTimeEnd: frame.validTimeEnd ?? null,
        transactionTime: timestamp,
        knowledgeBoundary: frame.knowledgeBoundary || frame.timestamp,
        evaluationEligible: eligible,
        frameId: frame.id || 'frame',
        newsCount: frame.news.length,
        clusterCount: frame.clusters.length,
        marketCount: frame.markets.length,
        ideaCount: frameIdeaCards.length,
        trackedIdeaCount: 0,
        sourceProfileCount: frameSourceProfiles.length,
        mappingStatCount: mappingStatsMap.size,
      });

      if (eligible) {
        ideaRuns.push(
          ...buildIdeaRunsForFrame(runId, frame, minimalSnapshot, lastRecordedByIdea, dedupeWindowMs),
        );
      }
    }

    const mappingStats = await listMappingPerformanceStats(10_000);
    const sourceProfiles = await exportSourceCredibilityState();
    const priceSeries = buildPriceSeries(frames);
    const forwardReturns = buildForwardReturns(runId, ideaRuns, priceSeries, args.horizonsHours);
    const realitySummary = buildRealitySummary(forwardReturns, ideaRuns);
    const diagnostics = buildReplayDiagnostics(ideaRuns, forwardReturns);
    const coverageLedger = buildCoverageLedgerFromFrames(
      frames,
      ideaRuns.map((ideaRun) => ({ frameId: ideaRun.frameId, themeId: ideaRun.themeId })),
    );
    const themeRegimeMetrics = buildThemeRegimeMetrics(frames, ideaRuns, forwardReturns);
    const fullPortfolioAccounting = computePortfolioAccountingSnapshot({
      frames,
      ideaRuns,
      forwardReturns,
      initialCapital: 100,
    });
    // Preserve trades for audit trail. Adaptively downsample the equity curve
    // only when it exceeds 500 points (long backtests) to limit JSON payload size
    // while retaining full resolution for short runs.
    const portfolioAccounting = {
      ...fullPortfolioAccounting,
      equityCurve: fullPortfolioAccounting.equityCurve.length > 500
        ? fullPortfolioAccounting.equityCurve.filter((_: unknown, i: number, arr: unknown[]) =>
            i % Math.ceil(arr.length / 500) === 0 || i === arr.length - 1
          )
        : fullPortfolioAccounting.equityCurve,
    } as typeof fullPortfolioAccounting;
    const statisticalSummary = buildReplayStatisticalSummary(forwardReturns, portfolioAccounting);
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
      diagnostics,
      coverageLedger,
      realitySummary,
      statisticalSummary,
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
        null,
        null,
      ),
    };

    if (args.recordAdaptation !== false) {
      // Store a lightweight digest for persist — full run is saved via outFile
      const digest = {
        ...run,
        checkpoints: [],
        ideaRuns: [],
        forwardReturns: [],
        sourceProfiles: [],
        mappingStats: [],
      } as HistoricalReplayRun;
      replayRuns.unshift(digest);
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
  foldCount?: number,
): WalkForwardWindow[] {
  const total = frames.length;
  if (total < 6) {
    return [
      {
        fold: 1,
        phase: 'train',
        from: frames[0]?.timestamp || nowIso(),
        to: frames[Math.max(0, total - 1)]?.timestamp || nowIso(),
        frameCount: total,
      },
    ];
  }

  if (typeof foldCount === 'number') {
    const firstTimestamp = frames[0]?.timestamp;
    if (!firstTimestamp) return [];
    const effectiveFoldCount = Math.max(1, Math.floor(Number.isFinite(foldCount) ? foldCount : 4)) || 4;
    const startDate = new Date(firstTimestamp);
    const addUtcMonths = (months: number): number => {
      const boundary = new Date(startDate.getTime());
      boundary.setUTCMonth(boundary.getUTCMonth() + months);
      return boundary.getTime();
    };
    const lowerBoundFrameIndex = (targetTs: number): number => {
      let low = 0;
      let high = total;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        const frameTs = asTs(frames[mid]?.timestamp);
        if (frameTs < targetTs) low = mid + 1;
        else high = mid;
      }
      return low;
    };
    const buildWindow = (
      fold: number,
      phase: WalkForwardWindow['phase'],
      startIndex: number,
      endIndex: number,
    ): WalkForwardWindow | null => {
      if (endIndex <= startIndex || startIndex >= total) return null;
      const slice = frames.slice(startIndex, Math.min(endIndex, total));
      if (slice.length === 0) return null;
      return {
        fold,
        phase,
        from: slice[0]!.timestamp,
        to: slice[slice.length - 1]!.timestamp,
        frameCount: slice.length,
      };
    };

    const windows: WalkForwardWindow[] = [];
    for (let fold = 1; fold <= effectiveFoldCount; fold += 1) {
      const trainEndIndex = lowerBoundFrameIndex(addUtcMonths(18 + ((fold - 1) * 12)));
      const validateEndIndex = lowerBoundFrameIndex(addUtcMonths(24 + ((fold - 1) * 12)));
      const testEndIndex = fold === effectiveFoldCount
        ? total
        : lowerBoundFrameIndex(addUtcMonths(30 + ((fold - 1) * 12)));
      const trainWindow = buildWindow(fold, 'train', 0, trainEndIndex);
      const validateWindow = buildWindow(fold, 'validate', trainEndIndex, validateEndIndex);
      const testWindow = buildWindow(fold, 'test', validateEndIndex, testEndIndex);
      if (!trainWindow || !validateWindow) break;
      windows.push(trainWindow, validateWindow);
      if (testWindow) windows.push(testWindow);
      if (!testWindow || testEndIndex >= total) break;
    }
    return windows;
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
      fold: 1,
      phase: 'train',
      from: trainFrames[0]!.timestamp,
      to: trainFrames[trainFrames.length - 1]!.timestamp,
      frameCount: trainFrames.length,
    });
  }
  const validateFrames = frames.slice(adjustedTrainCount, adjustedTrainCount + validateCount);
  if (validateFrames.length > 0) {
    windows.push({
      fold: 1,
      phase: 'validate',
      from: validateFrames[0]!.timestamp,
      to: validateFrames[validateFrames.length - 1]!.timestamp,
      frameCount: validateFrames.length,
    });
  }
  const testFrames = frames.slice(adjustedTrainCount + validateCount);
  if (testFrames.length > 0) {
    windows.push({
      fold: 1,
      phase: 'test',
      from: testFrames[0]!.timestamp,
      to: testFrames[testFrames.length - 1]!.timestamp,
      frameCount: testFrames.length,
    });
  }
  return windows;
}

function partitionWalkForwardFramesForHoldout(
  frames: HistoricalReplayFrame[],
  holdoutRatio = 0.2,
  holdoutMinFrames = 24,
): {
  tuningFrames: HistoricalReplayFrame[];
  holdoutFrames: HistoricalReplayFrame[];
} {
  if (frames.length === 0) {
    return { tuningFrames: [], holdoutFrames: [] };
  }
  const safeRatio = clamp(holdoutRatio, 0, 0.4);
  const safeMinFrames = Math.max(0, Math.floor(Number.isFinite(holdoutMinFrames) ? holdoutMinFrames : 24));
  if (safeRatio <= 0 || safeMinFrames <= 0) {
    return { tuningFrames: frames.slice(), holdoutFrames: [] };
  }

  const holdoutCount = Math.max(safeMinFrames, Math.floor(frames.length * safeRatio));
  const tuningCount = frames.length - holdoutCount;
  const minTuningFrames = Math.max(12, safeMinFrames);
  if (holdoutCount <= 0 || tuningCount < minTuningFrames) {
    return { tuningFrames: frames.slice(), holdoutFrames: [] };
  }

  return {
    tuningFrames: frames.slice(0, tuningCount),
    holdoutFrames: frames.slice(tuningCount),
  };
}

function sliceFramesForWalkForwardWindow(
  frames: HistoricalReplayFrame[],
  window: WalkForwardWindow,
): HistoricalReplayFrame[] {
  if (!frames.length || window.frameCount <= 0) return [];
  const startTs = asTs(window.from);
  const startIndex = frames.findIndex((frame) => asTs(frame.timestamp) >= startTs);
  if (startIndex < 0) return [];
  return frames.slice(startIndex, startIndex + window.frameCount);
}

function buildWalkForwardFoldPlans(
  frames: HistoricalReplayFrame[],
  windows: WalkForwardWindow[],
): WalkForwardFoldPlan[] {
  const grouped = new Map<number, WalkForwardWindow[]>();
  for (const window of windows) {
    const bucket = grouped.get(window.fold);
    if (bucket) bucket.push(window);
    else grouped.set(window.fold, [window]);
  }

  const phaseOrder: Record<WalkForwardWindow['phase'], number> = {
    train: 0,
    validate: 1,
    test: 2,
    oos: 3,
  };

  return Array.from(grouped.entries())
    .sort((left, right) => left[0] - right[0])
    .flatMap(([fold, foldWindows]) => {
      const ordered = foldWindows.slice().sort((left, right) =>
        phaseOrder[left.phase] - phaseOrder[right.phase]
        || asTs(left.from) - asTs(right.from));
      const trainWindow = ordered.find((window) => window.phase === 'train');
      const evaluationWindows = ordered.filter((window) => window.phase !== 'train');
      if (!trainWindow || evaluationWindows.length === 0) return [];

      const trainFrames = sliceFramesForWalkForwardWindow(frames, trainWindow);
      const evaluationFrames = evaluationWindows.flatMap((window) =>
        sliceFramesForWalkForwardWindow(frames, window));
      if (trainFrames.length === 0 || evaluationFrames.length === 0) return [];

      return [{
        fold,
        trainWindow,
        evaluationWindows,
        trainFrames,
        evaluationFrames,
      }];
    });
}

function buildWalkForwardSeedState(run: HistoricalReplayRun): HistoricalReplayOptions['seedState'] {
  return {
    sourceProfiles: run.sourceProfiles,
    investmentLearning: {
      mappingStats: run.mappingStats,
      banditStates: run.banditStates ?? [],
      candidateReviews: run.candidateReviews ?? [],
    } satisfies Partial<InvestmentLearningState>,
  };
}

function buildThresholdOptimizationSamples(
  run: HistoricalReplayRun,
): Array<{
  metaHitProbability: number;
  metaExpectedReturnPct: number;
  metaDecisionScore: number;
  forwardReturnPct: number | null;
}> {
  const returnByIdeaRun = new Map<string, number[]>();
  for (const row of run.forwardReturns) {
    const value = typeof row.costAdjustedSignedReturnPct === 'number'
      ? row.costAdjustedSignedReturnPct
      : row.signedReturnPct;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const bucket = returnByIdeaRun.get(row.ideaRunId) || [];
    bucket.push(value);
    returnByIdeaRun.set(row.ideaRunId, bucket);
  }

  return run.ideaRuns
    .filter((ideaRun) =>
      typeof ideaRun.metaHitProbability === 'number'
      && typeof ideaRun.metaExpectedReturnPct === 'number'
      && typeof ideaRun.metaDecisionScore === 'number')
    .map((ideaRun) => {
      const returns = returnByIdeaRun.get(ideaRun.id) || [];
      return {
        metaHitProbability: Number(ideaRun.metaHitProbability) / 100,
        metaExpectedReturnPct: Number(ideaRun.metaExpectedReturnPct),
        metaDecisionScore: Number(ideaRun.metaDecisionScore),
        forwardReturnPct: returns.length > 0 ? average(returns) : null,
      };
    });
}

function mergeLatestByKey<T>(
  rows: T[],
  getKey: (row: T) => string,
  getTs: (row: T) => number,
): T[] {
  const merged = new Map<string, T>();
  for (const row of rows) {
    const key = getKey(row);
    const previous = merged.get(key);
    if (!previous || getTs(row) >= getTs(previous)) {
      merged.set(key, row);
    }
  }
  return Array.from(merged.values()).sort((left, right) => getTs(right) - getTs(left));
}

function rebaseWalkForwardRun(
  run: HistoricalReplayRun,
  aggregateRunId: string,
  fold: number,
): Pick<HistoricalReplayRun, 'checkpoints' | 'ideaRuns' | 'forwardReturns'> {
  const foldPrefix = `${aggregateRunId}:fold-${fold}`;
  const ideaIdMap = new Map<string, string>();
  const ideaRuns = run.ideaRuns.map((ideaRun) => {
    const rebasedId = `${foldPrefix}:${ideaRun.id}`;
    ideaIdMap.set(ideaRun.id, rebasedId);
    return {
      ...ideaRun,
      id: rebasedId,
      runId: aggregateRunId,
    };
  });
  const forwardReturns = run.forwardReturns.map((row) => ({
    ...row,
    id: `${foldPrefix}:${row.id}`,
    runId: aggregateRunId,
    ideaRunId: ideaIdMap.get(row.ideaRunId) || `${foldPrefix}:${row.ideaRunId}`,
  }));
  const checkpoints = run.checkpoints.map((checkpoint) => ({
    ...checkpoint,
    id: `${foldPrefix}:${checkpoint.id}`,
  }));
  return { checkpoints, ideaRuns, forwardReturns };
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
      causalIntegrityMode: options.causalIntegrityMode || 'strict',
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
      const { tuningFrames, holdoutFrames } = partitionWalkForwardFramesForHoldout(
        normalized,
        options.holdoutRatio ?? 0.2,
        options.holdoutMinFrames ?? 24,
      );
      const windows = splitWalkForwardWindows(
        tuningFrames,
        options.trainRatio ?? 0.6,
        options.validateRatio ?? 0.2,
        options.foldCount,
      );
      const holdoutWindow = holdoutFrames.length > 0
        ? {
            fold: Math.max(1, (windows[windows.length - 1]?.fold || 0) + 1),
            phase: 'oos' as const,
            from: holdoutFrames[0]!.timestamp,
            to: holdoutFrames[holdoutFrames.length - 1]!.timestamp,
            frameCount: holdoutFrames.length,
          }
        : null;
      const windowsWithHoldout = holdoutWindow ? [...windows, holdoutWindow] : windows;
      const foldPlans = buildWalkForwardFoldPlans(tuningFrames, windows);
      if (foldPlans.length === 0) {
        return executeReplay({
          mode: 'walk-forward',
          label: options.label || 'Walk-Forward Backtest',
          frames: tuningFrames,
          horizonsHours: (options.horizonsHours || DEFAULT_HORIZONS_HOURS).slice(),
          retainLearningState: Boolean(options.retainLearningState),
          causalIntegrityMode: options.causalIntegrityMode || 'strict',
          dedupeWindowHours: options.dedupeWindowHours,
          warmupFrameCount: options.warmupFrameCount,
          warmupUntil: options.warmupUntil,
          transactionTimeCeiling: options.transactionTimeCeiling,
          knowledgeBoundaryCeiling: options.knowledgeBoundaryCeiling,
          seedState: options.seedState,
          windows: windowsWithHoldout,
          recordAdaptation: options.recordAdaptation,
          investmentContext: options.investmentContext,
        });
      }

      const label = options.label || 'Walk-Forward Backtest';
      const aggregateRunId = buildRunId('walk-forward', label);
      const horizonsHours = (options.horizonsHours || DEFAULT_HORIZONS_HOURS).slice();
      const evaluationRuns: HistoricalReplayRun[] = [];
      const evaluationFrames: HistoricalReplayFrame[] = [];
      const checkpoints: ReplayCheckpoint[] = [];
      const ideaRuns: BacktestIdeaRun[] = [];
      const forwardReturns: ForwardReturnRecord[] = [];
      let learnedThresholds: AdmissionThresholds | null = null;
      let mlState: MLWalkForwardState = createInitialMLState();

      // Pre-train ML models from labeled_outcomes (618k historical labels)
      if (tuningFrames.length > 0) {
        try {
          const ragMod = await import('./investment/rag-retriever.js').catch(() => null);
          const pool = (ragMod as { getRagPool?: () => { query: (t: string, v: (string | number)[]) => Promise<{ rows: unknown[] }> } | null } | null)?.getRagPool?.();
          if (pool) {
            const temporalBarrier = tuningFrames[0]?.timestamp ?? '';
            const preQuery = buildPreTrainingQuery(temporalBarrier, 15000);
            const preResult = await pool.query(preQuery.text, preQuery.values);
            const preSamples = convertPreTrainingRows(preResult.rows as Parameters<typeof convertPreTrainingRows>[0]);
            if (preSamples.length > 100) {
              mlState = trainEnsembleModels(mlState, preSamples);
              process.stderr.write(`[walk-forward:ml] Pre-trained on ${preSamples.length} labeled_outcomes (before ${temporalBarrier.slice(0, 10)})\n`);
            }
          }
        } catch { /* pre-training is non-fatal */ }
      }

      for (const [index, plan] of foldPlans.entries()) {
        const validateWindow = plan.evaluationWindows.find((window) => window.phase === 'validate') || null;
        const testWindows = plan.evaluationWindows.filter((window) => window.phase === 'test');
        const validateFrames = validateWindow ? sliceFramesForWalkForwardWindow(tuningFrames, validateWindow) : [];
        const testFrames = testWindows.flatMap((window) => sliceFramesForWalkForwardWindow(tuningFrames, window));
        const trainRun = await executeReplay({
          mode: 'replay',
          label: `${label} / fold-${plan.fold} train`,
          frames: plan.trainFrames,
          horizonsHours: horizonsHours.slice(),
          retainLearningState: false,
          causalIntegrityMode: options.causalIntegrityMode || 'strict',
          dedupeWindowHours: options.dedupeWindowHours,
          warmupFrameCount: plan.trainFrames.length,
          warmupUntil: plan.trainFrames[plan.trainFrames.length - 1]?.transactionTime || plan.trainFrames[plan.trainFrames.length - 1]?.timestamp,
          transactionTimeCeiling: plan.trainFrames[plan.trainFrames.length - 1]?.transactionTime || plan.trainFrames[plan.trainFrames.length - 1]?.timestamp,
          knowledgeBoundaryCeiling: plan.trainFrames[plan.trainFrames.length - 1]?.knowledgeBoundary || plan.trainFrames[plan.trainFrames.length - 1]?.timestamp,
          seedState: options.seedState,
          windows: [plan.trainWindow],
          recordAdaptation: false,
          investmentContext: options.investmentContext,
          admissionThresholds: learnedThresholds,
        });

        const validateRun = await executeReplay({
          mode: 'walk-forward',
          label: `${label} / fold-${plan.fold} validate`,
          frames: validateFrames,
          horizonsHours: horizonsHours.slice(),
          retainLearningState: false,
          causalIntegrityMode: options.causalIntegrityMode || 'strict',
          dedupeWindowHours: options.dedupeWindowHours,
          transactionTimeCeiling: options.transactionTimeCeiling,
          knowledgeBoundaryCeiling: options.knowledgeBoundaryCeiling,
          seedState: buildWalkForwardSeedState(trainRun),
          windows: validateWindow ? [plan.trainWindow, validateWindow] : [plan.trainWindow],
          recordAdaptation: false,
          investmentContext: options.investmentContext,
          admissionThresholds: learnedThresholds,
        });
        evaluationRuns.push(validateRun);
        evaluationFrames.push(...validateFrames);
        {
          const rebased = rebaseWalkForwardRun(validateRun, aggregateRunId, plan.fold);
          checkpoints.push(...rebased.checkpoints);
          ideaRuns.push(...rebased.ideaRuns);
          forwardReturns.push(...rebased.forwardReturns);
        }
        learnedThresholds = optimizeAdmissionThresholds(buildThresholdOptimizationSamples(validateRun));

        // ── ML ensemble training (Phase 2) ──
        {
          const mlSamples = extractMLTrainingSamples(validateRun.ideaRuns, validateRun.forwardReturns);
          mlState = trainEnsembleModels(mlState, mlSamples);
        }

        if (testFrames.length > 0) {
          const testRun = await executeReplay({
            mode: 'walk-forward',
            label: `${label} / fold-${plan.fold} test`,
            frames: testFrames,
            horizonsHours: horizonsHours.slice(),
            retainLearningState: Boolean(options.retainLearningState) && index === foldPlans.length - 1,
            causalIntegrityMode: options.causalIntegrityMode || 'strict',
            dedupeWindowHours: options.dedupeWindowHours,
            transactionTimeCeiling: options.transactionTimeCeiling,
            knowledgeBoundaryCeiling: options.knowledgeBoundaryCeiling,
            seedState: buildWalkForwardSeedState(validateRun),
            windows: [plan.trainWindow, ...testWindows],
            recordAdaptation: false,
            investmentContext: options.investmentContext,
            admissionThresholds: learnedThresholds,
            ensembleModels: mlState.ensemble,
            mlNormalization: mlState.normalization,
          });
          evaluationRuns.push(testRun);
          evaluationFrames.push(...testFrames);
          const rebased = rebaseWalkForwardRun(testRun, aggregateRunId, plan.fold);
          checkpoints.push(...rebased.checkpoints);
          ideaRuns.push(...rebased.ideaRuns);
          forwardReturns.push(...rebased.forwardReturns);
        }
      }

      let lockedOosSummary: LockedOosSummary | null = null;
      if (holdoutFrames.length > 0) {
        const finalTrainingWindow: WalkForwardWindow = {
          fold: holdoutWindow?.fold || (foldPlans.length + 1),
          phase: 'train',
          from: tuningFrames[0]?.timestamp || nowIso(),
          to: tuningFrames[tuningFrames.length - 1]?.timestamp || nowIso(),
          frameCount: tuningFrames.length,
        };
        const finalTrainRun = await executeReplay({
          mode: 'replay',
          label: `${label} / locked-oos train`,
          frames: tuningFrames,
          horizonsHours: horizonsHours.slice(),
          retainLearningState: false,
          causalIntegrityMode: options.causalIntegrityMode || 'strict',
          dedupeWindowHours: options.dedupeWindowHours,
          warmupFrameCount: tuningFrames.length,
          warmupUntil: tuningFrames[tuningFrames.length - 1]?.transactionTime || tuningFrames[tuningFrames.length - 1]?.timestamp,
          transactionTimeCeiling: tuningFrames[tuningFrames.length - 1]?.transactionTime || tuningFrames[tuningFrames.length - 1]?.timestamp,
          knowledgeBoundaryCeiling: tuningFrames[tuningFrames.length - 1]?.knowledgeBoundary || tuningFrames[tuningFrames.length - 1]?.timestamp,
          seedState: options.seedState,
          windows: [finalTrainingWindow],
          recordAdaptation: false,
          investmentContext: options.investmentContext,
          admissionThresholds: learnedThresholds,
        });
        // Re-train ML on full tuning data for final holdout evaluation
        {
          const finalMlSamples = extractMLTrainingSamples(finalTrainRun.ideaRuns, finalTrainRun.forwardReturns);
          mlState = trainEnsembleModels(mlState, finalMlSamples);
        }
        const lockedOosRun = await executeReplay({
          mode: 'walk-forward',
          label: `${label} / locked-oos`,
          frames: holdoutFrames,
          horizonsHours: horizonsHours.slice(),
          retainLearningState: false,
          causalIntegrityMode: options.causalIntegrityMode || 'strict',
          dedupeWindowHours: options.dedupeWindowHours,
          transactionTimeCeiling: options.transactionTimeCeiling,
          knowledgeBoundaryCeiling: options.knowledgeBoundaryCeiling,
          seedState: buildWalkForwardSeedState(finalTrainRun),
          windows: holdoutWindow ? [finalTrainingWindow, holdoutWindow] : [finalTrainingWindow],
          recordAdaptation: false,
          investmentContext: options.investmentContext,
          admissionThresholds: learnedThresholds,
          ensembleModels: mlState.ensemble,
          mlNormalization: mlState.normalization,
        });
        lockedOosSummary = {
          frameCount: holdoutFrames.length,
          ideaRunCount: lockedOosRun.ideaRuns.length,
          forwardReturnCount: lockedOosRun.forwardReturns.length,
          realitySummary: lockedOosRun.realitySummary,
          statisticalSummary: lockedOosRun.statisticalSummary,
          diagnostics: lockedOosRun.diagnostics,
          portfolioAccounting: lockedOosRun.portfolioAccounting,
          governance: null,
          windows: holdoutWindow ? [holdoutWindow] : [],
          summaryLines: lockedOosRun.summaryLines,
        };
      }

      const latestEvaluationRun = evaluationRuns[evaluationRuns.length - 1] || null;
      const sourceProfiles = mergeLatestByKey(
        evaluationRuns.flatMap((run) => run.sourceProfiles),
        (profile) => profile.id,
        (profile) => profile.lastEvaluatedAt || 0,
      );
      const mappingStats = mergeLatestByKey(
        evaluationRuns.flatMap((run) => run.mappingStats),
        (row) => row.id,
        (row) => asTs(row.lastUpdatedAt),
      );
      const fullPortfolioAccounting = computePortfolioAccountingSnapshot({
        frames: evaluationFrames,
        ideaRuns,
        forwardReturns,
        initialCapital: 100,
      });
      const portfolioAccounting = {
        ...fullPortfolioAccounting,
        equityCurve: fullPortfolioAccounting.equityCurve.length > 500
          ? fullPortfolioAccounting.equityCurve.filter((_: unknown, i: number, arr: unknown[]) =>
              i % Math.ceil(arr.length / 500) === 0 || i === arr.length - 1
            )
          : fullPortfolioAccounting.equityCurve,
      } as typeof fullPortfolioAccounting;
      const diagnostics = buildReplayDiagnostics(ideaRuns, forwardReturns);
      const coverageLedger = buildCoverageLedgerFromFrames(
        evaluationFrames,
        ideaRuns.map((ideaRun) => ({ frameId: ideaRun.frameId, themeId: ideaRun.themeId })),
      );
      const themeRegimeMetrics = buildThemeRegimeMetrics(evaluationFrames, ideaRuns, forwardReturns);
      const realitySummary = buildRealitySummary(forwardReturns, ideaRuns);
      const statisticalSummary = buildReplayStatisticalSummary(forwardReturns, portfolioAccounting);

      const governance = buildReplayGovernanceSummary({
        evaluationRuns,
        portfolioAccounting,
        lockedOosSummary,
      });
      if (lockedOosSummary) {
        lockedOosSummary = {
          ...lockedOosSummary,
          governance,
        };
      }

      let run: HistoricalReplayRun = {
        id: aggregateRunId,
        label,
        mode: 'walk-forward',
        startedAt: tuningFrames[0]?.timestamp || normalized[0]?.timestamp || nowIso(),
        completedAt: nowIso(),
        temporalMode: 'bitemporal',
        retainLearningState: Boolean(options.retainLearningState),
        frameCount: evaluationFrames.length,
        warmupFrameCount: 0,
        evaluationFrameCount: evaluationFrames.length,
        horizonsHours: sortUniqueHours(forwardReturns.map((record) => record.horizonHours)),
        checkpoints,
        ideaRuns,
        forwardReturns,
        sourceProfiles,
        mappingStats,
        banditStates: latestEvaluationRun?.banditStates ?? [],
        candidateReviews: latestEvaluationRun?.candidateReviews ?? [],
        workflow: latestEvaluationRun?.workflow || [],
        themeHorizonProfiles: latestEvaluationRun?.themeHorizonProfiles || [],
        themeRegimeMetrics,
        diagnostics,
        coverageLedger,
        realitySummary,
        statisticalSummary,
        portfolioAccounting,
        lockedOosSummary,
        governance,
        summaryLines: [],
        windows: windowsWithHoldout,
      };

      const adaptationSnapshot = options.recordAdaptation === false
        ? (await getReplayAdaptationSnapshot()) || emptyReplayAdaptationSnapshot()
        : await recordReplayRunAdaptation(run);
      const runThemeIds = new Set(run.ideaRuns.map((ideaRun) => String(ideaRun.themeId || '').trim().toLowerCase()).filter(Boolean));
      const runThemeProfiles = adaptationSnapshot.themeProfiles
        .filter((profile) => runThemeIds.has(String(profile.themeId || '').trim().toLowerCase()))
        .slice(0, 12);
      run = {
        ...run,
        themeHorizonProfiles: runThemeProfiles,
        summaryLines: buildSummaryLines(
          evaluationFrames.length,
          0,
          ideaRuns,
          forwardReturns,
          sourceProfiles,
          mappingStats,
          checkpoints,
          runThemeProfiles,
          windowsWithHoldout,
          portfolioAccounting,
          lockedOosSummary,
          governance,
        ),
      };

      if (options.recordAdaptation !== false) {
        const digest = {
          ...run,
          checkpoints: [],
          ideaRuns: [],
          forwardReturns: [],
          sourceProfiles: [],
          mappingStats: [],
        } as HistoricalReplayRun;
        replayRuns.unshift(digest);
        await persist();
      }
      await logSourceOpsEvent({
        kind: 'report',
        action: 'generated',
        actor: 'system',
        title: 'Walk-forward backtest completed',
        detail: `folds=${foldPlans.length} evalFrames=${evaluationFrames.length} ideaRuns=${ideaRuns.length} forwardReturns=${forwardReturns.length} retain=${options.retainLearningState ? 'yes' : 'no'}`,
        status: 'ok',
        category: 'backtest',
      });
      if (options.recordAdaptation !== false) {
        await archiveHistoricalReplayRun(run).catch(() => false);
      }
      return run;
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

export const __historicalReplayTestUtils = {
  normalizeFrames,
  buildReplayStatisticalSummary,
  buildReplayGovernanceSummary,
  splitWalkForwardWindows,
  buildWalkForwardFoldPlans,
  partitionWalkForwardFramesForHoldout,
};
