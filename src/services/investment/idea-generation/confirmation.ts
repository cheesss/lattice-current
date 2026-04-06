import type { ReplayAdaptationSnapshot, CurrentThemePerformanceMetric } from '../../replay-adaptation';
import type { CoverageLedgerSnapshot } from '../../coverage-ledger';
import type { AutonomyAction } from '../../autonomy-constraints';
import { getReplayThemeProfileFromSnapshot, getCurrentThemePerformanceFromSnapshot } from '../../replay-adaptation';
import { getCoveragePenaltyForTheme } from '../../coverage-ledger';

import type {
  DirectAssetMapping, SectorSensitivityRow, EventBacktestRow,
  TrackedIdeaState, ConfirmationState, InvestmentDirection,
  InvestmentIntelligenceContext, InvestmentBias,
} from '../types';
import { clamp, normalize, average, nowIso } from '../utils';
import { executionReadinessScore } from './symbol-scoring';

// ============================================================================
// MARKET CONFIRMATION & EXECUTION SCORING
// ============================================================================

export function marketConfirmationScore(direction: InvestmentDirection, marketMovePct: number | null): number {
  if (typeof marketMovePct !== 'number' || !Number.isFinite(marketMovePct)) return 50;
  const directionalMove = direction === 'short'
    ? -marketMovePct
    : direction === 'hedge' || direction === 'watch' || direction === 'pair'
      ? Math.abs(marketMovePct) * 0.5
      : marketMovePct;
  return clamp(Math.round(50 + directionalMove * 10), 8, 96);
}

export function confirmationStateFromScore(score: number): ConfirmationState {
  if (score >= 72) return 'confirmed';
  if (score >= 54) return 'tentative';
  if (score >= 38) return 'fading';
  return 'contradicted';
}

function asTs(iso: string): number {
  return Date.parse(iso);
}

export function scoreCurrentPerformanceInfluence(args: {
  context: InvestmentIntelligenceContext;
  referenceTimestamp: string;
  replayProfile: ReturnType<typeof getReplayThemeProfileFromSnapshot>;
  currentPerformance: ReturnType<typeof getCurrentThemePerformanceFromSnapshot>;
  coverage: ReturnType<typeof getCoveragePenaltyForTheme>;
}): {
  weight: number;
  freshness: number;
  sampleConfidence: number;
  driftPenalty: number;
  currentReturn: number;
  currentHitRate: number;
  currentConfirmationScore: number;
} {
  const currentPerformance = args.currentPerformance;
  if (!currentPerformance) {
    return {
      weight: 0,
      freshness: 0,
      sampleConfidence: 0,
      driftPenalty: 0,
      currentReturn: 0,
      currentHitRate: 50,
      currentConfirmationScore: 0,
    };
  }
  const ageHours = Math.abs(asTs(args.referenceTimestamp) - asTs(currentPerformance.updatedAt)) / 3_600_000;
  const freshness = clamp(1 - ageHours / (24 * 21), 0, 1);
  const sampleCount = Math.max(0, Number(currentPerformance.activeCount) || 0) + Math.max(0, Number(currentPerformance.closedCount) || 0);
  const sampleConfidence = clamp(Math.log1p(sampleCount) / Math.log(10), 0, 1);
  const replayReliability = clamp((args.replayProfile?.confirmationReliability ?? 52) / 100, 0, 1);
  const coverageReliability = clamp(args.coverage.completenessScore / 100, 0, 1);
  const contextBase = args.context === 'live'
    ? 1
    : args.context === 'validation'
      ? 0.75
      : 0.55;
  const weight = Number((
    contextBase
    * freshness
    * (0.34 + sampleConfidence * 0.26 + replayReliability * 0.22 + coverageReliability * 0.18)
  ).toFixed(4));
  const driftPenalty = Number((
    weight
    * Math.min(18, Math.abs(args.replayProfile?.currentVsReplayDrift ?? 0) * 8)
  ).toFixed(2));
  return {
    weight,
    freshness,
    sampleConfidence,
    driftPenalty,
    currentReturn: Number(currentPerformance.avgReturnPct) || 0,
    currentHitRate: Number(currentPerformance.hitRate) || 50,
    currentConfirmationScore: Number(currentPerformance.confirmationScore) || 0,
  };
}

