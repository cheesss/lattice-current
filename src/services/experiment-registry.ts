import type { HistoricalReplayRun } from './historical-intelligence';
import type { InvestmentIntelligenceSnapshot } from './investment-intelligence';

export interface SelfTuningWeightProfile {
  corroborationWeightMultiplier: number;
  contradictionPenaltyMultiplier: number;
  recencyPenaltyMultiplier: number;
  realityPenaltyMultiplier: number;
  graphPropagationWeightMultiplier: number;
  riskOffExposureMultiplier: number;
  riskOnAggressionMultiplier: number;
  regimeRiskOffMultiplier: number;
  regimeInflationMultiplier: number;
}

export interface ExperimentPerformanceSnapshot {
  generatedAt: string;
  rawHitRate24h: number;
  costAdjustedHitRate24h: number;
  rawAvgReturn24h: number;
  costAdjustedAvgReturn24h: number;
  portfolioWeightedReturnPct: number;
  portfolioCagrPct: number;
  portfolioMaxDrawdownPct: number;
  portfolioSharpe: number;
  avgExecutionPenaltyPct: number;
  recentShadowHitRate: number;
  recentShadowAvgReturnPct: number;
  recentDrawdownPct: number;
  abstainRate: number;
  realityBlockedRate: number;
  hiddenCandidateCount: number;
}

export interface ExperimentRegistryEntry {
  id: string;
  recordedAt: string;
  score: number;
  action: 'observe' | 'promote' | 'rollback';
  reason: string;
  profile: SelfTuningWeightProfile;
  performance: ExperimentPerformanceSnapshot;
}

export interface ExperimentRegistrySnapshot {
  activeProfile: SelfTuningWeightProfile;
  lastScore: number;
  rollbackArmed: boolean;
  activeReason: string;
  history: ExperimentRegistryEntry[];
}

const DEFAULT_PROFILE: SelfTuningWeightProfile = {
  corroborationWeightMultiplier: 1,
  contradictionPenaltyMultiplier: 1,
  recencyPenaltyMultiplier: 1,
  realityPenaltyMultiplier: 1,
  graphPropagationWeightMultiplier: 1,
  riskOffExposureMultiplier: 1,
  riskOnAggressionMultiplier: 1,
  regimeRiskOffMultiplier: 1,
  regimeInflationMultiplier: 1,
};

