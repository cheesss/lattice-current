import type {
  TrackedIdeaState,
  InvestmentDirection,
  EventBacktestRow,
  InvestmentIdeaCard,
} from './types';
import { mappingStats, banditStates, currentSnapshot } from './module-state';
import { RETURN_EMA_ALPHA, MAPPING_POSTERIOR_DECAY, BANDIT_DIMENSION } from './constants';
import { average, clamp, percentile } from './utils';
import { mappingStatsId } from './idea-tracker';
import { updateConvictionModel } from './conviction-scorer';
import { createBanditArmState, updateBanditArm } from '../math-models/contextual-bandit';

function banditArmId(themeId: string, symbol: string, direction: InvestmentDirection): string {
  return `${themeId}::${symbol}::${direction}`;
}

/**
 * Updates an EMA (Exponential Moving Average) value for mapping statistics.
 * Uses RETURN_EMA_ALPHA constant for smoothing factor.
 */
export function updateMappingStatEma(previous: number, nextValue: number): number {
  return Number(((1 - RETURN_EMA_ALPHA) * previous + RETURN_EMA_ALPHA * nextValue).toFixed(2));
}

/**
 * Updates mapping performance statistics from closed tracked ideas.
 * Commits stats for closed ideas, updates conviction model, and maintains mapping performance map.
 * Also updates bandit arm states for contextual learning.
 */
export function updateMappingPerformanceStats(currentIdeas: TrackedIdeaState[], sourceQualityWeight: number = 1.0): TrackedIdeaState[] {
  const updatedIdeas = currentIdeas.map((idea) => {
    if (idea.status !== 'closed' || !idea.closedAt || idea.statsCommittedAt) {
      return idea;
    }

    const regimeLabel = currentSnapshot?.regime?.label ?? undefined;
    updateConvictionModel(idea.convictionFeatures, Number(idea.realizedReturnPct) || 0, {
      currentRegime: regimeLabel,
      generationRegime: regimeLabel, // best available approximation
      sourceQualityWeight,
    });

    for (const symbol of idea.symbols) {
      const realized = symbol.returnPct;
      if (typeof realized !== 'number' || !Number.isFinite(realized)) continue;
      const key = mappingStatsId(idea.themeId, symbol.symbol, symbol.direction);
      const previous = mappingStats.get(key);
      const alpha = (previous?.alpha ?? 1) * MAPPING_POSTERIOR_DECAY + (realized > 0 ? 1 : 0);
      const beta = (previous?.beta ?? 1) * MAPPING_POSTERIOR_DECAY + (realized > 0 ? 0 : 1);
      const posteriorWinRate = Number(((alpha / Math.max(alpha + beta, 1e-6)) * 100).toFixed(2));
      const emaReturnPct = updateMappingStatEma(previous?.emaReturnPct ?? realized, realized);
      const emaBestReturnPct = updateMappingStatEma(previous?.emaBestReturnPct ?? idea.bestReturnPct, idea.bestReturnPct);
      const emaWorstReturnPct = updateMappingStatEma(previous?.emaWorstReturnPct ?? idea.worstReturnPct, idea.worstReturnPct);
      const emaHoldingDays = updateMappingStatEma(previous?.emaHoldingDays ?? idea.daysHeld, idea.daysHeld);

      mappingStats.set(key, {
        id: key,
        themeId: idea.themeId,
        symbol: symbol.symbol,
        direction: symbol.direction,
        alpha: Number(alpha.toFixed(4)),
        beta: Number(beta.toFixed(4)),
        posteriorWinRate,
        emaReturnPct,
        emaBestReturnPct,
        emaWorstReturnPct,
        emaHoldingDays,
        observations: (previous?.observations ?? 0) + 1,
        lastUpdatedAt: idea.closedAt,
      });

      const reward = clamp(realized / 10, -1, 1);
      if (Array.isArray(symbol.contextVector) && symbol.contextVector.length === BANDIT_DIMENSION) {
        const armId = banditArmId(idea.themeId, symbol.symbol, symbol.direction);
        const updatedArm = updateBanditArm(
          banditStates.get(armId) || createBanditArmState(armId, BANDIT_DIMENSION),
          symbol.contextVector,
          reward,
        );
        banditStates.set(armId, updatedArm);
      }
    }

    return {
      ...idea,
      statsCommittedAt: idea.closedAt,
    };
  });

  return updatedIdeas;
}

/**
 * Builds backtest rows from closed tracked ideas.
 * Groups ideas by theme, symbol, and direction, computing aggregated performance metrics.
 * Returns top 24 backtests sorted by confidence.
 */
