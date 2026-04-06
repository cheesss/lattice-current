import type {
  InvestmentThemeDefinition,
  EventCandidate,
  ThemeAssetDefinition,
  CandidateExpansionReview,
  ThemePolicyDefinition,
  ThemeClassification,
  NarrativeShadowState,
} from './types';
import { THEME_RULES, SPECIAL_SYMBOL_POLICY, UNIVERSE_ASSET_CATALOG } from './constants';
import { automatedThemes, candidateReviews, setAutomatedThemes } from './module-state';
import {
  normalize,
  matchesThemeTrigger,
  dedupeThemeAssets,
  clamp,
} from './utils';
import { getMarketWatchlistEntries } from '../market-watchlist';
import { getSignificantPatterns, type DiscoveredLink } from '../pattern-discovery';
import { scoreNarrativeShadowThemes } from './narrative-factor';

type ThemeRule = InvestmentThemeDefinition;
export interface ThemeMatchDetail {
  theme: ThemeRule;
  triggerHits: string[];
  triggerHitCount: number;
  narrativeAlignmentScore: number;
  narrativeShadowState: NarrativeShadowState;
  narrativeShadowPosterior: number;
  narrativeShadowDisagreement: number;
  narrativeShadowTopThemeId: string | null;
  score: number;
  matchedBy: 'trigger' | 'fallback-symbol';
}

/**
 * Convert a CandidateExpansionReview to a ThemeAssetDefinition
 */
function reviewToThemeAsset(review: CandidateExpansionReview): ThemeAssetDefinition {
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

function normalizeThemePolicy(policy?: ThemePolicyDefinition): ThemePolicyDefinition | undefined {
  if (!policy) return undefined;
  const normalizedSymbolAdjustments = Object.fromEntries(
    Object.entries(policy.symbolAdjustments || {})
      .map(([symbol, value]) => [String(symbol || '').trim().toUpperCase(), { ...value }])
      .filter(([symbol]) => Boolean(symbol)),
  );
  return {
    classification: policy.classification,
    trigger: policy.trigger
      ? {
        minTriggerHits: Math.max(1, Math.round(Number(policy.trigger.minTriggerHits) || 1)),
        minStress: clamp(Number(policy.trigger.minStress) || 0, 0, 1),
        requireDirectionalTerms: Array.isArray(policy.trigger.requireDirectionalTerms)
          ? policy.trigger.requireDirectionalTerms.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean).slice(0, 12)
          : [],
      }
      : undefined,
    assets: policy.assets
      ? {
        maxPrimaryAssets: Math.max(0, Math.round(Number(policy.assets.maxPrimaryAssets) || 0)) || undefined,
        maxConfirmAssets: Math.max(0, Math.round(Number(policy.assets.maxConfirmAssets) || 0)) || undefined,
        maxHedgeAssets: Math.max(0, Math.round(Number(policy.assets.maxHedgeAssets) || 0)) || undefined,
      }
      : undefined,
    admission: policy.admission
      ? {
        rejectHitProbability: typeof policy.admission.rejectHitProbability === 'number' ? clamp(policy.admission.rejectHitProbability, 0, 1) : undefined,
        watchHitProbability: typeof policy.admission.watchHitProbability === 'number' ? clamp(policy.admission.watchHitProbability, 0, 1) : undefined,
        rejectExpectedReturnPct: typeof policy.admission.rejectExpectedReturnPct === 'number' ? Number(policy.admission.rejectExpectedReturnPct.toFixed(2)) : undefined,
        watchExpectedReturnPct: typeof policy.admission.watchExpectedReturnPct === 'number' ? Number(policy.admission.watchExpectedReturnPct.toFixed(2)) : undefined,
        rejectScore: typeof policy.admission.rejectScore === 'number' ? clamp(policy.admission.rejectScore, 0, 100) : undefined,
        watchScore: typeof policy.admission.watchScore === 'number' ? clamp(policy.admission.watchScore, 0, 100) : undefined,
      }
      : undefined,
    narrative: policy.narrative
      ? {
        enabled: policy.narrative.enabled !== false,
        minAlignmentScore: typeof policy.narrative.minAlignmentScore === 'number' ? clamp(policy.narrative.minAlignmentScore, 0, 100) : undefined,
        weakPenalty: typeof policy.narrative.weakPenalty === 'number' ? clamp(policy.narrative.weakPenalty, 0, 20) : undefined,
        mismatchPenalty: typeof policy.narrative.mismatchPenalty === 'number' ? clamp(policy.narrative.mismatchPenalty, 0, 30) : undefined,
      }
      : undefined,
    symbolAdjustments: Object.keys(normalizedSymbolAdjustments).length > 0 ? normalizedSymbolAdjustments : undefined,
  };
}

