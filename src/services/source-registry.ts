import type { Feed } from '@/types';
import { getPersistentCache, setPersistentCache } from './persistent-cache';
import { logSourceOpsEvent } from './source-ops-log';

export type FeedHealthStatus = 'healthy' | 'degraded' | 'investigating';
export type FeedSourceStrategy = 'rss';

export interface FeedSourceRecord {
  id: string;
  feedName: string;
  lang: string;
  currentUrl: string;
  strategy: FeedSourceStrategy;
  status: FeedHealthStatus;
  failureCount: number;
  lastFailureAt: number | null;
  lastFailureReason: string | null;
  lastSuccessAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface FeedSourceOverride {
  id: string;
  feedName: string;
  lang: string;
  overrideUrl: string;
  reason: string;
  createdAt: number;
  updatedAt: number;
}

export type DiscoveredSourceStatus = 'draft' | 'approved' | 'active' | 'rejected';
export type DiscoveredBy = 'playwright' | 'codex-playwright' | 'manual' | 'heuristic';
export type DiscoveredSourceActor = DiscoveredBy | 'system';

export interface DiscoveredSourceRecord {
  id: string;
  category: string;
  feedName: string;
  url: string;
  lang: string;
  domain: string;
  status: DiscoveredSourceStatus;
  discoveredBy: DiscoveredBy;
  confidence: number;
  reason: string;
  topics?: string[];
  createdAt: number;
  updatedAt: number;
}

type PersistedRegistry = {
  records: FeedSourceRecord[];
  overrides: FeedSourceOverride[];
  discoveredSources: DiscoveredSourceRecord[];
};

const REGISTRY_CACHE_KEY = 'source-registry:v1';

let loaded = false;
const sourceRecords = new Map<string, FeedSourceRecord>();
const sourceOverrides = new Map<string, FeedSourceOverride>();
const discoveredSources = new Map<string, DiscoveredSourceRecord>();

function sourceId(feedName: string, lang: string): string {
  return `${feedName}::${lang || 'en'}`;
}

function nowMs(): number {
  return Date.now();
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const cached = await getPersistentCache<PersistedRegistry>(REGISTRY_CACHE_KEY);
    const records = cached?.data?.records ?? [];
    const overrides = cached?.data?.overrides ?? [];
    const discovered = cached?.data?.discoveredSources ?? [];
    for (const record of records) {
      sourceRecords.set(record.id, record);
    }
    for (const override of overrides) {
      sourceOverrides.set(override.id, override);
    }
    for (const source of discovered) {
      discoveredSources.set(source.id, source);
    }
  } catch (error) {
    console.warn('[source-registry] Failed to load cache', error);
  }
}

async function persist(): Promise<void> {
  const payload: PersistedRegistry = {
    records: Array.from(sourceRecords.values()),
    overrides: Array.from(sourceOverrides.values()),
    discoveredSources: Array.from(discoveredSources.values()),
  };
  await setPersistentCache(REGISTRY_CACHE_KEY, payload);
}

export async function resolveFeedUrl(feedName: string, lang: string, defaultUrl: string): Promise<string> {
  await ensureLoaded();
  const id = sourceId(feedName, lang);
  const override = sourceOverrides.get(id);
  if (override?.overrideUrl) return override.overrideUrl;
  return defaultUrl;
}

export async function recordFeedHealth(
  feedName: string,
  lang: string,
  currentUrl: string,
  outcome: { ok: true } | { ok: false; reason: string },
): Promise<void> {
  await ensureLoaded();
  const id = sourceId(feedName, lang);
  const ts = nowMs();
  const prev = sourceRecords.get(id);
  const next: FeedSourceRecord = prev
    ? {
      ...prev,
      currentUrl,
      updatedAt: ts,
    }
    : {
      id,
      feedName,
      lang,
      currentUrl,
      strategy: 'rss',
      status: 'healthy',
      failureCount: 0,
      lastFailureAt: null,
      lastFailureReason: null,
      lastSuccessAt: null,
      createdAt: ts,
      updatedAt: ts,
    };

  if (outcome.ok) {
    next.status = 'healthy';
    next.failureCount = 0;
    next.lastSuccessAt = ts;
    next.lastFailureReason = null;
  } else {
    next.status = 'degraded';
    next.failureCount += 1;
    next.lastFailureAt = ts;
    next.lastFailureReason = outcome.reason.slice(0, 240);
  }

  sourceRecords.set(id, next);
  await persist();
  if (!outcome.ok) {
    await logSourceOpsEvent({
      kind: 'source',
      action: 'feed-health',
      actor: 'system',
      title: feedName,
      detail: outcome.reason.slice(0, 220),
      status: next.status,
      category: lang || 'en',
      url: currentUrl,
      tags: ['rss', 'health'],
    });
  }
}

export async function markSourceInvestigating(feedName: string, lang: string): Promise<void> {
  await ensureLoaded();
  const id = sourceId(feedName, lang);
  const record = sourceRecords.get(id);
  if (!record) return;
  sourceRecords.set(id, {
    ...record,
    status: 'investigating',
    updatedAt: nowMs(),
  });
  await persist();
  await logSourceOpsEvent({
    kind: 'source',
    action: 'investigating',
    actor: 'system',
    title: feedName,
    detail: 'Feed moved to investigation queue',
    status: 'investigating',
    category: lang || 'en',
    url: record.currentUrl,
    tags: ['rss', 'investigation'],
  });
}

