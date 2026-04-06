import type { MarketData } from '@/types';
import type {
  CandidateExpansionReview,
  UniverseExpansionPolicy,
  UniverseCoverageSummary,
  UniverseCoverageGap,
  ThemeAssetDefinition,
  UniverseAssetDefinition,
  InvestmentAssetKind,
  InvestmentDirection,
  DirectAssetMapping,
  EventBacktestRow,
  EventCandidate,
  InvestmentThemeDefinition,
} from './types';
import {
  UNIVERSE_ASSET_CATALOG,
  DEFAULT_UNIVERSE_EXPANSION_POLICY,
  MAX_CANDIDATE_REVIEWS,
} from './constants';
import { candidateReviews } from './module-state';
import {
  nowIso,
  clamp,
  candidateReviewId,
  themeAssetKey,
  normalize,
} from './utils';
import {
  getThemeRule,
  getEffectiveThemeAssets,
  listEffectiveThemeCatalog,
  buildWatchlistLookup,
} from './theme-registry';

export function reviewToThemeAsset(review: CandidateExpansionReview): ThemeAssetDefinition {
  return {
    symbol: review.symbol,
    name: review.assetName,
    assetKind: review.assetKind,
    sector: review.sector,
    commodity: review.commodity || undefined,
    direction: review.direction,
    role: review.role,
  };
}

export function normalizeCandidateReview(review: CandidateExpansionReview): CandidateExpansionReview {
  return {
    ...review,
    supportingSignals: Array.isArray(review.supportingSignals) ? review.supportingSignals.slice(0, 8) : [],
    knowledgeGraphScore: Number(review.knowledgeGraphScore) || 0,
    coverageGainScore: Number(review.coverageGainScore) || 0,
    replayUtilityGainScore: Number(review.replayUtilityGainScore) || 0,
    source: review.source || 'heuristic',
    status: review.status || 'open',
    autoApproved: Boolean(review.autoApproved),
    autoApprovalMode: review.autoApprovalMode || null,
    acceptedAt: review.acceptedAt || null,
    probationStatus: review.probationStatus || (review.autoApproved ? 'active' : 'n/a'),
    probationCycles: Number.isFinite(review.probationCycles) ? review.probationCycles : 0,
    probationHits: Number.isFinite(review.probationHits) ? review.probationHits : 0,
    probationMisses: Number.isFinite(review.probationMisses) ? review.probationMisses : 0,
    lastUpdatedAt: review.lastUpdatedAt || nowIso(),
  };
}

export function normalizeUniverseExpansionPolicy(policy?: Partial<UniverseExpansionPolicy> | null): UniverseExpansionPolicy {
  return {
    mode: policy?.mode === 'manual' || policy?.mode === 'guarded-auto' || policy?.mode === 'full-auto'
      ? policy.mode
      : DEFAULT_UNIVERSE_EXPANSION_POLICY.mode,
    minCodexConfidence: clamp(Number(policy?.minCodexConfidence) || DEFAULT_UNIVERSE_EXPANSION_POLICY.minCodexConfidence, 40, 95),
    minAutoApproveScore: clamp(Number(policy?.minAutoApproveScore) || DEFAULT_UNIVERSE_EXPANSION_POLICY.minAutoApproveScore, 45, 98),
    maxAutoApprovalsPerTheme: clamp(Math.round(Number(policy?.maxAutoApprovalsPerTheme) || DEFAULT_UNIVERSE_EXPANSION_POLICY.maxAutoApprovalsPerTheme), 1, 6),
    maxAutoApprovalsPerSectorPerTheme: clamp(Math.round(Number(policy?.maxAutoApprovalsPerSectorPerTheme) || DEFAULT_UNIVERSE_EXPANSION_POLICY.maxAutoApprovalsPerSectorPerTheme), 1, 4),
    maxAutoApprovalsPerAssetKindPerTheme: clamp(Math.round(Number(policy?.maxAutoApprovalsPerAssetKindPerTheme) || DEFAULT_UNIVERSE_EXPANSION_POLICY.maxAutoApprovalsPerAssetKindPerTheme), 1, 4),
    requireMarketData: typeof policy?.requireMarketData === 'boolean' ? policy.requireMarketData : DEFAULT_UNIVERSE_EXPANSION_POLICY.requireMarketData,
    probationCycles: clamp(Math.round(Number(policy?.probationCycles) || DEFAULT_UNIVERSE_EXPANSION_POLICY.probationCycles), 1, 12),
    autoDemoteMisses: clamp(Math.round(Number(policy?.autoDemoteMisses) || DEFAULT_UNIVERSE_EXPANSION_POLICY.autoDemoteMisses), 1, 12),
  };
}