function inferThemeClassification(theme: ThemeRule): ThemeClassification {
  const hedgeCount = theme.assets.filter((asset) => asset.role === 'hedge' || asset.direction === 'hedge').length;
  const directionalCount = theme.assets.filter((asset) => asset.direction === 'long' || asset.direction === 'short').length;
  if (hedgeCount >= Math.max(2, directionalCount)) return 'hedge-heavy';
  if (hedgeCount > 0 && directionalCount > 0) return 'mixed';
  return 'directional';
}

export function resolveThemePolicy(theme: ThemeRule): Required<ThemePolicyDefinition> {
  const classification = theme.policy?.classification || inferThemeClassification(theme);
  const normalized = normalizeThemePolicy(theme.policy) || {};
  return {
    classification,
    trigger: {
      minTriggerHits: normalized.trigger?.minTriggerHits ?? (classification === 'hedge-heavy' ? 2 : classification === 'mixed' ? 2 : 1),
      minStress: normalized.trigger?.minStress ?? (classification === 'hedge-heavy' ? 0.3 : classification === 'mixed' ? 0.18 : 0),
      requireDirectionalTerms: normalized.trigger?.requireDirectionalTerms ?? [],
    },
    assets: {
      maxPrimaryAssets: normalized.assets?.maxPrimaryAssets ?? (classification === 'hedge-heavy' ? 1 : classification === 'mixed' ? 2 : 2),
      maxConfirmAssets: normalized.assets?.maxConfirmAssets ?? (classification === 'hedge-heavy' ? 1 : 2),
      maxHedgeAssets: normalized.assets?.maxHedgeAssets ?? (classification === 'directional' ? 1 : 2),
    },
    admission: {
      rejectHitProbability: normalized.admission?.rejectHitProbability ?? (classification === 'hedge-heavy' ? 0.46 : 0.44),
      watchHitProbability: normalized.admission?.watchHitProbability ?? (classification === 'hedge-heavy' ? 0.54 : 0.52),
      rejectExpectedReturnPct: normalized.admission?.rejectExpectedReturnPct ?? (classification === 'hedge-heavy' ? -0.05 : -0.2),
      watchExpectedReturnPct: normalized.admission?.watchExpectedReturnPct ?? (classification === 'hedge-heavy' ? 0.1 : 0.08),
      rejectScore: normalized.admission?.rejectScore ?? (classification === 'hedge-heavy' ? 42 : 38),
      watchScore: normalized.admission?.watchScore ?? (classification === 'hedge-heavy' ? 54 : 52),
    },
    narrative: {
      enabled: normalized.narrative?.enabled ?? classification !== 'directional',
      minAlignmentScore: normalized.narrative?.minAlignmentScore ?? (classification === 'hedge-heavy' ? 48 : 44),
      weakPenalty: normalized.narrative?.weakPenalty ?? 3,
      mismatchPenalty: normalized.narrative?.mismatchPenalty ?? 7,
    },
    symbolAdjustments: {
      ...SPECIAL_SYMBOL_POLICY,
      ...(normalized.symbolAdjustments || {}),
    },
  };
}

function extractThemeLexicon(theme: ThemeRule): string[] {
  const assetAliases = theme.assets.flatMap((asset) => {
    const catalog = UNIVERSE_ASSET_CATALOG.find((entry) => normalize(entry.symbol) === normalize(asset.symbol));
    return catalog?.aliases || [];
  });
  return Array.from(new Set([
    ...theme.triggers,
    ...theme.sectors,
    ...theme.commodities,
    theme.label,
    ...assetAliases,
  ].map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)));
}

