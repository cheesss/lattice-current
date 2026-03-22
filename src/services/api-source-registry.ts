import type { NewsItem } from '@/types';
import { fetchWithProxy, rssProxyUrl } from '@/utils';
import { getPersistentCache, setPersistentCache } from './persistent-cache';
import { logSourceOpsEvent } from './source-ops-log';

export type ApiSourceStatus = 'draft' | 'approved' | 'active' | 'rejected';
export type ApiSourceActor = 'playwright' | 'codex-playwright' | 'manual' | 'heuristic' | 'system';

export interface ApiSourceRecord {
  id: string;
  name: string;
  category: string;
  baseUrl: string;
  sampleUrl: string;
  status: ApiSourceStatus;
  confidence: number;
  reason: string;
  discoveredBy: 'playwright' | 'codex-playwright' | 'manual' | 'heuristic';
  schemaHint: 'json' | 'xml' | 'unknown';
  hasRateLimitInfo: boolean;
  hasTosInfo: boolean;
  healthStatus: 'ok' | 'degraded' | 'down' | 'unknown';
  lastCheckedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ApiDiscoveryCandidate {
  name: string;
  baseUrl: string;
  sampleUrl?: string;
  category?: string;
  confidence?: number;
  reason?: string;
  discoveredBy?: ApiSourceRecord['discoveredBy'];
  schemaHint?: ApiSourceRecord['schemaHint'];
  hasRateLimitInfo?: boolean;
  hasTosInfo?: boolean;
}

interface PersistedApiRegistry {
  records: ApiSourceRecord[];
}

const API_REGISTRY_KEY = 'api-source-registry:v1';
const MAX_API_SOURCES = 800;

let loaded = false;
const apiSourceMap = new Map<string, ApiSourceRecord>();

function nowMs(): number {
  return Date.now();
}

function normalizeUrl(raw: string): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function normalizeCategory(raw: string): string {
  return String(raw || 'intel').trim().toLowerCase().slice(0, 40) || 'intel';
}

function inferCategory(url: string): string {
  const value = String(url || '').toLowerCase();
  if (/(ship|port|ais|maritime)/.test(value)) return 'supply-chain';
  if (/(flight|aviation|opensky)/.test(value)) return 'crisis';
  if (/(stock|market|price|finance|quote)/.test(value)) return 'finance';
  if (/(climate|weather|disaster)/.test(value)) return 'politics';
  return 'intel';
}

function inferSchemaHint(url: string): ApiSourceRecord['schemaHint'] {
  const value = String(url || '').toLowerCase();
  if (value.endsWith('.xml') || value.includes('/xml')) return 'xml';
  if (value.endsWith('.json') || value.includes('/json') || value.includes('format=json')) return 'json';
  return 'unknown';
}

function sourceId(baseUrl: string, sampleUrl: string): string {
  return `${baseUrl.toLowerCase()}::${sampleUrl.toLowerCase()}`;
}

function scoreSourceConfidence(record: Pick<ApiSourceRecord, 'confidence' | 'healthStatus' | 'hasRateLimitInfo' | 'hasTosInfo' | 'schemaHint'>): number {
  let score = Math.max(0, Math.min(100, Math.round(record.confidence)));
  if (record.healthStatus === 'ok') score += 8;
  else if (record.healthStatus === 'degraded') score += 2;
  else if (record.healthStatus === 'down') score -= 12;
  if (record.hasRateLimitInfo) score += 4;
  if (record.hasTosInfo) score += 4;
  if (record.schemaHint === 'json' || record.schemaHint === 'xml') score += 3;
  return Math.max(0, Math.min(100, score));
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const cached = await getPersistentCache<PersistedApiRegistry>(API_REGISTRY_KEY);
    for (const record of cached?.data?.records ?? []) {
      apiSourceMap.set(record.id, record);
    }
  } catch (error) {
    console.warn('[api-source-registry] failed to load cache', error);
  }
}

async function persist(): Promise<void> {
  const records = Array.from(apiSourceMap.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_API_SOURCES);
  apiSourceMap.clear();
  for (const record of records) apiSourceMap.set(record.id, record);
  await setPersistentCache(API_REGISTRY_KEY, { records });
}

