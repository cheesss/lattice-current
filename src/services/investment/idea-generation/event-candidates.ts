import type { ClusteredEvent } from '@/types';
import type { EventMarketTransmissionSnapshot } from '../../event-market-transmission';
import type { SourceCredibilityProfile } from '../../source-credibility';
import type { ScheduledReport } from '../../scheduled-reports';
import type { TimedFlowPoint } from '../../information-flow';
import type { KnowledgeGraphRelationEvidence } from '../../knowledge-graph';
import { computeHawkesIntensity } from '../../math-models/hawkes-process';
import { inferKnowledgeGraphSupport } from '../../knowledge-graph';
import { assessCrossCorroboration } from '../../autonomy-constraints';
import { getSignificantPatterns } from '../../pattern-discovery';

import type {
  EventCandidate, AdaptiveEventPolicy, ThemeAssetDefinition,
  InvestmentThemeDefinition, InvestmentHistoryEntry,
  FalsePositiveStats, MarketHistoryPoint,
} from '../types';
import {
  ARCHIVE_RE, SPORTS_RE, LOW_SIGNAL_RE,
} from '../constants';
import * as S from '../module-state';
import {
  clamp, normalize, normalizeMatchable, matchesThemeTrigger,
  percentile, average,
  titleId,
} from '../utils';
import { findSourceCredibility, inferRegion, reasonCountsFromMap, extractGraphTerms } from '../normalizers';

type ThemeRule = InvestmentThemeDefinition;

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
