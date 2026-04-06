import type { DirectAssetMapping, InvestmentIdeaCard, AutonomyControlState, InvestmentIntelligenceSnapshot, FalsePositiveReasonStat, CandidateExpansionReview } from './types';
import type { SourceCredibilityProfile } from '../source-credibility';
import { clamp } from './utils';
import { normalizeUniverseExpansionPolicy, normalizeUniverseCoverageSummary } from './universe-expansion';
import { buildIdeaAttribution } from '../decision-attribution';
import { buildMacroRiskOverlay } from '../macro-risk-overlay';
import { getExperimentRegistrySnapshot, getActiveWeightProfileSync } from '../experiment-registry';

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

function normalizeCandidateReview(review: CandidateExpansionReview): CandidateExpansionReview {
  return {
    ...review,
  };
}

export function normalizeDirectAssetMapping(mapping: DirectAssetMapping): DirectAssetMapping {
  return {
    ...mapping,
    sourceDiversity: Number(mapping.sourceDiversity) || 0,
    corroborationQuality: Number(mapping.corroborationQuality) || Number(mapping.corroboration) || 0,
    contradictionPenalty: Number(mapping.contradictionPenalty) || 0,
    rumorPenalty: Number(mapping.rumorPenalty) || 0,
    recentEvidenceScore: Number(mapping.recentEvidenceScore) || 0,
    timeDecayWeight: Number(mapping.timeDecayWeight) || 0,
    stalePenalty: Number(mapping.stalePenalty) || 0,
    realityScore: Number(mapping.realityScore) || 0,
    executionPenaltyPct: Number(mapping.executionPenaltyPct) || 0,
    sessionState: mapping.sessionState || 'closed',
    tradableNow: typeof mapping.tradableNow === 'boolean' ? mapping.tradableNow : false,
    graphSignalScore: Number(mapping.graphSignalScore) || 0,
    calibratedConfidence: Number(mapping.calibratedConfidence) || Number(mapping.conviction) || 0,
    confirmationScore: clamp(Number(mapping.confirmationScore) || Number(mapping.calibratedConfidence) || 0, 0, 100),
    confirmationState: mapping.confirmationState === 'confirmed' || mapping.confirmationState === 'tentative' || mapping.confirmationState === 'fading'
      ? mapping.confirmationState
      : 'contradicted',
    convictionFeatures: mapping.convictionFeatures || undefined,
    sizeMultiplier: clamp(Number(mapping.sizeMultiplier) || 1, 0, 1.5),
    horizonMultiplier: clamp(Number(mapping.horizonMultiplier) || 1, 0.4, 1.6),
    executionGate: typeof mapping.executionGate === 'boolean' ? mapping.executionGate : Boolean(mapping.tradableNow),
    coveragePenalty: clamp(Number(mapping.coveragePenalty) || 0, 0, 100),
    autonomyAction: mapping.autonomyAction || 'watch',
    autonomyReasons: Array.isArray(mapping.autonomyReasons) ? mapping.autonomyReasons.slice(0, 6) : [],
    attribution: mapping.attribution || buildIdeaAttribution({
      themeLabel: mapping.themeLabel || mapping.themeId,
      symbol: mapping.symbol,
      corroborationQuality: Number(mapping.corroborationQuality) || 0,
      contradictionPenalty: Number(mapping.contradictionPenalty) || 0,
      recentEvidenceScore: Number(mapping.recentEvidenceScore) || 0,
      stalePenalty: Number(mapping.stalePenalty) || 0,
      realityScore: Number(mapping.realityScore) || 0,
      transferEntropy: Number(mapping.transferEntropy) || 0,
      banditScore: Number(mapping.banditScore) || 0,
      graphSignalScore: Number(mapping.graphSignalScore) || 0,
      regimeMultiplier: Number(mapping.regimeMultiplier) || 1,
      macroPenalty: 0,
      falsePositiveRisk: Number(mapping.falsePositiveRisk) || 0,
      marketMovePct: mapping.marketMovePct ?? null,
    }),
  };
}