export async function registerApiDiscoveryCandidate(input: ApiDiscoveryCandidate): Promise<ApiSourceRecord | null> {
  await ensureLoaded();

  const baseUrl = normalizeUrl(input.baseUrl);
  const sampleUrl = normalizeUrl(input.sampleUrl || input.baseUrl);
  if (!baseUrl || !sampleUrl) return null;

  const id = sourceId(baseUrl, sampleUrl);
  const ts = nowMs();
  const prev = apiSourceMap.get(id);
  const confidence = Math.max(0, Math.min(100, Math.round(input.confidence ?? 52)));

  const candidate: ApiSourceRecord = prev
    ? {
      ...prev,
      name: (input.name || prev.name || new URL(baseUrl).hostname).slice(0, 120),
      category: normalizeCategory(input.category || prev.category || inferCategory(sampleUrl)),
      confidence: Math.max(prev.confidence, confidence),
      reason: String(input.reason || prev.reason || 'api candidate').slice(0, 320),
      discoveredBy: input.discoveredBy || prev.discoveredBy || 'heuristic',
      schemaHint: input.schemaHint || prev.schemaHint || inferSchemaHint(sampleUrl),
      hasRateLimitInfo: Boolean(input.hasRateLimitInfo ?? prev.hasRateLimitInfo),
      hasTosInfo: Boolean(input.hasTosInfo ?? prev.hasTosInfo),
      updatedAt: ts,
    }
    : {
      id,
      name: (input.name || new URL(baseUrl).hostname).slice(0, 120),
      category: normalizeCategory(input.category || inferCategory(sampleUrl)),
      baseUrl,
      sampleUrl,
      status: confidence >= 90 ? 'approved' : 'draft',
      confidence,
      reason: String(input.reason || 'api discovery candidate').slice(0, 320),
      discoveredBy: input.discoveredBy || 'heuristic',
      schemaHint: input.schemaHint || inferSchemaHint(sampleUrl),
      hasRateLimitInfo: Boolean(input.hasRateLimitInfo),
      hasTosInfo: Boolean(input.hasTosInfo),
      healthStatus: 'unknown',
      lastCheckedAt: null,
      createdAt: ts,
      updatedAt: ts,
    };

  candidate.confidence = scoreSourceConfidence(candidate);
  if (candidate.status === 'draft' && candidate.confidence >= 92) {
    candidate.status = 'approved';
  }
  apiSourceMap.set(id, candidate);
  await persist();
  await logSourceOpsEvent({
    kind: 'api',
    action: prev ? 'updated' : 'discovered',
    actor: candidate.discoveredBy,
    title: candidate.name,
    detail: candidate.reason,
    status: candidate.status,
    category: candidate.category,
    url: candidate.sampleUrl,
    tags: [candidate.schemaHint, candidate.healthStatus].filter(Boolean),
  });
  return candidate;
}

export async function registerApiDiscoveryCandidates(inputs: ApiDiscoveryCandidate[]): Promise<ApiSourceRecord[]> {
  await ensureLoaded();
  const out: ApiSourceRecord[] = [];
  for (const input of inputs) {
    const record = await registerApiDiscoveryCandidate(input);
    if (record) out.push(record);
  }
  return out;
}

