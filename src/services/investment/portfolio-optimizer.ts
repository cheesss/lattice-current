// ── Re-exports from sub-modules (canonical extraction targets) ──
// Consumers can now import from:
//   ./portfolio-execution/allocation        — buildDeployClusterPlan, allocateDeployBudget, zipfRankShares
//   ./portfolio-execution/execution-controls — applyPortfolioExecutionControls, deployFloorPctForCard
//   ./portfolio-execution/sizing            — buildThemeExposureCaps, inferDynamicMaxPositionWeight

import type { InvestmentIdeaCard, InvestmentIdeaSymbol, InvestmentAssetKind } from './types';
import type { MacroRiskOverlay } from '../macro-risk-overlay';
import type { AutonomyAction } from '../autonomy-constraints';
import {
  clamp,
  average,
  weightedAverage,
  pearsonCorrelation,
  normalizeMatchable,
  percentile,
  median,
} from './utils';
import { denoiseCorrelationMatrix } from '../math-models/rmt-correlation';
import { optimizeTargetWeights } from '../execution-mpc';
import {
  buildRecentReturnSeries,
  estimateMacroStressProbability,
  summarizeInstrumentMix,
  buildCoreOrbitalExecutionPlan,
} from './shared-ranking';
import {
  getReplayAdaptationSnapshotSync,
  getReplayThemeProfileFromSnapshot,
  getCurrentThemePerformanceFromSnapshot,
} from '../replay-adaptation';
import { estimateTransferEntropy } from '../math-models/transfer-entropy';
import { getThemeRule, resolveThemePolicy } from './theme-registry';

// ── Externalized configuration ──

export interface PortfolioOptimizerConfig {
  regime: {
    riskOff: { maxClusters: number; budgetPct: number; grossCapPct: number };
    balanced: { maxClusters: number; budgetPct: number; grossCapPct: number };
    riskOn: { maxClusters: number; budgetPct: number; grossCapPct: number };
    budgetBaseHigh: number;
  };
  thresholds: {
    readinessBaseline: number;
    defaultSampleSize: number;
    hitRateNeutral: number;
    defensiveTrigger: number;
    percentileCap: number;
  };
  weights: {
    familyShare: number;
    hedgeRole: number;
    direction: number;
    utilityShrinkageBase: number;
    sampleReliabilityWeight: number;
    robustGapPenalty: number;
    hitPenaltyWeight: number;
    flipRateWeight: number;
    regimeDispersionWeight: number;
    watchDirection: number;
  };
  penalties: {
    downsideMagnitude: number;
    volatilityLossWeight: number;
    driftLossMultiplier: number;
    replayGapLoss: number;
    concentrationBoost: number;
    negativeDriftPenalty: number;
    clusterFloor: number;
    stressMultiplierHigh: number;
  };
}

let _cfg: PortfolioOptimizerConfig = {
  regime: {
    riskOff: { maxClusters: 6, budgetPct: 40, grossCapPct: 50 },
    balanced: { maxClusters: 8, budgetPct: 65, grossCapPct: 75 },
    riskOn: { maxClusters: 10, budgetPct: 85, grossCapPct: 90 },
    budgetBaseHigh: 90,
  },
  thresholds: {
    readinessBaseline: 45,
    defaultSampleSize: 48,
    hitRateNeutral: 50,
    defensiveTrigger: 55,
    percentileCap: 100,
  },
  weights: {
    familyShare: 0.5,
    hedgeRole: 0.3,
    direction: 0.2,
    utilityShrinkageBase: 0.35,
    sampleReliabilityWeight: 0.65,
    robustGapPenalty: 0.7,
    hitPenaltyWeight: 0.62,
    flipRateWeight: 0.95,
    regimeDispersionWeight: 0.72,
    watchDirection: 0.55,
  },
  penalties: {
    downsideMagnitude: 0.26,
    volatilityLossWeight: 0.42,
    driftLossMultiplier: 0.78,
    replayGapLoss: 1.05,
    concentrationBoost: 1.35,
    negativeDriftPenalty: 1.45,
    clusterFloor: 0.82,
    stressMultiplierHigh: 0.76,
  },
};

export function setPortfolioOptimizerConfig(config: Partial<PortfolioOptimizerConfig> | any): void {
  if (config.regime) {
    _cfg.regime = {
      ..._cfg.regime,
      riskOff: { ..._cfg.regime.riskOff, ...config.regime.riskOff },
      balanced: { ..._cfg.regime.balanced, ...config.regime.balanced },
      riskOn: { ..._cfg.regime.riskOn, ...config.regime.riskOn },
      budgetBaseHigh: config.regime.budgetBaseHigh ?? _cfg.regime.budgetBaseHigh,
    };
  }
  if (config.thresholds) {
    _cfg.thresholds = { ..._cfg.thresholds, ...config.thresholds };
  }
  if (config.weights) {
    _cfg.weights = { ..._cfg.weights, ...config.weights };
  }
  if (config.penalties) {
    _cfg.penalties = { ..._cfg.penalties, ...config.penalties };
  }
}

export interface ThemeStabilityAdjustment {
  scoreDelta: number;
  exposureMultiplier: number;
  stabilityScore: number;
  lcbUtility: number;
  regimeDispersion: number;
  negativeRegimeShare: number;
  sampleReliability: number;
  instabilityPenalty: number;
}

interface DeployClusterCardRow {
  card: InvestmentIdeaCard;
  score: number;
  floor: number;
  family: string;
  label: string;
  clusterId: string;
  clusterLabel: string;
  defensiveScore: number;
  stressLeadSupport: number;
  onlineBoost: number;
  currentReturnPct: number;
  replayReturnPct: number;
  currentHitRate: number;
  drift: number;
  averageAbsVol: number;
  coreShare: number;
  coreCount: number;
  orbitalCount: number;
  representativeSymbols: string[];
}

interface DeployClusterRow {
  id: string;
  label: string;
  family: string;
  share: number;
  cap: number;
  topK: number;
  score: number;
  riskScore: number;
  defensiveScore: number;
  coreShare: number;
  orbitalCount: number;
  currentReturnPct: number;
  replayReturnPct: number;
  icDrift: number;
  multiplier: number;
  regretPenalty: number;
  gateState: 'open' | 'shrunk' | 'gated';
  memberIds: string[];
}

interface DeployClusterPlan {
  rows: DeployClusterCardRow[];
  clusters: DeployClusterRow[];
  clusterByCardId: Map<string, string>;
  clusterCaps: Record<string, number>;
}

let trackedIdeas: any[] = [];

function normalizeWeights(values: number[]): number[] {
  const clean = values.map((value) => (Number.isFinite(value) && value > 0 ? value : 0));
  const total = clean.reduce((acc, value) => acc + value, 0);
  if (!(total > 0)) {
    return clean.map(() => (clean.length > 0 ? 1 / clean.length : 0));
  }
  return clean.map((value) => value / total);
}

function temperatureSoftmax(values: number[], temperature = 1): number[] {
  if (!values.length) return [];
  const boundedTemperature = clamp(temperature, 0.08, 5);
  const maxValue = Math.max(...values);
  const exps = values.map((value) => Math.exp((value - maxValue) / boundedTemperature));
  const total = exps.reduce((acc, value) => acc + value, 0);
  if (!(total > 0)) {
    return values.map(() => 1 / values.length);
  }
  return exps.map((value) => value / total);
}

function weightedStdDev(values: number[], weights: number[]): number {
  const sampleSize = Math.min(values.length, weights.length);
  if (sampleSize <= 1) return 0;
  const mean = weightedAverage(values, weights);
  let weightedVariance = 0;
  let totalWeight = 0;
  for (let index = 0; index < sampleSize; index += 1) {
    const value = Number(values[index] ?? 0);
    const weight = Math.max(0, Number(weights[index] ?? 0));
    if (!Number.isFinite(value) || !(weight > 0)) continue;
    weightedVariance += weight * Math.pow(value - mean, 2);
    totalWeight += weight;
  }
  if (!(totalWeight > 0)) return 0;
  return Math.sqrt(weightedVariance / totalWeight);
}

// isCoreInstrumentSymbol – imported from ./shared-ranking

function estimateAverageAbsoluteVolatility(series: number[]): number {
  if (!series.length) return 0;
  return average(series.map((value) => Math.abs(value)));
}

function buildCardCompositeReturnSeries(card: InvestmentIdeaCard, maxPoints = _cfg.thresholds.defaultSampleSize): number[] {
  const symbols = cardPrimarySymbols(card);
  if (!symbols.length) return [];
  const series = symbols
    .map((symbol) => buildRecentReturnSeries(symbol, maxPoints))
    .filter((row) => row.length > 0);
  if (!series.length) return [];
  const sampleSize = Math.min(...series.map((row) => row.length));
  if (!Number.isFinite(sampleSize) || sampleSize <= 0) return [];
  const trimmed = series.map((row) => row.slice(-sampleSize));
  return Array.from({ length: sampleSize }, (_, index) =>
    Number(average(trimmed.map((row) => row[index] ?? 0)).toFixed(6)),
  );
}

function estimateCardVolatilityPct(card: InvestmentIdeaCard, maxPoints = _cfg.thresholds.defaultSampleSize): number {
  const series = buildCardCompositeReturnSeries(card, maxPoints);
  if (series.length < 8) return 1.6;
  return clamp(weightedStdDev(series, Array(series.length).fill(1)), 0.35, 6);
}

function computeFractionalKellyMultiplier(card: InvestmentIdeaCard, macroOverlay: MacroRiskOverlay): number {
  const expectedEdgePct = Number(card.metaExpectedReturnPct ?? card.backtestAvgReturnPct ?? 0) || 0;
  const hitProbability = clamp(Number(card.metaHitProbability ?? card.confirmationScore ?? 50) / 100, 0.01, 0.99);
  const volatilityPct = estimateCardVolatilityPct(card);
  const rewardEdgePct = Math.max(0, expectedEdgePct) + Math.max(0, hitProbability - 0.5) * 1.2;
  const rawKelly = rewardEdgePct / Math.max(volatilityPct * volatilityPct, 0.25);
  const regimeScale = macroOverlay.killSwitch
    ? 0.18
    : macroOverlay.state === 'risk-off'
      ? 0.28
      : macroOverlay.state === 'balanced'
        ? 0.38
        : 0.5;
  return clamp(rawKelly * regimeScale, 0.22, 1.2);
}