export function buildEventBacktests(currentIdeas: TrackedIdeaState[]): EventBacktestRow[] {
  const closed = currentIdeas.filter((idea) => idea.status === 'closed' && typeof idea.realizedReturnPct === 'number');
  const openIdeas = currentIdeas.filter((idea) => idea.status === 'open');
  const grouped = new Map<string, TrackedIdeaState[]>();

  for (const idea of closed) {
    for (const symbol of idea.symbols) {
      const key = `${idea.themeId}::${symbol.symbol}::${symbol.direction}`;
      const bucket = grouped.get(key) || [];
      bucket.push(idea);
      grouped.set(key, bucket);
    }
  }

  return Array.from(grouped.entries()).map(([key, bucket]) => {
    const [themeId = 'unknown', symbol = 'unknown', direction = 'watch'] = key.split('::');
    const returns = bucket.map((idea) => idea.realizedReturnPct).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const bests = bucket.map((idea) => idea.bestReturnPct).filter(Number.isFinite);
    const worsts = bucket.map((idea) => idea.worstReturnPct).filter(Number.isFinite);
    const hits = returns.filter((value) => value > 0).length;
    const activeCount = openIdeas.filter((idea) => idea.themeId === themeId && idea.symbols.some((item) => item.symbol === symbol)).length;
    const avgHoldingDays = average(bucket.map((idea) => idea.daysHeld));
    const confidence = clamp(Math.round(Math.min(100, 35 + returns.length * 11 + Math.max(0, average(returns)) * 2)), 20, 99);
    return {
      id: key,
      themeId,
      symbol,
      direction: direction as InvestmentDirection,
      sampleSize: returns.length,
      hitRate: returns.length > 0 ? Math.round((hits / returns.length) * 100) : 0,
      avgReturnPct: Number(average(returns).toFixed(2)),
      avgBestReturnPct: Number(average(bests).toFixed(2)),
      avgWorstReturnPct: Number(average(worsts).toFixed(2)),
      avgHoldingDays: Number(avgHoldingDays.toFixed(2)),
      activeCount,
      confidence,
      notes: [`${returns.length} closed samples`, activeCount > 0 ? `${activeCount} active signals` : 'no active signals'],
    };
  })
    .filter((row) => row.sampleSize > 0)
    .sort((a, b) => b.confidence - a.confidence || b.sampleSize - a.sampleSize)
    .slice(0, 24);
}

/**
 * Enriches idea cards with tracked idea data and backtest metrics.
 * Adds tracking status, live returns, realized returns, and backtest performance.
 */
export function enrichIdeaCards(
  ideaCards: InvestmentIdeaCard[],
  tracked: TrackedIdeaState[],
  backtests: EventBacktestRow[],
): InvestmentIdeaCard[] {
  return ideaCards.map((card) => {
    const trackedMatch = tracked.find((idea) => idea.ideaKey === card.id)
      || tracked.find((idea) => idea.title === card.title);
    const relatedBacktests = backtests.filter((row) =>
      row.themeId === card.themeId || card.symbols.some((symbol) => symbol.symbol === row.symbol),
    );
    const weightedSamples = relatedBacktests.reduce((sum, row) => sum + row.sampleSize, 0);
    const backtestHitRate = weightedSamples > 0
      ? Math.round(relatedBacktests.reduce((sum, row) => sum + row.hitRate * row.sampleSize, 0) / weightedSamples)
      : null;
    const backtestAvgReturnPct = weightedSamples > 0
      ? Number((relatedBacktests.reduce((sum, row) => sum + row.avgReturnPct * row.sampleSize, 0) / weightedSamples).toFixed(2))
      : null;
    const trackingStatus = trackedMatch
      ? trackedMatch.status
      : card.direction === 'watch'
        ? 'watch'
        : 'new';

    return {
      ...card,
      trackingStatus,
      daysHeld: trackedMatch?.daysHeld,
      liveReturnPct: trackedMatch?.status === 'open' ? trackedMatch.currentReturnPct : trackedMatch?.currentReturnPct ?? null,
      realizedReturnPct: trackedMatch?.realizedReturnPct ?? null,
      backtestHitRate,
      backtestAvgReturnPct,
      exitReason: trackedMatch?.exitReason ?? null,
    };
  });
}

/**
 * Scores an idea card for auto-triage ranking.
 * Combines conviction, false positive risk, evidence, and backtest signals.
 * Returns a score 0-100 used for filtering and prioritization.
 */
