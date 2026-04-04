import type { ClusteredEvent, MarketData } from '@/types';
import type { EventMarketTransmissionSnapshot } from '../event-market-transmission';
import type { KeywordGraphSnapshot } from '../keyword-registry';
import type { SourceCredibilityProfile } from '../source-credibility';
import type { ScheduledReport } from '../scheduled-reports';
import type { TimedFlowPoint } from '../information-flow';
import type { KnowledgeGraphRelationEvidence } from '../knowledge-graph';
import type { SelfTuningWeightProfile } from '../experiment-registry';
import type { MacroRiskOverlay } from '../macro-risk-overlay';
import type { ReplayAdaptationSnapshot, CurrentThemePerformanceMetric } from '../replay-adaptation';
import type { CoverageLedgerSnapshot } from '../coverage-ledger';
import type { AutonomyAction, ConfidenceBand } from '../autonomy-constraints';
import type { IdeaAttributionBreakdown } from '../decision-attribution';
import { computeHawkesIntensity } from '../math-models/hawkes-process';
import { estimateLaggedNormalizedMutualInformation } from '../math-models/normalized-mutual-information';
import { estimateTransferEntropy } from '../math-models/transfer-entropy';
import { scoreBanditArm } from '../math-models/contextual-bandit';
import { regimeMultiplierForTheme } from '../math-models/regime-model';
import { estimateDirectionalFlowSummary } from '../information-flow';
import { inferKnowledgeGraphSupport } from '../knowledge-graph';
import { assessCrossCorroboration, assessExecutionReality, assessRecency, calibrateDecision } from '../autonomy-constraints';
import { getCoveragePenaltyForTheme } from '../coverage-ledger';
import { buildIdeaAttribution } from '../decision-attribution';
import { getReplayThemeProfileFromSnapshot, parseThemeTimeframeCandidates, formatLearnedTimeframe, getCurrentThemePerformanceFromSnapshot } from '../replay-adaptation';
import { assessGraphSupport } from '../graph-propagation';
import { computeOnlineRankingAdjustment, computeThemeStabilityAdjustment } from './portfolio-optimizer';

import type {
  EventCandidate, AdaptiveEventPolicy, ThemeAssetDefinition, InvestmentThemeDefinition,
  DirectAssetMapping, InvestmentIdeaCard, InvestmentIdeaSymbol, InvestmentHistoryEntry,
  HistoricalAnalog, SectorSensitivityRow, EventBacktestRow, TrackedIdeaState,
  FalsePositiveStats, ConvictionFeatureSnapshot,
  MappingPerformanceStats, MarketHistoryPoint,
  ConfirmationState, InvestmentDirection, InvestmentAssetKind,
  UniverseCoverageGap, AutonomyControlState, InvestmentIntelligenceContext, InvestmentBias, ThemeAdmissionPolicy,
} from './types';
import type { DatasetDiscoveryThemeInput } from '../dataset-discovery';
import {
  ARCHIVE_RE, SPORTS_RE, LOW_SIGNAL_RE, UNIVERSE_ASSET_CATALOG,
  MAX_MAPPINGS, MAX_IDEAS, MAX_ANALOGS, MAX_HISTORY,
} from './constants';
import * as S from './module-state';
import {
  clamp, normalize, normalizeMatchable, matchesThemeTrigger,
  percentile, average, median,
  titleId, uniqueId, nowIso,
  pearsonCorrelation,
} from './utils';
import {
  buildThemeMatchDetails,
  findMatchingThemes,
  getThemeRule,
  resolveThemePolicy,
  selectThemeAssetsForCandidate,
} from './theme-registry';
import { blendLearnedConviction } from './conviction-scorer';
import { chooseSizingRule, applyAtrAdjustedRule } from './position-sizer';
import { getMappingStats, getBanditState } from './idea-tracker';
import { findSourceCredibility, inferRegion, reasonCountsFromMap, extractGraphTerms } from './normalizers';
import { predictHitProbability } from './adaptive-params/weight-learner.js';
import type { MetaWeights } from './adaptive-params/weight-learner.js';
// ensemble-predictor removed — moved to legacy/backtest branch
import type { KNNPrediction } from './adaptive-params/embedding-knn.js';
import type { TransmissionProxy } from './adaptive-params/transmission-proxy.js';
import { getSignificantPatterns } from '../pattern-discovery';

type ThemeRule = InvestmentThemeDefinition;

type MetaWeightsLoadStatus = 'ready' | 'missing' | 'invalid' | 'unsupported';

interface MetaWeightsLoadState {
  status: MetaWeightsLoadStatus;
  weights: MetaWeights | null;
  path: string | null;
  error: string | null;
}

function isNodeRuntime(): boolean {
  return typeof process !== 'undefined' && Boolean(process.versions?.node);
}

function isMetaWeights(weights: unknown): weights is MetaWeights {
  if (!weights || typeof weights !== 'object') return false;
  const candidate = weights as MetaWeights;
  return Array.isArray(candidate.featureNames)
    && candidate.featureNames.length === 11
    && Array.isArray(candidate.weights)
    && candidate.weights.length === 11
    && candidate.featureNames.includes('confidence')
    && candidate.featureNames.includes('driftPenalty');
}

function buildMetaWeightsLoadState(): MetaWeightsLoadState {
  if (!isNodeRuntime()) {
    return {
      status: 'unsupported',
      weights: null,
      path: null,
      error: 'Meta weights loading is only available in a Node-capable runtime.',
    };
  }

  const configuredPath = String(
    process.env.WM_META_WEIGHTS_PATH
    || process.env.LEARNED_META_WEIGHTS_PATH
    || 'data/learned_meta_weights.json',
  ).trim();

  try {
    const nodeRequire = (new Function(
      'return typeof require === "function" ? require : null;',
    )() as ((specifier: string) => {
      resolveWeightsPath: (inputPath: string) => string;
      loadWeightsSync: (pathLike: string) => unknown;
    }) | null);

    if (!nodeRequire) {
      return {
        status: 'unsupported',
        weights: null,
        path: configuredPath,
        error: 'Meta weights loading requires Node require().',
      };
    }

    let nodeLoader:
      | {
        resolveWeightsPath: (inputPath: string) => string;
        loadWeightsSync: (pathLike: string) => unknown;
      }
      | null = null;
    let lastError: unknown = null;
    for (const specifier of [
      './adaptive-params/weight-learner.node.js',
      './adaptive-params/weight-learner.node.ts',
    ]) {
      try {
        nodeLoader = nodeRequire(specifier);
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!nodeLoader) {
      throw lastError instanceof Error
        ? lastError
        : new Error('Unable to load node weight loader.');
    }

    const resolvedPath = nodeLoader.resolveWeightsPath(configuredPath);
    const loaded = nodeLoader.loadWeightsSync(resolvedPath);
    if (!isMetaWeights(loaded)) {
      return {
        status: 'invalid',
        weights: null,
        path: resolvedPath,
        error: `Unexpected meta weight shape at ${resolvedPath}.`,
      };
    }

    return {
      status: 'ready',
      weights: loaded,
      path: resolvedPath,
      error: null,
    };
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    return {
      status: /ENOENT|no such file/i.test(message) ? 'missing' : 'invalid',
      weights: null,
      path: configuredPath,
      error: message,
    };
  }
}

const metaWeightsState = buildMetaWeightsLoadState();

export function getMetaWeightsLoadState(): MetaWeightsLoadState {
  return {
    status: metaWeightsState.status,
    weights: metaWeightsState.weights
      ? {
        featureNames: [...metaWeightsState.weights.featureNames],
        weights: [...metaWeightsState.weights.weights],
        bias: metaWeightsState.weights.bias,
      }
      : null,
    path: metaWeightsState.path,
    error: metaWeightsState.error,
  };
}

// ============================================================================
// UTILITY: Hawkes Intensity Scoring
// ============================================================================

function scoreEventIntensity(args: {
  text: string;
  sourceCount: number;
  isAlert: boolean;
  relationConfidence?: number | null;
  clusterConfidence?: number | null;
  marketStressPrior?: number | null;
}): number {
  const normalizedText = normalizeMatchable(args.text);
  const evidenceConfidence = Math.max(args.relationConfidence ?? 0, args.clusterConfidence ?? 0);
  const stressPrior = clamp(args.marketStressPrior ?? 0, 0, 1);
  if (!normalizedText) {
    return clamp(
      Math.round((args.isAlert ? 44 : 24) + evidenceConfidence * 0.22 + stressPrior * 20 + args.sourceCount * 5),
      18,
      96,
    );
  }
  const cueHits = [
    'attack',
    'attacked',
    'assault',
    'assaulted',
    'offensive',
    'shell',
    'shelled',
    'artillery',
    'missile',
    'rocket',
    'drone',
    'explosion',
    'strike',
    'clash',
    'clashed',
    'repelled',
    'killed',
    'wounded',
    'civilian',
    'outage',
    'cyber',
    'sanction',
    'export control',
    'port',
    'pipeline',
    'shipping',
  ].filter((cue) => matchesThemeTrigger(normalizedText, cue)).length;
  return clamp(
    Math.round(
      24
      + cueHits * 6
      + args.sourceCount * 7
      + (args.isAlert ? 10 : 0)
      + evidenceConfidence * 0.24
      + stressPrior * 18,
    ),
    18,
    96,
  );
}

function computeMarketStressPrior(args: {
  clusterConfidence: number;
  sourceCount: number;
  isAlert: boolean;
  corroborationQuality: number;
  sourceDiversity: number;
  matchedSymbolCount: number;
  reasonCount: number;
}): number {
  return clamp(
    Number((
      args.clusterConfidence / 100 * 0.34
      + Math.min(0.18, Math.max(0, args.sourceCount - 1) * 0.05)
      + (args.isAlert ? 0.12 : 0)
      + Math.max(0, args.corroborationQuality - 52) / 180
      + Math.max(0, args.sourceDiversity - 40) / 320
      + Math.min(0.08, args.matchedSymbolCount * 0.02)
      + Math.min(0.06, args.reasonCount * 0.015)
    ).toFixed(4)),
    0,
    0.78,
  );
}

function computeAdaptiveEventPolicy(args: {
  clusters: ClusteredEvent[];
  sourceCredibility: SourceCredibilityProfile[];
}): AdaptiveEventPolicy {
  const sourceCounts = args.clusters.map((cluster) => cluster.sourceCount).filter((value) => Number.isFinite(value));
  const alertRate = args.clusters.length > 0
    ? args.clusters.filter((cluster) => cluster.isAlert).length / args.clusters.length
    : 0;
  const articleCounts = args.sourceCredibility.map((profile) => Math.max(0, profile.articleCount || 0));
  const totalArticles = articleCounts.reduce((sum, value) => sum + value, 0);
  const sourceConcentration = totalArticles > 0
    ? Math.max(...articleCounts, 0) / totalArticles
    : 1;
  const lowerCredibility = percentile(args.sourceCredibility.map((profile) => profile.credibilityScore || 0), 0.35) || 52;
  const lowerFeedHealth = percentile(args.sourceCredibility.map((profile) => profile.feedHealthScore || 0), 0.35) || 58;
  const medianSourceCount = percentile(sourceCounts, 0.5) || 1;

  return {
    minSingleSourceQuality: clamp(
      Math.round(
        44
        + sourceConcentration * 12
        + Math.max(0, 52 - lowerCredibility) * 0.22
        + Math.max(0, 58 - lowerFeedHealth) * 0.18
        - alertRate * 8
        - Math.max(0, medianSourceCount - 1) * 4,
      ),
      32,
      62,
    ),
    stressBypassFloor: clamp(
      Number((0.42 + sourceConcentration * 0.08 - alertRate * 0.08).toFixed(2)),
      0.28,
      0.62,
    ),
    intensityBypassFloor: clamp(
      Math.round(
        64
        + sourceConcentration * 8
        - alertRate * 10
        - Math.max(0, medianSourceCount - 1) * 3,
      ),
      50,
      82,
    ),
  };
}

function rankIdeaSymbolRole(role: InvestmentIdeaSymbol['role']): number {
  if (role === 'primary') return 3;
  if (role === 'confirm') return 2;
  return 1;
}

function scoreIdeaSymbolChoice(symbol: InvestmentIdeaSymbol): number {
  return (
    rankIdeaSymbolRole(symbol.role) * 100
    + (typeof symbol.realityScore === 'number' ? symbol.realityScore : 0)
    + (typeof symbol.liquidityScore === 'number' ? symbol.liquidityScore * 0.5 : 0)
    + (typeof symbol.banditScore === 'number' ? symbol.banditScore * 10 : 0)
  );
}

function dedupeIdeaSymbols(symbols: InvestmentIdeaSymbol[]): InvestmentIdeaSymbol[] {
  const bestByKey = new Map<string, InvestmentIdeaSymbol>();
  for (const symbol of symbols) {
    const key = `${symbol.symbol}::${symbol.direction}`;
    const existing = bestByKey.get(key);
    if (!existing || scoreIdeaSymbolChoice(symbol) > scoreIdeaSymbolChoice(existing)) {
      bestByKey.set(key, symbol);
    }
  }
  return Array.from(bestByKey.values()).sort(
    (left, right) =>
      rankIdeaSymbolRole(right.role) - rankIdeaSymbolRole(left.role)
      || (typeof right.banditScore === 'number' ? right.banditScore : -Infinity) - (typeof left.banditScore === 'number' ? left.banditScore : -Infinity)
      || (typeof right.realityScore === 'number' ? right.realityScore : 0) - (typeof left.realityScore === 'number' ? left.realityScore : 0),
  );
}

// ============================================================================
// UTILITY: Horizon Learning Resolution & Scaling
// ============================================================================

function resolveIdeaCardHorizonLearning(
  themeId: string,
  fallbackTimeframe: string,
  replayAdaptation: ReplayAdaptationSnapshot | null,
): {
  timeframe: string;
  preferredHorizonHours: number | null;
  horizonCandidatesHours: number[];
  horizonLearningConfidence: number | null;
  timeframeSource: 'theme-default' | 'replay-learned';
} {
  const learned = getReplayThemeProfileFromSnapshot(replayAdaptation, themeId);
  if (learned) {
    return {
      timeframe: learned.timeframe,
      preferredHorizonHours: learned.preferredHorizonHours,
      horizonCandidatesHours: learned.candidateHorizonHours.slice(),
      horizonLearningConfidence: learned.confidence,
      timeframeSource: 'replay-learned',
    };
  }

  const fallbackCandidates = parseThemeTimeframeCandidates(fallbackTimeframe);
  const preferredHorizonHours = fallbackCandidates.length > 0
    ? fallbackCandidates[Math.floor(fallbackCandidates.length / 2)] || fallbackCandidates[0]!
    : null;
  return {
    timeframe: fallbackTimeframe || '1d-7d',
    preferredHorizonHours,
    horizonCandidatesHours: fallbackCandidates,
    horizonLearningConfidence: null,
    timeframeSource: 'theme-default',
  };
}

function scaleHorizonLearning(
  learning: ReturnType<typeof resolveIdeaCardHorizonLearning>,
  multiplier: number,
): ReturnType<typeof resolveIdeaCardHorizonLearning> {
  const scaledCandidates = Array.from(new Set(
    (learning.horizonCandidatesHours || [])
      .map((value) => Math.max(1, Math.round(value * multiplier)))
      .filter(Boolean),
  )).sort((a, b) => a - b);
  const scaledPreferred = typeof learning.preferredHorizonHours === 'number'
    ? Math.max(48, Math.round(learning.preferredHorizonHours * multiplier))
    : null;
  const prunedCandidates = scaledPreferred && multiplier < 0.95
    ? scaledCandidates.filter((value, index) => index === 0 || value <= scaledPreferred * 1.35)
    : scaledCandidates;
  const scaledTimeframe = scaledCandidates.length > 0
    ? formatLearnedTimeframe(prunedCandidates)
    : learning.timeframe;
  return {
    ...learning,
    timeframe: scaledTimeframe,
    preferredHorizonHours: scaledPreferred,
    horizonCandidatesHours: prunedCandidates,
  };
}

function medianPositiveSpacingHours(hours: number[]): number {
  const sorted = Array.from(new Set(
    (hours || [])
      .map((value) => Math.max(1, Math.round(Number(value) || 0)))
      .filter(Boolean),
  )).sort((a, b) => a - b);
  if (sorted.length <= 1) return sorted[0] || 24;
  const spacings: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const spacing = sorted[index]! - sorted[index - 1]!;
    if (spacing > 0) spacings.push(spacing);
  }
  return Math.max(1, Math.round(median(spacings.length > 0 ? spacings : sorted)));
}