export function getCurrentThemePerformanceMetric(
  metrics: CurrentThemePerformanceMetric[],
  themeId: string,
): CurrentThemePerformanceMetric | null {
  const normalizedThemeId = normalize(themeId);
  return metrics.find((metric) => normalize(metric.themeId) === normalizedThemeId) || null;
}

export function estimateRegimeConditionalHalfLife(args: {
  replayProfile: ReturnType<typeof getReplayThemeProfileFromSnapshot>;
  currentInfluence: ReturnType<typeof scoreCurrentPerformanceInfluence>;
  coverage: ReturnType<typeof getCoveragePenaltyForTheme>;
  marketConfirmation: number;
}): {
  persistenceRho: number;
  multiplier: number;
  estimatedHalfLifeHours: number | null;
} {
  const preferredHorizonHours =
    typeof args.replayProfile?.preferredHorizonHours === 'number'
      ? Math.max(1, Math.round(args.replayProfile.preferredHorizonHours))
      : null;
  const replayReliability = clamp((args.replayProfile?.confirmationReliability ?? 52) / 100, 0, 1);
  const coverageReliability = clamp(args.coverage.completenessScore / 100, 0, 1);
  const positiveReturn = clamp(args.currentInfluence.currentReturn / 4, 0, 1);
  const negativeReturn = clamp(Math.abs(Math.min(0, args.currentInfluence.currentReturn)) / 4, 0, 1);
  const hitBonus = clamp((args.currentInfluence.currentHitRate - 50) / 28, 0, 1);
  const hitPenalty = clamp((50 - args.currentInfluence.currentHitRate) / 24, 0, 1);
  const driftPenalty = clamp(Math.abs(args.replayProfile?.currentVsReplayDrift ?? 0) / 6, 0, 1);
  const marketPenalty = args.marketConfirmation < 46 ? (46 - args.marketConfirmation) / 60 : 0;
  const marketBonus = args.marketConfirmation > 62 ? (args.marketConfirmation - 62) / 80 : 0;
  const persistenceRho = clamp(
    0.26
    + replayReliability * 0.28
    + coverageReliability * 0.12
    + positiveReturn * 0.08
    + hitBonus * 0.08
    + marketBonus * 0.06
    - negativeReturn * 0.18
    - hitPenalty * 0.12
    - driftPenalty * 0.2
    - marketPenalty * 0.08,
    0.2,
    0.94,
  );
  const halfLifePeriods = Math.abs(Math.log(0.5) / Math.log(persistenceRho));
  const multiplier = clamp(halfLifePeriods / 2.4, 0.24, 1.12);
  return {
    persistenceRho: Number(persistenceRho.toFixed(4)),
    multiplier: Number(multiplier.toFixed(4)),
    estimatedHalfLifeHours: preferredHorizonHours
      ? Math.max(12, Math.round(preferredHorizonHours * multiplier))
      : null,
  };
}