export function normalizeUniverseCoverageSummary(summary?: Partial<UniverseCoverageSummary> | null): UniverseCoverageSummary {
  return {
    totalCatalogAssets: Number(summary?.totalCatalogAssets) || 0,
    activeAssetKinds: Array.isArray(summary?.activeAssetKinds) ? summary!.activeAssetKinds.slice() : [],
    activeSectors: Array.isArray(summary?.activeSectors) ? summary!.activeSectors.slice() : [],
    directMappingCount: Number(summary?.directMappingCount) || 0,
    dynamicApprovedCount: Number(summary?.dynamicApprovedCount) || 0,
    openReviewCount: Number(summary?.openReviewCount) || 0,
    gapCount: Number(summary?.gapCount) || 0,
    uncoveredThemeCount: Number(summary?.uncoveredThemeCount) || 0,
  };
}

export function scoreExpansionCandidate(args: {
  candidate: EventCandidate;
  theme: InvestmentThemeDefinition;
  asset: UniverseAssetDefinition;
  inWatchlist: boolean;
  hasMarketData: boolean;
}): number {
  const aliasBoost = (args.asset.aliases || []).some((alias) => args.candidate.text.includes(normalize(alias))) ? 10 : 0;
  const commodityBoost = args.asset.commodity && args.theme.commodities.includes(args.asset.commodity) ? 5 : 0;
  const watchlistBoost = args.inWatchlist ? 8 : 0;
  const marketBoost = args.hasMarketData ? 6 : 0;
  const liquidityBoost = args.asset.liquidityTier === 'core' ? 8 : args.asset.liquidityTier === 'high' ? 5 : 2;
  return clamp(
    Math.round(
      36
      + args.candidate.credibility * 0.2
      + args.candidate.corroboration * 0.12
      + args.candidate.marketStress * 18
      + args.candidate.aftershockIntensity * 12
      + aliasBoost
      + commodityBoost
      + watchlistBoost
      + marketBoost
      + liquidityBoost,
    ),
    28,
    96,
  );
}

function findMatchingThemes(candidate: EventCandidate): InvestmentThemeDefinition[] {
  const themeCatalog = listEffectiveThemeCatalog();
  const matches = themeCatalog.filter((rule) => rule.triggers.some((trigger) => matchesThemeTrigger(candidate.text, trigger)));
  if (matches.length > 0) return matches;
  if (candidate.matchedSymbols.length > 0 && candidate.marketStress >= 0.55) {
    return themeCatalog.filter((rule) => candidate.matchedSymbols.some((symbol) => themeHasAssetSymbol(rule, symbol)));
  }
  return [];
}

function marketMoveMap(markets: MarketData[]): Map<string, MarketData> {
  const map = new Map<string, MarketData>();
  for (const market of markets) {
    if (market.symbol) map.set(market.symbol, market);
  }
  return map;
}

function dedupeThemeAssets(assets: ThemeAssetDefinition[]): ThemeAssetDefinition[] {
  const seen = new Set<string>();
  const output: ThemeAssetDefinition[] = [];
  for (const asset of assets) {
    const key = themeAssetKey(asset);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(asset);
  }
  return output;
}