// ============================================================================
// UTILITY: Regime-Conditional Half-Life Policy & Decay
// ============================================================================

function estimateRegimeConditionalHalfLifePolicy(args: {
  learning: ReturnType<typeof resolveIdeaCardHorizonLearning>;
  replayProfile: ReturnType<typeof getReplayThemeProfileFromSnapshot>;
  currentPerformance: ReturnType<typeof getCurrentThemePerformanceFromSnapshot>;
  referenceTimestamp: string;
  macroOverlay: MacroRiskOverlay;
  coveragePenalty?: number;
  marketConfirmation?: number;
}): {
  rho: number | null;
  halfLifeHours: number | null;
  multiplier: number;
} {
  const preferredHours = args.learning.preferredHorizonHours
    ?? args.learning.horizonCandidatesHours[0]
    ?? null;
  if (!(typeof preferredHours === 'number' && Number.isFinite(preferredHours) && preferredHours > 0)) {
    return { rho: null, halfLifeHours: null, multiplier: 1 };
  }

  const currentPerformance = args.currentPerformance;
  const replayProfile = args.replayProfile;
  const sampleCount = currentPerformance
    ? Math.max(0, Number(currentPerformance.activeCount) || 0) + Math.max(0, Number(currentPerformance.closedCount) || 0)
    : 0;
  const sampleConfidence = clamp(Math.log1p(sampleCount) / Math.log(12), 0, 1);
  const ageHours = currentPerformance
    ? Math.abs(asTs(args.referenceTimestamp) - asTs(currentPerformance.updatedAt)) / 3_600_000
    : 24 * 30;
  const freshness = clamp(1 - ageHours / (24 * 14), 0.2, 1);
  const replayReliability = clamp((replayProfile?.confirmationReliability ?? 52) / 100, 0, 1);
  const replayUtility = clamp(((replayProfile?.coverageAdjustedUtility ?? replayProfile?.utilityScore ?? 0) + 12) / 28, 0, 1);
  const currentHitRate = currentPerformance?.hitRate ?? replayProfile?.hitRate ?? 50;
  const currentReturnPct = currentPerformance?.avgReturnPct ?? replayProfile?.costAdjustedAvgReturnPct ?? 0;
  const currentVsReplayDrift = Math.max(0, -(replayProfile?.currentVsReplayDrift ?? 0));
  const coverageSupport = clamp(1 - (Number(args.coveragePenalty) || 0) / 120, 0.2, 1);
  const marketSupport = clamp((Number(args.marketConfirmation) || 50) / 100, 0.18, 0.98);
  const regimePenalty = args.macroOverlay.killSwitch
    ? 0.24
    : args.macroOverlay.state === 'risk-off'
      ? 0.14
      : args.macroOverlay.state === 'balanced'
        ? 0.06
        : 0;
  const rho = clamp(
    0.44
    + replayReliability * 0.12
    + replayUtility * 0.05
    + sampleConfidence * 0.06
    + freshness * 0.04
    + coverageSupport * 0.04
    + marketSupport * 0.04
    + clamp((currentHitRate - 50) / 100, -0.26, 0.08)
    + clamp(currentReturnPct / 20, -0.28, 0.06)
    - clamp(currentVsReplayDrift / 6, 0, 0.4)
    - regimePenalty,
    0.18,
    0.9,
  );
  const baseIntervalHours = medianPositiveSpacingHours([
    preferredHours,
    ...(replayProfile?.candidateHorizonHours || []),
    ...(args.learning.horizonCandidatesHours || []),
  ]);
  const rawHalfLifeHours = baseIntervalHours * (Math.log(0.5) / Math.log(rho));
  const lossPenalty = currentReturnPct < 0 ? clamp(Math.abs(currentReturnPct) / 3.1, 0, 0.72) : 0;
  const hitPenalty = currentHitRate < 50 ? clamp((50 - currentHitRate) / 18, 0, 0.6) : 0;
  const driftPenalty = clamp(currentVsReplayDrift / 3.2, 0, 0.55);
  const halfLifeHours = clamp(
    rawHalfLifeHours * (1 - lossPenalty * 0.68 - hitPenalty * 0.58 - driftPenalty * 0.52),
    Math.min(baseIntervalHours, preferredHours * 0.35),
    Math.max(baseIntervalHours * 1.6, preferredHours * 0.72),
  );
  const multiplier = clamp(halfLifeHours / preferredHours, 0.12, 1);
  return {
    rho: Number(rho.toFixed(4)),
    halfLifeHours: Number(halfLifeHours.toFixed(0)),
    multiplier: Number(multiplier.toFixed(4)),
  };
}

function applyHalfLifePolicyToLearning(
  learning: ReturnType<typeof resolveIdeaCardHorizonLearning>,
  policy: ReturnType<typeof estimateRegimeConditionalHalfLifePolicy>,
): ReturnType<typeof resolveIdeaCardHorizonLearning> {
  if (!(policy.multiplier > 0) || Math.abs(policy.multiplier - 1) < 0.03) {
    return learning;
  }
  const preferredHours = learning.preferredHorizonHours
    ?? learning.horizonCandidatesHours[0]
    ?? null;
  if (!(typeof preferredHours === 'number' && Number.isFinite(preferredHours) && preferredHours > 0)) {
    return learning;
  }
  const halfLifeHours = Math.max(1, Math.round(policy.halfLifeHours || preferredHours));
  const contractedCandidates = Array.from(new Set(
    (learning.horizonCandidatesHours || [])
      .map((value) => Math.max(1, Math.round(Math.min(value, halfLifeHours))))
      .filter(Boolean),
  )).sort((a, b) => a - b);
  const nextCandidates = contractedCandidates.length > 0
    ? contractedCandidates
    : [Math.max(1, Math.round(halfLifeHours))];
  const nextPreferred = Math.min(
    Math.max(1, Math.round(preferredHours * policy.multiplier)),
    Math.max(...nextCandidates),
  );
  return {
    ...learning,
    timeframe: formatLearnedTimeframe(nextCandidates),
    preferredHorizonHours: nextPreferred,
    horizonCandidatesHours: nextCandidates,
  };
}

function shouldRejectSingleSourceLowCredibility(args: {
  cluster: ClusteredEvent;
  profile: SourceCredibilityProfile | null;
  credibility: number;
  corroboration: number;
  corroborationQuality: number;
  marketStress: number;
  eventIntensity: number;
  policy: AdaptiveEventPolicy;
}): boolean {
  const {
    cluster,
    profile,
    credibility,
    corroboration,
    corroborationQuality,
    marketStress,
    eventIntensity,
    policy,
  } = args;
  if (cluster.sourceCount > 1 || cluster.isAlert || marketStress >= policy.stressBypassFloor) {
    return false;
  }
  const clusterConfidence = clamp(cluster.relations?.confidenceScore ?? 0, 0, 100);
  const articleCount = Math.max(profile?.articleCount ?? 0, cluster.allItems.length);
  const feedHealthScore = profile?.feedHealthScore ?? 0;
  const truthAgreementScore = profile?.truthAgreementScore ?? 0;
  const articleDepth = Math.min(18, Math.log2(articleCount + 1) * 6);
  const qualityScore = clamp(
    Math.round(
      credibility * 0.24
      + corroboration * 0.16
      + corroborationQuality * 0.22
      + feedHealthScore * 0.12
      + truthAgreementScore * 0.1
      + eventIntensity * 0.12
      + clusterConfidence * 0.18
      + articleDepth
      + marketStress * 14,
    ),
    0,
    100,
  );
  if (clusterConfidence >= Math.max(policy.minSingleSourceQuality + 6, 78)) {
    return false;
  }
  if (eventIntensity >= policy.intensityBypassFloor && qualityScore >= policy.minSingleSourceQuality - 8) {
    return false;
  }
  // In historical/replay contexts, market stress is typically 0 (no transmission data),
  // so allow events through when stress data is absent.
  if (marketStress === 0 && eventIntensity >= 20) {
    return false;
  }
  return qualityScore < policy.minSingleSourceQuality;
}

// ============================================================================
// UTILITY: Report & Event History Parsing
// ============================================================================

export function parseReportHistory(reports: ScheduledReport[]): InvestmentHistoryEntry[] {
  return reports.map((report) => {
    const summary = String(report.summary || '');
    const themeMatch = summary.match(/Dominant themes:\s*([^.]*)\./i);
    const themes = (themeMatch?.[1] || '')
      .split(',')
      .map((item) => normalize(item))
      .filter(Boolean)
      .slice(0, 6);

    const symbolMoves: Array<{ symbol: string; move: number }> = [];
    const symbolRe = /([A-Z^][A-Z0-9=.-]{1,15})\s*([+-]\d+(?:\.\d+)?)%/g;
    for (const match of summary.matchAll(symbolRe)) {
      const symbol = String(match[1] || '').trim();
      const move = Number(match[2]);
      if (symbol && Number.isFinite(move)) {
        symbolMoves.push({ symbol, move });
      }
    }

    const avgMovePct = average(symbolMoves.map((item) => item.move));
    const bestMovePct = symbolMoves.length > 0
      ? Math.max(...symbolMoves.map((item) => Math.abs(item.move)))
      : 0;

    return {
      id: `report-${report.id}`,
      timestamp: report.generatedAt,
      label: report.title,
      themes,
      regions: ['Global'],
      symbols: symbolMoves.map((item) => item.symbol).slice(0, 6),
      avgMovePct,
      bestMovePct,
      conviction: report.consensusMode === 'multi-agent' ? 72 : 64,
      falsePositiveRisk: report.rebuttalSummary ? 32 : 46,
      direction: avgMovePct >= 0 ? 'long' : 'short',
      summary,
    };
  });
}

