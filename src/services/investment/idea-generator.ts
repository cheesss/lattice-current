import type { MarketData } from '@/types';
import type { EventMarketTransmissionSnapshot } from '../event-market-transmission';
import type { KeywordGraphSnapshot } from '../keyword-registry';
import type { SelfTuningWeightProfile } from '../experiment-registry';
import type { MacroRiskOverlay } from '../macro-risk-overlay';
import type { ReplayAdaptationSnapshot } from '../replay-adaptation';
import type { AutonomyAction, ConfidenceBand } from '../autonomy-constraints';
import { estimateTransferEntropy } from '../math-models/transfer-entropy';
import { scoreBanditArm } from '../math-models/contextual-bandit';
import { regimeMultiplierForTheme } from '../math-models/regime-model';
import { estimateDirectionalFlowSummary } from '../information-flow';
import { assessExecutionReality, assessRecency, calibrateDecision } from '../autonomy-constraints';
import { buildIdeaAttribution } from '../decision-attribution';
import { getReplayThemeProfileFromSnapshot, parseThemeTimeframeCandidates, formatLearnedTimeframe, getCurrentThemePerformanceFromSnapshot } from '../replay-adaptation';
import { assessGraphSupport } from '../graph-propagation';

import type {
  EventCandidate,
  DirectAssetMapping, InvestmentIdeaCard, InvestmentIdeaSymbol, InvestmentHistoryEntry,
  HistoricalAnalog, ConvictionFeatureSnapshot,
  MappingPerformanceStats,
  InvestmentDirection,
  UniverseCoverageGap, AutonomyControlState, IdeaGenerationRuntimeContext,
} from './types';
import type { DatasetDiscoveryThemeInput } from '../dataset-discovery';
import { UNIVERSE_ASSET_CATALOG, MAX_MAPPINGS, MAX_IDEAS, MAX_ANALOGS, MAX_HISTORY } from './constants';
import {
  clamp, normalize, average, median,
  uniqueId, nowIso,
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

// ── Sub-module imports ──────────────────────────────────────────────────────
import {
  buildBanditContext,
  buildEventIntensitySeries,
  buildMarketSignalSeries,
  buildTimedEventFlowSeries,
  buildTimedMarketFlowSeries,
  buildKnowledgeGraphMappingSupport,
} from './idea-generation/event-candidates';

import {
  liquidityBaseline,
  macroPenaltyForAsset,
  marketMoveMap,
  dedupeIdeaSymbols,
} from './idea-generation/symbol-scoring';

import {
  marketConfirmationScore,
  confirmationStateFromScore,
} from './idea-generation/confirmation';

import { applyMetaTradeAdmission } from './idea-generation/meta-admission';
import { mergeAttributionBreakdown } from './idea-generation/attribution';

// ── Re-exports: sub-modules ─────────────────────────────────────────────────
// These re-exports ensure that external importers of idea-generator.ts
// continue to find every function at its original path.
export {
  buildEventCandidates,
  parseReportHistory,
  buildBanditContext,
  buildEventIntensitySeries,
  buildMarketSignalSeries,
  buildTimedEventFlowSeries,
  buildTimedMarketFlowSeries,
  buildKnowledgeGraphMappingSupport,
} from './idea-generation/event-candidates';

export {
  rankIdeaSymbolRole,
  scoreIdeaSymbolChoice,
  dedupeIdeaSymbols,
  liquidityBaseline,
  macroPenaltyForAsset,
  marketMoveMap,
  executionReadinessScore,
} from './idea-generation/symbol-scoring';

export {
  marketConfirmationScore,
  confirmationStateFromScore,
  applyAdaptiveConfirmationLayer,
  buildCurrentThemePerformanceMetrics,
  buildRollingThemePerformanceMetrics,
  buildSensitivityRows,
  getCurrentThemePerformanceMetric,
  estimateRegimeConditionalHalfLife,
  scoreCurrentPerformanceInfluence,
} from './idea-generation/confirmation';

export {
  getMetaWeightsLoadState,
  applyMetaTradeAdmission,
} from './idea-generation/meta-admission';
export type { MetaWeightsLoadState } from './idea-generation/meta-admission';

export {
  mergeAttributionBreakdown,
} from './idea-generation/attribution';

// ── Re-exports: shared-ranking (unchanged) ──────────────────────────────────
export {
  buildRecentReturnSeries,
  estimateMacroStressProbability,
  isCoreInstrumentSymbol,
  summarizeInstrumentMix,
  estimateCoreOrbitalAlignmentScore,
  buildCoreOrbitalExecutionPlan,
} from './shared-ranking';

// ============================================================================
// UTILITY: Horizon Learning Resolution & Scaling
// ============================================================================

function asTs(iso: string): number {
  return Date.parse(iso);
}

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
  const halfLifeMultiplier = clamp(halfLifeHours / preferredHours, 0.12, 1);
  return {
    rho: Number(rho.toFixed(4)),
    halfLifeHours: Number(halfLifeHours.toFixed(0)),
    multiplier: Number(halfLifeMultiplier.toFixed(4)),
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

// ============================================================================
// DIRECT MAPPINGS: Build event-to-asset transmission mappings
// ============================================================================

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
  const marketMapData = marketMoveMap(args.markets);
  const regime = args.transmission?.regime ?? null;
  const mappings: DirectAssetMapping[] = [];

  for (const candidate of args.candidates) {
    const themeMatches = buildThemeMatchDetails(candidate);
    if (!themeMatches.length) continue;

    for (const match of themeMatches) {
      const theme = match.theme;
      const themePolicy = resolveThemePolicy(theme);
      for (const asset of selectThemeAssetsForCandidate(theme, candidate, match)) {
        const market = marketMapData.get(asset.symbol);
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
// IDEA CARDS & HISTORY BUILDING
// ============================================================================

export function buildIdeaCards(
  mappings: DirectAssetMapping[],
  analogs: HistoricalAnalog[],
  macroOverlay: MacroRiskOverlay,
  replayAdaptation: ReplayAdaptationSnapshot | null,
  runtimeContext: IdeaGenerationRuntimeContext,
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

  const admissionAdjustedCards = cards.map((card) => applyMetaTradeAdmission(card, macroOverlay, replayAdaptation, runtimeContext));

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