function buildHrpfClusterCaps(
  cards: InvestmentIdeaCard[],
  macroOverlay: MacroRiskOverlay,
  grossBudgetPct: number,
  fallbackCaps: Record<string, number>,
  clusterByCardId: Map<string, string>,
): Record<string, number> {
  const deployCards = cards.filter((card) => card.autonomyAction === 'deploy' && card.executionGate);
  if (deployCards.length <= 1) return fallbackCaps;
  const grossBudget = grossBudgetPct / 100;
  const stressBias = macroOverlay.state === 'risk-off' ? 1.06 : macroOverlay.state === 'balanced' ? 1.02 : 1;
  const clusterIds = Array.from(new Set(deployCards.map((card) => clusterByCardId.get(card.id) || 'unassigned')));
  if (clusterIds.length <= 1) return fallbackCaps;
  const seriesByCluster = new Map<string, number[]>();
  const scoreByCluster = new Map<string, number>();
  for (const clusterId of clusterIds) {
    const clusterCards = deployCards.filter((card) => (clusterByCardId.get(card.id) || 'unassigned') === clusterId);
    const clusterSeries = clusterCards
      .map((card) => buildCardCompositeReturnSeries(card))
      .filter((series) => series.length >= 8);
    if (!clusterSeries.length) continue;
    const sampleSize = Math.min(...clusterSeries.map((series) => series.length));
    if (!(sampleSize >= 8)) continue;
    const trimmed = clusterSeries.map((series) => series.slice(-sampleSize));
    seriesByCluster.set(
      clusterId,
      Array.from({ length: sampleSize }, (_, index) => Number(average(trimmed.map((series) => series[index] ?? 0)).toFixed(6))),
    );
    scoreByCluster.set(
      clusterId,
      average(clusterCards.map((card) =>
        Math.max(0.05, Number(card.metaExpectedReturnPct ?? 0) + (Number(card.metaHitProbability ?? 50) - 50) * 0.03 + card.confirmationScore * 0.02),
      )),
    );
  }
  const usableClusterIds = clusterIds.filter((clusterId) => seriesByCluster.has(clusterId));
  if (usableClusterIds.length <= 1) return fallbackCaps;
  const minSampleSize = Math.min(...usableClusterIds.map((clusterId) => (seriesByCluster.get(clusterId) ?? []).length));
  const alignedSeries = usableClusterIds.map((clusterId) => (seriesByCluster.get(clusterId) ?? []).slice(-minSampleSize));
  const correlationMatrix = alignedSeries.map((leftSeries) =>
    alignedSeries.map((rightSeries, index) => {
      if (leftSeries === rightSeries) return 1;
      const corr = pearsonCorrelation(leftSeries, rightSeries);
      return Number.isFinite(corr) ? corr : (index === 0 ? 1 : 0);
    }),
  );
  const denoised = denoiseCorrelationMatrix(correlationMatrix);
  const inverseVolScores = usableClusterIds.map((clusterId, index) => {
    const variance = Math.max(0.08, denoised.denoisedMatrix[index]?.[index] ?? 1);
    const volatilityPenalty = 1 / Math.sqrt(variance);
    const edgeScore = Math.max(0.2, Number(scoreByCluster.get(clusterId) || 0));
    return volatilityPenalty * edgeScore * stressBias;
  });
  const normalizedScores = normalizeWeights(inverseVolScores);
  const hrpCaps = Object.fromEntries(
    usableClusterIds.map((clusterId, index) => {
      const fallbackCap = fallbackCaps[clusterId] ?? grossBudget / Math.max(1, usableClusterIds.length);
      const blendedCap = clamp(
        grossBudget * normalizedScores[index]! * 0.78 + fallbackCap * 0.22,
        Math.min(fallbackCap * 0.55, grossBudget * 0.08),
        Math.max(fallbackCap * 1.15, grossBudget * 0.55),
      );
      return [clusterId, Number(blendedCap.toFixed(6))];
    }),
  );
  for (const clusterId of clusterIds) {
    if (!(clusterId in hrpCaps)) {
      hrpCaps[clusterId] = fallbackCaps[clusterId] ?? Number((grossBudget / Math.max(1, clusterIds.length)).toFixed(6));
    }
  }
  return hrpCaps;
}

function cardPrimarySymbols(card: InvestmentIdeaCard): string[] {
  const ranked = card.symbols
    .filter((symbol: InvestmentIdeaSymbol) => symbol.role !== 'hedge')
    .map((symbol: InvestmentIdeaSymbol) => String(symbol.symbol || '').trim())
    .filter(Boolean);
  const fallback = card.symbols
    .map((symbol: InvestmentIdeaSymbol) => String(symbol.symbol || '').trim())
    .filter(Boolean);
  return Array.from(new Set((ranked.length ? ranked : fallback).slice(0, 3)));
}

function normalizeSectorFamily(sector: string, assetKind?: InvestmentAssetKind | null): string {
  const normalizedSector = normalizeMatchable(sector || '');
  if (!normalizedSector) {
    if (assetKind === 'rate' || assetKind === 'fx') return 'defensive-macro';
    if (assetKind === 'commodity') return 'commodities';
    if (assetKind === 'crypto') return 'crypto';
    return assetKind || 'general';
  }
  if (/(gold|treasury|rates|volatility|fx|dollar|utilities)/.test(normalizedSector)) return 'defensive-macro';
  if (/(semiconductor|cybersecurity|network infrastructure|software|technology|compute)/.test(normalizedSector)) return 'technology';
  if (/(defense|surveillance|aerospace|drone|munitions)/.test(normalizedSector)) return 'defense';
  if (/(energy|shipping|airlines|transport|oil|gas)/.test(normalizedSector)) return 'energy-transport';
  if (/(fertilizer|agriculture|potash|phosphates|grain)/.test(normalizedSector)) return 'agri-inputs';
  if (/(rates|bond)/.test(normalizedSector)) return 'rates';
  return normalizedSector.replace(/\s+/g, '-');
}

function intersectionCount(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  return left.reduce((count, item) => count + (rightSet.has(item) ? 1 : 0), 0);
}

function estimateDefensiveScore(card: InvestmentIdeaCard): number {
  const families = Array.from(new Set([
    ...card.symbols.map((symbol: InvestmentIdeaSymbol) => normalizeSectorFamily(symbol.sector || '', symbol.assetKind || null)),
    ...card.sectorExposure.map((sector: string) => normalizeSectorFamily(sector || '')),
  ].filter(Boolean)));
  const defensiveFamilyShare = families.filter((family: string) => family === 'defensive-macro').length / Math.max(1, families.length);
  const hedgeRoleShare = card.symbols.filter((symbol: InvestmentIdeaSymbol) => symbol.role === 'hedge' || symbol.direction === 'hedge').length / Math.max(1, card.symbols.length);
  const defensiveDirection = card.direction === 'hedge' ? 1 : card.direction === 'watch' ? _cfg.weights.watchDirection : 0;
  return clamp(
    Number((defensiveFamilyShare * _cfg.weights.familyShare + hedgeRoleShare * _cfg.weights.hedgeRole + defensiveDirection * _cfg.weights.direction).toFixed(4)),
    0,
    1,
  );
}

function buildStressProxySeries(macroOverlay: MacroRiskOverlay, maxPoints = _cfg.thresholds.defaultSampleSize): number[] {
  const proxySymbols = Array.from(new Set([
    '^VIX',
    ...macroOverlay.hedgeBias.map((item) => item.symbol),
  ].filter(Boolean)));
  const series = proxySymbols
    .map((symbol) => buildRecentReturnSeries(symbol, maxPoints))
    .filter((row) => row.length >= 8);
  if (!series.length) return [];
  const sampleSize = Math.min(...series.map((row) => row.length));
  if (!Number.isFinite(sampleSize) || sampleSize < 8) return [];
  const trimmed = series.map((row) => row.slice(-sampleSize));
  return Array.from({ length: sampleSize }, (_, index) =>
    Number(average(trimmed.map((row) => row[index] ?? 0)).toFixed(6)),
  );
}

function estimateStressLeadSupport(
  card: InvestmentIdeaCard,
  macroOverlay: MacroRiskOverlay,
): number {
  const stressSeries = buildStressProxySeries(macroOverlay);
  const targetSeries = buildCardCompositeReturnSeries(card);
  const sampleSize = Math.min(stressSeries.length, targetSeries.length);
  if (!Number.isFinite(sampleSize) || sampleSize < 8) return 0;
  const te = estimateTransferEntropy(
    stressSeries.slice(-sampleSize),
    targetSeries.slice(-sampleSize),
  );
  return te.normalized;
}

export function computeThemeStabilityAdjustment(themeId: string): ThemeStabilityAdjustment {
  const replayAdaptation = getReplayAdaptationSnapshotSync();
  const replayProfile = getReplayThemeProfileFromSnapshot(replayAdaptation, themeId);
  const currentPerformance = getCurrentThemePerformanceFromSnapshot(replayAdaptation, themeId);
  if (!replayProfile) {
    return {
      scoreDelta: 0,
      exposureMultiplier: 1,
      stabilityScore: _cfg.thresholds.hitRateNeutral,
      lcbUtility: 0,
      regimeDispersion: 0,
      negativeRegimeShare: 0,
      sampleReliability: 0,
      instabilityPenalty: 0,
    };
  }

  const regimeMetrics = replayProfile.regimeMetrics || [];
  const regimeReturns = regimeMetrics.map((metric) => Number(metric.costAdjustedAvgReturnPct) || 0);
  const regimeWeights = regimeMetrics.map((metric) => Math.max(1, Number(metric.sampleSize) || 0));
  const weightedSamples = Math.max(
    0,
    Number(replayProfile.weightedSampleSize) || regimeWeights.reduce((sum, value) => sum + value, 0),
  );
  const sampleReliability = 1 - Math.exp(-weightedSamples / 22);
  const negativeDrift = clamp(Math.abs(Math.min(0, Number(replayProfile.currentVsReplayDrift) || 0)) / 2.4, 0, 2.4);
  const replayUtility = Number(replayProfile.coverageAdjustedUtility ?? replayProfile.utilityScore ?? 0) || 0;
  const robustUtility = Number(
    replayProfile.robustUtility
    ?? replayUtility
    ?? 0,
  ) || replayUtility;
  const windowDispersion = Math.max(0, Number(replayProfile.windowUtilityStd) || 0);
  const windowFlipRate = clamp(Number(replayProfile.windowFlipRate) || 0, 0, 1);
  const currentHitRate = Number(currentPerformance?.hitRate ?? replayProfile.hitRate ?? _cfg.thresholds.hitRateNeutral) || _cfg.thresholds.hitRateNeutral;
  const hitPenalty = clamp((_cfg.thresholds.hitRateNeutral - currentHitRate) / 18, 0, 1.6);
  const meanRegimeReturn = regimeReturns.length ? weightedAverage(regimeReturns, regimeWeights) : 0;
  const regimeDispersion = regimeReturns.length >= 2 ? weightedStdDev(regimeReturns, regimeWeights) : 0;
  const negativeRegimeShare = regimeReturns.length
    ? weightedAverage(
      regimeReturns.map((value) => (value < 0 ? 1 : 0)),
      regimeWeights,
    )
    : (meanRegimeReturn < 0 ? 1 : 0);
  const downsideMagnitude = regimeReturns.length
    ? weightedAverage(
      regimeReturns.map((value) => Math.max(0, -value)),
      regimeWeights,
    )
    : Math.max(0, -(Number(replayProfile.coverageAdjustedUtility) || 0));
  const signAgreement = regimeReturns.length
    ? Math.abs(weightedAverage(regimeReturns.map((value) => Math.sign(value)), regimeWeights))
    : 1;
  const shrunkenUtility = replayUtility * (_cfg.weights.utilityShrinkageBase + sampleReliability * _cfg.weights.sampleReliabilityWeight);
  const robustGapPenalty = Math.max(0, replayUtility * 0.18 - robustUtility);
  const lcbUtility = Number((
    shrunkenUtility
    - robustGapPenalty * _cfg.weights.robustGapPenalty
    - regimeDispersion * (_cfg.weights.regimeDispersionWeight + negativeRegimeShare * 0.44)
    - windowDispersion * 0.08
    - downsideMagnitude * _cfg.penalties.downsideMagnitude
    - negativeDrift * _cfg.penalties.negativeDriftPenalty
    - windowFlipRate * _cfg.weights.flipRateWeight
    - (1 - signAgreement) * _cfg.penalties.concentrationBoost
    - hitPenalty * _cfg.weights.hitPenaltyWeight
  ).toFixed(3));
  const stabilityScore = clamp(
    Number((
      _cfg.thresholds.readinessBaseline
      + sampleReliability * 22
      + signAgreement * 18
      + Math.max(0, lcbUtility) * 3.5
      + Math.max(0, meanRegimeReturn) * 1.6
      - regimeDispersion * 11
      - windowDispersion * 0.3
      - windowFlipRate * 7
      - negativeRegimeShare * 22
      - downsideMagnitude * 1.2
      - negativeDrift * 9
    ).toFixed(2)),
    0,
    _cfg.thresholds.percentileCap,
  );
  const exposureMultiplier = clamp(
    Number((
      0.34
      + sampleReliability * 0.36
      + signAgreement * 0.22
      + clamp(lcbUtility / 7, -0.26, 0.28)
      - Math.min(0.08, windowDispersion * 0.004)
      - windowFlipRate * 0.03
      - negativeRegimeShare * 0.18
      - negativeDrift * 0.09
    ).toFixed(4)),
    0.12,
    1.18,
  );
  const instabilityPenalty = Number(clamp(
    regimeDispersion * _cfg.penalties.clusterFloor
    + windowDispersion * 0.04
    + windowFlipRate * _cfg.weights.robustGapPenalty
    + negativeRegimeShare * 2.8
    + downsideMagnitude * 0.24
    + negativeDrift * 0.65
    + (1 - sampleReliability) * 0.9,
    0,
    8,
  ).toFixed(3));
  const scoreDelta = Number((lcbUtility * 2.1 + (stabilityScore - 50) * 0.16).toFixed(3));
  return {
    scoreDelta,
    exposureMultiplier,
    stabilityScore,
    lcbUtility,
    regimeDispersion: Number(regimeDispersion.toFixed(4)),
    negativeRegimeShare: Number(negativeRegimeShare.toFixed(4)),
    sampleReliability: Number(sampleReliability.toFixed(4)),
    instabilityPenalty,
  };
}