function buildKnowledgeGraphMappingSupport(args: {
  theme: InvestmentThemeDefinition;
  candidate: EventCandidate;
  asset: UniverseAssetDefinition;
  graphSignalScore: number;
  transferEntropy: number;
  informationFlowScore: number;
  leadLagScore: number;
  replayUtility: number;
}): {
  supportScore: number;
  dominantRelationType: string;
} {
  return {
    supportScore: clamp(
      Math.round(
        args.graphSignalScore * 0.34
        + args.transferEntropy * 0.18
        + args.informationFlowScore * 0.26
        + args.leadLagScore * 0.12
        + args.replayUtility * 0.1,
      ),
      0,
      100,
    ),
    dominantRelationType: args.asset.commodity ? 'commodity-exposure' : `${args.asset.sector}-exposure`,
  };
}

function matchesThemeTrigger(text: string, trigger: string): boolean {
  const normalized = normalize(text);
  const normalizedTrigger = normalize(trigger);
  return normalized.includes(normalizedTrigger);
}

function themeHasAssetSymbol(rule: InvestmentThemeDefinition, symbol: string): boolean {
  return rule.assets.some((asset: ThemeAssetDefinition) => normalize(asset.symbol) === normalize(symbol));
}

export function buildCandidateExpansionReviews(args: {
  candidates: EventCandidate[];
  markets: MarketData[];
}): CandidateExpansionReview[] {
  const marketMap = marketMoveMap(args.markets);
  const watchlistLookup = buildWatchlistLookup();
  const nextReviews = new Map<string, CandidateExpansionReview>();

  for (const candidate of args.candidates) {
    const themes = findMatchingThemes(candidate);
    for (const theme of themes) {
      const effectiveAssets = new Set(getEffectiveThemeAssets(theme).map(themeAssetKey));
      const effectiveThemeAssets = getEffectiveThemeAssets(theme);
      const existingSectors = new Set(effectiveThemeAssets.map((item) => normalize(item.sector)));
      const existingKinds = new Set(effectiveThemeAssets.map((item) => item.assetKind));
      const existingCommodities = new Set(
        effectiveThemeAssets
          .map((item) => normalize(item.commodity || ''))
          .filter(Boolean),
      );
      const themeCatalog = UNIVERSE_ASSET_CATALOG.filter((asset) => asset.themeIds.includes(theme.id));

      for (const asset of themeCatalog) {
        if (effectiveAssets.has(themeAssetKey(asset))) continue;
        const reviewId = candidateReviewId(theme.id, asset.symbol, asset.direction, asset.role);
        const previous = candidateReviews.get(reviewId);
        const inWatchlist = watchlistLookup.has(normalize(asset.symbol));
        const hasMarketData = marketMap.has(asset.symbol);
        const knowledgeGraphSupport = buildKnowledgeGraphMappingSupport({
          theme,
          candidate,
          asset,
          graphSignalScore: clamp(candidate.corroborationQuality + candidate.sourceDiversity * 4, 0, 100),
          transferEntropy: 0,
          informationFlowScore: clamp(candidate.marketStress * 100, 0, 100),
          leadLagScore: clamp((candidate.aftershockIntensity - 0.25) * 100, -100, 100),
          replayUtility: Number(((candidate.marketStress + candidate.aftershockIntensity) * 20).toFixed(2)),
        });
        const coverageGainScore = clamp(
          Math.round(
            32
            + (existingSectors.has(normalize(asset.sector)) ? 0 : 24)
            + (existingKinds.has(asset.assetKind) ? 0 : 18)
            + (asset.commodity && !existingCommodities.has(normalize(asset.commodity)) ? 12 : 0)
            + (hasMarketData ? 6 : 0),
          ),
          12,
          100,
        );
        const replayUtilityGainScore = clamp(
          Math.round(
            20
            + candidate.marketStress * 18
            + candidate.aftershockIntensity * 16
            + candidate.corroborationQuality * 0.14
            + (hasMarketData ? 8 : 0)
            + (inWatchlist ? 4 : 0),
          ),
          12,
          100,
        );
        const confidence = clamp(
          Math.round(
            scoreExpansionCandidate({ candidate, theme, asset, inWatchlist, hasMarketData }) * 0.72
            + knowledgeGraphSupport.supportScore * 0.16
            + coverageGainScore * 0.08
            + replayUtilityGainScore * 0.04,
          ),
          24,
          98,
        );
        const supportingSignals = [
          candidate.title,
          `Theme=${theme.label}`,
          `Credibility=${candidate.credibility}`,
          `Corroboration=${candidate.corroboration}`,
          `Stress=${candidate.marketStress.toFixed(2)}`,
          `Aftershock=${candidate.aftershockIntensity.toFixed(2)}`,
          `KG=${knowledgeGraphSupport.supportScore.toFixed(0)} ${knowledgeGraphSupport.dominantRelationType}`,
          `CoverageGain=${coverageGainScore}`,
          `ReplayValue=${replayUtilityGainScore}`,
          ...(asset.aliases || []).filter((alias) => candidate.text.includes(normalize(alias))).map((alias) => `Alias=${alias}`),
          ...(inWatchlist ? ['User watchlist overlap'] : []),
          ...(hasMarketData ? ['Live market data available'] : ['No live market data yet']),
        ].slice(0, 7);

        const review: CandidateExpansionReview = {
          id: reviewId,
          themeId: theme.id,
          themeLabel: theme.label,
          symbol: asset.symbol,
          assetName: inWatchlist ? (watchlistLookup.get(normalize(asset.symbol))?.name || asset.name) : asset.name,
          assetKind: asset.assetKind,
          sector: asset.sector,
          commodity: asset.commodity || null,
          direction: asset.direction,
          role: asset.role,
          confidence,
          source: previous?.source || (inWatchlist ? 'watchlist' : 'heuristic'),
          status: previous?.status || 'open',
          reason: previous?.reason || `${asset.name} extends ${theme.label} coverage into ${asset.sector}${asset.commodity ? ` / ${asset.commodity}` : ''}.`,
          supportingSignals: previous?.supportingSignals?.length ? previous.supportingSignals.slice(0, 8) : supportingSignals,
          requiresMarketData: !hasMarketData,
          knowledgeGraphScore: Number(knowledgeGraphSupport.supportScore.toFixed(2)),
          coverageGainScore,
          replayUtilityGainScore,
          autoApproved: previous?.autoApproved || false,
          autoApprovalMode: previous?.autoApprovalMode || null,
          acceptedAt: previous?.acceptedAt || null,
          probationStatus: previous?.probationStatus || 'n/a',
          probationCycles: previous?.probationCycles || 0,
          probationHits: previous?.probationHits || 0,
          probationMisses: previous?.probationMisses || 0,
          lastUpdatedAt: nowIso(),
        };
        const existing = nextReviews.get(reviewId);
        if (!existing || existing.confidence < review.confidence) {
          nextReviews.set(reviewId, review);
        }
      }
    }
  }

  for (const existing of candidateReviews.values()) {
    if (!nextReviews.has(existing.id)) nextReviews.set(existing.id, existing);
  }

  return Array.from(nextReviews.values())
    .sort((a, b) => {
      const statusRank = (value: CandidateExpansionReview['status']): number => (value === 'open' ? 0 : value === 'accepted' ? 1 : 2);
      return statusRank(a.status) - statusRank(b.status)
        || b.confidence - a.confidence
        || Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt);
    })
    .slice(0, MAX_CANDIDATE_REVIEWS);
}

