import type { ClusteredEvent, NewsItem } from '@/types';

import type { HistoricalRawReplayRecord } from './historical-stream-worker';

type MentionKind = 'article' | 'structured-event' | 'aggregate';

type EventMention = {
  id: string;
  item: NewsItem;
  record: HistoricalRawReplayRecord;
  kind: MentionKind;
  sourceKey: string;
  sourceLabel: string;
  sourceTier: number;
  timestampMs: number;
  text: string;
  orderedTokens: string[];
  tokenSet: Set<string>;
  bigramSet: Set<string>;
  themeHints: Set<string>;
  geoHints: Set<string>;
  alertPrior: number;
  trustScore: number;
  salience: number;
};

type PairScore = {
  score: number;
  lexicalScore: number;
  themeScore: number;
  geoScore: number;
};

type ClusterDraft = {
  id: string;
  baseMentions: EventMention[];
  aggregateMentions: Array<{ mention: EventMention; supportScore: number }>;
  pairScores: PairScore[];
};

const TOKEN_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'have', 'will', 'into',
  'amid', 'after', 'over', 'under', 'while', 'when', 'where', 'were', 'was',
  'been', 'being', 'about', 'against', 'their', 'there', 'which', 'would',
  'could', 'should', 'today', 'says', 'said', 'report', 'reports', 'update',
  'latest', 'analysis', 'live', 'more', 'than', 'near', 'across',
]);

const GENERIC_GEO_STOPWORDS = new Set([
  'global', 'world', 'international', 'middle', 'east', 'north', 'south', 'west', 'east',
  'region', 'regions', 'country', 'countries',
]);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string, limit = 64): string[] {
  if (!value) return [];
  const raw = normalizeText(value).split(' ');
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const token of raw) {
    if (!token || token.length < 3 || TOKEN_STOPWORDS.has(token)) continue;
    const normalized = token.endsWith('s') && token.length > 4 ? token.slice(0, -1) : token;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    tokens.push(normalized);
    if (tokens.length >= limit) break;
  }
  return tokens;
}

function buildBigrams(tokens: string[]): Set<string> {
  const out = new Set<string>();
  for (let index = 0; index < tokens.length - 1; index += 1) {
    out.add(`${tokens[index]} ${tokens[index + 1]}`);
  }
  return out;
}

function asSet(values: string[]): Set<string> {
  return new Set(values.filter(Boolean));
}

function setIntersectionCount(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const value of left) {
    if (right.has(value)) count += 1;
  }
  return count;
}

function overlapRatio(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  const intersection = setIntersectionCount(left, right);
  if (!intersection) return 0;
  return intersection / Math.max(1, Math.min(left.size, right.size));
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  const intersection = setIntersectionCount(left, right);
  if (!intersection) return 0;
  return intersection / (left.size + right.size - intersection);
}