function computeNarrativeAlignmentScore(candidate: EventCandidate, theme: ThemeRule, triggerHits: string[]): number {
  const text = normalize(String(candidate.text || ''));
  const lexicon = extractThemeLexicon(theme);
  if (!text || !lexicon.length) return triggerHits.length > 0 ? 55 : 0;
  const directionalTerms = resolveThemePolicy(theme).trigger.requireDirectionalTerms || [];
  const lexiconHits = lexicon.filter((term) => matchesThemeTrigger(text, term));
  const directionalHits = directionalTerms.filter((term) => matchesThemeTrigger(text, term));
  const symbolHits = candidate.matchedSymbols.filter((symbol) => themeHasAssetSymbol(theme, symbol));
  return clamp(
    Math.round(
      18
      + triggerHits.length * 14
      + lexiconHits.length * 5
      + directionalHits.length * 8
      + symbolHits.length * 11
      + candidate.corroborationQuality * 0.18
      + candidate.sourceDiversity * 0.08
      + candidate.marketStress * 14,
    ),
    0,
    100,
  );
}

function classifyNarrativeShadowState(theme: ThemeRule, narrativeAlignmentScore: number): NarrativeShadowState {
  const minAlignment = resolveThemePolicy(theme).narrative.minAlignmentScore || 48;
  if (narrativeAlignmentScore >= minAlignment) return 'aligned';
  if (narrativeAlignmentScore >= minAlignment - 10) return 'weak';
  return 'mismatch';
}

/**
 * Normalizes a theme's arrays (triggers, sectors, commodities, invalidation)
 * and assets, ensuring all values are properly trimmed and validated
 */
export function normalizeThemeDefinition(theme: InvestmentThemeDefinition): InvestmentThemeDefinition {
  return {
    id: String(theme.id || '').trim().toLowerCase(),
    label: String(theme.label || '').trim() || 'Untitled Theme',
    triggers: Array.isArray(theme.triggers) ? theme.triggers.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean).slice(0, 20) : [],
    sectors: Array.isArray(theme.sectors) ? theme.sectors.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean).slice(0, 10) : [],
    commodities: Array.isArray(theme.commodities) ? theme.commodities.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean).slice(0, 10) : [],
    timeframe: String(theme.timeframe || '1d-7d').trim() || '1d-7d',
    thesis: String(theme.thesis || 'Automated theme proposal.').trim() || 'Automated theme proposal.',
    invalidation: Array.isArray(theme.invalidation) ? theme.invalidation.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6) : [],
    baseSensitivity: clamp(Number(theme.baseSensitivity) || 60, 25, 95),
    policy: normalizeThemePolicy(theme.policy),
    assets: dedupeThemeAssets(
      Array.isArray(theme.assets)
        ? theme.assets
          .map((asset) => ({
            symbol: String(asset.symbol || '').trim().toUpperCase(),
            name: String(asset.name || asset.symbol || '').trim() || String(asset.symbol || '').trim().toUpperCase(),
            assetKind: asset.assetKind,
            sector: String(asset.sector || 'cross-asset').trim().toLowerCase() || 'cross-asset',
            commodity: asset.commodity ? String(asset.commodity).trim().toLowerCase() : undefined,
            direction: asset.direction,
            role: asset.role,
          }))
          .filter((asset) => asset.symbol && asset.assetKind && asset.direction && asset.role)
        : [],
    ),
  };
}

/**
 * Returns the effective theme catalog: base THEME_RULES plus any automated themes
 */
export function listEffectiveThemeCatalog(): ThemeRule[] {
  return [
    ...THEME_RULES,
    ...Array.from(automatedThemes.values()).map((theme) => normalizeThemeDefinition(theme)),
  ];
}

/**
 * Returns a deep copy of the base investment themes (THEME_RULES)
 */
export function listBaseInvestmentThemes(): InvestmentThemeDefinition[] {
  return THEME_RULES.map((theme) => ({
    ...theme,
    triggers: theme.triggers.slice(),
    sectors: theme.sectors.slice(),
    commodities: theme.commodities.slice(),
    invalidation: theme.invalidation.slice(),
    assets: theme.assets.map((asset) => ({ ...asset })),
  }));
}

