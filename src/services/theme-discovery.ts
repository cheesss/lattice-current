import type { HistoricalReplayFrame } from './historical-intelligence';
import { THEME_DISCOVERY_TUNING } from '@/config/intelligence-tuning';
import { isLowSignalKeywordTerm } from './keyword-registry';

export interface KnownThemeCatalogEntry {
  id: string;
  label: string;
  triggers: string[];
  sectors: string[];
  commodities: string[];
}

export interface ThemeDiscoveryQueueItem {
  id: string;
  topicKey: string;
  label: string;
  status: 'open' | 'proposed' | 'promoted' | 'rejected';
  signalScore: number;
  overlapWithKnownThemes: number;
  sampleCount: number;
  sourceCount: number;
  regionCount: number;
  supportingHeadlines: string[];
  supportingRegions: string[];
  supportingSources: string[];
  datasetIds: string[];
  suggestedSymbols: string[];
  hints: string[];
  reason: string;
  createdAt: string;
  updatedAt: string;
  proposedThemeId?: string | null;
  promotedThemeId?: string | null;
  rejectedReason?: string | null;
}

export interface CodexThemeAssetProposal {
  symbol: string;
  name: string;
  assetKind: 'etf' | 'equity' | 'commodity' | 'fx' | 'rate' | 'crypto';
  sector: string;
  commodity?: string | null;
  direction: 'long' | 'short' | 'hedge' | 'watch' | 'pair';
  role: 'primary' | 'confirm' | 'hedge';
}

export interface CodexThemeProposal {
  id: string;
  label: string;
  confidence: number;
  reason: string;
  triggers: string[];
  sectors: string[];
  commodities: string[];
  timeframe: string;
  thesis: string;
  invalidation: string[];
  assets: CodexThemeAssetProposal[];
  suggestedSources?: Array<{
    url: string;
    domain: string;
    confidence: number;
  }>;
  suggestedGdeltKeywords?: string[];
  validationWarnings?: string[];
}

export interface ThemeDiscoveryOptions {
  minSamples?: number;
  minSources?: number;
  maxQueueItems?: number;
}

const STOPWORDS = new Set([
  'about', 'after', 'amid', 'amidst', 'and', 'are', 'around', 'before', 'being', 'between', 'brief',
  'from', 'into', 'more', 'over', 'than', 'that', 'their', 'there', 'these', 'this', 'through', 'under',
  'with', 'without', 'would', 'could', 'should', 'while', 'where', 'when', 'what', 'which', 'have', 'has',
  'been', 'will', 'were', 'news', 'update', 'latest', 'report', 'reports', 'says', 'say', 'saying', 'rises',
  'falls', 'surges', 'drops', 'global', 'market', 'markets',
]);

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalize(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value: string): string {
  return normalize(value).replace(/\s+/g, '-').slice(0, 72) || 'theme';
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= THEME_DISCOVERY_TUNING.tokenMinLength && !STOPWORDS.has(token));
}

function extractPhrases(text: string): string[] {
  const tokens = tokenize(text);
  const phrases = new Set<string>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token && token.length >= THEME_DISCOVERY_TUNING.longTokenMinLength) {
      if (!isLowSignalKeywordTerm(token)) phrases.add(token);
    }
    const bigram = tokens.slice(index, index + 2).join(' ').trim();
    if (bigram.split(' ').length === 2 && !isLowSignalKeywordTerm(bigram)) phrases.add(bigram);
    const trigram = tokens.slice(index, index + 3).join(' ').trim();
    if (trigram.split(' ').length === 3 && !isLowSignalKeywordTerm(trigram)) phrases.add(trigram);
  }
  return Array.from(phrases);
}

function buildKnownThemePhraseSet(themes: KnownThemeCatalogEntry[]): Set<string> {
  const phrases = new Set<string>();
  for (const theme of themes) {
    phrases.add(normalize(theme.label));
    for (const trigger of theme.triggers) phrases.add(normalize(trigger));
    for (const sector of theme.sectors) phrases.add(normalize(sector));
    for (const commodity of theme.commodities) phrases.add(normalize(commodity));
  }
  return phrases;
}

function themeOverlapScore(phrase: string, knownThemePhrases: Set<string>): number {
  const normalizedPhrase = normalize(phrase);
  if (!normalizedPhrase) return 0;
  let overlap = 0;
  for (const known of knownThemePhrases) {
    if (!known) continue;
    if (normalizedPhrase === known) return 1;
    if (known.includes(normalizedPhrase) || normalizedPhrase.includes(known)) {
      overlap = Math.max(overlap, Math.min(normalizedPhrase.length, known.length) / Math.max(normalizedPhrase.length, known.length));
    }
  }
  return overlap;
}

interface PhraseAggregate {
  label: string;
  sampleCount: number;
  headlines: Set<string>;
  sources: Set<string>;
  regions: Set<string>;
  datasetIds: Set<string>;
  symbols: Set<string>;
}

function collectFrameEntries(frames: HistoricalReplayFrame[]): Array<{ text: string; source: string; region: string; datasetId: string; symbols: string[] }> {
  const entries: Array<{ text: string; source: string; region: string; datasetId: string; symbols: string[] }> = [];
  for (const frame of frames) {
    const frameSymbols = Array.from(new Set((frame.markets || []).map((row) => String(row.symbol || '').trim()).filter(Boolean))).slice(0, 6);
    const datasetId = String(frame.datasetId || 'default');
    for (const news of frame.news || []) {
      entries.push({
        text: String(news.title || '').trim(),
        source: String(news.source || 'unknown'),
        region: String(news.locationName || frame.metadata?.region || 'Global'),
        datasetId,
        symbols: frameSymbols,
      });
    }
    for (const cluster of frame.clusters || []) {
      const title = String((cluster as { title?: string }).title || '').trim();
      if (!title) continue;
      entries.push({
        text: title,
        source: 'cluster',
        region: String(frame.metadata?.region || 'Global'),
        datasetId,
        symbols: frameSymbols,
      });
    }
  }
  return entries.filter((entry) => entry.text.length >= 8);
}