export function normalizeInvestmentIdeaCard(card: InvestmentIdeaCard): InvestmentIdeaCard {
  return {
    ...card,
    calibratedConfidence: Number(card.calibratedConfidence) || Number(card.conviction) || 0,
    confidenceBand: card.confidenceBand || 'guarded',
    autonomyAction: card.autonomyAction || (card.direction === 'watch' ? 'watch' : 'shadow'),
    autonomyReasons: Array.isArray(card.autonomyReasons) ? card.autonomyReasons.slice(0, 6) : [],
    realityScore: Number(card.realityScore) || 0,
    graphSignalScore: Number(card.graphSignalScore) || 0,
    timeDecayWeight: Number(card.timeDecayWeight) || 0,
    recentEvidenceScore: Number(card.recentEvidenceScore) || 0,
    corroborationQuality: Number(card.corroborationQuality) || 0,
    transferEntropy: Number(card.transferEntropy) || 0,
    banditScore: Number(card.banditScore) || 0,
    regimeMultiplier: Number(card.regimeMultiplier) || 1,
    convictionFeatures: card.convictionFeatures || undefined,
    confirmationScore: clamp(Number(card.confirmationScore) || Number(card.calibratedConfidence) || 0, 0, 100),
    confirmationState: card.confirmationState === 'confirmed' || card.confirmationState === 'tentative' || card.confirmationState === 'fading'
      ? card.confirmationState
      : 'contradicted',
    sizeMultiplier: clamp(Number(card.sizeMultiplier) || 1, 0, 1.5),
    horizonMultiplier: clamp(Number(card.horizonMultiplier) || 1, 0.4, 1.6),
    executionGate: typeof card.executionGate === 'boolean' ? card.executionGate : card.autonomyAction !== 'abstain',
    coveragePenalty: clamp(Number(card.coveragePenalty) || 0, 0, 100),
    attribution: card.attribution || {
      primaryDriver: 'Unspecified',
      primaryPenalty: 'Unspecified',
      components: [],
      narrative: '',
      failureModes: [],
    },
    symbols: Array.isArray(card.symbols) ? card.symbols.map((symbol) => ({
      ...symbol,
      liquidityScore: typeof symbol.liquidityScore === 'number' ? symbol.liquidityScore : null,
      realityScore: typeof symbol.realityScore === 'number' ? symbol.realityScore : null,
    })) : [],
    preferredHorizonHours: typeof card.preferredHorizonHours === 'number' ? Math.max(1, Math.round(card.preferredHorizonHours)) : null,
    horizonCandidatesHours: Array.isArray(card.horizonCandidatesHours)
      ? Array.from(new Set(card.horizonCandidatesHours.map((value) => Math.max(1, Math.round(Number(value) || 0))).filter(Boolean))).sort((a, b) => a - b)
      : [],
    horizonLearningConfidence: typeof card.horizonLearningConfidence === 'number' ? clamp(Math.round(card.horizonLearningConfidence), 0, 99) : null,
    timeframeSource: card.timeframeSource === 'replay-learned' ? 'replay-learned' : 'theme-default',
  };
}

export function normalizeAutonomyControlState(state?: Partial<AutonomyControlState> | null): AutonomyControlState {
  return {
    shadowMode: Boolean(state?.shadowMode),
    rollbackLevel: state?.rollbackLevel === 'armed' || state?.rollbackLevel === 'watch' ? state.rollbackLevel : 'normal',
    recentSampleCount: Number(state?.recentSampleCount) || 0,
    recentHitRate: Number(state?.recentHitRate) || 0,
    recentAvgReturnPct: Number(state?.recentAvgReturnPct) || 0,
    recentDrawdownPct: Number(state?.recentDrawdownPct) || 0,
    staleIdeaCount: Number(state?.staleIdeaCount) || 0,
    deployCount: Number(state?.deployCount) || 0,
    shadowCount: Number(state?.shadowCount) || 0,
    watchCount: Number(state?.watchCount) || 0,
    abstainCount: Number(state?.abstainCount) || 0,
    realityBlockedCount: Number(state?.realityBlockedCount) || 0,
    recentEvidenceWeakCount: Number(state?.recentEvidenceWeakCount) || 0,
    notes: Array.isArray(state?.notes) ? state!.notes.slice(0, 8) : [],
  };
}