export function applyAdaptiveConfirmationLayer(
  mappings: DirectAssetMapping[],
  replayAdaptation: ReplayAdaptationSnapshot | null,
  coverageLedger: CoverageLedgerSnapshot | null,
  options: {
    context: InvestmentIntelligenceContext;
    referenceTimestamp: string;
    currentThemePerformance: CurrentThemePerformanceMetric[];
  },
): DirectAssetMapping[] {
  return mappings.map((mapping) => {
    const replayProfile = getReplayThemeProfileFromSnapshot(replayAdaptation, mapping.themeId);
    const currentPerformance =
      getCurrentThemePerformanceMetric(options.currentThemePerformance, mapping.themeId)
      || getCurrentThemePerformanceFromSnapshot(replayAdaptation, mapping.themeId);
    const coverage = getCoveragePenaltyForTheme(coverageLedger, mapping.themeId);
    const marketConfirmation = marketConfirmationScore(mapping.direction, mapping.marketMovePct);
    const replayUtility = replayProfile?.coverageAdjustedUtility ?? replayProfile?.utilityScore ?? 0;
    const regimeConsistency = clamp(Math.round(50 + ((mapping.regimeMultiplier ?? 1) - 1) * 42), 0, 100);
    const sourceDiversityScore = clamp(Math.round(mapping.sourceDiversity * 14), 0, 100);
    const executionReadiness = executionReadinessScore(mapping);
    const informationFlowScore = clamp(Math.round(Number(mapping.informationFlowScore) || 0), 0, 100);
    const knowledgeGraphScore = clamp(Math.round(Number(mapping.knowledgeGraphScore) || 0), 0, 100);
    const currentInfluence = scoreCurrentPerformanceInfluence({
      context: options.context,
      referenceTimestamp: options.referenceTimestamp,
      replayProfile,
      currentPerformance,
      coverage,
    });
    const halfLife = estimateRegimeConditionalHalfLife({
      replayProfile,
      currentInfluence,
      coverage,
      marketConfirmation,
    });
    const confirmationScore = clamp(
      Math.round(
        14
        + mapping.corroborationQuality * 0.18
        + mapping.realityScore * 0.14
        + mapping.recentEvidenceScore * 0.12
        + sourceDiversityScore * 0.08
        + marketConfirmation * 0.18
        + executionReadiness * 0.08
        + regimeConsistency * 0.08
        + informationFlowScore * 0.06
        + knowledgeGraphScore * 0.06
        + Math.max(0, replayUtility) * 0.14
        + (replayProfile?.confirmationReliability ?? 0) * 0.08
        + currentInfluence.currentConfirmationScore * currentInfluence.weight * 0.1
        + (currentInfluence.currentHitRate - 50) * currentInfluence.weight * 0.18
        + currentInfluence.currentReturn * currentInfluence.weight * 6
        - mapping.executionPenaltyPct * 3.4
        - coverage.coveragePenalty * 0.44
        - currentInfluence.driftPenalty,
      ),
      0,
      100,
    );
    const confirmationState = confirmationStateFromScore(confirmationScore);
    const sizeMultiplier = Number(clamp(
      (
        (confirmationScore / 78)
        * (0.48 + marketConfirmation / 100)
        * (0.52 + executionReadiness / 125)
        * (1 - coverage.coveragePenalty / 130)
      ),
      0,
      1.25,
    ).toFixed(4));
    const horizonMultiplier = Number(clamp(
      (
        (replayProfile ? 0.82 + replayProfile.confirmationReliability / 140 : 1)
        * (marketConfirmation < 45 ? 0.72 : marketConfirmation > 62 ? 1.1 : 0.94)
        * clamp(1 + currentInfluence.currentReturn * currentInfluence.weight * 0.05, 0.84, 1.12)
        * halfLife.multiplier
      ),
      0.22,
      1.28,
    ).toFixed(4));
    const executionGate = executionReadiness >= 52 && mapping.realityScore >= 34 && confirmationScore >= 36;
    const calibratedConfidence = clamp(
      Math.round(mapping.calibratedConfidence * 0.58 + confirmationScore * 0.42 - coverage.coveragePenalty * 0.06),
      0,
      99,
    );
    const conviction = clamp(
      Math.round(mapping.conviction * 0.66 + confirmationScore * 0.34 - coverage.coveragePenalty * 0.08),
      12,
      99,
    );
    const falsePositiveRisk = clamp(
      Math.round(mapping.falsePositiveRisk * 0.74 + Math.max(0, 72 - confirmationScore) * 0.34 + coverage.coveragePenalty * 0.24),
      4,
      96,
    );
    const autonomyAction: AutonomyAction = !executionGate || confirmationState === 'contradicted'
      ? 'abstain'
      : confirmationState === 'fading'
        ? 'shadow'
        : confirmationState === 'tentative'
          ? (mapping.autonomyAction === 'deploy' ? 'shadow' : mapping.autonomyAction)
          : mapping.autonomyAction;

    return {
      ...mapping,
      conviction,
      falsePositiveRisk,
      calibratedConfidence,
      confirmationScore,
      confirmationState,
      sizeMultiplier,
      horizonMultiplier,
      executionGate,
      coveragePenalty: coverage.coveragePenalty,
      autonomyAction,
      autonomyReasons: Array.from(new Set([
        ...mapping.autonomyReasons,
        `Confirmation=${confirmationScore}`,
        `MarketConfirm=${marketConfirmation}`,
        `ExecReady=${executionReadiness}`,
        `InfoFlow=${informationFlowScore}`,
        `KG=${knowledgeGraphScore}`,
        `CoveragePenalty=${coverage.coveragePenalty}`,
        replayProfile ? `ReplayUtility=${replayUtility.toFixed(2)}` : 'ReplayUtility=unavailable',
        currentPerformance ? `CurrentWeight=${(currentInfluence.weight * 100).toFixed(0)}` : 'CurrentWeight=0',
        halfLife.estimatedHalfLifeHours ? `HalfLife=${halfLife.estimatedHalfLifeHours}h` : '',
      ])).slice(0, 6),
    };
  }).sort((a, b) =>
    b.confirmationScore - a.confirmationScore
    || b.calibratedConfidence - a.calibratedConfidence
    || b.conviction - a.conviction
  );
}