export function discoverThemeQueue(
  frames: HistoricalReplayFrame[],
  knownThemes: KnownThemeCatalogEntry[],
  previousQueue: ThemeDiscoveryQueueItem[] = [],
  options: ThemeDiscoveryOptions = {},
): ThemeDiscoveryQueueItem[] {
  const minSamples = Math.max(2, Math.round(options.minSamples ?? THEME_DISCOVERY_TUNING.defaultMinSamples));
  const minSources = Math.max(1, Math.round(options.minSources ?? THEME_DISCOVERY_TUNING.defaultMinSources));
  const maxQueueItems = Math.max(4, Math.round(options.maxQueueItems ?? THEME_DISCOVERY_TUNING.defaultMaxQueueItems));
  const knownThemePhrases = buildKnownThemePhraseSet(knownThemes);
  const aggregates = new Map<string, PhraseAggregate>();

  for (const entry of collectFrameEntries(frames)) {
    const phrases = Array.from(new Set(extractPhrases(entry.text)));
    for (const phrase of phrases) {
      const overlap = themeOverlapScore(phrase, knownThemePhrases);
      if (overlap >= THEME_DISCOVERY_TUNING.knownThemeOverlapReject) continue;
      const bucket = aggregates.get(phrase) || {
        label: titleCase(phrase),
        sampleCount: 0,
        headlines: new Set<string>(),
        sources: new Set<string>(),
        regions: new Set<string>(),
        datasetIds: new Set<string>(),
        symbols: new Set<string>(),
      };
      bucket.sampleCount += 1;
      bucket.headlines.add(entry.text);
      bucket.sources.add(entry.source);
      bucket.regions.add(entry.region);
      bucket.datasetIds.add(entry.datasetId);
      for (const symbol of entry.symbols) bucket.symbols.add(symbol);
      aggregates.set(phrase, bucket);
    }
  }

  const previousByKey = new Map(previousQueue.map((item) => [item.topicKey, item] as const));
  const discovered = Array.from(aggregates.entries())
    .flatMap(([phrase, aggregate]) => {
      if (isLowSignalKeywordTerm(phrase)) return [];
      const overlap = themeOverlapScore(phrase, knownThemePhrases);
      const sampleScore = aggregate.sampleCount * THEME_DISCOVERY_TUNING.sampleWeight;
      const sourceScore = aggregate.sources.size * THEME_DISCOVERY_TUNING.sourceWeight;
      const regionScore = aggregate.regions.size * THEME_DISCOVERY_TUNING.regionWeight;
      const noveltyPenalty = overlap * THEME_DISCOVERY_TUNING.overlapPenaltyWeight;
      const signalScore = clamp(Math.round(sampleScore + sourceScore + regionScore - noveltyPenalty), 0, 100);
      const topicKey = slugify(phrase);
      const existing = previousByKey.get(topicKey);
      const item = {
        id: existing?.id || `theme-discovery:${topicKey}`,
        topicKey,
        label: existing?.label || aggregate.label,
        status: existing?.status || 'open',
        signalScore,
        overlapWithKnownThemes: Number(overlap.toFixed(2)),
        sampleCount: aggregate.sampleCount,
        sourceCount: aggregate.sources.size,
        regionCount: aggregate.regions.size,
        supportingHeadlines: Array.from(aggregate.headlines).slice(0, 6),
        supportingRegions: Array.from(aggregate.regions).sort(),
        supportingSources: Array.from(aggregate.sources).sort(),
        datasetIds: Array.from(aggregate.datasetIds).sort(),
        suggestedSymbols: Array.from(aggregate.symbols).slice(0, 6),
        hints: [phrase, ...Array.from(aggregate.symbols).slice(0, 3)],
        reason: `Repeated motif "${aggregate.label}" is recurring outside the current theme trigger set.`,
        createdAt: existing?.createdAt || nowIso(),
        updatedAt: nowIso(),
        proposedThemeId: existing?.proposedThemeId || null,
        promotedThemeId: existing?.promotedThemeId || null,
        rejectedReason: existing?.rejectedReason || null,
      } satisfies ThemeDiscoveryQueueItem;
      return [item];
    })
    .filter((item) =>
      item.sampleCount >= minSamples
      && item.sourceCount >= minSources
      && item.signalScore >= THEME_DISCOVERY_TUNING.queueSignalFloor)
    .sort((a, b) => b.signalScore - a.signalScore || b.sampleCount - a.sampleCount || a.label.localeCompare(b.label))
    .slice(0, maxQueueItems);

  const preserved = previousQueue.filter((item) => item.status === 'promoted' || item.status === 'rejected');
  const merged = new Map<string, ThemeDiscoveryQueueItem>();
  for (const item of discovered) merged.set(item.id, item);
  for (const item of preserved) {
    if (!merged.has(item.id)) merged.set(item.id, item);
  }
  return Array.from(merged.values())
    .sort((a, b) => {
      const statusOrder = (value: ThemeDiscoveryQueueItem['status']): number => (
        value === 'open' ? 0 : value === 'proposed' ? 1 : value === 'promoted' ? 2 : 3
      );
      return statusOrder(a.status) - statusOrder(b.status) || b.signalScore - a.signalScore;
    });
}