function countAutoApprovedByTheme(reviews: CandidateExpansionReview[], themeId: string): number {
  return reviews.filter((review) => review.themeId === themeId && review.status === 'accepted' && review.autoApproved).length;
}

function countAcceptedByThemeSector(reviews: CandidateExpansionReview[], themeId: string, sector: string): number {
  return reviews.filter((review) =>
    review.themeId === themeId
    && review.status === 'accepted'
    && normalize(review.sector) === normalize(sector),
  ).length;
}

function countAcceptedByThemeAssetKind(reviews: CandidateExpansionReview[], themeId: string, assetKind: InvestmentAssetKind): number {
  return reviews.filter((review) =>
    review.themeId === themeId
    && review.status === 'accepted'
    && review.assetKind === assetKind,
  ).length;
}

function countAcceptedByThemeDirection(reviews: CandidateExpansionReview[], themeId: string, direction: InvestmentDirection): number {
  return reviews.filter((review) =>
    review.themeId === themeId
    && review.status === 'accepted'
    && review.direction === direction,
  ).length;
}

interface CandidateAutoApprovalAssessment {
  approved: boolean;
  score: number;
  reason: string;
}

function assessAutoApprovalReview(
  review: CandidateExpansionReview,
  policy: UniverseExpansionPolicy,
  allReviews: CandidateExpansionReview[],
): CandidateAutoApprovalAssessment {
  if (review.status !== 'open') return { approved: false, score: 0, reason: 'not-open' };
  if (policy.mode === 'manual') return { approved: false, score: 0, reason: 'manual-policy' };
  if (policy.requireMarketData && review.requiresMarketData) return { approved: false, score: 0, reason: 'market-data-required' };

  const themeApproved = countAutoApprovedByTheme(allReviews, review.themeId);
  if (themeApproved >= policy.maxAutoApprovalsPerTheme) {
    return { approved: false, score: 0, reason: 'theme-cap-reached' };
  }

  const acceptedInSector = countAcceptedByThemeSector(allReviews, review.themeId, review.sector);
  if (acceptedInSector >= policy.maxAutoApprovalsPerSectorPerTheme) {
    return { approved: false, score: 0, reason: 'sector-cap-reached' };
  }

  const acceptedInAssetKind = countAcceptedByThemeAssetKind(allReviews, review.themeId, review.assetKind);
  if (acceptedInAssetKind >= policy.maxAutoApprovalsPerAssetKindPerTheme) {
    return { approved: false, score: 0, reason: 'asset-kind-cap-reached' };
  }

  if (policy.mode === 'guarded-auto' && review.source === 'codex' && review.confidence < policy.minCodexConfidence) {
    return { approved: false, score: review.confidence, reason: 'codex-confidence-too-low' };
  }

  let score = review.confidence;
  const sourceBonus = review.source === 'codex'
    ? 10
    : review.source === 'market'
      ? 8
      : review.source === 'watchlist'
        ? 6
        : 2;
  const roleBonus = review.role === 'hedge' ? 7 : review.role === 'confirm' ? 4 : 1;
  const signalBonus = Math.min(12, review.supportingSignals.length * 2);
  const assetKindBonus = review.assetKind === 'etf' ? 5 : review.assetKind === 'commodity' || review.assetKind === 'fx' || review.assetKind === 'rate' ? 4 : 2;
  const commodityBonus = review.commodity ? 4 : 0;
  const knowledgeBonus = clamp(Math.round((Number(review.knowledgeGraphScore) || 0) * 0.12), 0, 12);
  const coverageBonus = clamp(Math.round((Number(review.coverageGainScore) || 0) * 0.08), 0, 10);
  const replayValueBonus = clamp(Math.round((Number(review.replayUtilityGainScore) || 0) * 0.06), 0, 8);
  const missingMarketPenalty = review.requiresMarketData ? 14 : 0;
  const sectorCrowdingPenalty = acceptedInSector * 12;
  const assetKindCrowdingPenalty = acceptedInAssetKind * 10;
  const directionCrowdingPenalty = countAcceptedByThemeDirection(allReviews, review.themeId, review.direction) * 4;
  const themeCrowdingPenalty = themeApproved * 5;
  score += sourceBonus + roleBonus + signalBonus + assetKindBonus + commodityBonus + knowledgeBonus + coverageBonus + replayValueBonus;
  score -= missingMarketPenalty + sectorCrowdingPenalty + assetKindCrowdingPenalty + directionCrowdingPenalty + themeCrowdingPenalty;
  score = clamp(Math.round(score), 0, 100);

  const threshold = policy.mode === 'full-auto'
    ? Math.max(52, policy.minAutoApproveScore - 12)
    : policy.minAutoApproveScore;
  const approved = score >= threshold;
  const reason = `score=${score} source=${review.source} role=${review.role} sectorFill=${acceptedInSector}/${policy.maxAutoApprovalsPerSectorPerTheme} kindFill=${acceptedInAssetKind}/${policy.maxAutoApprovalsPerAssetKindPerTheme}`;
  return { approved, score, reason };
}