/**
 * Returns a deep copy of the automated investment themes
 */
export function listAutomatedInvestmentThemes(): InvestmentThemeDefinition[] {
  return Array.from(automatedThemes.values()).map((theme) => ({
    ...theme,
    triggers: theme.triggers.slice(),
    sectors: theme.sectors.slice(),
    commodities: theme.commodities.slice(),
    invalidation: theme.invalidation.slice(),
    assets: theme.assets.map((asset) => ({ ...asset })),
  }));
}

/**
 * Sets the automated theme catalog to the provided themes,
 * normalizing each one and filtering out invalid entries
 */
export function setAutomatedThemeCatalog(themes: InvestmentThemeDefinition[]): void {
  setAutomatedThemes(
    new Map(
      (themes || [])
        .map((theme) => normalizeThemeDefinition(theme))
        .filter((theme) => theme.id && theme.triggers.length > 0)
        .map((theme) => [theme.id, theme] as const),
    ),
  );
}

export function buildThemeMatchDetails(candidate: EventCandidate): ThemeMatchDetail[] {
  const themeCatalog = listEffectiveThemeCatalog();
  const shadowScores = scoreNarrativeShadowThemes(candidate, themeCatalog);
  const shadowByThemeId = new Map(shadowScores.map((row) => [row.themeId, row]));
  const topShadowTheme = shadowScores[0] || null;
  const directMatches: ThemeMatchDetail[] = [];
  const fallbackMatches: ThemeMatchDetail[] = [];
  const normalizedText = normalize(String(candidate.text || ''));

  for (const theme of themeCatalog) {
    const policy = resolveThemePolicy(theme);
    const requiredDirectionalTerms = policy.trigger.requireDirectionalTerms || [];
    const minTriggerHits = policy.trigger.minTriggerHits || 1;
    const minStress = policy.trigger.minStress || 0;
    const triggerHits = theme.triggers.filter((trigger) => matchesThemeTrigger(normalizedText, trigger));
    const directionalHits = requiredDirectionalTerms.filter((term) => matchesThemeTrigger(normalizedText, term));
    const narrativeAlignmentScore = computeNarrativeAlignmentScore(candidate, theme, triggerHits);
    const narrativeShadowState = classifyNarrativeShadowState(theme, narrativeAlignmentScore);
    const shadow = shadowByThemeId.get(theme.id);
    const narrativeShadowPosterior = shadow?.posterior ?? 0;
    const narrativeShadowDisagreement = topShadowTheme && topShadowTheme.themeId !== theme.id
      ? clamp(Number(((topShadowTheme.posterior - narrativeShadowPosterior) * 100).toFixed(2)), 0, 100)
      : 0;
    const triggerPass =
      triggerHits.length >= minTriggerHits
      && candidate.marketStress >= minStress
      && (requiredDirectionalTerms.length === 0 || directionalHits.length > 0);
    const fallbackSymbolHits = candidate.matchedSymbols.filter((symbol) => themeHasAssetSymbol(theme, symbol));
    const fallbackPass =
      !triggerPass
      && fallbackSymbolHits.length > 0
      && candidate.marketStress >= Math.max(minStress, 0.55);
    if (!triggerPass && !fallbackPass) continue;
    const score = Number((
      triggerHits.length * 16
      + fallbackSymbolHits.length * 10
      + narrativeAlignmentScore * 0.42
      + candidate.corroborationQuality * 0.12
      + candidate.eventIntensity * 0.08
      + candidate.aftershockIntensity * 10
      - (narrativeShadowState === 'mismatch' ? 8 : narrativeShadowState === 'weak' ? 3 : 0)
    ).toFixed(2));
    const detail: ThemeMatchDetail = {
      theme,
      triggerHits,
      triggerHitCount: triggerHits.length,
      narrativeAlignmentScore,
      narrativeShadowState,
      narrativeShadowPosterior,
      narrativeShadowDisagreement,
      narrativeShadowTopThemeId: topShadowTheme?.themeId ?? null,
      score,
      matchedBy: triggerPass ? 'trigger' : 'fallback-symbol',
    };
    if (triggerPass) {
      directMatches.push(detail);
    } else {
      fallbackMatches.push(detail);
    }
  }

  const ranked = (directMatches.length > 0 ? directMatches : fallbackMatches)
    .sort((left, right) => right.score - left.score || right.triggerHitCount - left.triggerHitCount)
    .slice(0, candidate.marketStress >= 0.65 ? 4 : 3);
  return ranked;
}