export async function listApiSourceRegistry(): Promise<ApiSourceRecord[]> {
  await ensureLoaded();
  return Array.from(apiSourceMap.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function setApiSourceStatus(id: string, status: ApiSourceStatus): Promise<ApiSourceRecord | null> {
  return setApiSourceStatusWithMeta(id, status);
}

export async function setApiSourceStatusWithMeta(
  id: string,
  status: ApiSourceStatus,
  options: {
    actor?: ApiSourceActor;
    note?: string;
  } = {},
): Promise<ApiSourceRecord | null> {
  await ensureLoaded();
  const existing = apiSourceMap.get(id);
  if (!existing) return null;
  const next: ApiSourceRecord = {
    ...existing,
    status,
    updatedAt: nowMs(),
  };
  apiSourceMap.set(id, next);
  await persist();
  await logSourceOpsEvent({
    kind: 'api',
    action: 'status-change',
    actor: options.actor || 'manual',
    title: next.name,
    detail: (options.note || `API source -> ${status}`).slice(0, 220),
    status,
    category: next.category,
    url: next.sampleUrl,
    tags: [next.schemaHint, next.healthStatus].filter(Boolean),
  });
  return next;
}

export async function refreshApiSourceHealth(id: string): Promise<ApiSourceRecord | null> {
  await ensureLoaded();
  const existing = apiSourceMap.get(id);
  if (!existing) return null;

  let healthStatus: ApiSourceRecord['healthStatus'] = 'unknown';
  let schemaHint = existing.schemaHint;
  let hasRateLimitInfo = existing.hasRateLimitInfo;
  let hasTosInfo = existing.hasTosInfo;

  try {
    const res = await fetchWithProxy(rssProxyUrl(existing.sampleUrl));
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    const text = await res.text();
    if (res.ok) {
      healthStatus = text.length > 0 ? 'ok' : 'degraded';
    } else {
      healthStatus = res.status >= 500 ? 'down' : 'degraded';
    }

    if (schemaHint === 'unknown') {
      if (contentType.includes('json') || /^\s*[\[{]/.test(text)) schemaHint = 'json';
      else if (contentType.includes('xml') || /^\s*</.test(text)) schemaHint = 'xml';
    }

    if (!hasRateLimitInfo) {
      const headers = ['x-ratelimit-limit', 'x-rate-limit-limit', 'ratelimit-limit'];
      hasRateLimitInfo = headers.some((key) => !!res.headers.get(key));
    }
    if (!hasTosInfo) {
      hasTosInfo = /terms|rate limit|api key|usage/i.test(text.slice(0, 1200));
    }
  } catch {
    healthStatus = 'down';
  }

  const next: ApiSourceRecord = {
    ...existing,
    healthStatus,
    schemaHint,
    hasRateLimitInfo,
    hasTosInfo,
    confidence: scoreSourceConfidence({
      confidence: existing.confidence,
      healthStatus,
      hasRateLimitInfo,
      hasTosInfo,
      schemaHint,
    }),
    lastCheckedAt: nowMs(),
    updatedAt: nowMs(),
  };
  apiSourceMap.set(id, next);
  await persist();
  await logSourceOpsEvent({
    kind: 'api',
    action: 'health-check',
    actor: 'system',
    title: next.name,
    detail: `${next.schemaHint} / rate-limit=${next.hasRateLimitInfo ? 'yes' : 'no'} / tos=${next.hasTosInfo ? 'yes' : 'no'}`,
    status: next.healthStatus,
    category: next.category,
    url: next.sampleUrl,
    tags: [next.schemaHint, next.healthStatus].filter(Boolean),
  });
  return next;
}

export async function getActiveApiSources(category?: string): Promise<ApiSourceRecord[]> {
  await ensureLoaded();
  const normalizedCategory = category ? normalizeCategory(category) : null;
  return Array.from(apiSourceMap.values())
    .filter(record => record.status === 'active')
    .filter(record => !normalizedCategory || record.category === normalizedCategory)
    .sort((a, b) => b.confidence - a.confidence);
}

function flattenObjectToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.slice(0, 8).map(item => flattenObjectToText(item)).join(' | ');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .slice(0, 10)
      .map(([key, val]) => `${key}: ${flattenObjectToText(val)}`);
    return entries.join(' | ');
  }
  return '';
}

function buildNewsItemFromApiRecord(
  source: ApiSourceRecord,
  payload: unknown,
): NewsItem | null {
  const text = flattenObjectToText(payload).trim();
  if (!text) return null;
  const title = text.length > 260 ? `${text.slice(0, 257)}...` : text;
  return {
    source: `API/${source.name}`,
    title,
    link: source.sampleUrl,
    pubDate: new Date(),
    isAlert: /(warning|critical|conflict|sanction|attack|disruption|outage)/i.test(title),
  };
}

export async function collectNewsFromActiveApiSources(
  category?: string,
  limitSources = 10,
  limitItemsPerSource = 5,
): Promise<NewsItem[]> {
  const sources = (await getActiveApiSources(category)).slice(0, Math.max(1, limitSources));
  const out: NewsItem[] = [];

  for (const source of sources) {
    try {
      const response = await fetchWithProxy(rssProxyUrl(source.sampleUrl));
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (!response.ok) continue;

      if (contentType.includes('json')) {
        const json = await response.json() as unknown;
        if (Array.isArray(json)) {
          for (let i = 0; i < Math.min(limitItemsPerSource, json.length); i += 1) {
            const item = buildNewsItemFromApiRecord(source, json[i]);
            if (item) out.push(item);
          }
        } else {
          const item = buildNewsItemFromApiRecord(source, json);
          if (item) out.push(item);
        }
      } else {
        const text = await response.text();
        if (!text.trim()) continue;
        out.push({
          source: `API/${source.name}`,
          title: text.slice(0, 260),
          link: source.sampleUrl,
          pubDate: new Date(),
          isAlert: false,
        });
      }
    } catch {
      continue;
    }
  }

  return out;
}
