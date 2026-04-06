/**
 * HistoricalReplayFrame assembly logic extracted from historical-stream-worker.ts.
 * Contains materializeReplayFramesFromRawRecords, buildNewsItem, buildSimpleClusters,
 * and related frame construction helpers.
 */

import type { ClusteredEvent, MarketData, NewsItem } from '@/types';
import type { HistoricalReplayFrame } from '../historical-intelligence';
import type { HistoricalRawReplayRecord } from './historical-stream-worker';

// ── Utility helpers (self-contained duplicates) ──

function asTs(value: string | null | undefined): number {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function stableId(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join('::')
    .slice(0, 240);
}

function normalizeTitle(value: unknown, fallback: string): string {
  const text = String(value || '').trim();
  return text || fallback;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function shouldReplaceMarketRecord(
  candidate: HistoricalRawReplayRecord,
  current: HistoricalRawReplayRecord,
): boolean {
  const candidateKnowledge = asTs(candidate.knowledgeBoundary);
  const currentKnowledge = asTs(current.knowledgeBoundary);
  if (candidateKnowledge !== currentKnowledge) return candidateKnowledge > currentKnowledge;
  const candidateTransaction = asTs(candidate.transactionTime);
  const currentTransaction = asTs(current.transactionTime);
  if (candidateTransaction !== currentTransaction) return candidateTransaction > currentTransaction;
  return asTs(candidate.validTimeStart) >= asTs(current.validTimeStart);
}

// ── Frame building helpers ──

function newsSourceName(record: HistoricalRawReplayRecord): string {
  const source = String(record.metadata.sourceName || record.sourceId || record.provider).trim();
  return source || record.provider;
}

export function buildNewsItem(record: HistoricalRawReplayRecord): NewsItem {
  const payload = record.payload || {};
  const metadata = record.metadata || {};
  const lat = toNumber(payload.lat || payload.latitude || payload.event_latitude);
  const lon = toNumber(payload.lon || payload.longitude || payload.event_longitude);
  return {
    source: newsSourceName(record),
    title: record.headline || 'Historical item',
    link: record.link || '',
    pubDate: new Date(record.validTimeStart),
    isAlert: false,
    tier: typeof metadata.sourceTier === 'number' ? metadata.sourceTier : 4,
    lat: lat ?? undefined,
    lon: lon ?? undefined,
    locationName: record.region || undefined,
    lang: typeof metadata.language === 'string' ? metadata.language : undefined,
  };
}

export function buildSimpleClusters(newsItems: NewsItem[], _newsRecords?: HistoricalRawReplayRecord[]): ClusteredEvent[] {
  const groups = new Map<string, NewsItem[]>();
  for (const item of newsItems) {
    const key = normalizeTitle(item.title, 'untitled').toLowerCase();
    const bucket = groups.get(key) || [];
    bucket.push(item);
    groups.set(key, bucket);
  }

  return Array.from(groups.entries()).flatMap(([key, items], index) => {
    const anchor = items[0];
    if (!anchor) return [];
    const firstSeen = items.reduce(
      (earliest, item) => (item.pubDate < earliest ? item.pubDate : earliest),
      anchor.pubDate,
    );
    const lastUpdated = items.reduce(
      (latest, item) => (item.pubDate > latest ? item.pubDate : latest),
      anchor.pubDate,
    );
    return [{
      id: stableId(['cluster', key, index]),
      primaryTitle: anchor.title,
      primarySource: anchor.source || 'Unknown',
      primaryLink: anchor.link,
      sourceCount: items.length,
      topSources: Array.from(new Set(items.map((item) => item.source || 'Unknown')))
        .slice(0, 6)
        .map((name) => ({ name, tier: anchor.tier || 4, url: anchor.link })),
      allItems: items,
      firstSeen,
      lastUpdated,
      isAlert: items.some((item) => item.isAlert),
      threat: undefined,
      lat: anchor.lat,
      lon: anchor.lon,
      lang: anchor.lang,
    }];
  });
}

export function countTimeSkewWarnings(newsItems: NewsItem[], skewMs = 30 * 60 * 1000): number {
  const buckets = new Map<string, number[]>();
  for (const item of newsItems) {
    const key = normalizeTitle(item.title, 'untitled').toLowerCase();
    const ts = item.pubDate?.getTime?.() ?? NaN;
    if (!Number.isFinite(ts)) continue;
    const bucket = buckets.get(key) || [];
    bucket.push(ts);
    buckets.set(key, bucket);
  }
  let warnings = 0;
  for (const values of buckets.values()) {
    if (values.length < 2) continue;
    const minTs = Math.min(...values);
    const maxTs = Math.max(...values);
    if ((maxTs - minTs) > skewMs) warnings += 1;
  }
  return warnings;
}

const DEFAULT_POSTGRES_FRAME_BUCKET_HOURS = 12;

/**
 * Build HistoricalReplayFrames from a sorted list of raw records by bucketing
 * them by time and assembling news, clusters, and market data.
 */
export function materializeReplayFramesFromRawRecords(args: {
  records: HistoricalRawReplayRecord[];
  bucketHours: number;
  datasetId?: string;
  sourceVersion?: string | null;
  clusterBuilder?: (newsItems: NewsItem[], newsRecords: HistoricalRawReplayRecord[]) => ClusteredEvent[];
}): HistoricalReplayFrame[] {
  const bucketHours = Math.max(1, Math.floor(args.bucketHours) || DEFAULT_POSTGRES_FRAME_BUCKET_HOURS);
  const bucketMs = bucketHours * 60 * 60 * 1000;
  const sortedRecords = args.records
    .slice()
    .sort((left, right) =>
      asTs(left.validTimeStart) - asTs(right.validTimeStart)
      || asTs(left.transactionTime) - asTs(right.transactionTime)
      || left.id.localeCompare(right.id));
  if (sortedRecords.length === 0) return [];

  const buckets = new Map<number, HistoricalRawReplayRecord[]>();
  for (const record of sortedRecords) {
    const bucketKey = Math.floor(asTs(record.validTimeStart) / bucketMs) * bucketMs;
    const bucket = buckets.get(bucketKey) || [];
    bucket.push(record);
    buckets.set(bucketKey, bucket);
  }

  const bucketKeys = Array.from(buckets.keys()).sort((left, right) => left - right);
  const latestMarketBySymbol = new Map<string, HistoricalRawReplayRecord>();
  const warmupFrameCount = Math.ceil(bucketKeys.length * 0.1);
  const clusterBuilder = args.clusterBuilder || buildSimpleClusters;

  return bucketKeys.map((bucketKey, index) => {
    const bucketRecords = buckets.get(bucketKey) || [];
    const newsRecords = bucketRecords.filter((record) => record.itemKind === 'news');
    const marketRecords = bucketRecords.filter((record) => record.itemKind === 'market');
    for (const record of marketRecords) {
      const symbol = record.symbol || record.headline || record.id;
      const current = latestMarketBySymbol.get(symbol);
      if (!current || shouldReplaceMarketRecord(record, current)) {
        latestMarketBySymbol.set(symbol, record);
      }
    }
    const news = newsRecords.map(buildNewsItem);
    const clusters = clusterBuilder(news, newsRecords);
    const markets = Array.from(latestMarketBySymbol.entries()).map(([symbol, record]) => ({
      symbol,
      name: record.headline || record.symbol || record.id,
      display: record.symbol || record.headline || record.id,
      price: record.price ?? null,
      change: 0,
    })) as MarketData[];
    const bucketStart = new Date(bucketKey).toISOString();
    const bucketEnd = new Date(bucketKey + bucketMs).toISOString();
    const transactionTime = bucketRecords.reduce((latest, record) =>
      asTs(record.transactionTime) > asTs(latest) ? record.transactionTime : latest, bucketEnd);
    const knowledgeBoundary = bucketRecords.reduce((latest, record) =>
      asTs(record.knowledgeBoundary) > asTs(latest) ? record.knowledgeBoundary : latest, transactionTime);
    const datasetId = args.datasetId || bucketRecords.find((record) => record.datasetId)?.datasetId || 'postgres-raw-items';
    const providerCounts = Object.fromEntries(
      bucketRecords.reduce((counts, record) => {
        const key = String(record.provider || 'unknown').trim().toLowerCase();
        counts.set(key, (counts.get(key) || 0) + 1);
        return counts;
      }, new Map<string, number>()),
    );

    return {
      id: stableId([datasetId, bucketStart, bucketHours]),
      timestamp: bucketStart,
      validTimeStart: bucketStart,
      validTimeEnd: bucketEnd,
      transactionTime,
      knowledgeBoundary,
      datasetId,
      sourceVersion: args.sourceVersion || null,
      warmup: index < warmupFrameCount,
      news,
      clusters,
      markets,
      metadata: {
        provider: 'postgres-raw-items',
        bucketHours,
        frameNewsCount: news.length,
        frameMarketCount: markets.length,
        providerCountsJson: JSON.stringify(providerCounts),
      },
    } satisfies HistoricalReplayFrame;
  });
}