export function buildCurrentThemePerformanceMetrics(
  mappings: DirectAssetMapping[],
  tracked: TrackedIdeaState[],
  backtests: EventBacktestRow[],
): Array<{
  themeId: string;
  activeCount: number;
  closedCount: number;
  hitRate: number;
  avgReturnPct: number;
  confirmationScore: number;
  updatedAt: string;
}> {
  const now = nowIso();
  const themeIds = Array.from(new Set(mappings.map((mapping) => mapping.themeId).filter(Boolean)));
  return themeIds.map((themeId) => {
    const themeMappings = mappings.filter((mapping) => mapping.themeId === themeId);
    const relatedTracked = tracked.filter((idea) => idea.themeId === themeId);
    const relatedBacktests = backtests.filter((row) => row.themeId === themeId);
    const activeCount = relatedTracked.filter((idea) => idea.status === 'open').length;
    const closedCount = relatedTracked.filter((idea) => idea.status === 'closed').length;
    const weightedSamples = relatedBacktests.reduce((sum, row) => sum + row.sampleSize, 0);
    const hitRate = weightedSamples > 0
      ? Math.round(relatedBacktests.reduce((sum, row) => sum + row.hitRate * row.sampleSize, 0) / weightedSamples)
      : 0;
    const avgReturnPct = weightedSamples > 0
      ? Number((relatedBacktests.reduce((sum, row) => sum + row.avgReturnPct * row.sampleSize, 0) / weightedSamples).toFixed(2))
      : Number(average(
        relatedTracked
          .map((idea) => idea.status === 'closed' ? idea.realizedReturnPct : idea.currentReturnPct)
          .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
      ).toFixed(2));
    const confirmationScore = clamp(
      Math.round(average(themeMappings.map((mapping) => mapping.confirmationScore || 0))),
      0,
      100,
    );
    return {
      themeId,
      activeCount,
      closedCount,
      hitRate,
      avgReturnPct,
      confirmationScore,
      updatedAt: now,
    };
  });
}

export function buildRollingThemePerformanceMetrics(
  tracked: TrackedIdeaState[],
  backtests: EventBacktestRow[],
  timestamp: string,
): CurrentThemePerformanceMetric[] {
  const themeIds = Array.from(new Set([
    ...tracked.map((idea) => idea.themeId),
    ...backtests.map((row) => row.themeId),
  ].filter(Boolean)));
  return themeIds.map((themeId) => {
    const relatedTracked = tracked.filter((idea) => idea.themeId === themeId);
    const relatedBacktests = backtests.filter((row) => row.themeId === themeId);
    const activeCount = relatedTracked.filter((idea) => idea.status === 'open').length;
    const closedCount = relatedTracked.filter((idea) => idea.status === 'closed').length;
    const weightedSamples = relatedBacktests.reduce((sum, row) => sum + row.sampleSize, 0);
    const trackedReturns = relatedTracked
      .map((idea) => idea.status === 'closed' ? idea.realizedReturnPct : idea.currentReturnPct)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const trackedHitRate = trackedReturns.length > 0
      ? Math.round((trackedReturns.filter((value) => value > 0).length / trackedReturns.length) * 100)
      : 0;
    const hitRate = weightedSamples > 0
      ? Math.round(relatedBacktests.reduce((sum, row) => sum + row.hitRate * row.sampleSize, 0) / weightedSamples)
      : trackedHitRate;
    const avgReturnPct = weightedSamples > 0
      ? Number((relatedBacktests.reduce((sum, row) => sum + row.avgReturnPct * row.sampleSize, 0) / weightedSamples).toFixed(2))
      : Number(average(trackedReturns).toFixed(2));
    const sampleCount = weightedSamples > 0 ? weightedSamples : trackedReturns.length;
    const confirmationScore = clamp(
      Math.round(
        36
        + Math.log1p(sampleCount) * 9
        + (hitRate - 50) * 0.42
        + avgReturnPct * 6
        + Math.min(8, activeCount * 1.6),
      ),
      0,
      100,
    );
    return {
      themeId,
      activeCount,
      closedCount,
      hitRate,
      avgReturnPct,
      confirmationScore,
      updatedAt: timestamp,
    };
  }).sort((a, b) =>
    b.confirmationScore - a.confirmationScore
    || (b.activeCount + b.closedCount) - (a.activeCount + a.closedCount)
  );
}