/**
 * Finds themes that match an EventCandidate by trigger matching,
 * and falls back to symbol matching if market stress is high
 */
export function findMatchingThemes(candidate: EventCandidate): ThemeRule[] {
  return buildThemeMatchDetails(candidate).map((match) => match.theme);
}

/**
 * Finds a theme rule by its id from the effective catalog
 */
export function getThemeRule(themeId: string): ThemeRule | null {
  return listEffectiveThemeCatalog().find((theme) => theme.id === themeId) || null;
}

/**
 * Gets the effective theme assets including both base assets and accepted candidate reviews
 */
export function getEffectiveThemeAssets(theme: ThemeRule): ThemeAssetDefinition[] {
  const accepted = Array.from(candidateReviews.values())
    .filter((review) => review.themeId === theme.id && review.status === 'accepted')
    .map(reviewToThemeAsset);
  return dedupeThemeAssets([...theme.assets, ...accepted]);
}

export function selectThemeAssetsForCandidate(
  theme: ThemeRule,
  candidate: EventCandidate,
  matchDetail?: ThemeMatchDetail | null,
): ThemeAssetDefinition[] {
  const policy = resolveThemePolicy(theme);
  const symbolAdjustments = policy.symbolAdjustments;
  const maxPrimaryAssets = policy.assets.maxPrimaryAssets || 2;
  const maxConfirmAssets = policy.assets.maxConfirmAssets || 2;
  const maxHedgeAssets = policy.assets.maxHedgeAssets || 1;
  const assets = getEffectiveThemeAssets(theme)
    .filter((asset) => {
      const symbolRule = symbolAdjustments[String(asset.symbol || '').trim().toUpperCase()];
      if (!symbolRule?.requireRiskOff) return true;
      return candidate.marketStress >= 0.45;
    });
  const ranked = assets.slice().sort((left, right) => {
    const leftCatalog = UNIVERSE_ASSET_CATALOG.find((entry) => normalize(entry.symbol) === normalize(left.symbol));
    const rightCatalog = UNIVERSE_ASSET_CATALOG.find((entry) => normalize(entry.symbol) === normalize(right.symbol));
    const leftLiquidity = leftCatalog?.liquidityTier === 'high' ? 3 : leftCatalog?.liquidityTier === 'medium' ? 2 : 1;
    const rightLiquidity = rightCatalog?.liquidityTier === 'high' ? 3 : rightCatalog?.liquidityTier === 'medium' ? 2 : 1;
    const leftRole = left.role === 'primary' ? 3 : left.role === 'confirm' ? 2 : 1;
    const rightRole = right.role === 'primary' ? 3 : right.role === 'confirm' ? 2 : 1;
    return rightRole - leftRole || rightLiquidity - leftLiquidity;
  });
  const picked: ThemeAssetDefinition[] = [];
  let primaryCount = 0;
  let confirmCount = 0;
  let hedgeCount = 0;
  for (const asset of ranked) {
    const nextPrimary = asset.role === 'primary' ? primaryCount + 1 : primaryCount;
    const nextConfirm = asset.role === 'confirm' ? confirmCount + 1 : confirmCount;
    const nextHedge = asset.role === 'hedge' ? hedgeCount + 1 : hedgeCount;
    if (nextPrimary > maxPrimaryAssets) continue;
    if (nextConfirm > maxConfirmAssets) continue;
    if (nextHedge > maxHedgeAssets) continue;
    if (
      policy.classification === 'hedge-heavy'
      && matchDetail?.narrativeShadowState === 'mismatch'
      && asset.role === 'hedge'
      && hedgeCount > 0
    ) {
      continue;
    }
    picked.push(asset);
    primaryCount = nextPrimary;
    confirmCount = nextConfirm;
    hedgeCount = nextHedge;
  }
  return picked.length > 0 ? picked : ranked.slice(0, 2);
}