export function scoreIdeaCardTriage(card: InvestmentIdeaCard): number {
  const convictionScore = card.conviction * 0.42;
  const fpScore = (100 - card.falsePositiveRisk) * 0.26;
  const confirmationScore = card.confirmationScore * 0.18;
  const evidenceScore = Math.min(10, card.evidence.length * 3 + card.triggers.length);
  const transmissionScore = Math.min(10, card.transmissionPath.length * 2);
  const symbolScore = Math.min(8, card.symbols.length * 2);
  const analogScore = Math.min(8, card.analogRefs.length * 3);
  const backtestScore = (card.backtestHitRate != null ? Math.min(10, card.backtestHitRate * 0.14) : 0)
    + (card.backtestAvgReturnPct != null ? Math.min(8, Math.max(0, card.backtestAvgReturnPct) * 1.6) : 0);
  const calibrationScore = card.calibratedConfidence * 0.12;
  const realityScore = card.realityScore * 0.08;
  const recencyScore = card.recentEvidenceScore * 0.06;
  const coveragePenalty = card.coveragePenalty * 0.18;
  const directionPenalty = card.direction === 'watch' ? 10 : 0;
  const lowEvidencePenalty = card.evidence.length <= 1 && card.triggers.length <= 1 ? 8 : 0;
  const veryHighFpPenalty = card.falsePositiveRisk >= 82 ? 14 : 0;
  const autonomyPenalty = card.autonomyAction === 'abstain'
    ? 30
    : card.autonomyAction === 'shadow'
      ? 12
      : card.autonomyAction === 'watch'
        ? 8
        : 0;
  return clamp(
    Math.round(
      convictionScore
      + fpScore
      + evidenceScore
      + transmissionScore
      + symbolScore
      + analogScore
      + backtestScore
      + calibrationScore
      + realityScore
      + confirmationScore
      + recencyScore
      - coveragePenalty
      - directionPenalty
      - lowEvidencePenalty
      - veryHighFpPenalty
      - autonomyPenalty
    ),
    0,
    100,
  );
}

/**
 * Auto-triages idea cards by scoring and filtering based on multiple criteria.
 * Applies different thresholds for directional (long/short) vs watch signals.
 * Ensures coverage with fallback if too many cards are suppressed.
 */
export function autoTriageIdeaCards(ideaCards: InvestmentIdeaCard[]): { kept: InvestmentIdeaCard[]; suppressedCount: number } {
  const scored = ideaCards.map((card) => ({ card, score: scoreIdeaCardTriage(card) }))
    .sort((a, b) => b.score - a.score || b.card.conviction - a.card.conviction || a.card.falsePositiveRisk - b.card.falsePositiveRisk);
  const scoreValues = scored.map((item) => item.score);
  const confidenceValues = ideaCards.map((card) => card.calibratedConfidence);
  const realityValues = ideaCards.map((card) => card.realityScore);
  const directionalFloor = clamp(Math.round(percentile(scoreValues, 0.45) || 44), 36, 56);
  const watchFloor = clamp(directionalFloor + 10, 48, 66);
  const shadowConfidenceFloor = clamp(Math.round(percentile(confidenceValues, 0.35) || 52), 44, 62);
  const shadowRealityFloor = clamp(Math.round(percentile(realityValues, 0.35) || 45), 38, 58);
  const kept = scored.filter(({ card, score }) => {
    if (card.autonomyAction === 'abstain') return false;
    if (!card.executionGate && card.direction !== 'watch') return false;
    if (card.direction !== 'watch' && score >= directionalFloor) return true;
    if (card.direction === 'watch' && score >= watchFloor) return true;
    if ((card.backtestHitRate || 0) >= 58 && (card.backtestAvgReturnPct || 0) > 0.4) return true;
    if (card.autonomyAction === 'shadow' && card.calibratedConfidence >= shadowConfidenceFloor && card.realityScore >= shadowRealityFloor) return true;
    return false;
  }).map(({ card }) => card);
  if (kept.length === 0 && scored.length > 0) {
    const fallback = scored
      .filter(({ card }) => card.autonomyAction !== 'abstain' && (card.executionGate || card.direction === 'watch'))
      .slice(0, Math.min(2, scored.length))
      .map(({ card }) => card);
    return {
      kept: fallback,
      suppressedCount: Math.max(0, scored.length - fallback.length),
    };
  }
  return {
    kept,
    suppressedCount: Math.max(0, scored.length - kept.length),
  };
}