export function buildSensitivityRows(
  mappings: DirectAssetMapping[],
  backtests: EventBacktestRow[],
  tracked: TrackedIdeaState[],
): SectorSensitivityRow[] {
  const grouped = new Map<string, DirectAssetMapping[]>();
  for (const mapping of mappings) {
    const key = `${mapping.sector}::${mapping.commodity || 'na'}`;
    const bucket = grouped.get(key) || [];
    bucket.push(mapping);
    grouped.set(key, bucket);
  }

  return Array.from(grouped.entries()).map(([key, bucket]) => {
    const [sector = 'unknown', commodityRaw = 'na'] = key.split('::');
    const commodity = commodityRaw === 'na' ? null : commodityRaw;
    const longScore = bucket.filter((item) => item.direction === 'long').reduce((sum, item) => sum + item.sensitivityScore, 0);
    const shortScore = bucket.filter((item) => item.direction === 'short').reduce((sum, item) => sum + item.sensitivityScore, 0);
    const hedgeScore = bucket.filter((item) => item.direction === 'hedge').reduce((sum, item) => sum + item.sensitivityScore, 0);
    const symbols = Array.from(new Set(bucket.map((item) => item.symbol)));
    const themeIds = Array.from(new Set(bucket.map((item) => item.themeId)));
    const relevantBacktests = backtests.filter((row) => symbols.includes(row.symbol) || themeIds.includes(row.themeId));
    const relevantTracked = tracked.filter((idea) =>
      idea.symbols.some((symbol) => symbols.includes(symbol.symbol)),
    );
    const liveReturns = relevantTracked
      .map((idea) => idea.status === 'closed' ? idea.realizedReturnPct : idea.currentReturnPct)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const weightedWinRateDenominator = relevantBacktests.reduce((sum, row) => sum + row.sampleSize, 0);
    const weightedWinRate = weightedWinRateDenominator > 0
      ? Math.round(relevantBacktests.reduce((sum, row) => sum + row.hitRate * row.sampleSize, 0) / weightedWinRateDenominator)
      : null;
    const bias: InvestmentBias = longScore >= shortScore + hedgeScore
      ? 'benefit'
      : shortScore >= longScore + hedgeScore
        ? 'pressure'
        : 'mixed';
    return {
      id: key,
      sector,
      commodity,
      bias,
      sensitivityScore: clamp(Math.round(average(bucket.map((item) => item.sensitivityScore))), 10, 99),
      conviction: clamp(Math.round(average(bucket.map((item) => item.conviction))), 10, 99),
      linkedEvents: new Set(bucket.map((item) => item.eventTitle)).size,
      sampleSize: relevantBacktests.reduce((sum, row) => sum + row.sampleSize, 0),
      liveReturnPct: liveReturns.length > 0 ? Number(average(liveReturns).toFixed(2)) : null,
      backtestWinRate: weightedWinRate,
      drivers: Array.from(new Set(bucket.flatMap((item) => item.reasons))).slice(0, 4),
      symbols: symbols.slice(0, 6),
    };
  }).sort((a, b) => b.sensitivityScore - a.sensitivityScore).slice(0, 14);
}