function hostFromLink(link: string): string | null {
  try {
    return new URL(link).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(/[,\s|]+/g)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function toTierTrust(tier: number): number {
  const normalized = Number.isFinite(tier) ? tier : 4;
  return clamp(92 - (normalized - 1) * 13, 36, 92);
}

function mentionKindForRecord(record: HistoricalRawReplayRecord): MentionKind {
  switch (String(record.provider || '').trim().toLowerCase()) {
    case 'gdelt-agg':
      return 'aggregate';
    case 'acled':
      return 'structured-event';
    default:
      return 'article';
  }
}

function buildSourceKey(item: NewsItem, record: HistoricalRawReplayRecord): string {
  const fromLink = item.link ? hostFromLink(item.link) : null;
  const sourceName = String(record.metadata.sourceName || item.source || record.sourceId || record.provider).trim().toLowerCase();
  return fromLink || sourceName || String(record.provider || 'unknown').trim().toLowerCase();
}

function buildThemeHints(record: HistoricalRawReplayRecord): Set<string> {
  const payload = record.payload || {};
  const themeTerms = [
    payload.theme,
    payload.disorder_type,
    payload.event_type,
    payload.sub_event_type,
    payload.actor1,
    payload.actor2,
    payload.category,
    record.headline,
    payload.summary,
    record.provider === 'gdelt-agg' ? 'conflict tension' : '',
  ].flatMap((value) => tokenize(String(value || ''), 12));
  return asSet(themeTerms);
}

function buildGeoHints(item: NewsItem, record: HistoricalRawReplayRecord): Set<string> {
  const payload = record.payload || {};
  const candidates = [
    record.region,
    item.locationName,
    payload.country,
    payload.location,
    payload.admin1,
    payload.admin2,
    payload.sourcecountry,
    ...toStringArray(payload.countries).slice(0, 12),
  ]
    .flatMap((value) => tokenize(String(value || ''), 8))
    .filter((token) => !GENERIC_GEO_STOPWORDS.has(token));
  return asSet(candidates);
}

function buildSupportingText(item: NewsItem, record: HistoricalRawReplayRecord): string {
  const payload = record.payload || {};
  return [
    item.title,
    payload.summary,
    payload.description,
    payload.abstract,
    payload.snippet,
    payload.event_type,
    payload.sub_event_type,
    payload.disorder_type,
    payload.actor1,
    payload.actor2,
    payload.country,
    payload.location,
    payload.theme,
    record.region,
  ].map((value) => String(value || '').trim()).filter(Boolean).join(' ');
}

function buildAlertPrior(kind: MentionKind, record: HistoricalRawReplayRecord): number {
  const payload = record.payload || {};
  if (kind === 'structured-event') return 0.95;
  if (kind === 'aggregate') {
    const eventCount = Number(payload.eventCount || 0);
    const totalSources = Number(payload.totalSources || 0);
    return clamp(0.55 + Math.min(0.3, eventCount / 2000) + Math.min(0.15, totalSources / 4000), 0.55, 0.95);
  }
  if (record.provider === 'gdelt-doc') return 0.28;
  return 0.12;
}

function buildSalience(kind: MentionKind, trustScore: number, tokenCount: number, geoCount: number, alertPrior: number): number {
  const kindBase = kind === 'structured-event' ? 0.72 : kind === 'aggregate' ? 0.62 : 0.42;
  return clamp(
    kindBase
      + trustScore / 280
      + Math.min(0.12, tokenCount / 80)
      + Math.min(0.08, geoCount / 20)
      + alertPrior * 0.14,
    0.2,
    1,
  );
}

function buildMention(item: NewsItem, record: HistoricalRawReplayRecord, index: number): EventMention {
  const text = buildSupportingText(item, record);
  const orderedTokens = tokenize(text);
  const sourceTier = typeof item.tier === 'number' ? item.tier : 4;
  const kind = mentionKindForRecord(record);
  const trustScore = toTierTrust(sourceTier);
  const alertPrior = buildAlertPrior(kind, record);
  const themeHints = buildThemeHints(record);
  const geoHints = buildGeoHints(item, record);
  return {
    id: `${record.id || index}`,
    item,
    record,
    kind,
    sourceKey: buildSourceKey(item, record),
    sourceLabel: String(item.source || record.metadata.sourceName || record.provider || 'unknown'),
    sourceTier,
    timestampMs: item.pubDate?.getTime?.() || Date.parse(record.validTimeStart) || 0,
    text,
    orderedTokens,
    tokenSet: asSet(orderedTokens),
    bigramSet: buildBigrams(orderedTokens),
    themeHints,
    geoHints,
    alertPrior,
    trustScore,
    salience: buildSalience(kind, trustScore, orderedTokens.length, geoHints.size, alertPrior),
  };
}

function computePairScore(left: EventMention, right: EventMention): PairScore {
  const tokenOverlap = overlapRatio(left.tokenSet, right.tokenSet);
  const bigramOverlap = jaccard(left.bigramSet, right.bigramSet);
  const lexicalScore = clamp(tokenOverlap * 0.72 + bigramOverlap * 0.28, 0, 1);
  const themeScore = overlapRatio(left.themeHints, right.themeHints);
  const geoScore = overlapRatio(left.geoHints, right.geoHints);
  const timeGapHours = Math.abs(left.timestampMs - right.timestampMs) / (1000 * 60 * 60);
  const timeScore = clamp(1 - (timeGapHours / 24), 0, 1);
  const sourceDiversity = left.sourceKey !== right.sourceKey ? 0.08 : -0.06;
  const kindSupport = left.kind === 'structured-event' || right.kind === 'structured-event' ? 0.08 : 0;
  const score = clamp(
    lexicalScore * 0.52
      + themeScore * 0.16
      + geoScore * 0.12
      + timeScore * 0.12
      + Math.max(left.alertPrior, right.alertPrior) * 0.08
      + kindSupport
      + sourceDiversity,
    0,
    1,
  );
  return {
    score,
    lexicalScore,
    themeScore,
    geoScore,
  };
}

function shouldMergePair(pair: PairScore): boolean {
  if (pair.score >= 0.48) return true;
  if (pair.lexicalScore >= 0.36 && (pair.themeScore >= 0.14 || pair.geoScore >= 0.14) && pair.score >= 0.38) return true;
  if (pair.lexicalScore >= 0.5 && pair.score >= 0.34) return true;
  return false;
}

function computeAggregateSupport(aggregate: EventMention, cluster: ClusterDraft): number {
  if (cluster.baseMentions.length === 0) return 0;
  const clusterTheme = asSet(cluster.baseMentions.flatMap((mention) => Array.from(mention.themeHints)));
  const clusterGeo = asSet(cluster.baseMentions.flatMap((mention) => Array.from(mention.geoHints)));
  const clusterText = asSet(cluster.baseMentions.flatMap((mention) => mention.orderedTokens.slice(0, 18)));
  const themeScore = overlapRatio(aggregate.themeHints, clusterTheme);
  const geoScore = overlapRatio(aggregate.geoHints, clusterGeo);
  const lexicalScore = overlapRatio(aggregate.tokenSet, clusterText);
  const timeGapHours = Math.min(...cluster.baseMentions.map((mention) => Math.abs(mention.timestampMs - aggregate.timestampMs) / (1000 * 60 * 60)));
  const timeScore = clamp(1 - (timeGapHours / 36), 0, 1);
  return clamp(
    themeScore * 0.32
      + geoScore * 0.18
      + lexicalScore * 0.2
      + timeScore * 0.12
      + aggregate.alertPrior * 0.18,
    0,
    1,
  );
}

class UnionFind {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index: number): number {
    if (this.parent[index] === index) return index;
    this.parent[index] = this.find(this.parent[index]!);
    return this.parent[index]!;
  }

  union(left: number, right: number): void {
    const a = this.find(left);
    const b = this.find(right);
    if (a !== b) this.parent[b] = a;
  }
}

function createDrafts(baseMentions: EventMention[]): ClusterDraft[] {
  const unionFind = new UnionFind(baseMentions.length);
  const pairScores = new Map<string, PairScore>();

  const MAX_PAIR_TIME_DIFF_MS = 48 * 60 * 60 * 1000; // 48 hours

  for (let left = 0; left < baseMentions.length; left += 1) {
    for (let right = left + 1; right < baseMentions.length; right += 1) {
      const timeDiff = Math.abs(baseMentions[left]!.timestampMs - baseMentions[right]!.timestampMs);
      if (timeDiff > MAX_PAIR_TIME_DIFF_MS) continue; // Skip pairs > 48h apart
      const pair = computePairScore(baseMentions[left]!, baseMentions[right]!);
      if (!shouldMergePair(pair)) continue;
      pairScores.set(`${left}:${right}`, pair);
      unionFind.union(left, right);
    }
  }

  const groups = new Map<number, EventMention[]>();
  for (let index = 0; index < baseMentions.length; index += 1) {
    const root = unionFind.find(index);
    const bucket = groups.get(root) || [];
    bucket.push(baseMentions[index]!);
    groups.set(root, bucket);
  }

  const mentionIndexMap = new Map<typeof baseMentions[0], number>();
  for (let i = 0; i < baseMentions.length; i++) {
    mentionIndexMap.set(baseMentions[i]!, i);
  }

  return Array.from(groups.values()).map((mentions, index) => {
    const scores: PairScore[] = [];
    for (let left = 0; left < mentions.length; left += 1) {
      for (let right = left + 1; right < mentions.length; right += 1) {
        const originalLeft = mentionIndexMap.get(mentions[left]!) ?? -1;
        const originalRight = mentionIndexMap.get(mentions[right]!) ?? -1;
        const key = originalLeft < originalRight ? `${originalLeft}:${originalRight}` : `${originalRight}:${originalLeft}`;
        const pair = pairScores.get(key);
        if (pair) scores.push(pair);
      }
    }
    return {
      id: `event-cluster:${index}`,
      baseMentions: mentions,
      aggregateMentions: [],
      pairScores: scores,
    };
  });
}

function clusterAnchor(mentions: EventMention[]): EventMention {
  return mentions
    .slice()
    .sort((left, right) => (
      right.salience - left.salience
      || right.trustScore - left.trustScore
      || right.orderedTokens.length - left.orderedTokens.length
    ))[0]!;
}

function buildClusterConfidence(cluster: ClusterDraft): number {
  const distinctSources = new Set(cluster.baseMentions.map((mention) => mention.sourceKey)).size;
  const meanTrust = cluster.baseMentions.reduce((sum, mention) => sum + mention.trustScore, 0) / Math.max(cluster.baseMentions.length, 1);
  const meanPairScore = cluster.pairScores.length > 0
    ? cluster.pairScores.reduce((sum, pair) => sum + pair.score, 0) / cluster.pairScores.length
    : cluster.baseMentions[0]?.salience ?? 0.32;
  const themeSet = asSet(cluster.baseMentions.flatMap((mention) => Array.from(mention.themeHints)));
  const geoSet = asSet(cluster.baseMentions.flatMap((mention) => Array.from(mention.geoHints)));
  const aggregateSupport = cluster.aggregateMentions.length > 0
    ? Math.max(...cluster.aggregateMentions.map((entry) => entry.supportScore))
    : 0;
  const structuredSupport = cluster.baseMentions.some((mention) => mention.kind === 'structured-event') ? 1 : 0;

  return clamp(Math.round(
    22
    + meanTrust * 0.3
    + Math.min(20, distinctSources * 9)
    + meanPairScore * 22
    + Math.min(10, themeSet.size * 1.2)
    + Math.min(7, geoSet.size * 1.3)
    + aggregateSupport * 16
    + structuredSupport * 12,
  ), 0, 100);
}

function buildClusterEvidence(cluster: ClusterDraft, confidenceScore: number): string[] {
  const evidence = [
    `sources=${new Set(cluster.baseMentions.map((mention) => mention.sourceKey)).size}`,
    `mentions=${cluster.baseMentions.length}`,
    `confidence=${confidenceScore}`,
  ];
  if (cluster.pairScores.length > 0) {
    const avgPair = cluster.pairScores.reduce((sum, pair) => sum + pair.score, 0) / cluster.pairScores.length;
    evidence.push(`pairScore=${avgPair.toFixed(2)}`);
  }
  if (cluster.aggregateMentions.length > 0) {
    const maxAggregate = Math.max(...cluster.aggregateMentions.map((entry) => entry.supportScore));
    evidence.push(`aggregateSupport=${maxAggregate.toFixed(2)}`);
  }
  const themeTerms = asSet(cluster.baseMentions.flatMap((mention) => Array.from(mention.themeHints)));
  if (themeTerms.size > 0) {
    evidence.push(`themes=${Array.from(themeTerms).slice(0, 4).join(',')}`);
  }
  return evidence;
}

function convertDraftToCluster(cluster: ClusterDraft, index: number): ClusteredEvent {
  const anchor = clusterAnchor(cluster.baseMentions);
  const confidenceScore = buildClusterConfidence(cluster);
  const sourceEntries = new Map<string, { name: string; tier: number; url: string }>();
  for (const mention of cluster.baseMentions) {
    if (!sourceEntries.has(mention.sourceKey)) {
      sourceEntries.set(mention.sourceKey, {
        name: mention.sourceLabel,
        tier: mention.sourceTier,
        url: mention.item.link,
      });
    }
  }
  const aggregateSupport = cluster.aggregateMentions.length > 0
    ? Math.max(...cluster.aggregateMentions.map((entry) => entry.supportScore))
    : 0;
  const isAlert = cluster.baseMentions.some((mention) => mention.kind === 'structured-event' || mention.item.isAlert)
    || (aggregateSupport >= 0.34 && confidenceScore >= 58);

  return {
    id: `canonical:${index}:${anchor.record.id || anchor.id}`,
    primaryTitle: anchor.item.title,
    primarySource: anchor.item.source || anchor.record.provider || 'Unknown',
    primaryLink: anchor.item.link,
    sourceCount: sourceEntries.size,
    topSources: Array.from(sourceEntries.values()).slice(0, 6),
    allItems: cluster.baseMentions.map((mention) => mention.item),
    firstSeen: new Date(Math.min(...cluster.baseMentions.map((mention) => mention.timestampMs))),
    lastUpdated: new Date(Math.max(...cluster.baseMentions.map((mention) => mention.timestampMs))),
    isAlert,
    lat: anchor.item.lat,
    lon: anchor.item.lon,
    lang: anchor.item.lang,
    relations: {
      relatedNews: [],
      airEventMatches: 0,
      maritimeEventMatches: 0,
      confidenceScore,
      evidence: buildClusterEvidence(cluster, confidenceScore),
    },
  };
}

export function buildCanonicalEventClusters(
  newsItems: NewsItem[],
  newsRecords: HistoricalRawReplayRecord[],
): ClusteredEvent[] {
  const size = Math.min(newsItems.length, newsRecords.length);
  if (size === 0) return [];

  const mentions: EventMention[] = [];
  for (let index = 0; index < size; index += 1) {
    mentions.push(buildMention(newsItems[index]!, newsRecords[index]!, index));
  }

  const baseMentions = mentions.filter((mention) => mention.kind !== 'aggregate');
  const aggregateMentions = mentions.filter((mention) => mention.kind === 'aggregate');

  const drafts = baseMentions.length > 0
    ? createDrafts(baseMentions)
    : aggregateMentions.map((mention, index) => ({
      id: `aggregate-only:${index}`,
      baseMentions: [mention],
      aggregateMentions: [],
      pairScores: [],
    }));

  for (const aggregate of aggregateMentions) {
    let bestMatch: { cluster: ClusterDraft; supportScore: number } | null = null;
    for (const cluster of drafts) {
      const supportScore = computeAggregateSupport(aggregate, cluster);
      if (!bestMatch || supportScore > bestMatch.supportScore) {
        bestMatch = { cluster, supportScore };
      }
    }
    if (bestMatch && bestMatch.supportScore >= 0.28) {
      bestMatch.cluster.aggregateMentions.push({ mention: aggregate, supportScore: bestMatch.supportScore });
    }
  }

  return drafts
    .map((cluster, index) => convertDraftToCluster(cluster, index))
    .sort((left, right) => (
      right.sourceCount - left.sourceCount
      || (right.relations?.confidenceScore || 0) - (left.relations?.confidenceScore || 0)
      || right.lastUpdated.getTime() - left.lastUpdated.getTime()
    ));
}