export function normalizeInvestmentSnapshot(snapshot: InvestmentIntelligenceSnapshot | null | undefined): InvestmentIntelligenceSnapshot | null {
  if (!snapshot) return null;
  return {
    ...snapshot,
    macroOverlay: snapshot.macroOverlay || buildMacroRiskOverlay({
      regime: snapshot.regime ?? null,
      markets: [],
      clusters: [],
      weightProfile: getActiveWeightProfileSync(),
    }),
    directMappings: Array.isArray(snapshot.directMappings)
      ? snapshot.directMappings.map((mapping) => normalizeDirectAssetMapping(mapping))
      : [],
    ideaCards: Array.isArray(snapshot.ideaCards)
      ? snapshot.ideaCards.map((card) => normalizeInvestmentIdeaCard(card))
      : [],
    universePolicy: normalizeUniverseExpansionPolicy(snapshot.universePolicy),
    universeCoverage: normalizeUniverseCoverageSummary(snapshot.universeCoverage),
    coverageGaps: Array.isArray(snapshot.coverageGaps)
      ? snapshot.coverageGaps.map((gap) => ({
        ...gap,
        missingAssetKinds: Array.isArray(gap.missingAssetKinds) ? gap.missingAssetKinds.slice() : [],
        missingSectors: Array.isArray(gap.missingSectors) ? gap.missingSectors.slice() : [],
        suggestedSymbols: Array.isArray(gap.suggestedSymbols) ? gap.suggestedSymbols.slice() : [],
      }))
      : [],
    candidateReviews: Array.isArray(snapshot.candidateReviews)
      ? snapshot.candidateReviews.map((review) => normalizeCandidateReview(review))
      : [],
    autonomy: normalizeAutonomyControlState(snapshot.autonomy),
    hiddenCandidates: Array.isArray(snapshot.hiddenCandidates) ? snapshot.hiddenCandidates.slice(0, 24) : [],
    experimentRegistry: snapshot.experimentRegistry || getExperimentRegistrySnapshot(),
    datasetAutonomy: snapshot.datasetAutonomy || {
      mode: 'guarded-auto',
      proposals: [],
    },
    coverageLedger: snapshot.coverageLedger || null,
  };
}

export function findSourceCredibility(map: Map<string, SourceCredibilityProfile>, source: string): SourceCredibilityProfile | null {
  return map.get(normalize(source)) || null;
}

export function inferRegion(text: string): string {
  if (/iran|israel|qatar|hormuz|tehran|riyadh|saudi|beirut|lebanon/.test(text)) return 'Middle East';
  if (/ukraine|russia|moscow|kyiv|europe|eu|france|germany/.test(text)) return 'Europe';
  if (/china|taiwan|japan|korea|north korea|south china sea|indopacom/.test(text)) return 'Asia-Pacific';
  if (/africa|sahel|sudan|ethiopia|nigeria|congo/.test(text)) return 'Africa';
  if (/latin america|brazil|argentina|venezuela|mexico/.test(text)) return 'Latin America';
  if (/united states|u\.s\.|washington|fed|wall street/.test(text)) return 'United States';
  return 'Global';
}

export function reasonCountsFromMap(reasonMap: Map<string, number>): FalsePositiveReasonStat[] {
  return Array.from(reasonMap.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, 8);
}

export function extractGraphTerms(text: string, reasons: string[] = []): string[] {
  const combined = normalize([text, ...reasons].join(' '));
  return Array.from(new Set(combined.split(' ').filter((token) => token.length >= 4))).slice(0, 14);
}