export function computeOnlineRankingAdjustment(
  card: InvestmentIdeaCard,
  macroOverlay: MacroRiskOverlay,
): {
  scoreDelta: number;
  survivalBoost: number;
  stressLeadSupport: number;
  defensiveScore: number;
  currentReturnPct: number;
  replayReturnPct: number;
  currentHitRate: number;
  drift: number;
  stabilityScore: number;
  stabilityMultiplier: number;
  lcbUtility: number;
  instabilityPenalty: number;
} {
  const replayAdaptation = getReplayAdaptationSnapshotSync();
  const replayProfile = getReplayThemeProfileFromSnapshot(replayAdaptation, card.themeId);
  const currentPerformance = getCurrentThemePerformanceFromSnapshot(replayAdaptation, card.themeId);
  const stability = computeThemeStabilityAdjustment(card.themeId);
  const defensiveScore = estimateDefensiveScore(card);
  const stressLevel = macroOverlay.killSwitch
    ? 1
    : macroOverlay.state === 'risk-off'
      ? 0.84
      : macroOverlay.state === 'balanced'
        ? 0.42
        : 0.12;
  const stressLeadSupport = estimateStressLeadSupport(card, macroOverlay);
  const currentReturnPct = Number(currentPerformance?.avgReturnPct ?? card.liveReturnPct ?? card.backtestAvgReturnPct ?? 0) || 0;
  const currentHitRate = Number(currentPerformance?.hitRate ?? card.backtestHitRate ?? _cfg.thresholds.hitRateNeutral) || _cfg.thresholds.hitRateNeutral;
  const replayReturnPct = Number(replayProfile?.coverageAdjustedUtility ?? replayProfile?.costAdjustedAvgReturnPct ?? card.backtestAvgReturnPct ?? 0) || 0;
  const drift = Number(replayProfile?.currentVsReplayDrift ?? (currentReturnPct - replayReturnPct)) || 0;
  const replayReliability = clamp((replayProfile?.confirmationReliability ?? card.confirmationScore ?? _cfg.thresholds.hitRateNeutral) / 100, 0, 1);
  const positiveCurrent = clamp(currentReturnPct / 3.5, 0, 1.8);
  const negativeCurrent = clamp(Math.abs(Math.min(0, currentReturnPct)) / 3.5, 0, 1.8);
  const hitBonus = clamp((currentHitRate - _cfg.thresholds.hitRateNeutral) / 18, 0, 1.4);
  const hitPenalty = clamp((_cfg.thresholds.hitRateNeutral - currentHitRate) / 16, 0, 1.6);
  const driftPenalty = clamp(Math.abs(Math.min(0, drift)) / 1.3, 0, 2.6);
  const driftBonus = clamp(Math.max(0, drift) / 2.5, 0, 1.2);
  const survivalBoost = defensiveScore * stressLevel * (
    8
    + stressLeadSupport * 14
    + hitBonus * 5
    + replayReliability * 6
    + driftBonus * 3
    + Math.max(0, stability.exposureMultiplier - _cfg.weights.robustGapPenalty) * 11
  );
  const offensivePenalty = (1 - defensiveScore) * stressLevel * (
    negativeCurrent * 9
    + hitPenalty * 7
    + driftPenalty * 6
    + stressLeadSupport * 4
    + stability.instabilityPenalty * 1.6
  );
  const baselineReward =
    positiveCurrent * 4.5
    + hitBonus * 2.2
    + replayReliability * 2
    + Math.max(0, stability.lcbUtility) * 0.85
    + Math.max(0, stability.stabilityScore - _cfg.thresholds.defensiveTrigger) * 0.06;
  const scoreDelta = Number((survivalBoost + baselineReward - offensivePenalty + stability.scoreDelta).toFixed(3));
  return {
    scoreDelta,
    survivalBoost: Number(survivalBoost.toFixed(3)),
    stressLeadSupport: Number(stressLeadSupport.toFixed(4)),
    defensiveScore: Number(defensiveScore.toFixed(4)),
    currentReturnPct: Number(currentReturnPct.toFixed(2)),
    replayReturnPct: Number(replayReturnPct.toFixed(2)),
    currentHitRate: Number(currentHitRate.toFixed(2)),
    drift: Number(drift.toFixed(2)),
    stabilityScore: Number(stability.stabilityScore.toFixed(2)),
    stabilityMultiplier: Number(stability.exposureMultiplier.toFixed(4)),
    lcbUtility: Number(stability.lcbUtility.toFixed(3)),
    instabilityPenalty: Number(stability.instabilityPenalty.toFixed(3)),
  };
}

export function estimateClusterRankingCorrelation(
  signal: number[],
  outcome: number[],
): number {
  const sampleSize = Math.min(signal.length, outcome.length);
  if (!Number.isFinite(sampleSize) || sampleSize < 3) return 0;
  const trimmedSignal = signal.slice(-sampleSize);
  const trimmedOutcome = outcome.slice(-sampleSize);
  const signalSpread = Math.max(...trimmedSignal) - Math.min(...trimmedSignal);
  const outcomeSpread = Math.max(...trimmedOutcome) - Math.min(...trimmedOutcome);
  if (!(signalSpread > 1e-6) || !(outcomeSpread > 1e-6)) return 0;
  const corr = pearsonCorrelation(trimmedSignal, trimmedOutcome);
  return Number.isFinite(corr) ? corr : 0;
}

function capitalReadinessScore(card: InvestmentIdeaCard): number {
  return clamp(
    card.confirmationScore * 0.3
    + card.realityScore * 0.14
    + card.graphSignalScore * 0.11
    + (100 - card.coveragePenalty) * 0.16
    + clamp(card.calibratedConfidence, 0, 100) * 0.12
    + clamp(100 - (Number(card.portfolioCrowdingPenalty) || 0) * 100, 0, 100) * 0.09
    + clamp(card.sizeMultiplier * 100, 0, 150) * 0.08,
    0,
    100,
  );
}

function deployFloorPctForCard(
  card: InvestmentIdeaCard,
  macroOverlay: MacroRiskOverlay,
  grossBudgetPct = 0,
  deployCount = 1,
): number {
  if (macroOverlay.killSwitch || card.confirmationState === 'contradicted') return 0;
  const budgetAwareFloor = grossBudgetPct > 0
    ? (grossBudgetPct / Math.max(1, deployCount)) * (macroOverlay.state === 'risk-on' ? 0.34 : macroOverlay.state === 'balanced' ? 0.28 : 0.22)
    : 0;
  const baseFloor = Math.max(
    budgetAwareFloor,
    macroOverlay.state === 'risk-on'
      ? 1.2
      : macroOverlay.state === 'balanced'
        ? 0.8
        : 0.4,
  );
  const confirmationBoost = clamp((card.confirmationScore - 55) / 35, 0, 1);
  const realityBoost = clamp((card.realityScore - 60) / 30, 0, 1);
  const sizeBoost = clamp(card.sizeMultiplier, 0, 1.5);
  const floor = baseFloor * (0.7 + confirmationBoost * 0.7 + realityBoost * 0.25 + sizeBoost * 0.08);
  const cap = macroOverlay.state === 'risk-on' ? 2.5 : macroOverlay.state === 'balanced' ? 1.8 : 1.1;
  return clamp(Number(floor.toFixed(2)), 0, cap);
}

function zipfRankShares(count: number, alpha: number): number[] {
  if (!(count > 0)) return [];
  const weights = Array.from({ length: count }, (_, index) => 1 / Math.pow(index + 1, alpha));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return total > 0 ? weights.map((value) => value / total) : weights.map(() => 1 / count);
}