export function applyUniverseExpansionPolicy(reviews: CandidateExpansionReview[], policy: UniverseExpansionPolicy): CandidateExpansionReview[] {
  const output = reviews.map((review) => ({ ...review }));
  for (let index = 0; index < output.length; index += 1) {
    const review = output[index]!;
    const assessment = assessAutoApprovalReview(review, policy, output);
    if (!assessment.approved) continue;
    const acceptedAt = nowIso();
    output[index] = {
      ...review,
      status: 'accepted',
      autoApproved: true,
      autoApprovalMode: policy.mode,
      acceptedAt,
      probationStatus: 'active',
      probationCycles: 0,
      probationHits: 0,
      probationMisses: 0,
      reason: `${review.reason} Auto-approved by ${policy.mode} policy (${assessment.reason}).`,
      lastUpdatedAt: acceptedAt,
    };
  }
  return output;
}

export function evaluateCandidateReviewProbation(args: {
  reviews: CandidateExpansionReview[];
  activeCandidates: EventCandidate[];
  mappings: DirectAssetMapping[];
  backtests: EventBacktestRow[];
  policy: UniverseExpansionPolicy;
}): CandidateExpansionReview[] {
  const activeThemeIds = new Set(args.activeCandidates.flatMap((candidate) => findMatchingThemes(candidate).map((theme) => theme.id)));
  return args.reviews.map((review) => {
    if (review.status !== 'accepted' || !review.autoApproved) return review;
    if (!activeThemeIds.has(review.themeId)) return review;

    const hasMapping = args.mappings.some((mapping) =>
      mapping.themeId === review.themeId
      && normalize(mapping.symbol) === normalize(review.symbol)
      && mapping.direction === review.direction,
    );
    const hasBacktest = args.backtests.some((row) =>
      row.themeId === review.themeId
      && normalize(row.symbol) === normalize(review.symbol)
      && row.direction === review.direction,
    );
    const hit = hasMapping || hasBacktest;
    const nextCycles = review.probationCycles + 1;
    const nextHits = review.probationHits + (hit ? 1 : 0);
    const nextMisses = review.probationMisses + (hit ? 0 : 1);
    const next: CandidateExpansionReview = {
      ...review,
      probationCycles: nextCycles,
      probationHits: nextHits,
      probationMisses: nextMisses,
      lastUpdatedAt: nowIso(),
    };

    if (!hit && nextMisses >= args.policy.autoDemoteMisses) {
      return {
        ...next,
        status: 'open',
        autoApproved: false,
        probationStatus: 'demoted',
        autoApprovalMode: review.autoApprovalMode || args.policy.mode,
        reason: `${review.reason} Auto-demoted after ${nextMisses} probation misses.`,
      };
    }
    if (hit && nextCycles >= args.policy.probationCycles) {
      return {
        ...next,
        probationStatus: 'graduated',
      };
    }
    return {
      ...next,
      probationStatus: 'active',
    };
  });
}