/**
 * Checks if a theme has a specific asset symbol (including accepted candidates)
 */
export function themeHasAssetSymbol(theme: ThemeRule, symbol: string): boolean {
  const normalizedSymbol = normalize(symbol);
  return getEffectiveThemeAssets(theme).some((asset) => normalize(asset.symbol) === normalizedSymbol);
}

/**
 * Builds a lookup map from normalized symbols to watchlist entries
 */
export function buildWatchlistLookup(): Map<string, { symbol: string; name?: string }> {
  const lookup = new Map<string, { symbol: string; name?: string }>();
  for (const entry of getMarketWatchlistEntries()) {
    lookup.set(normalize(entry.symbol), { symbol: entry.symbol, name: entry.name });
  }
  return lookup;
}

/**
 * Auto-promote discovered patterns to themes.
 * Called periodically to check if any discovered patterns qualify as themes.
 */
export function promoteDiscoveredPatternsToThemes(): InvestmentThemeDefinition[] {
  const patterns = getSignificantPatterns(5, 1.5); // At least 5 samples, t-stat >= 1.5
  const promoted: InvestmentThemeDefinition[] = [];
  const existingIds = new Set(listEffectiveThemeCatalog().map(t => t.id));

  // Group patterns by fingerprint (same news type -> same theme)
  const byFingerprint = new Map<string, DiscoveredLink[]>();
  for (const p of patterns) {
    const existing = byFingerprint.get(p.clusterFingerprint) || [];
    existing.push(p);
    byFingerprint.set(p.clusterFingerprint, existing);
  }

  for (const [fpId, links] of byFingerprint) {
    const themeId = `discovered-${fpId}`;
    if (existingIds.has(themeId)) continue;
    if (links.length < 2) continue; // Need at least 2 symbol connections

    // Build theme from discovered links
    const assets: ThemeAssetDefinition[] = links.slice(0, 6).map(link => ({
      symbol: link.symbol,
      name: link.symbol,
      assetKind: 'etf' as const,
      sector: 'discovered',
      commodity: undefined,
      direction: link.direction as 'long' | 'short',
      role: (link.tStat > 2 ? 'primary' : 'confirm') as 'primary' | 'confirm' | 'hedge',
    }));

    // Best horizon across all links
    const bestLink = links.reduce((a, b) => Math.abs(a.tStat) > Math.abs(b.tStat) ? a : b);
    const timeframe = `${Math.max(1, Math.floor(bestLink.horizonHours / 24))}d-${Math.ceil(bestLink.horizonHours / 24) * 2}d`;

    // Extract triggers from fingerprint
    const triggers = fpId.split('-').filter(t => t.length > 2);

    promoted.push({
      id: themeId,
      label: `Discovered: ${fpId}`,
      triggers,
      sectors: ['discovered'],
      commodities: [],
      timeframe,
      thesis: `Auto-discovered pattern: ${fpId} correlates with ${links.map(l => l.symbol).join(', ')} at ${bestLink.horizonHours}h horizon (t=${bestLink.tStat.toFixed(1)}, n=${bestLink.sampleCount})`,
      invalidation: ['Pattern breaks down', 'Correlation becomes insignificant'],
      baseSensitivity: clamp(Math.round(50 + bestLink.tStat * 5), 25, 80),
      assets,
    });
  }

  // Register promoted themes
  if (promoted.length > 0) {
    const existingAutomated = Array.from(automatedThemes.values()).filter(t => t.id.startsWith('discovered-'));
    // Keep max 10 discovered themes, remove oldest if needed
    const combined = [...existingAutomated, ...promoted].slice(-10);
    // Preserve non-discovered automated themes and add discovered ones
    const nonDiscovered = Array.from(automatedThemes.values()).filter(t => !t.id.startsWith('discovered-'));
    setAutomatedThemeCatalog([...nonDiscovered, ...combined]);
  }

  return promoted;
}