function buildConcentratedAllocationShares(
  scores: number[],
  macroOverlay: MacroRiskOverlay,
): number[] {
  if (!scores.length) return [];
  const scoreMedian = median(scores);
  const scoreSpread = Math.max(4, percentile(scores, 0.75) - percentile(scores, 0.25));
  const normalized = scores.map((score) => (score - scoreMedian) / scoreSpread);
  const temperature = clamp(
    (macroOverlay.state === 'risk-off' ? 0.08 : macroOverlay.state === 'balanced' ? 0.13 : 0.2)
    - Math.min(0.12, scoreSpread / 135),
    0.08,
    0.24,
  );
  const alpha = macroOverlay.state === 'risk-off'
    ? 2.25
    : macroOverlay.state === 'balanced'
      ? 1.8
      : 1.42;
  const softmaxShares = temperatureSoftmax(normalized, temperature);
  const rankShares = zipfRankShares(scores.length, alpha);
  const combined = softmaxShares.map((value, index) => Math.pow(value, 0.92) * Math.pow(rankShares[index] || 0, 0.2));
  const normalizedCombined = normalizeWeights(combined);
  const tailFloor = clamp(
    1 / Math.max(4, scores.length * (macroOverlay.state === 'risk-off' ? 1.8 : macroOverlay.state === 'balanced' ? 2.2 : 2.8)),
    0.04,
    0.12,
  );
  return normalizeWeights(
    normalizedCombined.map((share, index) => (index < 2 || share >= tailFloor ? share : 0)),
  );
}

export function buildDeployClusterPlan(
  cards: InvestmentIdeaCard[],
  macroOverlay: MacroRiskOverlay,
  grossBudgetPct: number,
): DeployClusterPlan {
  const deployCards = cards.filter((card) => card.autonomyAction === 'deploy' && card.executionGate && card.confirmationState !== 'contradicted');
  if (!deployCards.length) {
    return {
      rows: [],
      clusters: [],
      clusterByCardId: new Map(),
      clusterCaps: {},
    };
  }

  const stressLevel = macroOverlay.killSwitch
    ? 1
    : macroOverlay.state === 'risk-off'
      ? 0.84
      : macroOverlay.state === 'balanced'
        ? 0.42
        : 0.12;
  const rowMeta = deployCards.map((card) => {
    const instrumentMix = summarizeInstrumentMix(card.symbols);
    const primarySymbols = cardPrimarySymbols(card);
    const representativeSymbols = primarySymbols.length
      ? primarySymbols
      : card.symbols.map((symbol: InvestmentIdeaSymbol) => symbol.symbol).slice(0, 2);
    const family = normalizeSectorFamily(
      card.symbols.find((symbol: InvestmentIdeaSymbol) => symbol.role !== 'hedge')?.sector
      || card.sectorExposure[0]
      || card.themeId,
      card.symbols.find((symbol: InvestmentIdeaSymbol) => symbol.role !== 'hedge')?.assetKind || null,
    );
    const label = family.replace(/-/g, ' ').replace(/\b\w/g, (char: string) => char.toUpperCase());
    const baseFloor = deployFloorPctForCard(card, macroOverlay, grossBudgetPct, deployCards.length);
    const online = computeOnlineRankingAdjustment(card, macroOverlay);
    const score = clamp(
      card.confirmationScore * 0.26
      + card.calibratedConfidence * 0.1
      + card.realityScore * 0.08
      + card.graphSignalScore * 0.08
      + (100 - card.coveragePenalty) * 0.08
      + capitalReadinessScore(card) * 0.24
      + card.sizeMultiplier * 8
      + instrumentMix.coreShare * (stressLevel >= 0.55 ? 10 : 6)
      - instrumentMix.orbitalCount * stressLevel * 2.8
      + (online.stabilityMultiplier - 0.7) * 14
      + Math.max(0, online.lcbUtility) * 0.85
      - online.instabilityPenalty * 1.15
      + online.scoreDelta,
      1,
      100,
    );
    const series = buildCardCompositeReturnSeries(card);
    return {
      card,
      score,
      floor: baseFloor,
      family,
      label,
      representativeSymbols,
      series,
      averageAbsVol: estimateAverageAbsoluteVolatility(series),
      coreShare: instrumentMix.coreShare,
      orbitalCount: instrumentMix.orbitalCount,
      coreCount: instrumentMix.coreCount,
      defensiveScore: online.defensiveScore,
      onlineBoost: online.survivalBoost,
      stressLeadSupport: online.stressLeadSupport,
      currentReturnPct: online.currentReturnPct,
      replayReturnPct: online.replayReturnPct,
      currentHitRate: online.currentHitRate,
      drift: online.drift,
    };
  });

  const parents = rowMeta.map((_, index) => index);
  const findParent = (index: number): number => {
    let cursor = index;
    while (parents[cursor] !== cursor) {
      parents[cursor] = parents[parents[cursor]!]!;
      cursor = parents[cursor]!;
    }
    return cursor;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = findParent(left);
    const rightRoot = findParent(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  for (let leftIndex = 0; leftIndex < rowMeta.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rowMeta.length; rightIndex += 1) {
      const left = rowMeta[leftIndex]!;
      const right = rowMeta[rightIndex]!;
      const sharedSample = Math.min(left.series.length, right.series.length);
      const corrAbs = sharedSample >= 8
        ? Math.abs(pearsonCorrelation(left.series.slice(-sharedSample), right.series.slice(-sharedSample)))
        : 0;
      const sameFamily = left.family === right.family ? 1 : 0;
      const sameTheme = left.card.themeId === right.card.themeId ? 1 : 0;
      const overlap = intersectionCount(left.representativeSymbols, right.representativeSymbols) > 0 ? 1 : 0;
      const sharedDefense = left.defensiveScore >= 0.55 && right.defensiveScore >= 0.55 ? 1 : 0;
      const similarity = corrAbs * 0.66 + sameFamily * 0.18 + sameTheme * 0.1 + overlap * 0.08 + sharedDefense * 0.06;
      const threshold = macroOverlay.state === 'risk-off'
        ? 0.52
        : macroOverlay.state === 'balanced'
          ? 0.56
          : 0.6;
      if (similarity >= threshold) union(leftIndex, rightIndex);
    }
  }

  const buckets = new Map<number, typeof rowMeta>();
  rowMeta.forEach((row, index) => {
    const root = findParent(index);
    const bucket = buckets.get(root) || [];
    bucket.push(row);
    buckets.set(root, bucket);
  });

  const grossBudget = grossBudgetPct / 100;
  const clusterByCardId = new Map<string, string>();
  const clusterRows = Array.from(buckets.values()).map((bucket, index) => {
    const sorted = bucket.slice().sort((left, right) => right.score - left.score || right.card.confirmationScore - left.card.confirmationScore);
    const family = sorted[0]?.family || `cluster-${index + 1}`;
    const clusterId = `${family}-${index + 1}`;
    const clusterLabel = `${sorted[0]?.label || 'General'} Cluster`;
    const pairwiseCorrs: number[] = [];
    for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
        const left = sorted[leftIndex]!;
        const right = sorted[rightIndex]!;
        const sampleSize = Math.min(left.series.length, right.series.length);
        if (sampleSize >= 8) {
          pairwiseCorrs.push(Math.abs(pearsonCorrelation(left.series.slice(-sampleSize), right.series.slice(-sampleSize))));
        }
      }
    }
    const defensiveScore = average(sorted.map((row) => row.defensiveScore));
    const clusterScore = Number((
      (sorted[0]?.score || 0) * 0.54
      + average(sorted.map((row) => row.score)) * 0.22
      + average(sorted.map((row) => Math.max(0, row.onlineBoost))) * 0.16
      + average(sorted.map((row) => row.coreShare)) * stressLevel * 10
      + defensiveScore * stressLevel * 9
    ).toFixed(3));
    const clusterRisk = clamp(
      0.55
      + average(sorted.map((row) => row.averageAbsVol)) * 14
      + average(pairwiseCorrs) * 1.05
      + average(sorted.map((row) => Number(row.card.portfolioCrowdingPenalty) || 0)) * 1.8
      + average(sorted.map((row) => row.orbitalCount)) * stressLevel * 0.28
      - defensiveScore * stressLevel * 0.18,
      0.18,
      4.4,
    );
    const rawShare = Math.max(0.08, clusterScore / Math.max(18, clusterRisk * 28));
    sorted.forEach((row) => {
      clusterByCardId.set(row.card.id, clusterId);
    });
    return {
      id: clusterId,
      label: clusterLabel,
      family,
      score: clusterScore,
      riskScore: Number(clusterRisk.toFixed(4)),
      defensiveScore: Number(defensiveScore.toFixed(4)),
      coreShare: Number(average(sorted.map((row) => row.coreShare)).toFixed(4)),
      orbitalCount: average(sorted.map((row) => row.orbitalCount)),
      memberIds: sorted.map((row) => row.card.id),
      rows: sorted,
      rawShare,
    };
  }).sort((left, right) => right.score - left.score || left.riskScore - right.riskScore);

  const defensiveBenchmarkReturn = clusterRows
    .filter((cluster) => cluster.defensiveScore >= 0.55)
    .slice()
    .sort((left, right) =>
      average(right.rows.map((row) => row.currentReturnPct)) - average(left.rows.map((row) => row.currentReturnPct))
      || right.score - left.score
    )[0];
  const stressBenchmarkReturn = stressLevel >= 0.55
    ? Math.max(0.45, average(defensiveBenchmarkReturn?.rows.map((row) => row.currentReturnPct) || [0]))
    : Math.max(0, average(defensiveBenchmarkReturn?.rows.map((row) => row.currentReturnPct) || [0]));

  const calibratedClusterRows = clusterRows.map((cluster) => {
    const currentReturnPct = average(cluster.rows.map((row) => row.currentReturnPct));
    const replayReturnPct = average(cluster.rows.map((row) => row.replayReturnPct));
    const avgDrift = average(cluster.rows.map((row) => row.drift));
    const avgVol = average(cluster.rows.map((row) => row.averageAbsVol));
    const avgStressLead = average(cluster.rows.map((row) => row.stressLeadSupport));
    const currentIC = estimateClusterRankingCorrelation(
      cluster.rows.map((row) => row.score),
      cluster.rows.map((row) => row.currentReturnPct),
    );
    const replayIC = estimateClusterRankingCorrelation(
      cluster.rows.map((row) => row.score),
      cluster.rows.map((row) => row.replayReturnPct),
    );
    const icDrift = Number((currentIC - replayIC).toFixed(4));
    const driftLoss = clamp(Math.abs(Math.min(0, avgDrift)) / 1.1, 0, 3.2);
    const replayGapLoss = clamp((replayReturnPct - currentReturnPct) / Math.max(0.8, Math.abs(replayReturnPct) + 0.7), 0, 3.2);
    const volatilityLoss = clamp(avgVol * 18, 0, 1.8);
    const icPenalty = clamp(Math.abs(Math.min(0, icDrift)) / 0.22, 0, 3.4);
    const regretPenalty = cluster.defensiveScore >= 0.55
      ? 0
      : clamp(
        Math.max(0, stressBenchmarkReturn - currentReturnPct)
        + Math.max(0, 0.18 - currentReturnPct) * (stressLevel >= 0.55 ? 0.75 : 0.35),
        0,
        6,
      );
    const mwuLoss = replayGapLoss * _cfg.penalties.replayGapLoss + driftLoss * _cfg.penalties.driftLossMultiplier + volatilityLoss * _cfg.penalties.volatilityLossWeight + icPenalty * _cfg.weights.flipRateWeight;
    const multiplicativeWeight = clamp(
      Math.exp(-(stressLevel >= _cfg.thresholds.defensiveTrigger ? _cfg.penalties.stressMultiplierHigh : 0.62) * mwuLoss),
      cluster.defensiveScore >= _cfg.thresholds.defensiveTrigger ? 0.08 : 0.03,
      _cfg.penalties.negativeDriftPenalty,
    );
    const icMultiplier = clamp(1 - Math.abs(Math.min(0, icDrift)) * _cfg.weights.flipRateWeight, 0.08, 1.08);
    const regretMultiplier = cluster.defensiveScore >= 0.55
      ? 1
      : clamp(1 - regretPenalty * (stressLevel >= 0.55 ? 0.38 : 0.24), 0.03, 1);
    const survivalMultiplier = cluster.defensiveScore >= 0.55
      ? clamp(1 + stressLevel * 0.65 + avgStressLead * 0.55 + Math.max(0, currentReturnPct) / 7, 1, 2.05)
      : 1;
    const coreMultiplier = clamp(
      0.78 + cluster.coreShare * (stressLevel >= 0.55 ? 0.7 : 0.38),
      cluster.defensiveScore >= 0.55 ? 0.92 : 0.42,
      1.55,
    );
    const multiplier = Number((multiplicativeWeight * icMultiplier * regretMultiplier * survivalMultiplier).toFixed(4));
    const gateState: 'open' | 'shrunk' | 'gated' =
      cluster.defensiveScore < 0.45 && (
        regretPenalty >= (stressLevel >= 0.55 ? 0.85 : 1.2)
        || icDrift <= (stressLevel >= 0.55 ? -0.18 : -0.28)
        || avgDrift <= (stressLevel >= 0.55 ? -0.45 : -0.75)
      )
        ? 'gated'
        : (
          cluster.defensiveScore < 0.55 && (
            regretPenalty >= (stressLevel >= 0.55 ? 0.45 : 0.65)
            || icDrift <= (stressLevel >= 0.55 ? -0.08 : -0.12)
            || avgDrift <= (stressLevel >= 0.55 ? -0.2 : -0.35)
          )
            ? 'shrunk'
            : 'open'
        );
    return {
      ...cluster,
      rawShare: cluster.rawShare * multiplier * coreMultiplier,
      currentReturnPct: Number(currentReturnPct.toFixed(2)),
      replayReturnPct: Number(replayReturnPct.toFixed(2)),
      icDrift: Number(icDrift.toFixed(4)),
      multiplier: Number((multiplier * coreMultiplier).toFixed(4)),
      regretPenalty: Number(regretPenalty.toFixed(3)),
      gateState,
    };
  }).sort((left, right) => right.rawShare - left.rawShare || right.score - left.score);

  const bestDefensiveCluster = calibratedClusterRows
    .filter((cluster) => cluster.defensiveScore >= 0.55)
    .slice()
    .sort((left, right) => right.multiplier - left.multiplier || right.currentReturnPct - left.currentReturnPct)[0];
  if (bestDefensiveCluster && stressLevel >= 0.55) {
    bestDefensiveCluster.rawShare = Math.max(
      bestDefensiveCluster.rawShare,
      average(calibratedClusterRows.map((cluster) => cluster.rawShare)) * 0.95,
    );
  }

  const normalizedShares = normalizeWeights(calibratedClusterRows.map((cluster) => cluster.rawShare));
  const clusters: DeployClusterRow[] = calibratedClusterRows.map((cluster, index) => {
    const share = normalizedShares[index] || 0;
    const clusterBudgetPct = grossBudgetPct * share;
    const medianFloor = Math.max(0.35, median(cluster.rows.map((row) => row.floor).filter((value) => value > 0)));
    const baseTopK = clamp(
      Math.round(
        Math.max(
          1,
          clusterBudgetPct / Math.max(3.2, medianFloor * (macroOverlay.state === 'risk-off' ? 2.6 : macroOverlay.state === 'balanced' ? 2.25 : 1.95)),
        ),
      ),
      1,
      macroOverlay.state === 'risk-off' ? _cfg.regime.riskOff.maxClusters : macroOverlay.state === 'balanced' ? _cfg.regime.balanced.maxClusters : _cfg.regime.riskOn.maxClusters,
    );
    const topK = cluster.gateState === 'gated'
      ? 1
      : cluster.gateState === 'shrunk'
        ? Math.max(1, baseTopK - (stressLevel >= 0.55 ? 2 : 1))
        : baseTopK;
    const baseCap = grossBudget * share * (cluster.defensiveScore >= 0.55 && stressLevel >= 0.55 ? 1.45 : 2.05);
    const coreCapBias = cluster.coreShare >= 0.5
      ? clamp(1 + cluster.coreShare * (stressLevel >= 0.55 ? 0.26 : 0.14), 1, 1.28)
      : clamp(0.82 + cluster.coreShare * 0.2, 0.78, 1);
    const capMultiplier = cluster.gateState === 'gated'
      ? (stressLevel >= 0.55 ? 0.12 : 0.22)
      : cluster.gateState === 'shrunk'
        ? (stressLevel >= 0.55 ? 0.35 : 0.58)
        : 1;
    const cap = clamp(
      baseCap * capMultiplier * coreCapBias,
      cluster.gateState === 'gated'
        ? 0.02
        : macroOverlay.state === 'risk-off' ? 0.05 : 0.06,
      cluster.gateState === 'gated'
        ? 0.03
        : macroOverlay.state === 'risk-off' ? 0.24 : macroOverlay.state === 'balanced' ? 0.28 : 0.34,
    );
    return {
      id: cluster.id,
      label: cluster.label,
      family: cluster.family,
      share: Number(share.toFixed(4)),
      cap: Number(cap.toFixed(4)),
      topK,
      score: Number(cluster.score.toFixed(3)),
      riskScore: cluster.riskScore,
      defensiveScore: cluster.defensiveScore,
      coreShare: Number(cluster.coreShare.toFixed(4)),
      orbitalCount: Number(cluster.orbitalCount.toFixed(2)),
      currentReturnPct: cluster.currentReturnPct,
      replayReturnPct: cluster.replayReturnPct,
      icDrift: cluster.icDrift,
      multiplier: cluster.multiplier,
      regretPenalty: cluster.regretPenalty,
      gateState: cluster.gateState,
      memberIds: cluster.memberIds,
    };
  });

  return {
    rows: calibratedClusterRows.flatMap((cluster) => cluster.rows.map((row) => ({
      ...row,
      clusterId: cluster.id,
      clusterLabel: cluster.label,
    }))),
    clusters,
    clusterByCardId,
    clusterCaps: Object.fromEntries(clusters.map((cluster) => [cluster.id, cluster.cap])),
  };
}