function buildAftershockMap(clusters: ClusteredEvent[]): Map<string, number> {
  const sorted = clusters
    .slice(0, 72)
    .slice()
    .sort((a, b) => Date.parse(a.lastUpdated?.toString?.() || '') - Date.parse(b.lastUpdated?.toString?.() || ''));
  const map = new Map<string, number>();
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index]!;
    const currentTokens = Array.from(new Set(normalize(current.primaryTitle).split(' ').filter((token) => token.length >= 4))).slice(0, 10);
    const currentRegion = inferRegion(normalize([current.primaryTitle, current.primarySource, ...(current.relations?.evidence || [])].join(' ')));
    const points = sorted.slice(0, index).flatMap((candidate) => {
      const region = inferRegion(normalize([candidate.primaryTitle, candidate.primarySource, ...(candidate.relations?.evidence || [])].join(' ')));
      const candidateTokens = Array.from(new Set(normalize(candidate.primaryTitle).split(' ').filter((token) => token.length >= 4))).slice(0, 10);
      const overlap = scoreArrayOverlap(currentTokens, candidateTokens);
      if (region !== currentRegion && overlap < 2) return [];
      const text = normalize([candidate.primaryTitle, candidate.primarySource, ...(candidate.relations?.evidence || [])].join(' '));
      const isInhibitory = /\b(ceasefire|truce|agreement|deal|talks|negotiation|peace|de-escalat|reopen|resume)\b/.test(text);
      return [{
        timestamp: candidate.lastUpdated,
        weight: (candidate.isAlert ? 1.45 : 1) + candidate.sourceCount * 0.08 + overlap * 0.14,
        kind: isInhibitory ? 'inhibit' as const : 'excite' as const,
      }];
    });
    const hawkes = computeHawkesIntensity(points, {
      now: current.lastUpdated,
      alpha: 0.82,
      betaHours: 20,
      inhibitionAlpha: 0.74,
      inhibitionBetaHours: 12,
      baseline: current.isAlert ? 0.22 : 0.14,
      scale: 2.6,
      fitFromData: true,
    });
    map.set(current.id || titleId(current.primaryTitle), hawkes.normalized);
  }
  return map;
}

function scoreArrayOverlap(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  let count = 0;
  for (const token of left) {
    if (rightSet.has(token)) count += 1;
  }
  return count;
}

export function buildEventCandidates(args: {
  clusters: ClusteredEvent[];
  transmission: EventMarketTransmissionSnapshot | null;
  sourceCredibility: SourceCredibilityProfile[];
}): { kept: EventCandidate[]; falsePositive: FalsePositiveStats } {
  const credibilityMap = new Map(args.sourceCredibility.map((profile) => [normalize(profile.source), profile]));
  const transmissionByTitle = new Map<string, { stress: number; symbols: string[]; reasons: string[] }>();
  const regime = args.transmission?.regime ?? null;
  const aftershockByCluster = buildAftershockMap(args.clusters);
  const adaptiveEventPolicy = computeAdaptiveEventPolicy({
    clusters: args.clusters,
    sourceCredibility: args.sourceCredibility,
  });

  for (const edge of args.transmission?.edges || []) {
    const key = normalize(edge.eventTitle);
    const bucket = transmissionByTitle.get(key) || { stress: 0, symbols: [], reasons: [] };
    bucket.stress = Math.max(bucket.stress, edge.strength / 100);
    if (!bucket.symbols.includes(edge.marketSymbol)) bucket.symbols.push(edge.marketSymbol);
    if (!bucket.reasons.includes(edge.reason)) bucket.reasons.push(edge.reason);
    transmissionByTitle.set(key, bucket);
  }

  const reasonMap = new Map<string, number>();
  const kept: EventCandidate[] = [];
  let screened = 0;
  let rejected = 0;

  for (const cluster of args.clusters.slice(0, 72)) {
    const title = String(cluster.primaryTitle || '').trim();
    if (!title) continue;
    screened += 1;
    const text = normalize([
      cluster.primaryTitle,
      cluster.primarySource,
      ...(cluster.relations?.evidence || []),
      cluster.threat?.level || '',
    ].join(' '));

    const profile = findSourceCredibility(credibilityMap, cluster.primarySource || '');
    const credibility = profile?.credibilityScore ?? 55;
    const corroboration = profile?.corroborationScore ?? Math.min(88, 22 + cluster.sourceCount * 11);
    const clusterConfidence = clamp(Number(cluster.relations?.confidenceScore ?? 0), 0, 100);
    const corroborationAssessment = assessCrossCorroboration({
      primaryTitle: title,
      titles: cluster.allItems.map((item) => item.title),
      sources: [
        cluster.primarySource || '',
        ...cluster.allItems.map((item) => item.source),
        ...cluster.topSources.map((item) => item.name),
      ],
      baseCredibility: credibility,
      baseCorroboration: corroboration,
      feedHealthScore: profile?.feedHealthScore ?? null,
      truthAgreementScore: profile?.truthAgreementScore ?? null,
      relationConfidence: cluster.relations?.confidenceScore ?? null,
    });
    const transmissionInfo = transmissionByTitle.get(normalize(title));
    const rawTransmissionStress = transmissionInfo?.stress ?? null;
    const marketStressPrior = computeMarketStressPrior({
      clusterConfidence,
      sourceCount: cluster.sourceCount,
      isAlert: cluster.isAlert,
      corroborationQuality: corroborationAssessment.corroborationQuality,
      sourceDiversity: corroborationAssessment.sourceDiversity,
      matchedSymbolCount: transmissionInfo?.symbols.length ?? 0,
      reasonCount: (transmissionInfo?.reasons.length ?? 0) + corroborationAssessment.notes.length,
    });
    const transmissionStress = rawTransmissionStress != null ? clamp(rawTransmissionStress, 0, 1) : null;
    const marketStress = transmissionStress ?? marketStressPrior;
    const eventIntensity = scoreEventIntensity({
      text,
      sourceCount: cluster.sourceCount,
      isAlert: cluster.isAlert,
      relationConfidence: cluster.relations?.confidenceScore ?? null,
      clusterConfidence,
      marketStressPrior,
    });
    const aftershockIntensity = aftershockByCluster.get(cluster.id || titleId(title)) ?? 0;

    const rejectReason = (() => {
      if (ARCHIVE_RE.test(title)) return 'archive-or-historical';
      if (SPORTS_RE.test(title) || SPORTS_RE.test(text)) return 'sports-or-entertainment';
      if (LOW_SIGNAL_RE.test(text) && !cluster.isAlert && marketStress > 0) return 'routine-low-signal';
      if (marketStress > 0 && shouldRejectSingleSourceLowCredibility({
        cluster,
        profile,
        credibility,
        corroboration,
        corroborationQuality: corroborationAssessment.corroborationQuality,
        marketStress,
        eventIntensity,
        policy: adaptiveEventPolicy,
      })) return 'single-source-low-credibility';
      return null;
    })();

    if (rejectReason) {
      rejected += 1;
      reasonMap.set(rejectReason, (reasonMap.get(rejectReason) || 0) + 1);
      continue;
    }

    kept.push({
      id: cluster.id || titleId(title),
      title,
      source: cluster.primarySource || 'cluster',
      region: inferRegion(text),
      text,
      sourceCount: cluster.sourceCount,
      isAlert: cluster.isAlert,
      eventIntensity,
      credibility,
      corroboration,
      sourceDiversity: corroborationAssessment.sourceDiversity,
      corroborationQuality: corroborationAssessment.corroborationQuality,
      clusterConfidence,
      contradictionPenalty: corroborationAssessment.contradictionPenalty,
      rumorPenalty: corroborationAssessment.rumorPenalty,
      graphTerms: extractGraphTerms(text, [
        ...transmissionInfo?.reasons.slice(0, 3) ?? [],
        ...corroborationAssessment.notes,
      ]),
      marketStress,
      marketStressPrior,
      transmissionStress,
      aftershockIntensity,
      regimeId: regime?.id ?? null,
      regimeConfidence: regime?.confidence ?? 0,
      matchedSymbols: transmissionInfo?.symbols.slice(0, 6) ?? [],
      reasons: [
        ...(transmissionInfo?.reasons.slice(0, 3) ?? []),
        `EventIntensity=${eventIntensity}`,
        `ClusterConfidence=${clusterConfidence.toFixed(1)}`,
        `StressPrior=${marketStressPrior.toFixed(2)}`,
        ...(transmissionStress != null ? [`TransmissionStress=${transmissionStress.toFixed(2)}`] : []),
        ...corroborationAssessment.notes,
      ].slice(0, 5),
    });
  }

  if (kept.length === 0 && screened > 0) {
    console.warn(`[buildEventCandidates] screened=${screened} rejected=${rejected} kept=0 reasons=${JSON.stringify(Object.fromEntries(reasonMap))}`);
  }

  // --- Pattern Discovery: add candidates from discovered correlations ---
  const discoveredPatterns = getSignificantPatterns(3, 1.2);
  for (const pattern of discoveredPatterns.slice(0, 5)) {
    kept.push({
      id: `discovered::${pattern.id}`,
      title: `Discovered: ${pattern.clusterFingerprint} → ${pattern.symbol}`,
      source: 'pattern-discovery',
      region: '',
      text: `discovered pattern ${pattern.clusterFingerprint} ${pattern.symbol} ${pattern.direction}`,
      sourceCount: pattern.sampleCount,
      isAlert: false,
      eventIntensity: Math.min(80, 40 + pattern.sampleCount * 5),
      credibility: 60 + Math.min(20, pattern.tStat * 5),
      corroboration: pattern.sampleCount * 10,
      sourceDiversity: 1,
      corroborationQuality: 50 + pattern.winRate * 30,
      clusterConfidence: clamp(55 + pattern.sampleCount * 2.5 + pattern.winRate * 20, 40, 90),
      contradictionPenalty: 0,
      rumorPenalty: 0,
      graphTerms: [],
      marketStress: 0,
      marketStressPrior: 0,
      transmissionStress: null,
      aftershockIntensity: 0,
      regimeId: null,
      regimeConfidence: 0,
      matchedSymbols: [pattern.symbol],
      reasons: [`t-stat=${pattern.tStat.toFixed(2)}`, `n=${pattern.sampleCount}`, `win=${(pattern.winRate * 100).toFixed(0)}%`],
    });
  }

  return {
    kept,
    falsePositive: {
      screened,
      rejected,
      kept: kept.length,
      reasons: reasonCountsFromMap(reasonMap),
    },
  };
}

// ============================================================================
// UTILITY: Market Data Mapping & Helper Functions
// ============================================================================

function marketMoveMap(markets: MarketData[]): Map<string, MarketData> {
  const map = new Map<string, MarketData>();
  for (const market of markets) {
    if (market.symbol) map.set(market.symbol, market);
  }
  return map;
}

// ============================================================================
// UTILITY: Timestamp & Time Helpers
// ============================================================================

// ============================================================================
// UTILITY: Missing Helper Functions (referenced but not yet defined)
// ============================================================================

function asTs(iso: string): number {
  return Date.parse(iso);
}

// ============================================================================
// CONTEXT: Bandit & Series Building
// ============================================================================

export function buildBanditContext(args: {
  credibility: number;
  corroboration: number;
  marketStress: number;
  aftershockIntensity: number;
  regimeMultiplier: number;
  transferEntropy: number;
  posteriorWinRate: number;
  emaReturnPct: number;
}): number[] {
  return [
    Number((args.credibility / 100).toFixed(4)),
    Number((args.corroboration / 100).toFixed(4)),
    Number(clamp(args.marketStress, 0, 1).toFixed(4)),
    Number(clamp(args.aftershockIntensity, 0, 1).toFixed(4)),
    Number(clamp((args.regimeMultiplier - 0.75) / 0.75, 0, 1.5).toFixed(4)),
    Number(clamp(args.transferEntropy, 0, 1).toFixed(4)),
    Number((args.posteriorWinRate / 100).toFixed(4)),
    Number(clamp((args.emaReturnPct + 10) / 20, 0, 1).toFixed(4)),
  ];
}