export async function setFeedOverride(
  feedName: string,
  lang: string,
  overrideUrl: string,
  reason: string,
): Promise<void> {
  await ensureLoaded();
  const id = sourceId(feedName, lang);
  const ts = nowMs();
  const prev = sourceOverrides.get(id);
  sourceOverrides.set(id, prev
    ? {
      ...prev,
      overrideUrl,
      reason: reason.slice(0, 240),
      updatedAt: ts,
    }
    : {
      id,
      feedName,
      lang,
      overrideUrl,
      reason: reason.slice(0, 240),
      createdAt: ts,
      updatedAt: ts,
    });
  await persist();
  await logSourceOpsEvent({
    kind: 'source',
    action: 'override',
    actor: 'system',
    title: feedName,
    detail: reason.slice(0, 220),
    status: 'active',
    category: lang || 'en',
    url: overrideUrl,
    tags: ['rss', 'override'],
  });
}

export async function listSourceRegistrySnapshot(): Promise<{
  records: FeedSourceRecord[];
  overrides: FeedSourceOverride[];
  discoveredSources: DiscoveredSourceRecord[];
}> {
  await ensureLoaded();
  return {
    records: Array.from(sourceRecords.values()).sort((a, b) => b.updatedAt - a.updatedAt),
    overrides: Array.from(sourceOverrides.values()).sort((a, b) => b.updatedAt - a.updatedAt),
    discoveredSources: Array.from(discoveredSources.values()).sort((a, b) => b.updatedAt - a.updatedAt),
  };
}

function normalizeDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function discoveredId(category: string, url: string): string {
  return `${category.toLowerCase()}::${normalizeDomain(url)}::${url.toLowerCase()}`;
}

export async function addDiscoveredSource(input: {
  category: string;
  feedName: string;
  url: string;
  lang?: string;
  discoveredBy?: DiscoveredBy;
  confidence?: number;
  reason?: string;
  topics?: string[];
}): Promise<DiscoveredSourceRecord | null> {
  await ensureLoaded();
  const cleanUrl = (input.url || '').trim();
  if (!cleanUrl) return null;
  if (!/^https?:\/\//i.test(cleanUrl)) return null;

  const category = (input.category || '').trim().toLowerCase() || 'politics';
  const id = discoveredId(category, cleanUrl);
  const ts = nowMs();
  const domain = normalizeDomain(cleanUrl);
  const confidence = Math.max(0, Math.min(100, Math.round(input.confidence ?? 55)));
  const status: DiscoveredSourceStatus = confidence >= 85 ? 'approved' : 'draft';

  const previous = discoveredSources.get(id);
  const next: DiscoveredSourceRecord = previous
    ? {
      ...previous,
      feedName: input.feedName || previous.feedName,
      confidence: Math.max(previous.confidence, confidence),
      reason: (input.reason || previous.reason || 'discovered source').slice(0, 300),
      topics: Array.from(new Set([
        ...(previous.topics || []),
        ...((input.topics || []).map(topic => String(topic || '').trim()).filter(Boolean).slice(0, 8)),
      ])).slice(0, 12),
      updatedAt: ts,
      status: previous.status === 'active' || previous.status === 'approved' ? previous.status : status,
    }
    : {
      id,
      category,
      feedName: (input.feedName || domain || 'Discovered Feed').slice(0, 120),
      url: cleanUrl,
      lang: (input.lang || 'en').slice(0, 8),
      domain,
      status,
      discoveredBy: input.discoveredBy || 'heuristic',
      confidence,
      reason: (input.reason || 'discovered source').slice(0, 300),
      topics: (input.topics || []).map(topic => String(topic || '').trim()).filter(Boolean).slice(0, 12),
      createdAt: ts,
      updatedAt: ts,
    };

  discoveredSources.set(id, next);
  await persist();
  await logSourceOpsEvent({
    kind: 'source',
    action: previous ? 'updated' : 'discovered',
    actor: next.discoveredBy,
    title: next.feedName,
    detail: next.reason,
    status: next.status,
    category: next.category,
    url: next.url,
    tags: next.topics?.slice(0, 6) || [],
  });
  return next;
}

export async function setDiscoveredSourceStatus(
  id: string,
  status: DiscoveredSourceStatus,
  options: {
    actor?: DiscoveredSourceActor;
    note?: string;
  } = {},
): Promise<DiscoveredSourceRecord | null> {
  await ensureLoaded();
  const existing = discoveredSources.get(id);
  if (!existing) return null;
  const next: DiscoveredSourceRecord = {
    ...existing,
    status,
    updatedAt: nowMs(),
  };
  discoveredSources.set(id, next);
  await persist();
  await logSourceOpsEvent({
    kind: 'source',
    action: 'status-change',
    actor: options.actor || 'manual',
    title: next.feedName,
    detail: (options.note || `Discovered source -> ${status}`).slice(0, 220),
    status,
    category: next.category,
    url: next.url,
    tags: next.topics?.slice(0, 6) || [],
  });
  return next;
}

export async function listDiscoveredSources(): Promise<DiscoveredSourceRecord[]> {
  await ensureLoaded();
  return Array.from(discoveredSources.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getActiveDynamicFeedsForCategory(category: string): Promise<Feed[]> {
  await ensureLoaded();
  const key = (category || '').trim().toLowerCase();
  const active = Array.from(discoveredSources.values())
    .filter(source => source.status === 'active' && source.category === key);

  return active.map(source => ({
    name: source.feedName,
    url: `/api/rss-proxy?url=${encodeURIComponent(source.url)}`,
    lang: source.lang,
  }));
}

