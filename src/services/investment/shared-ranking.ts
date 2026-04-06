import type { InvestmentIdeaCard, InvestmentIdeaSymbol, MarketHistoryPoint } from './types';
import type { MacroRiskOverlay } from '../macro-risk-overlay';
import { clamp, average, pearsonCorrelation } from './utils';
import { estimateLaggedNormalizedMutualInformation } from '../math-models/normalized-mutual-information';
import * as S from './module-state';

// ── Functions extracted from idea-generator / portfolio-optimizer ──
// to break the circular dependency between those two modules.

export function buildRecentReturnSeries(symbol: string, maxPoints = 48): number[] {
  return S.marketHistory
    .filter((point: MarketHistoryPoint) => point.symbol === symbol && typeof point.change === 'number' && Number.isFinite(point.change))
    .slice(-maxPoints)
    .map((point: MarketHistoryPoint) => Number(point.change) || 0);
}

export function estimateMacroStressProbability(macroOverlay: MacroRiskOverlay): number {
  const base = macroOverlay.killSwitch
    ? 1
    : macroOverlay.state === 'risk-off'
      ? 0.84
      : macroOverlay.state === 'balanced'
        ? 0.46
        : 0.16;
  return clamp(Math.max(base, (Number(macroOverlay.riskGauge) || 0) / 100), 0, 1);
}

export function isCoreInstrumentSymbol(symbol: InvestmentIdeaSymbol): boolean {
  if (symbol.role === 'hedge') return false;
  return symbol.assetKind === 'etf'
    || symbol.assetKind === 'rate'
    || symbol.assetKind === 'commodity'
    || symbol.assetKind === 'fx';
}

export function summarizeInstrumentMix(symbols: InvestmentIdeaSymbol[]): {
  coreCount: number;
  orbitalCount: number;
  hedgeCount: number;
  coreShare: number;
  hasCore: boolean;
  hasOrbital: boolean;
} {
  const nonHedge = symbols.filter((symbol) => symbol.role !== 'hedge');
  const coreCount = nonHedge.filter(isCoreInstrumentSymbol).length;
  const orbitalCount = nonHedge.filter((symbol) => symbol.assetKind === 'equity').length;
  const hedgeCount = symbols.filter((symbol) => symbol.role === 'hedge').length;
  const denominator = Math.max(1, coreCount + orbitalCount);
  return {
    coreCount,
    orbitalCount,
    hedgeCount,
    coreShare: Number((coreCount / denominator).toFixed(4)),
    hasCore: coreCount > 0,
    hasOrbital: orbitalCount > 0,
  };
}

export function estimateCoreOrbitalAlignmentScore(
  benchmarkSymbol: string,
  candidateSymbol: InvestmentIdeaSymbol,
): number {
  const benchmarkSeries = buildRecentReturnSeries(benchmarkSymbol);
  const candidateSeries = buildRecentReturnSeries(candidateSymbol.symbol);
  const sampleSize = Math.min(benchmarkSeries.length, candidateSeries.length);
  if (sampleSize < 8) {
    const liquidity = clamp((Number(candidateSymbol.liquidityScore) || 58) / 100, 0.25, 1);
    const bandit = clamp((Number(candidateSymbol.banditScore) || 55) / 100, 0.2, 1);
    return Number((0.58 * liquidity + 0.42 * bandit).toFixed(4));
  }

  const benchmark = benchmarkSeries.slice(-sampleSize);
  const candidate = candidateSeries.slice(-sampleSize);
  const corr = clamp((pearsonCorrelation(benchmark, candidate) + 1) / 2, 0, 1);
  const nmi = estimateLaggedNormalizedMutualInformation(benchmark, candidate, { maxLag: 3 });
  const liquidity = clamp((Number(candidateSymbol.liquidityScore) || 58) / 100, 0.25, 1);
  const bandit = clamp((Number(candidateSymbol.banditScore) || 55) / 100, 0.2, 1);
  return Number((
    corr * 0.34
    + nmi.supportScore * 0.34
    + liquidity * 0.18
    + bandit * 0.14
  ).toFixed(4));
}

/**
 * Core-orbital execution plan builder.
 *
 * `getOnlineRanking` is injected by the caller so that this module does not
 * import portfolio-optimizer (which would re-introduce the circular dep).
 */