export function buildThemeExposureCaps(
  cards: InvestmentIdeaCard[],
  macroOverlay: MacroRiskOverlay,
  grossBudgetPct: number,
): Record<string, number> {
  const deployCards = cards.filter((card) => card.autonomyAction === 'deploy' && card.executionGate);
  const themeRows = Array.from(new Set(deployCards.map((card) => card.themeId))).map((themeId) => {
    const related = deployCards.filter((card) => card.themeId === themeId);
    const stability = computeThemeStabilityAdjustment(themeId);
    const ranked = related
      .slice()
      .sort((left, right) => capitalReadinessScore(right) - capitalReadinessScore(left) || right.confirmationScore - left.confirmationScore);
    const topScore = capitalReadinessScore(ranked[0]!);
    const runnerUpScore = ranked[1] ? capitalReadinessScore(ranked[1]) : topScore * 0.82;
    const rawThemeScore = topScore * 0.76
      + average(related.map((card) =>
        (Number(card.sizePct) || 0) * 2.6
        + card.confirmationScore * 0.18,
      )) * 0.24
      + Math.max(0, topScore - runnerUpScore) * 0.45;
    const themeScore = rawThemeScore * (0.48 + stability.exposureMultiplier * 0.72)
      + stability.scoreDelta * 0.55
      - stability.instabilityPenalty * 1.8
      + Math.max(0, stability.stabilityScore - 55) * 0.14;
    return { themeId, score: themeScore, stability };
  }).sort((left, right) => right.score - left.score);

  if (!themeRows.length) return {};

  const shares = buildConcentratedAllocationShares(
    themeRows.map((row) => row.score),
    macroOverlay,
  );
  const grossBudget = grossBudgetPct / 100;
  const minCap = macroOverlay.state === 'risk-off' ? 0.03 : macroOverlay.state === 'balanced' ? 0.04 : 0.05;
  const maxCap = macroOverlay.state === 'risk-off' ? 0.28 : macroOverlay.state === 'balanced' ? 0.28 : 0.32;
  return Object.fromEntries(themeRows.map((row, index) => {
    const share = shares[index] || 0;
    const stabilityCapMultiplier = clamp(
      0.42 + row.stability.exposureMultiplier * 0.72 + Math.max(0, row.stability.lcbUtility) * 0.02 - row.stability.instabilityPenalty * 0.04,
      0.22,
      1.22,
    );
    const cap = clamp(grossBudget * share * 2.15 * stabilityCapMultiplier, minCap, maxCap);
    return [row.themeId, Number(cap.toFixed(4))];
  }));
}

export function inferDynamicMaxPositionWeight(
  cards: InvestmentIdeaCard[],
  macroOverlay: MacroRiskOverlay,
  grossBudgetPct: number,
): number {
  const deployCards = cards.filter((card) => card.autonomyAction === 'deploy' && card.executionGate);
  if (!deployCards.length) {
    return macroOverlay.killSwitch ? 0.04 : macroOverlay.state === 'risk-off' ? 0.1 : 0.18;
  }
  const scores = deployCards.map((card) => capitalReadinessScore(card));
  const averageScore = Math.max(1, average(scores));
  const topScore = Math.max(...scores);
  const grossBudget = grossBudgetPct / 100;
  const averageTicket = grossBudget / Math.max(1, deployCards.length);
  const concentrationBoost = clamp(1 + ((topScore / averageScore) - 1) * 1.7, 1, 3.1);
  const inferredCap = averageTicket * (1.95 + concentrationBoost * 1.35);
  return clamp(
    inferredCap,
    macroOverlay.killSwitch ? 0.04 : macroOverlay.state === 'risk-off' ? 0.12 : 0.14,
    macroOverlay.state === 'risk-off' ? 0.26 : macroOverlay.state === 'balanced' ? 0.28 : 0.34,
  );
}