export function buildCoverageGaps(args: {
  candidates: EventCandidate[];
  reviews: CandidateExpansionReview[];
}): UniverseCoverageGap[] {
  const gaps = new Map<string, UniverseCoverageGap>();

  for (const candidate of args.candidates) {
    const themes = findMatchingThemes(candidate);
    for (const theme of themes) {
      const effectiveAssets = getEffectiveThemeAssets(theme);
      const effectiveKinds = new Set<InvestmentAssetKind>(effectiveAssets.map((asset) => asset.assetKind));
      const effectiveSectors = new Set<string>(effectiveAssets.map((asset) => asset.sector));
      const catalogAssets = UNIVERSE_ASSET_CATALOG.filter((asset) => asset.themeIds.includes(theme.id));
      const availableKinds = new Set<InvestmentAssetKind>([...theme.assets, ...catalogAssets].map((asset) => asset.assetKind));
      const availableSectors = new Set<string>([...theme.sectors, ...catalogAssets.map((asset) => asset.sector)]);
      const missingAssetKinds = Array.from(availableKinds).filter((kind) => !effectiveKinds.has(kind));
      const missingSectors = Array.from(availableSectors).filter((sector) => !effectiveSectors.has(sector));
      const suggestedSymbols = args.reviews
        .filter((review) => review.themeId === theme.id && review.status === 'open')
        .map((review) => review.symbol)
        .slice(0, 5);

      if (!missingAssetKinds.length && !missingSectors.length && effectiveAssets.length >= Math.min(3, theme.assets.length)) {
        continue;
      }

      const severity: UniverseCoverageGap['severity'] =
        effectiveAssets.length < 2 || missingAssetKinds.length >= 2 || missingSectors.length >= 2
          ? 'critical'
          : missingAssetKinds.length > 0 || missingSectors.length > 0
            ? 'elevated'
            : 'watch';

      gaps.set(`${theme.id}::${candidate.region}`, {
        id: `${theme.id}::${candidate.region}`,
        themeId: theme.id,
        themeLabel: theme.label,
        region: candidate.region,
        severity,
        reason: `${theme.label} lacks full cross-sector coverage for ${candidate.region}.`,
        missingAssetKinds,
        missingSectors,
        suggestedSymbols,
      });
    }
  }

  return Array.from(gaps.values())
    .sort((a, b) => {
      const severityRank = (value: UniverseCoverageGap['severity']): number => (value === 'critical' ? 0 : value === 'elevated' ? 1 : 2);
      return severityRank(a.severity) - severityRank(b.severity) || a.themeLabel.localeCompare(b.themeLabel);
    })
    .slice(0, 24);
}