export function buildCoreOrbitalExecutionPlan(
  card: InvestmentIdeaCard,
  macroOverlay: MacroRiskOverlay,
  getOnlineRanking: (card: InvestmentIdeaCard, macroOverlay: MacroRiskOverlay) => {
    currentReturnPct: number;
    drift: number;
    currentHitRate: number;
  },
): {
  symbols: InvestmentIdeaSymbol[];
  reasons: string[];
  coreShare: number;
  orbitalPenalty: number;
  retainedOrbitalCount: number;
  benchmarkSymbol: string | null;
} {
  const nonHedge = card.symbols.filter((symbol) => symbol.role !== 'hedge');
  const coreSymbols = nonHedge.filter(isCoreInstrumentSymbol);
  const orbitalSymbols = nonHedge.filter((symbol) => symbol.assetKind === 'equity');
  if (!coreSymbols.length || !orbitalSymbols.length) {
    const mix = summarizeInstrumentMix(card.symbols);
    return {
      symbols: card.symbols.slice(),
      reasons: [],
      coreShare: mix.coreShare,
      orbitalPenalty: 0,
      retainedOrbitalCount: mix.orbitalCount,
      benchmarkSymbol: coreSymbols[0]?.symbol || null,
    };
  }

  const benchmarkSymbol = coreSymbols
    .slice()
    .sort((left, right) =>
      Number(right.liquidityScore || 0) - Number(left.liquidityScore || 0)
      || Number(right.banditScore || 0) - Number(left.banditScore || 0)
      || (left.role === 'primary' ? -1 : 1),
    )[0]?.symbol || coreSymbols[0]?.symbol || null;
  const online = getOnlineRanking(card, macroOverlay);
  const stressProbability = estimateMacroStressProbability(macroOverlay);
  const scoredOrbital = orbitalSymbols
    .map((symbol) => ({
      symbol,
      alignment: benchmarkSymbol ? estimateCoreOrbitalAlignmentScore(benchmarkSymbol, symbol) : 0.5,
    }))
    .sort((left, right) =>
      right.alignment - left.alignment
      || Number(right.symbol.liquidityScore || 0) - Number(left.symbol.liquidityScore || 0)
      || Number(right.symbol.banditScore || 0) - Number(left.symbol.banditScore || 0),
    );
  const averageAlignment = average(scoredOrbital.map((item) => item.alignment));
  const negativeCurrent = clamp(Math.abs(Math.min(0, online.currentReturnPct)) / 2.5, 0, 2.4);
  const negativeDrift = clamp(Math.abs(Math.min(0, online.drift)) / 1.25, 0, 2.6);
  const hitPenalty = clamp((50 - online.currentHitRate) / 18, 0, 1.4);
  const lambda = 1.05 + negativeCurrent * 0.55 + negativeDrift * 0.72 + hitPenalty * 0.35;
  const orbitalGate = clamp(
    Math.exp(-lambda * stressProbability * Math.max(0.24, 1.08 - averageAlignment)),
    0,
    1,
  );
  const hardGate =
    stressProbability >= 0.78
    || (stressProbability >= 0.6 && (online.drift <= -0.45 || online.currentReturnPct <= -0.8))
    || (stressProbability >= 0.55 && averageAlignment < 0.42);
  const maxOrbitalCount = hardGate
    ? 0
    : stressProbability >= 0.68
      ? 0
      : stressProbability >= 0.5
        ? 1
        : stressProbability >= 0.32
          ? 1
          : 2;
  const minAlignment = stressProbability >= 0.6
    ? 0.62
    : stressProbability >= 0.45
      ? 0.56
      : 0.48;
  const retainedOrbital = hardGate || orbitalGate < 0.2
    ? []
    : scoredOrbital
      .filter((item) => item.alignment >= minAlignment)
      .slice(0, maxOrbitalCount)
      .map((item) => item.symbol);
  const retainedKeys = new Set(
    [...coreSymbols, ...retainedOrbital, ...card.symbols.filter((symbol) => symbol.role === 'hedge')]
      .map((symbol) => `${symbol.symbol}:${symbol.role}`),
  );
  const filteredSymbols = card.symbols.filter((symbol) => retainedKeys.has(`${symbol.symbol}:${symbol.role}`));
  const retainedShare = orbitalSymbols.length > 0 ? retainedOrbital.length / orbitalSymbols.length : 1;
  const orbitalPenalty = Number(clamp(
    (1 - retainedShare) * 0.7
    + Math.max(0, 0.55 - averageAlignment) * 0.75
    + stressProbability * 0.18,
    0,
    1,
  ).toFixed(4));
  const reasons: string[] = [];
  if (retainedOrbital.length < orbitalSymbols.length) {
    reasons.push(
      hardGate
        ? `Stress-aware ETF-first gating removed single-name confirm legs and kept ${coreSymbols.map((symbol) => symbol.symbol).join(', ')} as the cluster core.`
        : `Core-orbital filtering retained ${retainedOrbital.length}/${orbitalSymbols.length} single-name legs behind ETF core ${coreSymbols.map((symbol) => symbol.symbol).join(', ')}.`,
    );
  }
  if (benchmarkSymbol && averageAlignment < 0.52) {
    reasons.push(`Single-name legs showed weak ETF alignment (${(averageAlignment * 100).toFixed(0)}%), so idiosyncratic risk was suppressed.`);
  }
  const filteredMix = summarizeInstrumentMix(filteredSymbols);
  return {
    symbols: filteredSymbols.length ? filteredSymbols : card.symbols.slice(),
    reasons,
    coreShare: filteredMix.coreShare,
    orbitalPenalty,
    retainedOrbitalCount: retainedOrbital.length,
    benchmarkSymbol,
  };
}