export function allocateDeployBudget(
  cards: InvestmentIdeaCard[],
  macroOverlay: MacroRiskOverlay,
  targetBudgetPct?: number,
): Map<string, number> {
  const allocations = new Map<string, number>();
  const deployCards = cards.filter((card) => card.autonomyAction === 'deploy' && card.executionGate && card.confirmationState !== 'contradicted');
  if (!deployCards.length) return allocations;

  const computedBudgetPct = Number.isFinite(targetBudgetPct)
    ? clamp(Number(targetBudgetPct), 0, Math.min(macroOverlay.grossExposureCapPct, macroOverlay.state === 'risk-on' ? _cfg.regime.riskOn.budgetPct : macroOverlay.state === 'balanced' ? _cfg.regime.balanced.budgetPct : _cfg.regime.riskOff.budgetPct))
    : clamp(
      Number((macroOverlay.state === 'risk-on' ? _cfg.regime.riskOn.grossCapPct : macroOverlay.state === 'balanced' ? _cfg.regime.balanced.grossCapPct : _cfg.regime.riskOff.grossCapPct).toFixed(2)),
      0,
      Math.min(macroOverlay.grossExposureCapPct, macroOverlay.state === 'risk-on' ? _cfg.regime.riskOn.budgetPct : macroOverlay.state === 'balanced' ? _cfg.regime.balanced.budgetPct : _cfg.regime.riskOff.budgetPct),
    );
  if (!(computedBudgetPct > 0)) {
    for (const card of deployCards) allocations.set(card.id, 0);
    return allocations;
  }

  const clusterPlan = buildDeployClusterPlan(cards, macroOverlay, computedBudgetPct);
  const stressProbability = estimateMacroStressProbability(macroOverlay);
  const allocateRows = (
    rows: Array<typeof clusterPlan.rows[number]>,
    budgetPct: number,
    scoreBoost = 1,
  ): void => {
    if (!rows.length || !(budgetPct > 0)) return;
    const shares = buildConcentratedAllocationShares(
      rows.map((row) => (row.score + row.onlineBoost * 0.35 + row.stressLeadSupport * 6) * scoreBoost),
      macroOverlay,
    );
    const rankedFloors = rows.map((row, index) => {
      const rankLift = clamp(
        Math.pow(Math.max(0.03, (shares[index] || 0) * rows.length), 0.9),
        row.defensiveScore >= 0.55 ? 0.22 : 0.16,
        macroOverlay.state === 'risk-on' ? 1.95 : macroOverlay.state === 'balanced' ? 1.68 : 1.4,
      );
      return Number((row.floor * rankLift).toFixed(2));
    });
    const floorTotal = rankedFloors.reduce((sum, value) => sum + value, 0);
    if (floorTotal >= budgetPct) {
      const scale = budgetPct / floorTotal;
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]!;
        allocations.set(row.card.id, Number((rankedFloors[index]! * scale).toFixed(2)));
      }
      return;
    }

    const remainingBudget = budgetPct - floorTotal;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      const share = shares[index] || 0;
      allocations.set(row.card.id, Number((rankedFloors[index]! + remainingBudget * share).toFixed(2)));
    }
  };

  for (const cluster of clusterPlan.clusters) {
    const clusterRows = clusterPlan.rows
      .filter((row) => row.clusterId === cluster.id)
      .slice()
      .sort((left, right) => right.score - left.score || right.card.confirmationScore - left.card.confirmationScore);
    const selectedRows = clusterRows.slice(0, cluster.topK);
    if (!selectedRows.length) continue;
    const clusterBudgetPct = computedBudgetPct * cluster.share;
    const coreRows = selectedRows.filter((row) => row.coreCount > 0);
    const orbitalRows = selectedRows.filter((row) => row.coreCount === 0 && row.orbitalCount > 0);
    if (!coreRows.length || !orbitalRows.length) {
      allocateRows(selectedRows, clusterBudgetPct);
      continue;
    }

    const desiredCoreShare = clamp(
      average(coreRows.map((row) => row.coreShare)) * 0.55
      + (cluster.defensiveScore >= 0.55 ? 0.12 : 0)
      + (stressProbability >= 0.65 ? 0.26 : stressProbability >= 0.45 ? 0.18 : 0.08),
      macroOverlay.state === 'risk-off' ? 0.62 : 0.52,
      macroOverlay.state === 'risk-off' ? 0.92 : 0.82,
    );
    const coreBudgetPct = Number((clusterBudgetPct * desiredCoreShare).toFixed(2));
    const orbitalBudgetPct = Math.max(0, Number((clusterBudgetPct - coreBudgetPct).toFixed(2)));
    allocateRows(coreRows, coreBudgetPct, stressProbability >= 0.55 ? 1.08 : 1.03);
    allocateRows(orbitalRows, orbitalBudgetPct, stressProbability >= 0.55 ? 0.92 : 0.97);
  }

  for (const card of deployCards) {
    if (!allocations.has(card.id)) {
      allocations.set(card.id, 0);
    }
  }

  return allocations;
}