export function buildUniverseCoverageSummary(args: {
  candidates: EventCandidate[];
  mappings: DirectAssetMapping[];
  reviews: CandidateExpansionReview[];
  gaps: UniverseCoverageGap[];
}): UniverseCoverageSummary {
  const activeThemeIds = Array.from(new Set(args.candidates.flatMap((candidate) => findMatchingThemes(candidate).map((theme) => theme.id))));
  const activeAssets = dedupeThemeAssets(activeThemeIds.flatMap((themeId) => {
    const theme = getThemeRule(themeId);
    return theme ? getEffectiveThemeAssets(theme) : [];
  }));

  return {
    totalCatalogAssets: UNIVERSE_ASSET_CATALOG.length,
    activeAssetKinds: Array.from(new Set(activeAssets.map((asset) => asset.assetKind))).sort(),
    activeSectors: Array.from(new Set(activeAssets.map((asset) => asset.sector))).sort(),
    directMappingCount: args.mappings.length,
    dynamicApprovedCount: args.reviews.filter((review) => review.status === 'accepted').length,
    openReviewCount: args.reviews.filter((review) => review.status === 'open').length,
    gapCount: args.gaps.length,
    uncoveredThemeCount: Array.from(new Set(args.gaps.map((gap) => gap.themeId))).length,
  };
}