let currentRegistry: ExperimentRegistrySnapshot = {
  activeProfile: { ...DEFAULT_PROFILE },
  lastScore: 50,
  rollbackArmed: false,
  activeReason: 'Default weight profile is active.',
  history: [],
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function nowIso(): string {
  return new Date().toISOString();
}

export function defaultSelfTuningWeightProfile(): SelfTuningWeightProfile {
  return { ...DEFAULT_PROFILE };
}

export function normalizeWeightProfile(profile?: Partial<SelfTuningWeightProfile> | null): SelfTuningWeightProfile {
  return {
    corroborationWeightMultiplier: clamp(Number(profile?.corroborationWeightMultiplier) || DEFAULT_PROFILE.corroborationWeightMultiplier, 0.7, 1.5),
    contradictionPenaltyMultiplier: clamp(Number(profile?.contradictionPenaltyMultiplier) || DEFAULT_PROFILE.contradictionPenaltyMultiplier, 0.7, 1.6),
    recencyPenaltyMultiplier: clamp(Number(profile?.recencyPenaltyMultiplier) || DEFAULT_PROFILE.recencyPenaltyMultiplier, 0.7, 1.6),
    realityPenaltyMultiplier: clamp(Number(profile?.realityPenaltyMultiplier) || DEFAULT_PROFILE.realityPenaltyMultiplier, 0.7, 1.8),
    graphPropagationWeightMultiplier: clamp(Number(profile?.graphPropagationWeightMultiplier) || DEFAULT_PROFILE.graphPropagationWeightMultiplier, 0.6, 1.6),
    riskOffExposureMultiplier: clamp(Number(profile?.riskOffExposureMultiplier) || DEFAULT_PROFILE.riskOffExposureMultiplier, 0.6, 1.6),
    riskOnAggressionMultiplier: clamp(Number(profile?.riskOnAggressionMultiplier) || DEFAULT_PROFILE.riskOnAggressionMultiplier, 0.6, 1.5),
    regimeRiskOffMultiplier: clamp(Number(profile?.regimeRiskOffMultiplier) || DEFAULT_PROFILE.regimeRiskOffMultiplier, 0.7, 1.5),
    regimeInflationMultiplier: clamp(Number(profile?.regimeInflationMultiplier) || DEFAULT_PROFILE.regimeInflationMultiplier, 0.7, 1.5),
  };
}

export function hydrateExperimentRegistry(snapshot?: Partial<ExperimentRegistrySnapshot> | null): ExperimentRegistrySnapshot {
  currentRegistry = {
    activeProfile: normalizeWeightProfile(snapshot?.activeProfile),
    lastScore: Number(snapshot?.lastScore) || 50,
    rollbackArmed: Boolean(snapshot?.rollbackArmed),
    activeReason: String(snapshot?.activeReason || 'Default weight profile is active.'),
    history: Array.isArray(snapshot?.history) ? snapshot!.history!.slice(-64).map((entry) => ({
      id: String(entry.id || `${entry.action || 'observe'}:${entry.recordedAt || nowIso()}`),
      recordedAt: String(entry.recordedAt || nowIso()),
      score: Number(entry.score) || 0,
      action: entry.action === 'promote' || entry.action === 'rollback' ? entry.action : 'observe',
      reason: String(entry.reason || ''),
      profile: normalizeWeightProfile(entry.profile),
      performance: entry.performance as ExperimentPerformanceSnapshot,
    })) : [],
  };
  return getExperimentRegistrySnapshot();
}

export function getExperimentRegistrySnapshot(): ExperimentRegistrySnapshot {
  return {
    activeProfile: { ...currentRegistry.activeProfile },
    lastScore: currentRegistry.lastScore,
    rollbackArmed: currentRegistry.rollbackArmed,
    activeReason: currentRegistry.activeReason,
    history: currentRegistry.history.map((entry) => ({
      ...entry,
      profile: { ...entry.profile },
      performance: { ...entry.performance },
    })),
  };
}

export function getActiveWeightProfileSync(): SelfTuningWeightProfile {
  return { ...currentRegistry.activeProfile };
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function readRealityMetrics(runs: HistoricalReplayRun[]): {
  rawHitRate24h: number;
  costAdjustedHitRate24h: number;
  rawAvgReturn24h: number;
  costAdjustedAvgReturn24h: number;
  avgExecutionPenaltyPct: number;
} {
  const summaries = runs
    .map((run) => run.realitySummary)
    .filter(Boolean);
  if (!summaries.length) {
    return {
      rawHitRate24h: 0,
      costAdjustedHitRate24h: 0,
      rawAvgReturn24h: 0,
      costAdjustedAvgReturn24h: 0,
      avgExecutionPenaltyPct: 0,
    };
  }
  return {
    rawHitRate24h: round(average(summaries.map((item) => item.rawHitRate))),
    costAdjustedHitRate24h: round(average(summaries.map((item) => item.costAdjustedHitRate))),
    rawAvgReturn24h: round(average(summaries.map((item) => item.rawAvgReturnPct))),
    costAdjustedAvgReturn24h: round(average(summaries.map((item) => item.costAdjustedAvgReturnPct))),
    avgExecutionPenaltyPct: round(average(summaries.map((item) => item.avgExecutionPenaltyPct))),
  };
}

function readPortfolioMetrics(runs: HistoricalReplayRun[]): {
  portfolioWeightedReturnPct: number;
  portfolioCagrPct: number;
  portfolioMaxDrawdownPct: number;
  portfolioSharpe: number;
} {
  const summaries = runs
    .map((run) => run.portfolioAccounting?.summary)
    .filter((summary): summary is NonNullable<HistoricalReplayRun['portfolioAccounting']>['summary'] => Boolean(summary));
  if (!summaries.length) {
    return {
      portfolioWeightedReturnPct: 0,
      portfolioCagrPct: 0,
      portfolioMaxDrawdownPct: 0,
      portfolioSharpe: 0,
    };
  }
  return {
    portfolioWeightedReturnPct: round(average(summaries.map((item) => Number(item.weightedCostAdjustedReturnPct ?? item.weightedReturnPct) || 0))),
    portfolioCagrPct: round(average(summaries.map((item) => Number(item.cagrPct) || 0))),
    portfolioMaxDrawdownPct: round(average(summaries.map((item) => Math.abs(Number(item.maxDrawdownPct) || 0)))),
    portfolioSharpe: round(average(summaries.map((item) => Number(item.sharpeRatio) || 0))),
  };
}

export function buildExperimentPerformanceSnapshot(args: {
  snapshot: InvestmentIntelligenceSnapshot | null;
  replayRuns?: HistoricalReplayRun[];
}): ExperimentPerformanceSnapshot {
  const reality = readRealityMetrics(args.replayRuns || []);
  const portfolio = readPortfolioMetrics(args.replayRuns || []);
  const abstains = args.snapshot?.autonomy?.abstainCount || 0;
  const directMappings = args.snapshot?.directMappings?.length || 0;
  const hiddenCandidateCount = args.snapshot?.hiddenCandidates?.length || 0;
  return {
    generatedAt: nowIso(),
    rawHitRate24h: reality.rawHitRate24h,
    costAdjustedHitRate24h: reality.costAdjustedHitRate24h,
    rawAvgReturn24h: reality.rawAvgReturn24h,
    costAdjustedAvgReturn24h: reality.costAdjustedAvgReturn24h,
    portfolioWeightedReturnPct: portfolio.portfolioWeightedReturnPct,
    portfolioCagrPct: portfolio.portfolioCagrPct,
    portfolioMaxDrawdownPct: portfolio.portfolioMaxDrawdownPct,
    portfolioSharpe: portfolio.portfolioSharpe,
    avgExecutionPenaltyPct: reality.avgExecutionPenaltyPct,
    recentShadowHitRate: Number(args.snapshot?.autonomy?.recentHitRate) || 0,
    recentShadowAvgReturnPct: Number(args.snapshot?.autonomy?.recentAvgReturnPct) || 0,
    recentDrawdownPct: Number(args.snapshot?.autonomy?.recentDrawdownPct) || 0,
    abstainRate: directMappings > 0 ? round((abstains / directMappings) * 100) : 0,
    realityBlockedRate: directMappings > 0 ? round(((args.snapshot?.autonomy?.realityBlockedCount || 0) / directMappings) * 100) : 0,
    hiddenCandidateCount,
  };
}

function scorePerformance(perf: ExperimentPerformanceSnapshot): number {
  return clamp(round(
    perf.costAdjustedHitRate24h * 0.36
    + perf.recentShadowHitRate * 0.22
    + Math.max(-5, Math.min(5, perf.costAdjustedAvgReturn24h)) * 3.2
    + Math.max(-5, Math.min(5, perf.portfolioWeightedReturnPct)) * 2.8
    + Math.max(-6, Math.min(6, perf.portfolioCagrPct)) * 1.8
    + Math.max(-2, Math.min(3, perf.portfolioSharpe)) * 4.2
    + Math.max(-4, Math.min(4, perf.recentShadowAvgReturnPct)) * 2.4
    - perf.avgExecutionPenaltyPct * 1.9
    - perf.portfolioMaxDrawdownPct * 0.45
    - perf.recentDrawdownPct * 1.7
    - perf.abstainRate * 0.12
    - perf.realityBlockedRate * 0.1
    + Math.min(8, perf.hiddenCandidateCount * 0.8),
  ), 0, 100);
}

function evolveProfile(profile: SelfTuningWeightProfile, perf: ExperimentPerformanceSnapshot): { profile: SelfTuningWeightProfile; reason: string } {
  const next = { ...profile };
  const reasons: string[] = [];
  const realityGap = perf.rawHitRate24h - perf.costAdjustedHitRate24h;
  if (realityGap >= 6 || perf.avgExecutionPenaltyPct >= 1.1) {
    next.realityPenaltyMultiplier = clamp(next.realityPenaltyMultiplier + 0.08, 0.7, 1.8);
    reasons.push('execution reality penalty tightened');
  }
  if (perf.recentShadowHitRate < 48 || perf.recentShadowAvgReturnPct < 0 || perf.recentDrawdownPct > 4.5) {
    next.corroborationWeightMultiplier = clamp(next.corroborationWeightMultiplier + 0.05, 0.7, 1.5);
    next.contradictionPenaltyMultiplier = clamp(next.contradictionPenaltyMultiplier + 0.06, 0.7, 1.6);
    next.recencyPenaltyMultiplier = clamp(next.recencyPenaltyMultiplier + 0.05, 0.7, 1.6);
    next.riskOffExposureMultiplier = clamp(next.riskOffExposureMultiplier + 0.08, 0.6, 1.6);
    next.riskOnAggressionMultiplier = clamp(next.riskOnAggressionMultiplier - 0.06, 0.6, 1.5);
    next.regimeRiskOffMultiplier = clamp(next.regimeRiskOffMultiplier + 0.05, 0.7, 1.5);
    reasons.push('shadow underperformance pushed the profile more defensive');
  }
  if (perf.costAdjustedHitRate24h > 56 && perf.recentShadowHitRate > 54 && perf.abstainRate > 28) {
    next.riskOnAggressionMultiplier = clamp(next.riskOnAggressionMultiplier + 0.04, 0.6, 1.5);
    next.recencyPenaltyMultiplier = clamp(next.recencyPenaltyMultiplier - 0.03, 0.7, 1.6);
    reasons.push('recent evidence improved, allowing slightly more aggression');
  }
  if (perf.hiddenCandidateCount >= 3 && perf.costAdjustedHitRate24h >= 52) {
    next.graphPropagationWeightMultiplier = clamp(next.graphPropagationWeightMultiplier + 0.04, 0.6, 1.6);
    reasons.push('graph propagation received a modest boost');
  }
  if (perf.portfolioWeightedReturnPct < 0 || perf.portfolioCagrPct < 0 || perf.portfolioMaxDrawdownPct > 8) {
    next.riskOffExposureMultiplier = clamp(next.riskOffExposureMultiplier + 0.06, 0.6, 1.6);
    next.riskOnAggressionMultiplier = clamp(next.riskOnAggressionMultiplier - 0.05, 0.6, 1.5);
    reasons.push('portfolio accounting weakened, nudging the profile more defensive');
  }
  if (perf.costAdjustedAvgReturn24h < 0 && perf.rawAvgReturn24h > 0) {
    next.realityPenaltyMultiplier = clamp(next.realityPenaltyMultiplier + 0.05, 0.7, 1.8);
    reasons.push('cost-adjusted returns lagged raw replay, strengthening execution realism');
  }
  if (perf.rawAvgReturn24h < 0 && perf.costAdjustedAvgReturn24h < 0) {
    next.regimeInflationMultiplier = clamp(next.regimeInflationMultiplier + 0.03, 0.7, 1.5);
    reasons.push('macro sensitivity increased after broad replay weakness');
  }
  return {
    profile: normalizeWeightProfile(next),
    reason: reasons.join('; ') || 'performance stayed inside neutral bounds',
  };
}

export function runSelfTuningCycle(args: {
  snapshot: InvestmentIntelligenceSnapshot | null;
  replayRuns?: HistoricalReplayRun[];
}): ExperimentRegistrySnapshot {
  const performance = buildExperimentPerformanceSnapshot(args);
  const currentScore = scorePerformance(performance);
  const evolved = evolveProfile(currentRegistry.activeProfile, performance);
  const priorHistory = currentRegistry.history.slice(-6);
  const trailingAverage = priorHistory.length
    ? average(priorHistory.map((entry) => entry.score))
    : currentRegistry.lastScore;

  let action: ExperimentRegistryEntry['action'] = 'observe';
  let nextProfile = currentRegistry.activeProfile;
  let reason = evolved.reason;
  let rollbackArmed = false;

  if (currentScore < trailingAverage - 8 && priorHistory.length >= 2) {
    const rollbackTarget = [...priorHistory]
      .filter((entry) => entry.action === 'promote' || entry.action === 'observe')
      .sort((a, b) => b.score - a.score)[0];
    if (rollbackTarget) {
      nextProfile = rollbackTarget.profile;
      action = 'rollback';
      rollbackArmed = true;
      reason = `Score ${currentScore.toFixed(1)} fell below trailing average ${trailingAverage.toFixed(1)}; rolling back to a stronger prior profile.`;
    }
  } else {
    const scoreDelta = currentScore - currentRegistry.lastScore;
    const materiallyChanged = JSON.stringify(evolved.profile) !== JSON.stringify(currentRegistry.activeProfile);
    if (materiallyChanged && scoreDelta >= -2) {
      nextProfile = evolved.profile;
      action = 'promote';
      reason = evolved.reason;
    }
  }

  currentRegistry = {
    activeProfile: normalizeWeightProfile(nextProfile),
    lastScore: currentScore,
    rollbackArmed,
    activeReason: reason,
    history: [
      ...currentRegistry.history,
      {
        id: `${action}:${nowIso()}`,
        recordedAt: nowIso(),
        score: currentScore,
        action,
        reason,
        profile: normalizeWeightProfile(nextProfile),
        performance,
      },
    ].slice(-64),
  };

  return getExperimentRegistrySnapshot();
}

export function summarizeWeightProfile(profile: SelfTuningWeightProfile): string[] {
  return [
    `corroboration x${profile.corroborationWeightMultiplier.toFixed(2)}`,
    `contradiction x${profile.contradictionPenaltyMultiplier.toFixed(2)}`,
    `recency x${profile.recencyPenaltyMultiplier.toFixed(2)}`,
    `reality x${profile.realityPenaltyMultiplier.toFixed(2)}`,
    `graph x${profile.graphPropagationWeightMultiplier.toFixed(2)}`,
    `risk-off x${profile.riskOffExposureMultiplier.toFixed(2)}`,
  ];
}