export function applyPortfolioExecutionControls(
  cards: InvestmentIdeaCard[],
  macroOverlay: MacroRiskOverlay,
): InvestmentIdeaCard[] {
  if (!cards.length) return cards;
  const instrumentAwareCards: InvestmentIdeaCard[] = cards.map((card): InvestmentIdeaCard => {
    const plan = buildCoreOrbitalExecutionPlan(card, macroOverlay, computeOnlineRankingAdjustment);
    if (!plan.reasons.length && plan.symbols.length === card.symbols.length) {
      return card;
    }
    return {
      ...card,
      symbols: plan.symbols,
      sizeMultiplier: Number(clamp(card.sizeMultiplier * (1 - plan.orbitalPenalty * 0.18), 0.18, 3).toFixed(2)),
      autonomyReasons: Array.from(new Set([
        ...card.autonomyReasons,
        ...plan.reasons,
        plan.benchmarkSymbol ? `ETF-first benchmark=${plan.benchmarkSymbol}.` : '',
      ].filter(Boolean))).slice(0, 6),
    };
  });
  const directionalCards = instrumentAwareCards.filter((card) => card.direction === 'long' || card.direction === 'short');
  const correlationPenalty = computeCorrelationAwareSizingPenalty(
    directionalCards.flatMap((card: InvestmentIdeaCard) => card.symbols.filter((symbol: InvestmentIdeaSymbol) => symbol.role !== 'hedge').map((symbol: InvestmentIdeaSymbol) => symbol.symbol)),
  );

  const rmtAdjustedCards: InvestmentIdeaCard[] = instrumentAwareCards.map((card: InvestmentIdeaCard): InvestmentIdeaCard => {
    const rowPenalty = average(
      card.symbols
        .filter((symbol: InvestmentIdeaSymbol) => symbol.role !== 'hedge')
        .map((symbol: InvestmentIdeaSymbol) => correlationPenalty.rowPenaltyBySymbol.get(symbol.symbol) ?? 0),
    );
    const portfolioCrowdingPenalty = clamp(
      Number((Math.max(correlationPenalty.globalPenalty, rowPenalty) * (card.direction === 'hedge' ? 0.45 : 1)).toFixed(4)),
      0,
      0.55,
    );
    const autonomyAction = portfolioCrowdingPenalty >= 0.34 && card.autonomyAction === 'deploy'
      ? 'shadow'
      : card.autonomyAction;
    return {
      ...card,
      autonomyAction,
      portfolioCrowdingPenalty,
      autonomyReasons: Array.from(new Set([
        ...card.autonomyReasons,
        portfolioCrowdingPenalty > 0 ? `RMT crowding penalty=${(portfolioCrowdingPenalty * 100).toFixed(0)}%.` : '',
        ...correlationPenalty.summary,
      ].filter(Boolean))).slice(0, 6),
    };
  });

  const currentWeightByIdea = new Map(
    trackedIdeas
      .filter((idea) => idea.status === 'open')
      .map((idea) => {
        const signedWeight = (idea.direction === 'short' ? -1 : 1) * (Number(idea.sizePct) || 0) / 100;
        return [idea.ideaKey, signedWeight] as const;
      }),
  );
  const assetClassCaps: Record<string, number> = {
    etf: macroOverlay.killSwitch ? 0.08 : 0.28,
    equity: macroOverlay.killSwitch ? 0.06 : 0.24,
    commodity: macroOverlay.killSwitch ? 0.08 : 0.22,
    rate: 0.18,
    fx: 0.16,
    crypto: macroOverlay.state === 'risk-off' ? 0.04 : 0.1,
  };
  const capitalCalibration = calibrateCapitalBudget(rmtAdjustedCards, macroOverlay);
  const calibratedCards: InvestmentIdeaCard[] = rmtAdjustedCards.map((card): InvestmentIdeaCard => {
    const promotedToDeploy = capitalCalibration.promotedDeployIds.has(card.id);
    const calibratedAction: AutonomyAction = promotedToDeploy
      ? 'deploy'
      : (card.autonomyAction === 'deploy' ? 'shadow' : card.autonomyAction);
    const executionGate = promotedToDeploy ? true : card.executionGate;
    const calibrationReasons: string[] = [];
    if (promotedToDeploy) {
      calibrationReasons.push(
        `Auto-calibration promoted this idea into the deploy set (ranked within top ${Math.min(10, Math.max(1, Math.round(capitalCalibration.promotedDeployIds.size)))} candidates).`,
        `Deploy share=${(capitalCalibration.deployRate * 100).toFixed(0)}% | breadth=${(capitalCalibration.candidateBreadth * 100).toFixed(0)}% | confirmation median=${capitalCalibration.confirmationMedian.toFixed(0)}.`,
        `Readiness median=${capitalCalibration.readinessMedian.toFixed(0)} / spread=${capitalCalibration.readinessSpread.toFixed(0)}.`,
      );
    } else if (card.autonomyAction === 'deploy') {
      calibrationReasons.push(
        'Distribution calibration held this idea in shadow to preserve capital for stronger deploy candidates.',
        `Deploy share=${(capitalCalibration.deployRate * 100).toFixed(0)}% | breadth=${(capitalCalibration.candidateBreadth * 100).toFixed(0)}% | confirmation median=${capitalCalibration.confirmationMedian.toFixed(0)}.`,
      );
    }
    return {
      ...card,
      autonomyAction: calibratedAction,
      executionGate,
      autonomyReasons: Array.from(new Set([
        ...card.autonomyReasons,
        ...calibrationReasons,
      ])).slice(0, 6),
    };
  });
  const deployAllocations = allocateDeployBudget(calibratedCards, macroOverlay, capitalCalibration.grossBudgetPct);
  const normalizedCards: InvestmentIdeaCard[] = calibratedCards.map((card): InvestmentIdeaCard => {
    if (card.autonomyAction === 'abstain') {
      return {
        ...card,
        sizePct: 0,
        autonomyReasons: Array.from(new Set([
          ...card.autonomyReasons,
          'Abstained idea: capital allocation suppressed to zero.',
        ])).slice(0, 6),
      };
    }
    if (card.autonomyAction !== 'deploy') {
      const convictionScale = clamp((card.continuousConviction ?? 0) / 100, 0, 0.35);
      const watchSizePct = Number((card.sizePct * convictionScale).toFixed(2));
      return {
        ...card,
        sizePct: watchSizePct,
        autonomyReasons: Array.from(new Set([
          ...card.autonomyReasons,
          `Watch/shadow idea: conviction-scaled allocation at ${(convictionScale * 100).toFixed(0)}% of base size.`,
        ])).slice(0, 6),
      };
    }
    const allocatedSizePct = deployAllocations.get(card.id) ?? 0;
    const allocationSuppressed = !(allocatedSizePct > 0);
    const normalizedAction: AutonomyAction = allocationSuppressed ? 'watch' : card.autonomyAction;
    return {
      ...card,
      autonomyAction: normalizedAction,
      sizePct: allocatedSizePct,
      autonomyReasons: Array.from(new Set([
        ...card.autonomyReasons,
        `Regime gross budget=${capitalCalibration.grossBudgetPct.toFixed(2)}%.`,
        `Auto-calibration deploy count=${capitalCalibration.promotedDeployIds.size}.`,
        allocatedSizePct > 0
          ? `Deploy floor=${deployFloorPctForCard(card, macroOverlay, capitalCalibration.grossBudgetPct, Math.max(1, capitalCalibration.promotedDeployIds.size)).toFixed(2)}%.`
          : 'Cluster-aware Top-K and hierarchical risk budgeting withheld capital from this marginal deploy idea.',
      ])).slice(0, 6),
    };
  });
  const deployClusterPlan = buildDeployClusterPlan(normalizedCards, macroOverlay, capitalCalibration.grossBudgetPct);
  const themeCaps = buildThemeExposureCaps(normalizedCards, macroOverlay, capitalCalibration.grossBudgetPct);
  const hrpClusterCaps = buildHrpfClusterCaps(
    normalizedCards,
    macroOverlay,
    capitalCalibration.grossBudgetPct,
    deployClusterPlan.clusterCaps,
    deployClusterPlan.clusterByCardId,
  );
  const dynamicMaxPositionWeight = inferDynamicMaxPositionWeight(
    normalizedCards,
    macroOverlay,
    capitalCalibration.grossBudgetPct,
  );
  const inputs = normalizedCards.map((card: InvestmentIdeaCard) => {
    const primarySymbol = card.symbols.find((symbol: InvestmentIdeaSymbol) => symbol.role !== 'hedge') || card.symbols[0];
    const instrumentMix = summarizeInstrumentMix(card.symbols);
    const isDeploy = card.autonomyAction === 'deploy';
    const themeRule = getThemeRule(card.themeId);
    const themePolicy = themeRule ? resolveThemePolicy(themeRule) : null;
    const symbolWeightMultiplier = card.symbols
      .map((symbol: InvestmentIdeaSymbol) => themePolicy?.symbolAdjustments[String(symbol.symbol || '').trim().toUpperCase()]?.maxWeightMultiplier ?? 1)
      .reduce((min, value) => Math.min(min, value), 1);
    const kellyMultiplier = computeFractionalKellyMultiplier(card, macroOverlay);
    const rawTargetWeight = isDeploy
      ? (card.direction === 'short' ? -1 : 1) * (Number(card.sizePct) || 0) / 100
      : 0;
    const targetWeight = rawTargetWeight * kellyMultiplier * symbolWeightMultiplier;
    const coreBias = instrumentMix.hasCore
      ? clamp(0.96 + instrumentMix.coreShare * (macroOverlay.state === 'risk-off' ? 0.34 : 0.18), 0.92, 1.24)
      : (macroOverlay.state === 'risk-off' && instrumentMix.orbitalCount > 0 ? 0.82 : 1);
    const baseDynamicMaxWeight = isDeploy
      ? clamp(
        Math.max(
          themeCaps[card.themeId] || 0,
          Math.abs(targetWeight) * (macroOverlay.state === 'risk-off' ? 1.45 : 1.25),
        ) * coreBias,
        macroOverlay.killSwitch ? 0.02 : macroOverlay.state === 'risk-off' ? 0.06 : 0.08,
        dynamicMaxPositionWeight,
      )
      : (themeCaps[card.themeId] || dynamicMaxPositionWeight);
    const dynamicMaxWeight = isDeploy
      ? clamp(
        baseDynamicMaxWeight * clamp(0.52 + kellyMultiplier * 0.58, 0.38, 1.1) * symbolWeightMultiplier,
        macroOverlay.killSwitch ? 0.006 : macroOverlay.state === 'risk-off' ? 0.01 : 0.012,
        dynamicMaxPositionWeight,
      )
      : baseDynamicMaxWeight;
    const confidence = isDeploy
      ? clamp(
        (card.confirmationScore / 100) * (0.75 + card.sizeMultiplier * 0.25) * coreBias,
        0,
        1,
      )
      : 0;
    return {
      symbol: card.id,
      currentWeight: isDeploy ? (currentWeightByIdea.get(card.id) ?? 0) : 0,
      targetWeight,
      confidence,
      themeId: card.themeId,
      riskClusterId: deployClusterPlan.clusterByCardId.get(card.id) || undefined,
      assetClass: primarySymbol?.assetKind || 'other',
      tradable: isDeploy && card.executionGate,
      liquidityScore: average(card.symbols.map((symbol: InvestmentIdeaSymbol) => Number(symbol.liquidityScore) || 0)),
      turnoverCostBps: Math.max(2, (100 - card.realityScore) * 0.4 + card.coveragePenalty * 0.15),
      executionPenaltyPct: Math.max(0, (100 - card.realityScore) * 0.06 + card.coveragePenalty * 0.02),
      minWeight: isDeploy && macroOverlay.killSwitch && card.direction !== 'hedge' ? 0 : undefined,
      maxWeight: dynamicMaxWeight,
    };
  });
  const budgetAwareTicketWeight = (capitalCalibration.grossBudgetPct / 100) / Math.max(1, capitalCalibration.promotedDeployIds.size);
  const adaptiveMinTradeWeight = clamp(
    Math.max(
      median(
      normalizedCards
        .map((card) => Math.abs(Number(card.sizePct) || 0) / 100)
        .filter((value) => value > 0),
      ) * 0.45,
      budgetAwareTicketWeight * 0.2,
    ),
    0.0015,
    0.03,
  );
  const deployWeightBudget = normalizedCards
    .filter((card) => card.autonomyAction === 'deploy')
    .reduce((sum, card) => sum + Math.abs(Number(card.sizePct) || 0), 0);
  const deployConfidenceFloor = clamp(
    percentile(
      normalizedCards
        .filter((card) => card.autonomyAction === 'deploy')
        .map((card) => clamp((card.confirmationScore / 100) * (0.75 + card.sizeMultiplier * 0.25), 0, 1)),
      0.25,
    ) * 0.9,
    macroOverlay.state === 'risk-off' ? 0.12 : 0.1,
    macroOverlay.state === 'risk-off' ? 0.32 : 0.28,
  );
  const underInvestmentPenalty = clamp(
    0.8
    + capitalCalibration.candidateBreadth * 1
    + deployWeightBudget / 18
    + average(
      normalizedCards
        .filter((card) => card.autonomyAction === 'deploy')
        .map((card) => card.confirmationScore),
    ) / 140,
    0.8,
    2.8,
  );
  const plan = optimizeTargetWeights(inputs, {
    longOnly: false,
    grossCap: macroOverlay.grossExposureCapPct / 100,
    netCap: macroOverlay.netExposureCapPct / 100,
    targetGrossExposure: capitalCalibration.grossBudgetPct / 100,
    maxPositionWeight: dynamicMaxPositionWeight,
    maxTurnoverPct: macroOverlay.killSwitch ? 0.08 : macroOverlay.state === 'risk-off' ? 0.18 : 0.3,
    minTradeWeight: adaptiveMinTradeWeight,
    themeCaps,
    clusterCaps: hrpClusterCaps,
    assetClassCaps,
    confidenceFloor: deployConfidenceFloor,
    underInvestmentPenalty,
    iterations: 8,
  });
  const deployRetentionFloorPct = clamp(
    Math.max(
      percentile(
      normalizedCards
        .filter((card) => card.autonomyAction === 'deploy')
        .map((card) => Math.abs(Number((plan.optimizedWeights[card.id] ?? 0) * 100)) || 0)
        .filter((value) => value > 0),
      0.25,
      ) * 0.55,
      (capitalCalibration.grossBudgetPct / Math.max(1, capitalCalibration.promotedDeployIds.size)) * 0.22,
    ),
    0.4,
    4.5,
  );
  const plannedDeployRows = normalizedCards
    .filter((card) => card.autonomyAction === 'deploy')
    .map((card) => ({
      instrumentMix: summarizeInstrumentMix(card.symbols),
      id: card.id,
      themeId: card.themeId,
      clusterId: deployClusterPlan.clusterByCardId.get(card.id) || 'unassigned',
      score:
        capitalReadinessScore(card) * 0.36
        + card.confirmationScore * 0.28
        + Math.abs(Number((plan.optimizedWeights[card.id] ?? 0) * 100)) * 0.26
        + summarizeInstrumentMix(card.symbols).coreShare * (macroOverlay.state === 'risk-off' ? 14 : 8)
        - summarizeInstrumentMix(card.symbols).orbitalCount * (macroOverlay.state === 'risk-off' ? 1.8 : 1.1),
      optimizedSizePct: Math.abs(Number((plan.optimizedWeights[card.id] ?? 0) * 100)),
    }))
    .sort((left, right) => right.score - left.score || right.optimizedSizePct - left.optimizedSizePct);
  const maxDeployPositions = macroOverlay.killSwitch
    ? 1
    : macroOverlay.state === 'risk-off'
      ? Math.min(3, Math.max(1, Math.round(capitalCalibration.grossBudgetPct / 9)))
      : macroOverlay.state === 'balanced'
      ? Math.min(5, Math.max(2, Math.round(capitalCalibration.grossBudgetPct / 8)))
      : Math.min(7, Math.max(3, Math.round(capitalCalibration.grossBudgetPct / 8)));
  const clusterTopKMap = new Map(deployClusterPlan.clusters.map((cluster) => [cluster.id, cluster.topK] as const));
  const clusterPriority = deployClusterPlan.clusters.map((cluster) => cluster.id);
  const plannedByCluster = new Map<string, typeof plannedDeployRows>();
  for (const row of plannedDeployRows) {
    const bucket = plannedByCluster.get(row.clusterId) || [];
    bucket.push(row);
    plannedByCluster.set(row.clusterId, bucket);
  }
  const retainedDeployIds = new Set<string>();
  const retainedPerCluster = new Map<string, number>();
  let cursor = 0;
  while (retainedDeployIds.size < maxDeployPositions) {
    let progressed = false;
    for (const clusterId of clusterPriority) {
      if (retainedDeployIds.size >= maxDeployPositions) break;
      const clusterRows = plannedByCluster.get(clusterId) || [];
      const limit = clusterTopKMap.get(clusterId) ?? 1;
      const alreadyRetained = retainedPerCluster.get(clusterId) ?? 0;
      if (alreadyRetained >= limit) continue;
      const nextRow = clusterRows[alreadyRetained];
      if (!nextRow) continue;
      retainedDeployIds.add(nextRow.id);
      retainedPerCluster.set(clusterId, alreadyRetained + 1);
      progressed = true;
    }
    cursor += 1;
    if (!progressed || cursor > maxDeployPositions + deployClusterPlan.clusters.length + 3) break;
  }
  const totalPlannedDeployPct = plannedDeployRows.reduce((sum, row) => sum + row.optimizedSizePct, 0);
  const retainedPlannedDeployPct = plannedDeployRows
    .filter((row) => retainedDeployIds.has(row.id))
    .reduce((sum, row) => sum + row.optimizedSizePct, 0);
  const retainedBudgetScale = retainedPlannedDeployPct > 0
    ? clamp(totalPlannedDeployPct / retainedPlannedDeployPct, 1, macroOverlay.state === 'risk-off' ? 1.8 : 2.4)
    : 1;

  return normalizedCards.map((card): InvestmentIdeaCard => {
    const optimizedTargetWeightPct = Number((((plan.optimizedWeights[card.id] ?? 0) * 100)).toFixed(2));
    const keepDeploy = card.autonomyAction === 'deploy' && retainedDeployIds.has(card.id);
    const perThemeCapPct = Math.min((themeCaps[card.themeId] ?? dynamicMaxPositionWeight) * 100, dynamicMaxPositionWeight * 100);
    const optimizedSizePct = keepDeploy
      ? clamp(
        Number((Math.abs(optimizedTargetWeightPct) * retainedBudgetScale).toFixed(2)),
        deployRetentionFloorPct,
        perThemeCapPct,
      )
      : 0;
    const autonomyAction: AutonomyAction = card.autonomyAction === 'deploy'
      ? (keepDeploy && optimizedSizePct >= deployRetentionFloorPct ? 'deploy' : 'watch')
      : card.autonomyAction;
    return {
      ...card,
      sizePct: card.autonomyAction === 'deploy'
        ? optimizedSizePct
        : card.autonomyAction === 'abstain'
          ? 0
          : Number((Math.abs(optimizedTargetWeightPct) * clamp((card.continuousConviction ?? 0) / 100, 0, 0.35)).toFixed(2)),
      autonomyAction,
      executionPlanScore: plan.objectiveScore,
      optimizedTargetWeightPct,
      autonomyReasons: Array.from(new Set([
        ...card.autonomyReasons,
        card.autonomyAction === 'deploy'
          ? `Deploy budget used=${deployWeightBudget.toFixed(2)}%.`
          : 'Capital allocation suppressed for non-deploy idea.',
        card.autonomyAction === 'deploy' && !keepDeploy
          ? 'Cluster-aware concentration control removed this marginal deploy idea from capital allocation.'
          : `Deploy concentration scale=${retainedBudgetScale.toFixed(2)}.`,
        card.autonomyAction === 'deploy'
          ? `Fractional Kelly overlay adjusted target weight to ${optimizedTargetWeightPct.toFixed(2)}%.`
          : '',
        `Deploy confidence floor=${deployConfidenceFloor.toFixed(2)}.`,
        `HRP cluster cap=${((hrpClusterCaps[deployClusterPlan.clusterByCardId.get(card.id) || ''] ?? 0) * 100).toFixed(2)}%.`,
        `MPC objective=${plan.objectiveScore}.`,
        plan.violations.slice(0, 2).join(' | '),
      ].filter(Boolean))).slice(0, 6),
    };
  });
}

