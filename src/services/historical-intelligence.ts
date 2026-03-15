import type { ClusteredEvent, MarketData, NewsItem } from '@/types';
import type { EventMarketTransmissionSnapshot } from './event-market-transmission';
import type {
  InvestmentIdeaCard,
  InvestmentLearningState,
  InvestmentDirection,
  InvestmentIntelligenceSnapshot,
  MappingPerformanceStats,
} from './investment-intelligence';
import type { ScheduledReport } from './scheduled-reports';
import type { SourceCredibilityProfile } from './source-credibility';
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
}

export interface WalkForwardBacktestOptions extends HistoricalReplayOptions {
  trainRatio?: number;
  validateRatio?: number;
}

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
const DEFAULT_HORIZONS_HOURS = [1, 4, 24, 72, 168];

let loaded = false;
let replayRuns: HistoricalReplayRun[] = [];

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function asTs(value: string): number {
  const ts = Date.parse(value);
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

function regionFromIdeaCard(card: InvestmentIdeaCard): string {
  const [, rawRegion] = card.title.split('|');
  return rawRegion?.trim() || 'Global';
}

function directionMultiplier(direction: InvestmentDirection): number {
  if (direction === 'short') return -1;
  if (direction === 'watch') return 0;
  return 1;
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const cached = await getPersistentCache<PersistedReplayRuns>(REPLAY_RUNS_KEY);
    replayRuns = Array.isArray(cached?.data?.runs) ? cached!.data!.runs : [];
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
  return frames
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
}

function buildPriceSeries(frames: HistoricalReplayFrame[]): Map<string, PricePoint[]> {
  const bySymbol = new Map<string, PricePoint[]>();
  for (const frame of frames) {
    const ts = asTs(frame.timestamp);
    const transactionTs = asTs(frame.transactionTime || frame.knowledgeBoundary || frame.timestamp);
    for (const market of frame.markets) {
      if (!market?.symbol || typeof market.price !== 'number' || !Number.isFinite(market.price)) continue;
      const bucket = bySymbol.get(market.symbol) || [];
      bucket.push({
        timestamp: frame.timestamp,
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

function buildIdeaRunsForFrame(
  runId: string,
  frame: HistoricalReplayFrame,
  snapshot: InvestmentIntelligenceSnapshot,
  lastRecordedByIdea: Map<string, { ts: number; conviction: number }>,
  dedupeWindowMs: number,
): BacktestIdeaRun[] {
  const frameTs = asTs(frame.timestamp);
  const marketMap = new Map(
    frame.markets
      .filter((market) => typeof market.price === 'number' && Number.isFinite(market.price))
      .map((market) => [market.symbol, market.price as number] as const),
  );

  const runs: BacktestIdeaRun[] = [];
  for (const card of snapshot.ideaCards) {
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
      generatedAt: frame.timestamp,
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
    const entryTs = asTs(ideaRun.generatedAt);
    for (const symbolState of ideaRun.symbols) {
      const series = priceSeries.get(symbolState.symbol) || [];
      const entryPrice =
        typeof symbolState.entryPrice === 'number' && Number.isFinite(symbolState.entryPrice)
          ? symbolState.entryPrice
          : findNearestPrice(series, entryTs, 30 * 60 * 1000)?.price ?? null;

      for (const horizonHours of horizonsHours) {
        const targetTs = entryTs + horizonHours * 60 * 60 * 1000;
        const exitPoint = findNearestPrice(series, targetTs, Math.max(2, horizonHours / 2) * 60 * 60 * 1000);
        const exitPrice = exitPoint?.price ?? null;
        const rawReturnPct =
          entryPrice && exitPrice
            ? Number((((exitPrice - entryPrice) / entryPrice) * 100).toFixed(2))
            : null;
        const signedReturnPct =
          rawReturnPct == null
            ? null
            : Number((rawReturnPct * directionMultiplier(symbolState.direction)).toFixed(2));

        records.push({
          id: `${ideaRun.id}:${symbolState.symbol}:${horizonHours}h`,
          runId,
          ideaRunId: ideaRun.id,
          symbol: symbolState.symbol,
          direction: symbolState.direction,
          horizonHours,
          entryTimestamp: ideaRun.generatedAt,
          exitTimestamp: exitPoint?.timestamp ?? null,
          entryPrice,
          exitPrice,
          rawReturnPct,
          signedReturnPct,
        });
      }
    }
  }
  return records;
}

function buildSummaryLines(
  frameCount: number,
  warmupFrameCount: number,
  _ideaRuns: BacktestIdeaRun[],
  forwardReturns: ForwardReturnRecord[],
  sourceProfiles: SourceCredibilityProfile[],
  mappingStats: MappingPerformanceStats[],
  _checkpoints: ReplayCheckpoint[],
  windows?: WalkForwardWindow[],
): string[] {
  const primaryHorizon = 24;
  const primary = forwardReturns.filter((row) => row.horizonHours === primaryHorizon && typeof row.signedReturnPct === 'number');
  const hitRate = primary.length > 0
    ? Math.round((primary.filter((row) => (row.signedReturnPct || 0) > 0).length / primary.length) * 100)
    : 0;
  const avgReturn = primary.length > 0
    ? Number(average(primary.map((row) => row.signedReturnPct || 0)).toFixed(2))
    : 0;
  const avgCredibility = sourceProfiles.length > 0
    ? Math.round(average(sourceProfiles.map((row) => row.posteriorAccuracyScore)))
    : 0;
  const avgMappingPosterior = mappingStats.length > 0
    ? Math.round(average(mappingStats.map((row) => row.posteriorWinRate)))
    : 0;

  return [
    `${frameCount} point-in-time frames processed, ${Math.max(0, frameCount - warmupFrameCount)} evaluated, ${warmupFrameCount} reserved for warm-up.`,
    `${forwardReturns.length} forward-return labels generated across ${new Set(forwardReturns.map((row) => row.symbol)).size} symbols and ${new Set(forwardReturns.map((row) => row.horizonHours)).size} horizons.`,
    `${primaryHorizon}h primary horizon hit-rate ${hitRate}% with avg signed return ${avgReturn}%.`,
    `Learned source posterior avg ${avgCredibility} and mapping posterior avg ${avgMappingPosterior}.`,
    windows && windows.length > 0
      ? `${windows.map((window) => `${window.phase}:${window.frameCount}`).join(' | ')}`
      : 'Single replay window executed.',
  ];
}

async function executeReplay(args: {
  mode: HistoricalReplayRun['mode'];
  label: string;
  frames: HistoricalReplayFrame[];
  horizonsHours: number[];
  retainLearningState: boolean;
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

    const checkpoints: ReplayCheckpoint[] = [];
    const ideaRuns: BacktestIdeaRun[] = [];
    const lastRecordedByIdea = new Map<string, { ts: number; conviction: number }>();
    let warmupFramesApplied = 0;
    let evaluationFrameCount = 0;

    for (const [index, frame] of frames.entries()) {
      const warmupByCount = Number(args.warmupFrameCount || 0) > 0 && index < Number(args.warmupFrameCount || 0);
      const warmupByTime = warmupUntilTs > 0 && asTs(frame.transactionTime || frame.timestamp) <= warmupUntilTs;
      const evaluationEligible = !(Boolean(frame.warmup) || warmupByCount || warmupByTime);
      if (!evaluationEligible) warmupFramesApplied += 1;
      else evaluationFrameCount += 1;

      const sourceProfiles = await recomputeSourceCredibility(frame.news, frame.clusters);
      const snapshot = await recomputeInvestmentIntelligence({
        clusters: frame.clusters,
        markets: frame.markets,
        transmission: frame.transmission ?? null,
        sourceCredibility: sourceProfiles,
        reports: frame.reports ?? [],
      });

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
    const finalSnapshot = await exportInvestmentLearningState();

    const run: HistoricalReplayRun = {
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
      horizonsHours: args.horizonsHours.slice(),
      checkpoints,
      ideaRuns,
      forwardReturns,
      sourceProfiles,
      mappingStats,
      banditStates: finalSnapshot.banditStates,
      candidateReviews: finalSnapshot.candidateReviews,
      workflow: finalSnapshot.snapshot?.workflow ?? [],
      summaryLines: buildSummaryLines(frames.length, warmupFramesApplied, ideaRuns, forwardReturns, sourceProfiles, mappingStats, checkpoints, args.windows),
      windows: args.windows,
    };

    replayRuns.unshift(run);
    await persist();
    await logSourceOpsEvent({
      kind: 'report',
      action: 'generated',
      actor: 'system',
      title: args.mode === 'walk-forward' ? 'Walk-forward backtest completed' : 'Historical replay completed',
      detail: `frames=${run.frameCount} ideaRuns=${ideaRuns.length} forwardReturns=${forwardReturns.length} retain=${args.retainLearningState ? 'yes' : 'no'}`,
      status: 'ok',
      category: 'backtest',
    });
    await archiveHistoricalReplayRun(run).catch(() => false);
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
