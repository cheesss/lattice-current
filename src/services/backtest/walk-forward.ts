import type {
  BacktestIdeaRun,
  ForwardReturnRecord,
  HistoricalReplayFrame,
  HistoricalReplayOptions,
  HistoricalReplayRun,
  LockedOosSummary,
  ReplayCheckpoint,
  WalkForwardBacktestOptions,
  WalkForwardFoldPlan,
  WalkForwardWindow,
} from './backtest-types';
import type { InvestmentLearningState } from '../investment-intelligence';
import type { AdmissionThresholds } from '../investment/adaptive-params/threshold-optimizer.js';
import { optimizeAdmissionThresholds } from '../investment/adaptive-params/threshold-optimizer.js';
import {
  computePortfolioAccountingSnapshot,
} from '../portfolio-accounting';
import {
  buildCoverageLedgerFromFrames,
} from '../coverage-ledger';
import {
  getReplayAdaptationSnapshot,
  recordReplayRunAdaptation,
} from '../replay-adaptation';
import { logSourceOpsEvent } from '../source-ops-log';
import { archiveHistoricalReplayRun } from '../historical-archive';
import { measureResourceOperation } from '../resource-telemetry';
import {
  executeReplay,
  normalizeFrames,
  emptyReplayAdaptationSnapshot,
  nowIso,
  buildReplayStatisticalSummary,
  buildReplayGovernanceSummary,
  getReplayRuns,
  DEFAULT_HORIZONS_HOURS,
  buildRunId,
  buildSummaryLines,
  buildRealitySummary,
  buildReplayDiagnostics,
  buildThemeRegimeMetrics,
  sortUniqueHours,
  mergeLatestByKey,
  asTs,
} from './replay-workflow';

// ────────────────────────────────────────────────────────────────
// Walk-forward window splitting
// ────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function splitWalkForwardWindows(
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

export function partitionWalkForwardFramesForHoldout(
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

export function buildWalkForwardFoldPlans(
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

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

// ────────────────────────────────────────────────────────────────
// Main walk-forward backtest entry point
// ────────────────────────────────────────────────────────────────

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
            ensembleModels: null,
            mlNormalization: null,
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
          ensembleModels: null,
          mlNormalization: null,
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
        const replayRuns = getReplayRuns();
        const digest = {
          ...run,
          checkpoints: [],
          ideaRuns: [],
          forwardReturns: [],
          sourceProfiles: [],
          mappingStats: [],
        } as HistoricalReplayRun;
        replayRuns.unshift(digest);
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