export function buildEventIntensitySeries(themeId: string, region: string): number[] {
  const entries = S.currentHistory
    .slice()
    .sort((a: InvestmentHistoryEntry, b: InvestmentHistoryEntry) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .slice(-48);
  if (!entries.length) return [];
  return entries.map((entry: InvestmentHistoryEntry) => {
    const themeMatch = entry.themes.includes(themeId) || entry.themes.includes(normalize(themeId));
    const regionMatch = region !== 'Global' && entry.regions.some((item: string) => normalize(item) === normalize(region));
    if (!themeMatch && !regionMatch) return 0;
    const sign = entry.direction === 'short' ? -1 : 1;
    return Number((((entry.conviction / 100) * (1 - entry.falsePositiveRisk / 120)) * sign).toFixed(4));
  });
}

export function buildMarketSignalSeries(symbol: string): number[] {
  const points = S.marketHistory
    .filter((point: MarketHistoryPoint) => point.symbol === symbol)
    .slice(-48);
  if (!points.length) return [];
  return points.map((point: MarketHistoryPoint) => {
    if (typeof point.change === 'number' && Number.isFinite(point.change)) return point.change;
    return 0;
  });
}

export function buildTimedEventFlowSeries(themeId: string, region: string): TimedFlowPoint[] {
  return S.currentHistory
    .slice()
    .sort((a: InvestmentHistoryEntry, b: InvestmentHistoryEntry) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .slice(-96)
    .flatMap((entry: InvestmentHistoryEntry) => {
      const themeMatch = entry.themes.includes(themeId) || entry.themes.includes(normalize(themeId));
      const regionMatch = region === 'Global'
        ? true
        : entry.regions.some((item: string) => normalize(item) === normalize(region));
      if (!themeMatch && !regionMatch) return [];
      const sign = entry.direction === 'short' ? -1 : 1;
      const value = Number((((entry.conviction / 100) * (1 - entry.falsePositiveRisk / 120)) * sign).toFixed(4));
      return [{
        at: entry.timestamp,
        value,
        weight: 1 + Math.min(1.8, Math.abs(entry.bestMovePct) / 6),
      }];
    });
}

export function buildTimedMarketFlowSeries(symbol: string): TimedFlowPoint[] {
  return S.marketHistory
    .filter((point: MarketHistoryPoint) => point.symbol === symbol)
    .slice(-96)
    .map((point: MarketHistoryPoint) => ({
      at: point.timestamp,
      value: typeof point.change === 'number' && Number.isFinite(point.change) ? point.change : 0,
      weight: 1 + Math.min(1.4, Math.abs(point.change || 0) * 0.12),
    }));
}

export function buildKnowledgeGraphMappingSupport(args: {
  theme: ThemeRule;
  candidate: EventCandidate;
  asset: ThemeAssetDefinition;
  graphSignalScore: number;
  transferEntropy: number;
  informationFlowScore: number;
  leadLagScore: number;
  replayUtility: number;
}): {
  supportScore: number;
  dominantRelationType: string;
  notes: string[];
} {
  const nodes = [
    { id: `theme:${args.theme.id}`, prior: clamp(0.42 + args.candidate.corroborationQuality / 180, 0.2, 0.92), kind: 'theme' as const, label: args.theme.label },
    { id: `asset:${args.asset.symbol}`, prior: clamp(0.36 + args.candidate.credibility / 220, 0.16, 0.9), kind: 'asset' as const, label: args.asset.name },
    { id: `region:${normalize(args.candidate.region || 'global')}`, prior: clamp(0.32 + args.candidate.marketStress * 0.24, 0.14, 0.84), kind: 'country' as const, label: args.candidate.region || 'Global' },
    { id: `source:${normalize(args.candidate.source || 'event')}`, prior: clamp(0.24 + args.candidate.credibility / 180, 0.12, 0.88), kind: 'source' as const, label: args.candidate.source || 'event' },
  ];
  const evidence: KnowledgeGraphRelationEvidence[] = [
    {
      from: `theme:${args.theme.id}`,
      to: `asset:${args.asset.symbol}`,
      relationType: args.asset.commodity ? 'commodity-exposure' : `${args.asset.sector}-exposure`,
      strength: args.graphSignalScore,
      confidence: args.candidate.corroborationQuality,
      corroboration: args.candidate.corroborationQuality,
      leadLagScore: args.leadLagScore,
      coverageScore: clamp(58 + args.candidate.sourceDiversity * 6, 20, 100),
      truthAgreement: clamp(args.candidate.credibility, 0, 100),
      contradictionPenalty: clamp(args.candidate.contradictionPenalty, 0, 100),
      supportCount: Math.max(1, args.candidate.sourceCount),
      notes: [
        `Flow=${args.informationFlowScore.toFixed(2)}`,
        `TE=${args.transferEntropy.toFixed(2)}`,
        `ReplayUtility=${args.replayUtility.toFixed(2)}`,
      ],
    },
    {
      from: `region:${normalize(args.candidate.region || 'global')}`,
      to: `asset:${args.asset.symbol}`,
      relationType: 'region-exposure',
      strength: clamp(30 + args.candidate.marketStress * 40 + args.candidate.aftershockIntensity * 26, 0, 100),
      confidence: args.candidate.credibility,
      corroboration: args.candidate.corroborationQuality,
      leadLagScore: args.leadLagScore,
      coverageScore: clamp(48 + args.candidate.sourceDiversity * 8, 10, 100),
      truthAgreement: args.candidate.credibility,
      contradictionPenalty: args.candidate.contradictionPenalty,
      supportCount: Math.max(1, args.candidate.sourceCount),
    },
    {
      from: `source:${normalize(args.candidate.source || 'event')}`,
      to: `theme:${args.theme.id}`,
      relationType: 'source-supports',
      strength: clamp(24 + args.candidate.credibility * 0.56 + args.candidate.corroborationQuality * 0.18, 0, 100),
      confidence: args.candidate.credibility,
      corroboration: args.candidate.corroborationQuality,
      leadLagScore: Math.max(0, args.leadLagScore),
      coverageScore: clamp(40 + args.candidate.sourceDiversity * 10, 0, 100),
      truthAgreement: args.candidate.credibility,
      contradictionPenalty: args.candidate.contradictionPenalty,
      supportCount: Math.max(1, args.candidate.sourceCount),
    },
  ];
  const inference = inferKnowledgeGraphSupport(nodes, evidence, { iterations: 4, damping: 0.82, priorFloor: 0.14 });
  const summary = inference.relationSummaries[0];
  return {
    supportScore: clamp(summary?.supportScore ?? 0, 0, 100),
    dominantRelationType: summary?.dominantRelationType || 'related',
    notes: (summary?.notes || []).slice(0, 4),
  };
}

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

// ============================================================================
// CORE INSTRUMENT ALIGNMENT & EXECUTION PLANNING
// ============================================================================

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

export function buildCoreOrbitalExecutionPlan(
  card: InvestmentIdeaCard,
  macroOverlay: MacroRiskOverlay,
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
  const online = computeOnlineRankingAdjustment(card, macroOverlay);
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

// ============================================================================
// LIQUIDITY & MACRO PENALTY SCORING
// ============================================================================

export function liquidityBaseline(kind: InvestmentAssetKind): number {
  if (kind === 'etf') return 72;
  if (kind === 'equity') return 64;
  if (kind === 'commodity') return 58;
  if (kind === 'rate') return 70;
  if (kind === 'fx') return 74;
  return 56;
}

export function macroPenaltyForAsset(asset: ThemeAssetDefinition, overlay: MacroRiskOverlay): number {
  if (overlay.killSwitch) {
    return asset.direction === 'hedge' ? 0 : 26;
  }
  if (overlay.state === 'risk-off') {
    if (asset.direction === 'hedge') return -4;
    return asset.assetKind === 'equity' || asset.assetKind === 'crypto' ? 16 : 10;
  }
  if (overlay.state === 'balanced') {
    return asset.direction === 'hedge' ? 0 : 6;
  }
  if (overlay.state === 'risk-on' && asset.direction === 'hedge') {
    return 4;
  }
  return 0;
}

export function mergeAttributionBreakdown(
  lead: IdeaAttributionBreakdown,
  rows: IdeaAttributionBreakdown[],
): IdeaAttributionBreakdown {
  if (!rows.length) return lead;
  const components = new Map<string, { label: string; contribution: number; explanation: string; count: number }>();
  for (const row of rows) {
    for (const component of row.components) {
      const current = components.get(component.key) || {
        label: component.label,
        contribution: 0,
        explanation: component.explanation,
        count: 0,
      };
      current.contribution += component.contribution;
      current.count += 1;
      components.set(component.key, current);
    }
  }
  const mergedComponents = Array.from(components.entries())
    .map(([key, value]) => ({
      key,
      label: value.label,
      contribution: Number((value.contribution / Math.max(1, value.count)).toFixed(2)),
      explanation: value.explanation,
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const primaryDriver = mergedComponents.find((component) => component.contribution > 0)?.label || lead.primaryDriver;
  const primaryPenalty = [...mergedComponents].reverse().find((component) => component.contribution < 0)?.label || lead.primaryPenalty;
  const failureModes = Array.from(new Set(rows.flatMap((row) => row.failureModes))).slice(0, 6);
  return {
    primaryDriver,
    primaryPenalty,
    components: mergedComponents,
    narrative: lead.narrative,
    failureModes,
  };
}

export function buildDirectMappings(args: {
  candidates: EventCandidate[];
  markets: MarketData[];
  transmission: EventMarketTransmissionSnapshot | null;
  timestamp: string;
  autonomy: Pick<AutonomyControlState, 'shadowMode' | 'rollbackLevel'>;
  keywordGraph?: KeywordGraphSnapshot | null;
  weightProfile: SelfTuningWeightProfile;
  macroOverlay: MacroRiskOverlay;
}): DirectAssetMapping[] {
  const marketMap = marketMoveMap(args.markets);
  const regime = args.transmission?.regime ?? null;
  const mappings: DirectAssetMapping[] = [];

  for (const candidate of args.candidates) {
    const themeMatches = buildThemeMatchDetails(candidate);
    if (!themeMatches.length) continue;

    for (const match of themeMatches) {
      const theme = match.theme;
      const themePolicy = resolveThemePolicy(theme);
      for (const asset of selectThemeAssetsForCandidate(theme, candidate, match)) {
        const market = marketMap.get(asset.symbol);
        const marketMovePct = market?.change ?? null;
        const learned = getMappingStats(theme.id, asset.symbol, asset.direction);
        const learnedWinRate = learned?.posteriorWinRate ?? 50;
        const learnedReturnPct = learned?.emaReturnPct ?? 0;
        const learnedObservations = learned?.observations ?? 0;
        const recency = assessRecency({
          lastUpdatedAt: learned?.lastUpdatedAt ?? null,
          observations: learnedObservations,
          nowIso: args.timestamp,
        });
        const regimeMultiplier = regimeMultiplierForTheme(
          regime,
          theme.id,
          [candidate.text, theme.label, ...theme.sectors, ...theme.commodities],
        );
        const transferEntropy = estimateTransferEntropy(
          buildEventIntensitySeries(theme.id, candidate.region),
          buildMarketSignalSeries(asset.symbol),
        ).normalized;
        const flowSummary = estimateDirectionalFlowSummary(
          buildTimedEventFlowSeries(theme.id, candidate.region),
          buildTimedMarketFlowSeries(asset.symbol),
          { bucketMs: 24 * 60 * 60 * 1000, maxLag: 4, minBuckets: 8 },
        );
        const graphSupport = assessGraphSupport({
          theme: {
            id: theme.id,
            label: theme.label,
            triggers: theme.triggers,
            sectors: theme.sectors,
            commodities: theme.commodities,
          },
          event: {
            id: candidate.id,
            title: candidate.title,
            text: candidate.text,
            region: candidate.region,
            reasons: candidate.reasons,
            matchedSymbols: candidate.matchedSymbols,
          },
          asset: {
            symbol: asset.symbol,
            name: asset.name,
            assetKind: asset.assetKind,
            sector: asset.sector,
            commodity: asset.commodity,
            direction: asset.direction,
            role: asset.role,
            aliases: UNIVERSE_ASSET_CATALOG.find((entry) => entry.symbol === asset.symbol)?.aliases || [],
          },
          keywordGraph: args.keywordGraph,
          transmission: args.transmission,
        });
        const replayUtilityEstimate = Number((
          (learnedWinRate - 50) * 0.18
          + learnedReturnPct * 1.35
          + Math.log1p(learnedObservations) * 1.8
        ).toFixed(2));
        const knowledgeGraphSupport = buildKnowledgeGraphMappingSupport({
          theme,
          candidate,
          asset,
          graphSignalScore: graphSupport.graphSignalScore,
          transferEntropy,
          informationFlowScore: flowSummary.flowScore,
          leadLagScore: flowSummary.leadLagScore,
          replayUtility: replayUtilityEstimate,
        });
        const clusterConfidence = clamp(candidate.clusterConfidence, 0, 100);
        const clusterConfidenceNorm = clamp(clusterConfidence / 100, 0, 1);
        const transmissionStress = clamp(candidate.transmissionStress ?? 0, 0, 1);
        const marketStressPrior = clamp(candidate.marketStressPrior ?? candidate.marketStress, 0, 1);
        const effectiveStress = Math.max(transmissionStress, marketStressPrior);
        const banditContext = buildBanditContext({
          credibility: candidate.credibility,
          corroboration: candidate.corroborationQuality,
          marketStress: effectiveStress,
          aftershockIntensity: candidate.aftershockIntensity,
          regimeMultiplier,
          transferEntropy,
          posteriorWinRate: learnedWinRate,
          emaReturnPct: learnedReturnPct,
        });
        const bandit = scoreBanditArm(getBanditState(theme.id, asset.symbol, asset.direction), banditContext, 0.72);
        const posteriorBonus = clamp(Math.round((learnedWinRate - 50) * 0.36 * recency.timeDecayWeight), -12, 12);
        const returnBonus = clamp(Math.round(learnedReturnPct * 1.4 * recency.timeDecayWeight), -10, 10);
        const sampleBonus = Math.min(8, Math.round(Math.log2(learnedObservations + 1) * 2 + recency.recentEvidenceScore * 0.04));
        const weightedRegimeMultiplier = regimeMultiplier
          * (args.macroOverlay.state === 'risk-off' ? args.weightProfile.regimeRiskOffMultiplier : 1)
          * (regime?.id === 'inflation-shock' ? args.weightProfile.regimeInflationMultiplier : 1);
        const regimeBonus = clamp(Math.round((weightedRegimeMultiplier - 1) * 18), -10, 14);
        const aftershockBonus = clamp(Math.round(candidate.aftershockIntensity * 16), 0, 14);
        const entropyBonus = clamp(Math.round(transferEntropy * 16), 0, 12);
        const informationFlowBonus = clamp(
          Math.round(Math.max(0, flowSummary.flowScore - 50) * 0.16 + Math.max(0, flowSummary.leadLagScore) * 0.05),
          0,
          14,
        );
        const banditBonus = clamp(Math.round(bandit.score * 10), -10, 14);
        const corroborationBonus = clamp(
          Math.round(((candidate.corroborationQuality - 50) * 0.16) * args.weightProfile.corroborationWeightMultiplier),
          -10,
          14,
        );
        const graphBonus = clamp(
          Math.round(((graphSupport.graphSignalScore - 50) * 0.22) * args.weightProfile.graphPropagationWeightMultiplier),
          -8,
          14,
        );
        const knowledgeBonus = clamp(
          Math.round((knowledgeGraphSupport.supportScore - 50) * 0.16),
          -8,
          14,
        );
        const macroPenalty = macroPenaltyForAsset(asset, args.macroOverlay);
        const contradictionPenalty = Math.round(candidate.contradictionPenalty * args.weightProfile.contradictionPenaltyMultiplier);
        const rumorPenalty = Math.round(candidate.rumorPenalty * (0.92 + (args.weightProfile.contradictionPenaltyMultiplier - 1) * 0.8));
        const stalePenalty = Math.round(recency.stalePenalty * args.weightProfile.recencyPenaltyMultiplier);
        const narrativePenalty = Number(
          themePolicy.narrative.enabled
            ? match.narrativeShadowState === 'mismatch'
              ? themePolicy.narrative.mismatchPenalty
              : match.narrativeShadowState === 'weak'
                ? themePolicy.narrative.weakPenalty
                : 0
            : 0,
        ) || 0;
        const convictionBase = Math.round(
          24
          + candidate.sourceCount * 7
          + (candidate.isAlert ? 10 : 0)
          + candidate.eventIntensity * 0.14
          + candidate.credibility * 0.15
          + candidate.corroborationQuality * 0.16
          + candidate.sourceDiversity * 0.08
          + clusterConfidenceNorm * 14
          + transmissionStress * 16
          + marketStressPrior * 10
          + candidate.aftershockIntensity * 12
          + (marketMovePct != null ? Math.min(12, Math.abs(marketMovePct) * 2.8) : 0),
        );
        const conviction = clamp(
          convictionBase
          + corroborationBonus
          + posteriorBonus
          + returnBonus
          + sampleBonus
          + regimeBonus
          + aftershockBonus
          + entropyBonus
          + informationFlowBonus
          + banditBonus
          + graphBonus
          + knowledgeBonus
          - narrativePenalty
          - contradictionPenalty
          - rumorPenalty
          - stalePenalty
          - macroPenalty,
          20,
          98,
        );
        const falsePositiveRisk = clamp(
          Math.round(
            82
            - candidate.sourceCount * 6
            - candidate.credibility * 0.18
            - candidate.corroborationQuality * 0.18
            - candidate.sourceDiversity * 0.07
            - candidate.eventIntensity * 0.12
            - clusterConfidence * 0.12
            - transmissionStress * 12
            - marketStressPrior * 8
            - (candidate.isAlert ? 6 : 0)
            + contradictionPenalty * 0.85
            + rumorPenalty * 0.7
            + stalePenalty * 0.45
            - Math.max(0, posteriorBonus)
            - Math.max(0, returnBonus)
            - Math.max(0, regimeBonus)
            - Math.max(0, aftershockBonus)
            - Math.max(0, entropyBonus)
            - Math.max(0, informationFlowBonus)
            - Math.max(0, banditBonus)
            + narrativePenalty,
          ),
          6,
          78,
        );
        const sensitivityScore = clamp(
          Math.round(
            theme.baseSensitivity
            + transmissionStress * 10
            + marketStressPrior * 6
            + candidate.sourceCount * 1.8
            + candidate.eventIntensity * 0.12
            + candidate.aftershockIntensity * 10
            + candidate.corroborationQuality * 0.08
            + candidate.sourceDiversity * 0.06
            + clusterConfidence * 0.05
            + recency.recentEvidenceScore * 0.08
            + posteriorBonus * 0.35
            + returnBonus * 0.45
            + regimeBonus * 0.8
            + entropyBonus * 0.9
            + informationFlowBonus * 0.7
            + graphBonus * 0.8,
          ),
          35,
          99,
        );
        const liquidityScore = clamp(
          Math.round(liquidityBaseline(asset.assetKind) + (marketMovePct != null ? Math.min(12, Math.abs(marketMovePct) * 2.2) : 0)),
          20,
          98,
        );
        const reality = assessExecutionReality({
          assetKind: asset.assetKind,
          liquidityScore,
          marketMovePct,
          timestamp: args.timestamp,
        });
        const realityPenaltyPct = Number((reality.executionPenaltyPct * args.weightProfile.realityPenaltyMultiplier).toFixed(2));
        const adjustedRealityScore = clamp(
          Math.round(100 - realityPenaltyPct * 20 - Math.max(0, 58 - liquidityScore) * 0.6 - (reality.tradableNow ? 0 : 10)),
          10,
          98,
        );
        const calibration = calibrateDecision({
          conviction,
          falsePositiveRisk,
          corroborationQuality: candidate.corroborationQuality,
          contradictionPenalty,
          rumorPenalty,
          recentEvidenceScore: recency.recentEvidenceScore,
          realityScore: adjustedRealityScore,
          floorBreached: recency.floorBreached,
          rollbackLevel: args.autonomy.rollbackLevel,
          shadowMode: args.autonomy.shadowMode,
          direction: asset.direction,
        });
        const attribution = buildIdeaAttribution({
          themeLabel: theme.label,
          symbol: asset.symbol,
          corroborationQuality: candidate.corroborationQuality,
          contradictionPenalty,
          recentEvidenceScore: recency.recentEvidenceScore,
          stalePenalty,
          realityScore: adjustedRealityScore,
          transferEntropy,
          banditScore: bandit.score,
          graphSignalScore: graphSupport.graphSignalScore,
          regimeMultiplier: weightedRegimeMultiplier,
          macroPenalty,
          falsePositiveRisk,
          marketMovePct,
        });
        const convictionFeatures: ConvictionFeatureSnapshot = {
          corroborationQuality: candidate.corroborationQuality,
          recentEvidenceScore: recency.recentEvidenceScore,
          realityScore: adjustedRealityScore,
          graphSignalScore: graphSupport.graphSignalScore,
          transferEntropy,
          banditScore: clamp(Math.round(bandit.score * 100), 0, 100),
          regimeMultiplier: weightedRegimeMultiplier,
          coveragePenalty: 0,
          falsePositiveRisk,
        };

        mappings.push({
          id: `${candidate.id}:${theme.id}:${asset.symbol}`,
          eventTitle: candidate.title,
          eventSource: candidate.source,
          themeId: theme.id,
          themeLabel: theme.label,
          themeClassification: themePolicy.classification,
          region: candidate.region,
          symbol: asset.symbol,
          assetName: asset.name,
          assetKind: asset.assetKind,
          sector: asset.sector,
          commodity: asset.commodity || theme.commodities[0] || null,
          direction: asset.direction,
          role: asset.role,
          conviction,
          sensitivityScore,
          falsePositiveRisk,
          eventIntensity: candidate.eventIntensity,
          liquidityScore,
          marketMovePct,
          regimeId: regime?.id ?? candidate.regimeId,
          regimeMultiplier: weightedRegimeMultiplier,
          aftershockIntensity: Number(candidate.aftershockIntensity.toFixed(4)),
          transferEntropy: Number(transferEntropy.toFixed(4)),
          informationFlowScore: Number(flowSummary.flowScore.toFixed(4)),
          leadLagScore: Number(flowSummary.leadLagScore.toFixed(4)),
          knowledgeGraphScore: Number(knowledgeGraphSupport.supportScore.toFixed(4)),
          knowledgeRelationType: knowledgeGraphSupport.dominantRelationType,
          banditScore: Number(bandit.score.toFixed(4)),
          banditMean: Number(bandit.mean.toFixed(4)),
          banditUncertainty: Number(bandit.uncertainty.toFixed(4)),
          corroboration: candidate.corroboration,
          sourceDiversity: candidate.sourceDiversity,
          corroborationQuality: candidate.corroborationQuality,
          clusterConfidence,
          marketStressPrior,
          transmissionStress: candidate.transmissionStress ?? null,
          contradictionPenalty,
          rumorPenalty,
          recentEvidenceScore: recency.recentEvidenceScore,
          timeDecayWeight: recency.timeDecayWeight,
          stalePenalty,
          realityScore: adjustedRealityScore,
          executionPenaltyPct: realityPenaltyPct,
          sessionState: reality.sessionState,
          tradableNow: reality.tradableNow,
          graphSignalScore: graphSupport.graphSignalScore,
          narrativeAlignmentScore: match.narrativeAlignmentScore,
          narrativeShadowState: match.narrativeShadowState,
          narrativeShadowPosterior: Number((match.narrativeShadowPosterior * 100).toFixed(2)),
          narrativeShadowDisagreement: Number(match.narrativeShadowDisagreement.toFixed(2)),
          narrativeShadowTopThemeId: match.narrativeShadowTopThemeId,
          calibratedConfidence: calibration.calibratedConfidence,
          confirmationScore: calibration.calibratedConfidence,
          confirmationState: calibration.calibratedConfidence >= 70 ? 'confirmed' : calibration.calibratedConfidence >= 52 ? 'tentative' : 'fading',
          convictionFeatures,
          sizeMultiplier: 1,
          horizonMultiplier: 1,
          executionGate: reality.tradableNow && adjustedRealityScore >= 36,
          coveragePenalty: 0,
          autonomyAction: calibration.action,
          autonomyReasons: calibration.reasons,
          attribution,
          reasons: [
            theme.thesis,
            ...candidate.reasons,
            `CrossCorr=${candidate.corroborationQuality}`,
            `ClusterConfidence=${clusterConfidence.toFixed(1)}`,
            `StressPrior=${marketStressPrior.toFixed(2)}`,
            candidate.transmissionStress != null ? `TransmissionStress=${candidate.transmissionStress.toFixed(2)}` : '',
            `Intensity=${candidate.eventIntensity}`,
            `Recency=${recency.recentEvidenceScore} decay=${recency.timeDecayWeight.toFixed(2)}`,
            `Reality=${adjustedRealityScore} penalty=${realityPenaltyPct.toFixed(2)}%`,
            `Regime=${regime?.label || candidate.regimeId || 'unknown'} x${weightedRegimeMultiplier.toFixed(2)}`,
            `Aftershock=${candidate.aftershockIntensity.toFixed(2)}`,
            `TransferEntropy=${transferEntropy.toFixed(2)}`,
            `InfoFlow=${flowSummary.flowScore.toFixed(2)} lag=${flowSummary.bestLagHours.toFixed(1)}h`,
            `ThemeMatch=${match.matchedBy} hits=${match.triggerHitCount} narrative=${match.narrativeAlignmentScore.toFixed(0)} ${match.narrativeShadowState} shadow=${(match.narrativeShadowPosterior * 100).toFixed(1)}% top=${match.narrativeShadowTopThemeId || theme.id}`,
            `Bandit=${bandit.score.toFixed(2)}`,
            `Graph=${graphSupport.graphSignalScore}`,
            `KG=${knowledgeGraphSupport.supportScore.toFixed(0)} ${knowledgeGraphSupport.dominantRelationType}`,
            `Macro=${args.macroOverlay.state} gauge=${args.macroOverlay.riskGauge}`,
            ...calibration.reasons,
            ...graphSupport.notes,
            ...knowledgeGraphSupport.notes,
          ].slice(0, 8),
          transmissionPath: [
            ...graphSupport.propagationPath,
            ...knowledgeGraphSupport.notes.map((note) => `KG ${note}`),
            `${asset.symbol} ${asset.name}`,
          ].slice(0, 5),
          tags: [...theme.sectors, ...theme.commodities, ...candidate.matchedSymbols].slice(0, 8),
        });
      }
    }
  }

  return mappings
    .sort((a, b) => b.calibratedConfidence - a.calibratedConfidence || b.conviction - a.conviction || b.sensitivityScore - a.sensitivityScore)
    .slice(0, MAX_MAPPINGS);
}

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

export function executionReadinessScore(mapping: Pick<
  DirectAssetMapping,
  'assetKind' | 'tradableNow' | 'sessionState' | 'liquidityScore' | 'executionPenaltyPct'
>): number {
  const tradableScore = mapping.tradableNow
    ? 100
    : mapping.assetKind === 'crypto'
      ? 78
      : 56;
  const sessionScore = mapping.sessionState === 'always-on'
    ? 100
    : mapping.sessionState === 'open'
      ? 96
      : mapping.sessionState === 'extended'
        ? 82
        : 58;
  const liquidityScore = clamp(Number(mapping.liquidityScore) || 0, 0, 100);
  const penaltyScore = clamp(100 - (Number(mapping.executionPenaltyPct) || 0) * 18, 0, 100);
  return clamp(
    Math.round(
      tradableScore * 0.34
      + sessionScore * 0.24
      + liquidityScore * 0.26
      + penaltyScore * 0.16
    ),
    0,
    100,
  );
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

function applyMetaTradeAdmission(
  card: InvestmentIdeaCard,
  macroOverlay: MacroRiskOverlay,
  replayAdaptation: ReplayAdaptationSnapshot | null,
  options?: {
    ragHitRate?: number | null;
    ragConfidence?: number;
    admissionThresholds?: ThemeAdmissionPolicy | null;
    ensembleModels?: unknown | null;
    mlNormalization?: { mean: number[]; std: number[] } | null;
    knnPrediction?: KNNPrediction | null;
    gdeltProxy?: TransmissionProxy | null;
    macroIndicators?: { vix?: number; yieldSpread?: number; dollarIndex?: number; oilPrice?: number } | null;
  },
): InvestmentIdeaCard {
  const theme = getThemeRule(card.themeId);
  const themePolicy = theme ? resolveThemePolicy(theme) : null;
  const replayProfile = getReplayThemeProfileFromSnapshot(replayAdaptation, card.themeId);
  const currentPerformance = getCurrentThemePerformanceFromSnapshot(replayAdaptation, card.themeId);
  const stability = computeThemeStabilityAdjustment(card.themeId);
  const narrativePenalty = Number(
    themePolicy?.narrative.enabled
      ? card.narrativeShadowState === 'mismatch'
        ? themePolicy.narrative.mismatchPenalty
        : card.narrativeShadowState === 'weak'
          ? themePolicy.narrative.weakPenalty
          : 0
      : 0,
  ) || 0;
  const symbolRules = card.symbols
    .map((symbol) => themePolicy?.symbolAdjustments[String(symbol.symbol || '').trim().toUpperCase()])
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  const specialSymbolPenalty = symbolRules.reduce((sum, rule) => sum + (rule.metaScorePenalty || 0), 0);
  const specialSizeMultiplier = symbolRules.length > 0
    ? Math.min(...symbolRules.map((rule) => rule.sizeMultiplier ?? 1))
    : 1;
  const specialWeightBlock = symbolRules.some((rule) => rule.requireRiskOff) && !macroOverlay.killSwitch && macroOverlay.state === 'risk-on';
  const hedgeHeavyPenalty =
    themePolicy?.classification === 'hedge-heavy'
      ? macroOverlay.state === 'risk-on'
        ? 0.08
        : macroOverlay.state === 'balanced'
          ? 0.03
          : 0
      : 0;

  const replayHitRate = clamp(Number(replayProfile?.hitRate ?? card.backtestHitRate ?? 50), 0, 100);
  const replayReturnPct = Number(replayProfile?.costAdjustedAvgReturnPct ?? card.backtestAvgReturnPct ?? 0) || 0;
  const currentHitRate = clamp(Number(currentPerformance?.hitRate ?? replayHitRate), 0, 100);
  const currentReturnPct = Number(currentPerformance?.avgReturnPct ?? replayReturnPct) || 0;
  const driftPenalty = clamp(Math.abs(Math.min(0, Number(replayProfile?.currentVsReplayDrift ?? 0))) / 2.5, 0, 1);
  const confidence = clamp(card.calibratedConfidence / 100, 0, 1);
  const confirmation = clamp(card.confirmationScore / 100, 0, 1);
  const reality = clamp(card.realityScore / 100, 0, 1);
  const coverage = clamp(1 - card.coveragePenalty / 120, 0, 1);
  const bandit = clamp((Number(card.banditScore) || 50) / 100, 0, 1);
  const transfer = clamp(Number(card.transferEntropy) || 0, 0, 1);
  const clusterConfidence = clamp((Number(card.clusterConfidence) || 0) / 100, 0, 1);
  const gp = options?.gdeltProxy;
  const marketStressPrior = clamp(Number(card.marketStressPrior) || (gp?.marketStress ?? 0), 0, 1);
  const transmissionStress = clamp(Number(card.transmissionStress ?? card.marketStressPrior ?? 0) || (gp?.transmissionStrength ?? 0), 0, 1);
  const evidenceSupport = clamp(
    clusterConfidence * 0.58
    + marketStressPrior * 0.24
    + transmissionStress * 0.18,
    0,
    1,
  );
  const falsePositivePenalty = clamp(card.falsePositiveRisk / 100, 0, 1);
  const shadowPosterior = clamp((Number(card.narrativeShadowPosterior) || 0) / 100, 0, 1);
  const shadowDisagreement = clamp((Number(card.narrativeShadowDisagreement) || 0) / 100, 0, 1);
  const narrativeAlignment = clamp((Number(card.narrativeAlignmentScore) || 50) / 100, 0, 1);
  const shadowThemeAgreement = card.narrativeShadowTopThemeId
    ? String(card.narrativeShadowTopThemeId).trim().toLowerCase() === String(card.themeId).trim().toLowerCase()
      ? 1
      : 0
    : 0.5;
  const shadowSupport = clamp(
    shadowPosterior * (0.56 + shadowThemeAgreement * 0.44)
    + narrativeAlignment * 0.18
    - shadowDisagreement * 0.72,
    0,
    1,
  );
  const shadowPenalty = clamp(
    (card.narrativeShadowState === 'mismatch'
      ? 0.12
      : card.narrativeShadowState === 'weak'
        ? 0.05
        : 0)
    + shadowDisagreement * 0.08
    + (shadowThemeAgreement === 0 && shadowPosterior >= 0.58 ? 0.05 : 0),
    0,
    0.45,
  );
  const stressPenalty = macroOverlay.killSwitch
    ? 0.22
    : macroOverlay.state === 'risk-off'
      ? 0.1
      : macroOverlay.state === 'balanced'
        ? 0.04
        : 0;
  const stabilityExposure = clamp(stability.exposureMultiplier, 0, 1.2);
  let mlProbability: number | null = null;
  if (metaWeightsState.weights) {
    mlProbability = predictHitProbability(metaWeightsState.weights, {
      confidence,
      confirmation,
      reality,
      replayHitRate,
      currentHitRate,
      coverage,
      bandit,
      transfer,
      stability: stabilityExposure,
      falsePositivePenalty,
      driftPenalty,
    });
  }
  const hardcodedBaseProb = Number((
    confidence * 0.18
    + confirmation * 0.18
    + reality * 0.16
    + (replayHitRate / 100) * 0.16
    + (currentHitRate / 100) * 0.1
    + coverage * 0.08
    + bandit * 0.08
    + transfer * 0.06
    + evidenceSupport * 0.08
    + stabilityExposure * 0.06
    - falsePositivePenalty * 0.14
    - driftPenalty * 0.08
  ).toFixed(4));
  const ragConfidence = clamp(options?.ragConfidence ?? 0, 0, 1);
  const ragAdjustment = options?.ragHitRate != null
    ? (clamp(options.ragHitRate, 0, 1) - 0.5) * ragConfidence * 0.12
    : 0;
  const baseProb = (mlProbability ?? hardcodedBaseProb) + ragAdjustment;
  const fallbackMetaHitProbability = clamp(
    Number((hardcodedBaseProb - stressPenalty - hedgeHeavyPenalty - shadowPenalty).toFixed(4)),
    0.03,
    0.97,
  );

  const metaHitProbability = mlProbability === null
    ? fallbackMetaHitProbability
    : clamp(baseProb - stressPenalty - hedgeHeavyPenalty - shadowPenalty, 0.03, 0.97);

  const metaExpectedReturnPct = Number((
    replayReturnPct * 0.55
    + currentReturnPct * 0.2
    + Math.max(0, card.calibratedConfidence - 55) * 0.015
    + Math.max(0, card.realityScore - 60) * 0.01
    + Math.max(0, stability.lcbUtility) * 0.18
    + clusterConfidence * 0.85
    + marketStressPrior * 0.65
    + transmissionStress * 0.45
    - card.falsePositiveRisk * 0.012
    - card.coveragePenalty * 0.01
    - driftPenalty * 0.55
    - stressPenalty * 1.8
    - narrativePenalty * 0.05
    - shadowPenalty * 1.4
  ).toFixed(3));

  const metaDecisionScore = Number((
    metaHitProbability * 100
    + metaExpectedReturnPct * 7
    + stability.stabilityScore * 0.22
    + (Number(card.narrativeAlignmentScore) || 50) * 0.08
    + evidenceSupport * 10
    - card.falsePositiveRisk * 0.28
    - card.coveragePenalty * 0.12
    - specialSymbolPenalty
    - narrativePenalty * 1.2
    - shadowPenalty * 16
  ).toFixed(2));

  // ── Continuous Conviction Score ─────────────────
  const continuousConviction = clamp(
      metaHitProbability * 45
      + Math.max(0, metaExpectedReturnPct) * 8
      + (metaDecisionScore / 100) * 35
      + evidenceSupport * 12,
      0,
      100,
    );

  const thresholdPolicy = options?.admissionThresholds ?? themePolicy?.admission;
  // Legacy threshold variables — retained for threshold-optimizer integration (Phase 2).
  void (thresholdPolicy?.rejectHitProbability ?? 0.44);
  void (thresholdPolicy?.watchHitProbability ?? 0.52);
  void (thresholdPolicy?.rejectExpectedReturnPct ?? -0.2);
  void (thresholdPolicy?.watchExpectedReturnPct ?? 0.08);
  void (thresholdPolicy?.rejectScore ?? 38);
  void (thresholdPolicy?.watchScore ?? 52);

  // admissionState derived from continuousConviction (for logging + backward compat)
  let admissionState: 'accepted' | 'watch' | 'rejected' = 'accepted';
  let autonomyAction = card.autonomyAction;

  if (specialWeightBlock || continuousConviction < 15) {
    admissionState = 'rejected';
    autonomyAction = 'abstain';
  } else if (continuousConviction < 55) {
    admissionState = 'watch';
    if (autonomyAction === 'deploy') autonomyAction = 'watch';
  }

  // Continuous sizing: sigmoid-like scaling from conviction
  // conviction 0 → ~0.02, 25 → ~0.15, 50 → ~0.50, 75 → ~0.88, 100 → ~0.98
  const convictionFraction = continuousConviction / 100;
  const metaSizeScale = continuousConviction < 10
    ? 0
    : clamp(
      0.05 + convictionFraction * convictionFraction * 1.08,
      0.05,
      1.18,
    );

  return {
    ...card,
    autonomyAction,
    admissionState,
    continuousConviction: Number(continuousConviction.toFixed(2)),
    metaHitProbability: Number((metaHitProbability * 100).toFixed(2)),
    metaExpectedReturnPct,
    metaDecisionScore,
    sizePct: Number((card.sizePct * metaSizeScale * specialSizeMultiplier).toFixed(2)),
    autonomyReasons: Array.from(new Set([
      ...card.autonomyReasons,
      `Meta gate: hit=${(metaHitProbability * 100).toFixed(1)}%, exp=${metaExpectedReturnPct.toFixed(2)}%, score=${metaDecisionScore.toFixed(1)}.`,
      `Evidence prior: cluster=${(clusterConfidence * 100).toFixed(1)}%, stressPrior=${marketStressPrior.toFixed(2)}, transmission=${transmissionStress.toFixed(2)}.`,
      specialSymbolPenalty > 0 ? `Special-symbol calibration penalty=${specialSymbolPenalty.toFixed(1)}.` : '',
      card.narrativeShadowState ? `Narrative shadow=${card.narrativeShadowState} (${Number(card.narrativeAlignmentScore || 0).toFixed(0)}), posterior=${Number(card.narrativeShadowPosterior || 0).toFixed(1)}%, disagreement=${Number(card.narrativeShadowDisagreement || 0).toFixed(1)}, support=${(shadowSupport * 100).toFixed(1)}%.` : '',
      specialWeightBlock ? 'Risk-on regime blocked a risk-off-only special symbol.' : '',
      admissionState === 'rejected'
        ? 'Selective abstention rejected this idea before capital allocation.'
        : admissionState === 'watch'
          ? 'Selective gate downgraded this idea to watch-only because expected edge is too thin.'
          : 'Selective gate accepted this idea for allocation review.',
    ])).slice(0, 6),
  };
}

// ============================================================================
// IDEA CARDS & HISTORY BUILDING
// ============================================================================

export function buildIdeaCards(
  mappings: DirectAssetMapping[],
  analogs: HistoricalAnalog[],
  macroOverlay: MacroRiskOverlay,
  replayAdaptation: ReplayAdaptationSnapshot | null,
  options?: {
    ragHitRate?: number | null;
    ragConfidence?: number;
    admissionThresholds?: ThemeAdmissionPolicy | null;
    ensembleModels?: unknown | null;
    mlNormalization?: { mean: number[]; std: number[] } | null;
    knnPrediction?: KNNPrediction | null;
    gdeltProxy?: TransmissionProxy | null;
    macroIndicators?: { vix?: number; yieldSpread?: number; dollarIndex?: number; oilPrice?: number } | null;
  },
): InvestmentIdeaCard[] {
  const grouped = new Map<string, DirectAssetMapping[]>();
  for (const mapping of mappings) {
    const key = `${mapping.themeId}::${mapping.region}`;
    const bucket = grouped.get(key) || [];
    bucket.push(mapping);
    grouped.set(key, bucket);
  }

  const cards: InvestmentIdeaCard[] = [];
  for (const [key, bucket] of grouped.entries()) {
    const primary = bucket.filter((item) => item.direction === 'long' || item.direction === 'short');
    const hedges = bucket.filter((item) => item.direction === 'hedge');
    const hedgeOnly = primary.length === 0 && hedges.length > 0;
    const dominantDirection: InvestmentDirection = primary.length === 0
      ? 'watch'
      : primary.filter((item) => item.direction === 'long').length >= primary.filter((item) => item.direction === 'short').length
        ? 'long'
        : 'short';
    const baseConviction = clamp(Math.round(average(primary.length > 0 ? primary.map((item) => item.conviction) : bucket.map((item) => item.conviction))), 10, 99);

    // --- Direction auto-learning from data ---
    const directionStats = bucket
      .map((item) => getMappingStats(item.themeId, item.symbol, item.direction))
      .filter((item): item is MappingPerformanceStats => Boolean(item));
    const avgLearnedReturn = directionStats.length > 0
      ? directionStats.reduce((s, st) => s + st.emaReturnPct, 0) / directionStats.length
      : 0;
    const learnedDirection: InvestmentDirection =
      avgLearnedReturn > 0.3 ? 'long' :
      avgLearnedReturn < -0.3 ? 'short' :
      'watch';
    // Use learned direction if enough data, otherwise use theme default
    const effectiveDirection: InvestmentDirection = directionStats.length >= 3 && (directionStats[0]?.observations ?? 0) >= 5
      ? learnedDirection
      : dominantDirection;
    const falsePositiveRisk = clamp(Math.round(average(bucket.map((item) => item.falsePositiveRisk))), 5, 95);
    const lead = bucket[0]!;
    const theme = getThemeRule(lead.themeId);
    const themePolicy = theme ? resolveThemePolicy(theme) : null;
    const hedgeHeavyTheme = themePolicy?.classification === 'hedge-heavy';
    const primaryLimit = themePolicy?.assets.maxPrimaryAssets ?? 3;
    const confirmLimit = themePolicy?.assets.maxConfirmAssets ?? 2;
    const hedgeLimit = themePolicy?.assets.maxHedgeAssets ?? 2;
    const rule = applyAtrAdjustedRule(
      chooseSizingRule(
        baseConviction,
        falsePositiveRisk,
        hedgeHeavyTheme || effectiveDirection === 'watch' ? 'hedge' : effectiveDirection,
      ),
      [
        ...primary.slice(0, 3).map((item): InvestmentIdeaSymbol => ({
          symbol: item.symbol,
          name: item.assetName,
          role: item.role === 'hedge' ? 'hedge' : item.role,
          direction: item.direction,
          sector: item.sector,
        })),
        ...hedges.slice(0, 2).map((item): InvestmentIdeaSymbol => ({
          symbol: item.symbol,
          name: item.assetName,
          role: 'hedge',
          direction: item.direction,
          sector: item.sector,
        })),
      ],
      bucket[0]?.themeId,
      hedgeHeavyTheme || effectiveDirection === 'watch' ? 'hedge' : effectiveDirection,
    );
    const symbolStats = bucket
      .map((item) => getMappingStats(item.themeId, item.symbol, item.direction))
      .filter((item): item is MappingPerformanceStats => Boolean(item));
    const avgPosterior = symbolStats.length > 0 ? average(symbolStats.map((item) => item.posteriorWinRate)) : 50;
    const avgReturn = symbolStats.length > 0 ? average(symbolStats.map((item) => item.emaReturnPct)) : 0;
    const edgeAdj = clamp(0.75 + Math.max(0, avgPosterior - 50) / 80 + Math.max(0, avgReturn) / 14, 0.55, 1.35);
    const convictionScale = 0.7 + (baseConviction / 100) * 0.3; // 70% base + 30% conviction-driven (conviction 48 → 0.84x)
    const fpScale = 1 - falsePositiveRisk / 300; // minimal FP penalty (fpRisk 30 → 0.90x)
    const rawSizePct = clamp(rule.maxPositionPct * convictionScale * fpScale * edgeAdj, rule.maxPositionPct * 0.5, rule.maxPositionPct);
    const relatedAnalogs = analogs
      .filter((analog) => analog.themes.some((item) => item === lead.themeId || item === normalize(lead.themeLabel)))
      .slice(0, 3)
      .map((analog) => analog.label);
    const calibratedConfidence = clamp(Math.round(average(bucket.map((item) => item.calibratedConfidence))), 0, 99);
    const realityScore = clamp(Math.round(average(bucket.map((item) => item.realityScore))), 0, 99);
    const graphSignalScore = clamp(Math.round(average(bucket.map((item) => item.graphSignalScore))), 0, 99);
    const recentEvidenceScore = clamp(Math.round(average(bucket.map((item) => item.recentEvidenceScore))), 0, 99);
    const corroborationQuality = clamp(Math.round(average(bucket.map((item) => item.corroborationQuality))), 0, 99);
    const transferEntropy = Number(average(bucket.map((item) => item.transferEntropy ?? 0)).toFixed(4));
    const banditScore = clamp(Math.round(average(bucket.map((item) => (item.banditScore ?? 0) * 100))), 0, 100);
    const regimeMultiplier = Number(average(bucket.map((item) => item.regimeMultiplier ?? 1)).toFixed(4));
    const confirmationScore = clamp(Math.round(average(bucket.map((item) => item.confirmationScore))), 0, 100);
    const confirmationState = confirmationStateFromScore(confirmationScore);
    const coveragePenalty = clamp(Math.round(average(bucket.map((item) => item.coveragePenalty))), 0, 100);
    const convictionFeatures: ConvictionFeatureSnapshot = {
      corroborationQuality,
      recentEvidenceScore,
      realityScore,
      graphSignalScore,
      transferEntropy,
      banditScore,
      regimeMultiplier,
      coveragePenalty,
      falsePositiveRisk,
    };
    // Check recent performance for this theme+symbol combination
    const negativePerfCount = symbolStats.filter(s => s.emaReturnPct < -0.5).length;
    const failurePenalty = negativePerfCount > 0
      ? Math.max(0.4, 1 - negativePerfCount * 0.15)
      : 1.0;

    const conviction = Math.round(blendLearnedConviction(baseConviction, convictionFeatures) * failurePenalty);
    const sizeMultiplier = Number(average(bucket.map((item) => item.sizeMultiplier)).toFixed(4));
    const horizonMultiplier = Number(average(bucket.map((item) => item.horizonMultiplier)).toFixed(4));
    const executionGate = bucket.some((item) => item.executionGate);
    const timeDecayWeight = Number(average(bucket.map((item) => item.timeDecayWeight)).toFixed(4));
    const narrativeAlignmentScore = clamp(Math.round(average(bucket.map((item) => Number(item.narrativeAlignmentScore) || 0))), 0, 100);
    const narrativeShadowPosterior = Number(average(bucket.map((item) => Number(item.narrativeShadowPosterior) || 0)).toFixed(2));
    const narrativeShadowDisagreement = Number(Math.max(...bucket.map((item) => Number(item.narrativeShadowDisagreement) || 0), 0).toFixed(2));
    const narrativeShadowTopThemeId = (() => {
      const counts = bucket.reduce<Map<string, number>>((acc, item) => {
        const key = String(item.narrativeShadowTopThemeId || '').trim();
        if (!key) return acc;
        acc.set(key, (acc.get(key) || 0) + 1);
        return acc;
      }, new Map<string, number>());
      const winner = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
      return winner?.[0] || null;
    })();
    const narrativeShadowState = bucket.some((item) => item.narrativeShadowState === 'mismatch')
      ? 'mismatch'
      : bucket.some((item) => item.narrativeShadowState === 'weak')
        ? 'weak'
        : 'aligned';
    const contradictionPenalty = average(bucket.map((item) => item.contradictionPenalty));
    const eventIntensity = average(bucket.map((item) => item.eventIntensity));
    const clusterConfidence = Number(average(bucket.map((item) => item.clusterConfidence)).toFixed(2));
    const marketStressPrior = Number(average(bucket.map((item) => item.marketStressPrior)).toFixed(4));
    const transmissionStressValues = bucket
      .map((item) => item.transmissionStress)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const transmissionStress = transmissionStressValues.length > 0
      ? Number(average(transmissionStressValues).toFixed(4))
      : null;
    const actionCounts: Record<AutonomyAction, number> = bucket.reduce<Record<AutonomyAction, number>>((acc, item) => {
      acc[item.autonomyAction] += 1;
      return acc;
    }, { deploy: 0, shadow: 0, watch: 0, abstain: 0 });
    const abstainFloor = clamp(
      Math.round(
        18
        + Math.max(0, 44 - recentEvidenceScore) * 0.10
        + Math.max(0, 46 - realityScore) * 0.08
        + contradictionPenalty * 0.14
        - Math.max(0, eventIntensity - 50) * 0.10,
      ),
      12,
      30,
    );
    const shadowFloor = clamp(
      Math.round(
        30
        + Math.max(0, 52 - recentEvidenceScore) * 0.08
        + contradictionPenalty * 0.12
        - Math.max(0, graphSignalScore - 52) * 0.10
        - Math.max(0, eventIntensity - 50) * 0.08,
      ),
      24,
      42,
    );
    const watchFloor = clamp(
      Math.round(
        42
        + Math.max(0, 50 - recentEvidenceScore) * 0.06
        + contradictionPenalty * 0.08
        - Math.max(0, graphSignalScore - 55) * 0.08,
      ),
      34,
      54,
    );
    let autonomyAction: AutonomyAction = actionCounts.abstain >= Math.ceil(bucket.length / 2) || calibratedConfidence < abstainFloor
      ? 'abstain'
      : actionCounts.shadow > 0 || calibratedConfidence < shadowFloor || contradictionPenalty >= 12
        ? 'shadow'
        : actionCounts.watch > 0 || calibratedConfidence < watchFloor
          ? 'watch'
          : 'deploy';
    if (!executionGate || confirmationState === 'contradicted') {
      autonomyAction = 'abstain';
    } else if (confirmationState === 'fading' && autonomyAction === 'deploy') {
      autonomyAction = 'shadow';
    } else if (confirmationState === 'tentative' && autonomyAction === 'deploy') {
      autonomyAction = 'shadow';
    }
    if (macroOverlay.killSwitch && !hedgeOnly) {
      autonomyAction = calibratedConfidence >= 70 && effectiveDirection === 'watch' ? 'watch' : 'abstain';
    } else if (
      macroOverlay.state === 'risk-off'
      && !hedgeOnly
      && autonomyAction === 'deploy'
      && calibratedConfidence < watchFloor + 6
    ) {
      autonomyAction = 'shadow';
    }
    if (hedgeHeavyTheme && macroOverlay.state === 'risk-on' && autonomyAction === 'deploy') {
      autonomyAction = 'watch';
    }
    const confidenceBand: ConfidenceBand = calibratedConfidence >= 78
      ? 'high'
      : calibratedConfidence >= 62
        ? 'building'
        : calibratedConfidence >= 44
          ? 'guarded'
          : 'low';
    const sizeCap = autonomyAction === 'abstain' ? 0.3 : 1;
    const macroSizeMultiplier = 1;
    const sizePct = Number((rawSizePct * sizeCap * macroSizeMultiplier).toFixed(2));
    const autonomyReasons = Array.from(new Set([
      ...bucket.flatMap((item) => item.autonomyReasons),
      ...(macroOverlay.killSwitch && !hedgeOnly
        ? ['Macro kill switch blocked net directional deployment.']
        : macroOverlay.state === 'risk-off' && !hedgeOnly
          ? ['Macro risk-off overlay cut directional sizing and forced shadow mode.']
          : []),
    ])).slice(0, 4);
    const attribution = mergeAttributionBreakdown(
      lead.attribution,
      bucket.map((item) => item.attribution),
    );
    const replayThemeProfile = getReplayThemeProfileFromSnapshot(replayAdaptation, lead.themeId);
    const currentThemePerformance = getCurrentThemePerformanceFromSnapshot(replayAdaptation, lead.themeId);
    const baseHorizonLearning = scaleHorizonLearning(
      resolveIdeaCardHorizonLearning(
        lead.themeId,
        theme?.timeframe || '1d-7d',
        replayAdaptation,
      ),
      horizonMultiplier,
    );
    const halfLifePolicy = estimateRegimeConditionalHalfLifePolicy({
      learning: baseHorizonLearning,
      replayProfile: replayThemeProfile,
      currentPerformance: currentThemePerformance,
      referenceTimestamp: nowIso(),
      macroOverlay,
      coveragePenalty,
      marketConfirmation: Math.round(average(bucket.map((item) => marketConfirmationScore(item.direction, item.marketMovePct)))),
    });
    const horizonLearning = applyHalfLifePolicyToLearning(baseHorizonLearning, halfLifePolicy);
    const cardAutonomyReasons = halfLifePolicy.multiplier < 0.98 && halfLifePolicy.halfLifeHours
      ? Array.from(new Set([
        ...autonomyReasons,
        `Half-life policy compressed horizon toward ~${halfLifePolicy.halfLifeHours}h (rho=${halfLifePolicy.rho?.toFixed(2) ?? 'n/a'}).`,
      ])).slice(0, 6)
      : autonomyReasons;

    cards.push({
      id: key,
      title: `${lead.themeLabel} | ${lead.region}`,
      themeId: lead.themeId,
      themeClassification: themePolicy?.classification,
      direction: effectiveDirection,
      conviction,
      falsePositiveRisk,
      sizePct: Math.round(sizePct * sizeMultiplier * Math.max(0, 1 - coveragePenalty / 140) * (hedgeHeavyTheme ? 0.82 : 1) * 100) / 100,
      timeframe: horizonLearning.timeframe,
      thesis: theme?.thesis || lead.reasons[0] || 'Event-to-asset transmission detected.',
      calibratedConfidence,
      confidenceBand,
      autonomyAction,
      autonomyReasons: cardAutonomyReasons,
      realityScore,
      graphSignalScore,
      narrativeAlignmentScore,
      narrativeShadowState,
      narrativeShadowPosterior,
      narrativeShadowDisagreement,
      narrativeShadowTopThemeId,
      timeDecayWeight,
      recentEvidenceScore,
      corroborationQuality,
      clusterConfidence,
      marketStressPrior,
      transmissionStress,
      transferEntropy,
      banditScore,
      regimeMultiplier,
      convictionFeatures,
      confirmationScore,
      confirmationState,
      sizeMultiplier,
      horizonMultiplier,
      executionGate,
      coveragePenalty,
      attribution,
      symbols: dedupeIdeaSymbols([
        ...primary
          .filter((item) => item.role === 'primary')
          .slice(0, primaryLimit)
          .map((item): InvestmentIdeaSymbol => ({
          symbol: item.symbol,
          name: item.assetName,
          role: item.role === 'hedge' ? 'hedge' : item.role,
          direction: item.direction,
          sector: item.sector,
          assetKind: item.assetKind,
          liquidityScore: item.liquidityScore,
          realityScore: item.realityScore,
          contextVector: buildBanditContext({
            credibility: item.corroboration,
            corroboration: item.corroborationQuality,
            marketStress: Math.max(0, Math.min(1, (item.marketMovePct ?? 0) / 10)),
            aftershockIntensity: item.aftershockIntensity ?? 0,
            regimeMultiplier: item.regimeMultiplier ?? 1,
            transferEntropy: item.transferEntropy ?? 0,
            posteriorWinRate: getMappingStats(item.themeId, item.symbol, item.direction)?.posteriorWinRate ?? 50,
            emaReturnPct: getMappingStats(item.themeId, item.symbol, item.direction)?.emaReturnPct ?? 0,
          }),
          banditScore: item.banditScore ?? null,
        })),
        ...primary
          .filter((item) => item.role !== 'primary')
          .slice(0, confirmLimit)
          .map((item): InvestmentIdeaSymbol => ({
          symbol: item.symbol,
          name: item.assetName,
          role: item.role === 'hedge' ? 'hedge' : item.role,
          direction: item.direction,
          sector: item.sector,
          assetKind: item.assetKind,
          liquidityScore: item.liquidityScore,
          realityScore: item.realityScore,
          contextVector: buildBanditContext({
            credibility: item.corroboration,
            corroboration: item.corroborationQuality,
            marketStress: Math.max(0, Math.min(1, (item.marketMovePct ?? 0) / 10)),
            aftershockIntensity: item.aftershockIntensity ?? 0,
            regimeMultiplier: item.regimeMultiplier ?? 1,
            transferEntropy: item.transferEntropy ?? 0,
            posteriorWinRate: getMappingStats(item.themeId, item.symbol, item.direction)?.posteriorWinRate ?? 50,
            emaReturnPct: getMappingStats(item.themeId, item.symbol, item.direction)?.emaReturnPct ?? 0,
          }),
          banditScore: item.banditScore ?? null,
        })),
        ...hedges.slice(0, hedgeLimit).map((item): InvestmentIdeaSymbol => ({
          symbol: item.symbol,
          name: item.assetName,
          role: 'hedge' as const,
          direction: item.direction,
          sector: item.sector,
          assetKind: item.assetKind,
          liquidityScore: item.liquidityScore,
          realityScore: item.realityScore,
          contextVector: buildBanditContext({
            credibility: item.corroboration,
            corroboration: item.corroborationQuality,
            marketStress: Math.max(0, Math.min(1, (item.marketMovePct ?? 0) / 10)),
            aftershockIntensity: item.aftershockIntensity ?? 0,
            regimeMultiplier: item.regimeMultiplier ?? 1,
            transferEntropy: item.transferEntropy ?? 0,
            posteriorWinRate: getMappingStats(item.themeId, item.symbol, item.direction)?.posteriorWinRate ?? 50,
            emaReturnPct: getMappingStats(item.themeId, item.symbol, item.direction)?.emaReturnPct ?? 0,
          }),
          banditScore: item.banditScore ?? null,
        })),
      ]).slice(0, 4),
      triggers: Array.from(new Set(bucket.flatMap((item) => item.reasons))).slice(0, 4),
      invalidation: theme?.invalidation.slice(0, 3) || ['Transmission path weakens', 'Cross-asset confirmation disappears'],
      evidence: Array.from(new Set(bucket.map((item) => item.eventTitle))).slice(0, 3),
      transmissionPath: Array.from(new Set(bucket.flatMap((item) => item.transmissionPath))).slice(0, 5),
      sectorExposure: Array.from(new Set(bucket.map((item) => item.sector))).slice(0, 4),
      analogRefs: relatedAnalogs,
      preferredHorizonHours: horizonLearning.preferredHorizonHours != null ? Math.max(48, horizonLearning.preferredHorizonHours) : null,
      horizonCandidatesHours: horizonLearning.horizonCandidatesHours,
      horizonLearningConfidence: horizonLearning.horizonLearningConfidence,
      timeframeSource: horizonLearning.timeframeSource,
    });
  }

  const admissionAdjustedCards = cards.map((card) => applyMetaTradeAdmission(card, macroOverlay, replayAdaptation, options));

  // Cap ideas per theme to prevent over-concentration
  const MAX_IDEAS_PER_THEME = 3;
  const cappedCards: typeof admissionAdjustedCards = [];
  const themeCount = new Map<string, number>();
  // Sort by conviction descending so we keep the best
  admissionAdjustedCards.sort((a, b) =>
    (b.metaDecisionScore ?? b.conviction) - (a.metaDecisionScore ?? a.conviction)
    || b.conviction - a.conviction,
  );
  for (const card of admissionAdjustedCards) {
    const count = themeCount.get(card.themeId) || 0;
    const theme = getThemeRule(card.themeId);
    const maxIdeasForTheme = theme && resolveThemePolicy(theme).classification === 'hedge-heavy'
      ? 2
      : MAX_IDEAS_PER_THEME;
    if (count < maxIdeasForTheme) {
      cappedCards.push(card);
      themeCount.set(card.themeId, count + 1);
    }
  }

  return cappedCards
    .sort((a, b) =>
      (b.metaDecisionScore ?? b.conviction) - (a.metaDecisionScore ?? a.conviction)
      || b.conviction - a.conviction
      || a.falsePositiveRisk - b.falsePositiveRisk)
    .slice(0, MAX_IDEAS);
}

export function createCurrentHistoryEntries(
  ideaCards: InvestmentIdeaCard[],
  mappings: DirectAssetMapping[],
  timestamp: string,
): InvestmentHistoryEntry[] {
  return ideaCards.slice(0, 8).map((card) => {
    const cardMappings = mappings.filter((mapping) => mapping.themeId === card.themeId && card.title.includes(mapping.region));
    const moves = cardMappings.map((item) => item.marketMovePct).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return {
      id: uniqueId(card.id),
      timestamp,
      label: card.title,
      themes: [card.themeId, normalize(card.title)],
      regions: cardMappings.map((item) => item.region).filter(Boolean).slice(0, 3),
      symbols: card.symbols.map((symbol) => symbol.symbol),
      avgMovePct: average(moves),
      bestMovePct: moves.length > 0 ? Math.max(...moves.map((value) => Math.abs(value))) : 0,
      conviction: card.conviction,
      falsePositiveRisk: card.falsePositiveRisk,
      direction: card.direction,
      summary: card.thesis,
    };
  });
}

export function scoreAnalog(entry: InvestmentHistoryEntry, currentThemes: string[], currentSymbols: string[], currentRegions: string[], currentDirection: InvestmentDirection): number {
  const themeOverlap = currentThemes.length > 0
    ? entry.themes.filter((theme) => currentThemes.includes(theme)).length / currentThemes.length
    : 0;
  const symbolOverlap = currentSymbols.length > 0
    ? entry.symbols.filter((symbol) => currentSymbols.includes(symbol)).length / currentSymbols.length
    : 0;
  const regionOverlap = currentRegions.length > 0
    ? entry.regions.filter((region) => currentRegions.includes(region)).length / currentRegions.length
    : 0;
  const directionBonus = entry.direction === currentDirection ? 0.12 : entry.direction === 'hedge' ? 0.06 : 0;
  return clamp(Math.round((themeOverlap * 0.56 + symbolOverlap * 0.18 + regionOverlap * 0.14 + directionBonus) * 100), 0, 100);
}

export function buildHistoricalAnalogs(args: {
  history: InvestmentHistoryEntry[];
  ideaCards: InvestmentIdeaCard[];
}): HistoricalAnalog[] {
  const themeSet = Array.from(new Set(args.ideaCards.flatMap((card) => [card.themeId, normalize(card.title)])));
  const symbolSet = Array.from(new Set(args.ideaCards.flatMap((card) => card.symbols.map((symbol) => symbol.symbol))));
  const regionSet = Array.from(new Set(args.ideaCards.map((card) => card.title.split('|')[1]?.trim()).filter(Boolean) as string[]));
  const direction = args.ideaCards[0]?.direction || 'watch';

  const scored = args.history
    .map((entry) => ({ entry, similarity: scoreAnalog(entry, themeSet, symbolSet, regionSet, direction) }))
    .filter((item) => item.similarity >= 28)
    .sort((a, b) => b.similarity - a.similarity || Date.parse(b.entry.timestamp) - Date.parse(a.entry.timestamp));

  return scored.slice(0, MAX_ANALOGS).map(({ entry, similarity }) => {
    const siblings = args.history.filter((item) => item.label === entry.label || item.themes.some((theme) => entry.themes.includes(theme)));
    const positive = siblings.filter((item) => item.avgMovePct >= 0).length;
    return {
      id: entry.id,
      label: entry.label,
      timestamp: entry.timestamp,
      similarity,
      sampleSize: siblings.length,
      avgMovePct: Number(average(siblings.map((item) => item.avgMovePct)).toFixed(2)),
      winRate: siblings.length > 0 ? Math.round((positive / siblings.length) * 100) : 0,
      maxDrawdownPct: Number((Math.min(...siblings.map((item) => item.avgMovePct), 0)).toFixed(2)),
      summary: entry.summary,
      symbols: entry.symbols.slice(0, 6),
      themes: entry.themes.slice(0, 6),
    };
  });
}

// ============================================================================
// HISTORY & DATASET MERGING
// ============================================================================

export function mergeHistory(entries: InvestmentHistoryEntry[], additions: InvestmentHistoryEntry[]): InvestmentHistoryEntry[] {
  const merged = new Map<string, InvestmentHistoryEntry>();
  for (const entry of [...additions, ...entries]) {
    if (!entry.id) continue;
    merged.set(entry.id, entry);
  }
  return Array.from(merged.values())
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, MAX_HISTORY);
}

export function buildDatasetThemeInputs(
  candidates: EventCandidate[],
  ideas: InvestmentIdeaCard[],
  coverageGaps: UniverseCoverageGap[],
): DatasetDiscoveryThemeInput[] {
  const themeMap = new Map<string, DatasetDiscoveryThemeInput>();
  for (const card of ideas) {
    const theme = getThemeRule(card.themeId);
    const gaps = coverageGaps.filter((gap) => gap.themeId === card.themeId);
    themeMap.set(card.themeId, {
      themeId: card.themeId,
      label: card.title.split('|')[0]?.trim() || theme?.label || card.themeId,
      triggers: theme?.triggers.slice(0, 8) || [],
      sectors: Array.from(new Set([
        ...(theme?.sectors || []),
        ...card.sectorExposure,
        ...gaps.flatMap((gap) => gap.missingSectors),
      ])).slice(0, 8),
      commodities: theme?.commodities.slice(0, 6) || [],
      supportingHeadlines: candidates
        .filter((candidate) => findMatchingThemes(candidate).some((row) => row.id === card.themeId))
        .map((candidate) => candidate.title)
        .slice(0, 4),
      suggestedSymbols: Array.from(new Set([
        ...card.symbols.map((symbol) => symbol.symbol),
        ...gaps.flatMap((gap) => gap.suggestedSymbols),
      ])).slice(0, 8),
      priority: clamp(Math.round(card.calibratedConfidence + card.graphSignalScore * 0.18 + Math.max(0, 68 - card.falsePositiveRisk) * 0.14), 35, 96),
    });
  }
  return Array.from(themeMap.values()).slice(0, 8);
}
