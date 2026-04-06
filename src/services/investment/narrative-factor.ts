import { getSignificantPatterns } from '../pattern-discovery';
import type { EventCandidate, InvestmentThemeDefinition, NarrativeFactorShadowThemeScore } from './types';
import { UNIVERSE_ASSET_CATALOG } from './constants';
import { clamp, matchesThemeTrigger, normalize } from './utils';

const TOKEN_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'amid', 'after', 'over', 'near', 'about', 'against',
  'this', 'that', 'have', 'more', 'than', 'their', 'its', 'into', 'under', 'while', 'when',
  'will', 'said', 'says', 'report', 'reports', 'breaking', 'latest', 'update', 'updates',
]);

function tokenize(value: string): string[] {
  return Array.from(
    new Set(
      normalize(value)
        .split(/[^a-z0-9-]+/g)
        .filter((token) => token.length >= 3 && !TOKEN_STOPWORDS.has(token)),
    ),
  ).slice(0, 64);
}

function overlapCount(left: Iterable<string>, right: Iterable<string>): number {
  const rightSet = right instanceof Set ? right : new Set(right);
  let count = 0;
  for (const token of left) {
    if (rightSet.has(token)) count += 1;
  }
  return count;
}

function themeLexicon(theme: InvestmentThemeDefinition): Set<string> {
  const assetAliases = theme.assets.flatMap((asset) => {
    const catalog = UNIVERSE_ASSET_CATALOG.find((entry) => normalize(entry.symbol) === normalize(asset.symbol));
    return [asset.symbol, asset.name, ...(catalog?.aliases || [])];
  });
  return new Set([
    ...theme.triggers,
    ...theme.sectors,
    ...theme.commodities,
    theme.label,
    theme.thesis,
    ...assetAliases,
  ].flatMap((entry) => tokenize(String(entry || ''))));
}

function softmax(values: number[]): number[] {
  if (values.length === 0) return [];
  const max = Math.max(...values);
  const exps = values.map((value) => Math.exp(value - max));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return exps.map((value) => value / Math.max(total, 1e-9));
}

export function scoreNarrativeShadowThemes(
  candidate: EventCandidate,
  themeCatalog: InvestmentThemeDefinition[],
): NarrativeFactorShadowThemeScore[] {
  const candidateTerms = new Set([
    ...tokenize(candidate.text || ''),
    ...candidate.graphTerms.flatMap((term) => tokenize(String(term || ''))),
    ...candidate.matchedSymbols.map((symbol) => normalize(symbol)),
  ]);
  const patterns = getSignificantPatterns(2, 0.8);
  const rawRows = themeCatalog.map((theme) => {
    const lexicon = themeLexicon(theme);
    const lexiconHitCount = overlapCount(candidateTerms, lexicon);
    const directPhraseHits = theme.triggers.filter((trigger) => matchesThemeTrigger(candidate.text || '', trigger)).length;
    const symbolOverlapCount = candidate.matchedSymbols.filter((symbol) => theme.assets.some((asset) => normalize(asset.symbol) === normalize(symbol))).length;
    const themeAssetSet = new Set(theme.assets.map((asset) => normalize(asset.symbol)));
    const patternMatches = patterns.filter((pattern) => {
      if (!themeAssetSet.has(normalize(pattern.symbol))) return false;
      const fpTerms = String(pattern.clusterFingerprint || '').split('-').map((term) => normalize(term)).filter(Boolean);
      return overlapCount(candidateTerms, fpTerms) > 0;
    });
    const patternSupportScore = Number(patternMatches.reduce((sum, pattern) => (
      sum
      + Math.min(2.5, Math.abs(pattern.tStat) / 2.2)
      + Math.min(1.8, pattern.sampleCount / 6)
      + Math.min(1.5, Math.abs(pattern.avgReturnPct) / 0.8)
    ), 0).toFixed(2));
    const alignmentScore = clamp(Math.round(
      16
      + directPhraseHits * 14
      + lexiconHitCount * 7
      + symbolOverlapCount * 12
      + patternSupportScore * 7
      + candidate.corroborationQuality * 0.1
      + candidate.marketStress * 10
      + candidate.eventIntensity * 0.06,
    ), 0, 100);
    const rawScore = Number((
      directPhraseHits * 1.4
      + lexiconHitCount * 0.75
      + symbolOverlapCount * 1.2
      + patternSupportScore * 0.9
      + candidate.marketStress * 0.35
      + candidate.aftershockIntensity * 0.18
    ).toFixed(4));
    return {
      themeId: theme.id,
      themeLabel: theme.label,
      rawScore,
      posterior: 0,
      alignmentScore,
      patternSupportScore: Number(patternSupportScore.toFixed(2)),
      lexiconHitCount: directPhraseHits + lexiconHitCount,
      symbolOverlapCount,
      evidence: [
        directPhraseHits > 0 ? `triggerHits=${directPhraseHits}` : '',
        lexiconHitCount > 0 ? `tokenHits=${lexiconHitCount}` : '',
        symbolOverlapCount > 0 ? `symbolHits=${symbolOverlapCount}` : '',
        patternSupportScore > 0 ? `patternSupport=${patternSupportScore.toFixed(1)}` : '',
      ].filter(Boolean),
    };
  });
  const posteriors = softmax(rawRows.map((row) => row.rawScore));
  return rawRows
    .map((row, index) => ({ ...row, posterior: Number(posteriors[index]!.toFixed(6)) }))
    .sort((left, right) => right.posterior - left.posterior || right.alignmentScore - left.alignmentScore);
}