function computeCorrelationAwareSizingPenalty(symbols: string[]): {
  globalPenalty: number;
  rowPenaltyBySymbol: Map<string, number>;
  summary: string[];
} {
  const uniqueSymbols = Array.from(new Set(symbols.filter(Boolean)));
  if (uniqueSymbols.length < 2) {
    return { globalPenalty: 0, rowPenaltyBySymbol: new Map(), summary: [] };
  }

  const seriesBySymbol = new Map(uniqueSymbols.map((symbol) => [symbol, buildRecentReturnSeries(symbol)] as const));
  const sampleSize = Math.min(...Array.from(seriesBySymbol.values()).map((series) => series.length));
  if (!Number.isFinite(sampleSize) || sampleSize < 8) {
    return { globalPenalty: 0, rowPenaltyBySymbol: new Map(), summary: [] };
  }

  const matrix = uniqueSymbols.map((leftSymbol) =>
    uniqueSymbols.map((rightSymbol) => {
      if (leftSymbol === rightSymbol) return 1;
      return pearsonCorrelation(
        (seriesBySymbol.get(leftSymbol) ?? []).slice(-sampleSize),
        (seriesBySymbol.get(rightSymbol) ?? []).slice(-sampleSize),
      );
    }),
  );
  const denoised = denoiseCorrelationMatrix(matrix, { sampleSize });
  const rowPenaltyBySymbol = new Map<string, number>();
  for (let row = 0; row < uniqueSymbols.length; row += 1) {
    const offDiagonal = denoised.denoisedMatrix[row]!
      .filter((_: number, column: number) => column !== row)
      .map((value: number) => Math.abs(value));
    const rowMean = average(offDiagonal);
    rowPenaltyBySymbol.set(uniqueSymbols[row]!, clamp(Number((rowMean * 0.42 + denoised.concentration.crowdingPenalty * 0.38).toFixed(4)), 0, 0.55));
  }

  return {
    globalPenalty: clamp(Number((denoised.concentration.crowdingPenalty * 0.42).toFixed(4)), 0, 0.45),
    rowPenaltyBySymbol,
    summary: denoised.summary.slice(0, 3),
  };
}

function calibrateCapitalBudget(
  cards: InvestmentIdeaCard[],
  macroOverlay: MacroRiskOverlay,
): {
  grossBudgetPct: number;
  promotedDeployIds: Set<string>;
  deployRate: number;
  candidateBreadth: number;
  confirmationMedian: number;
  confirmationSpread: number;
  readinessMedian: number;
  readinessSpread: number;
} {
  const eligibleCards = cards.filter((card) => card.confirmationState !== 'contradicted');
  if (macroOverlay.killSwitch || !eligibleCards.length) {
    return {
      grossBudgetPct: 0,
      promotedDeployIds: new Set<string>(),
      deployRate: 0,
      candidateBreadth: 0,
      confirmationMedian: 0,
      confirmationSpread: 0,
      readinessMedian: 0,
      readinessSpread: 0,
    };
  }

  const readinessRows = eligibleCards.map((card) => ({
    card,
    score: capitalReadinessScore(card),
  }));
  const confirmationValues = eligibleCards.map((card) => card.confirmationScore);
  const readinessValues = readinessRows.map((row) => row.score);
  const confirmationMedian = median(confirmationValues);
  const confirmationSpread = percentile(confirmationValues, 0.75) - percentile(confirmationValues, 0.25);
  const readinessMedian = median(readinessValues);
  const readinessSpread = percentile(readinessValues, 0.75) - percentile(readinessValues, 0.25);
  const deployRate = eligibleCards.filter((card) => card.autonomyAction === 'deploy' && card.executionGate).length / eligibleCards.length;
  const candidateBreadth = eligibleCards.filter((card) => card.executionGate && card.confirmationScore >= confirmationMedian).length / eligibleCards.length;
  const budgetBase = macroOverlay.state === 'risk-on'
    ? 30
    : macroOverlay.state === 'balanced'
      ? 20
      : 10;
  const budgetSupport = clamp(
    0.55
    + deployRate * 0.7
    + candidateBreadth * 1
    + clamp((confirmationMedian - 50) / 100, 0, 0.2)
    + clamp(confirmationSpread / 220, 0, 0.14)
    + clamp((readinessMedian - 48) / 110, 0, 0.18)
    + clamp(readinessSpread / 260, 0, 0.1)
    - (average(eligibleCards.map((card) => card.coveragePenalty)) / 100) * 0.18,
    0.35,
    1.55,
  );
  const regimeCap = macroOverlay.state === 'risk-on'
    ? 44
    : macroOverlay.state === 'balanced'
      ? 30
      : 16;
  const grossBudgetPct = clamp(Number((budgetBase * budgetSupport).toFixed(2)), 0, Math.min(macroOverlay.grossExposureCapPct, regimeCap));
  const deploymentShare = clamp(
    (macroOverlay.state === 'risk-on' ? 0.16 : macroOverlay.state === 'balanced' ? 0.12 : 0.08)
    + deployRate * 0.14
    + candidateBreadth * 0.22
    + clamp((readinessMedian - 45) / 220, 0, 0.08)
    + clamp(readinessSpread / 500, 0, 0.06),
    macroOverlay.state === 'risk-off' ? 0.08 : 0.12,
    macroOverlay.state === 'risk-on' ? 0.58 : macroOverlay.state === 'balanced' ? 0.44 : 0.26,
  );
  const targetDeployCount = clamp(
    Math.round(Math.max(
      macroOverlay.state === 'risk-off' ? 1 : 2,
      eligibleCards.length * deploymentShare * 0.78 + Math.sqrt(eligibleCards.length) * 0.2,
    )),
    macroOverlay.state === 'risk-off' ? 1 : 2,
    Math.min(eligibleCards.length, macroOverlay.state === 'risk-on' ? 9 : macroOverlay.state === 'balanced' ? 6 : 3),
  );
  const promotionCandidates = eligibleCards
    .filter((card) => card.executionGate && card.confirmationState !== 'contradicted')
    .map((card) => ({
      ...card,
      autonomyAction: 'deploy' as AutonomyAction,
    }));
  const promotionPlan = buildDeployClusterPlan(promotionCandidates, macroOverlay, grossBudgetPct);
  const promotionClusterPriority = promotionPlan.clusters.map((cluster) => cluster.id);
  const promotionRowsByCluster = new Map<string, DeployClusterCardRow[]>();
  for (const row of promotionPlan.rows.sort((left, right) => right.score - left.score || right.card.confirmationScore - left.card.confirmationScore)) {
    const bucket = promotionRowsByCluster.get(row.clusterId) || [];
    bucket.push(row);
    promotionRowsByCluster.set(row.clusterId, bucket);
  }
  const promotedDeployIds = new Set<string>();
  const promotedPerCluster = new Map<string, number>();
  let promotionCursor = 0;
  while (promotedDeployIds.size < targetDeployCount) {
    let progressed = false;
    for (const clusterId of promotionClusterPriority) {
      if (promotedDeployIds.size >= targetDeployCount) break;
      const clusterRows = promotionRowsByCluster.get(clusterId) || [];
      const limit = promotionPlan.clusters.find((cluster) => cluster.id === clusterId)?.topK ?? 1;
      const alreadyPromoted = promotedPerCluster.get(clusterId) ?? 0;
      if (alreadyPromoted >= limit) continue;
      const nextRow = clusterRows[alreadyPromoted];
      if (!nextRow) continue;
      promotedDeployIds.add(nextRow.card.id);
      promotedPerCluster.set(clusterId, alreadyPromoted + 1);
      progressed = true;
    }
    promotionCursor += 1;
    if (!progressed || promotionCursor > targetDeployCount + promotionClusterPriority.length + 3) break;
  }
  if (!promotedDeployIds.size) {
    readinessRows
      .slice()
      .sort((left, right) => right.score - left.score)
      .slice(0, targetDeployCount)
      .forEach((row) => promotedDeployIds.add(row.card.id));
  }

  return {
    grossBudgetPct,
    promotedDeployIds,
    deployRate,
    candidateBreadth,
    confirmationMedian,
    confirmationSpread,
    readinessMedian,
    readinessSpread,
  };
}

// buildCoreOrbitalExecutionPlan, estimateCoreOrbitalAlignmentScore – imported from ./shared-ranking
