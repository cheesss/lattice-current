import { getPersistentCache, setPersistentCache } from './persistent-cache';
import { logSourceOpsEvent } from './source-ops-log';
import type { ApiDiscoveryCandidate } from './api-source-registry';

export interface NetworkDiscoveryCapture {
  id: string;
  pageUrl: string;
  requestUrl: string;
  method: string;
  status: number;
  contentType: string;
  schemaHint: 'json' | 'xml' | 'unknown';
  sampleKeys: string[];
  source: 'playwright-discovery' | 'multimodal';
  category: string;
  notes: string[];
  discoveredAt: number;
}

interface PersistedNetworkDiscovery {
  captures: NetworkDiscoveryCapture[];
}

const NETWORK_DISCOVERY_KEY = 'network-discovery:v1';
const MAX_CAPTURES = 1200;

let loaded = false;
const captureMap = new Map<string, NetworkDiscoveryCapture>();

function nowMs(): number {
  return Date.now();
}

function normalizeUrl(raw: string): string {
  try {
    const parsed = new URL(String(raw || '').trim());
    if (!/^https?:$/.test(parsed.protocol)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function normalizeCategory(raw: string): string {
  return String(raw || 'intel').trim().toLowerCase().slice(0, 40) || 'intel';
}

function inferCategory(url: string, keys: string[]): string {
  const blob = `${String(url || '').toLowerCase()} ${keys.join(' ').toLowerCase()}`;
  if (/(ship|port|ais|maritime|vessel|cargo|freight|container)/.test(blob)) return 'supply-chain';
  if (/(flight|aviation|aircraft|opensky|airport)/.test(blob)) return 'crisis';
  if (/(stock|market|price|quote|fx|yield|bond|crypto)/.test(blob)) return 'finance';
  if (/(sanction|conflict|missile|war|military|defense)/.test(blob)) return 'crisis';
  if (/(ai|chip|semiconductor|cloud|model|compute)/.test(blob)) return 'tech';
  if (/(power|grid|energy|oil|gas|lng|uranium)/.test(blob)) return 'energy';
  return 'intel';
}

function makeId(requestUrl: string, source: NetworkDiscoveryCapture['source']): string {
  return `${requestUrl.toLowerCase()}::${source}`;
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const cached = await getPersistentCache<PersistedNetworkDiscovery>(NETWORK_DISCOVERY_KEY);
    for (const capture of cached?.data?.captures ?? []) {
      captureMap.set(capture.id, capture);
    }
  } catch (error) {
    console.warn('[network-discovery] load failed', error);
  }
}

async function persist(): Promise<void> {
  const captures = Array.from(captureMap.values())
    .sort((a, b) => b.discoveredAt - a.discoveredAt)
    .slice(0, MAX_CAPTURES);
  captureMap.clear();
  for (const capture of captures) captureMap.set(capture.id, capture);
  await setPersistentCache(NETWORK_DISCOVERY_KEY, { captures });
}

export async function ingestNetworkDiscoveryCaptures(
  captures: Array<Partial<NetworkDiscoveryCapture> & { requestUrl: string }>,
  source: NetworkDiscoveryCapture['source'],
): Promise<NetworkDiscoveryCapture[]> {
  await ensureLoaded();
  const out: NetworkDiscoveryCapture[] = [];

  for (const raw of captures) {
    const requestUrl = normalizeUrl(raw.requestUrl || '');
    if (!requestUrl) continue;
    const pageUrl = normalizeUrl(raw.pageUrl || '') || requestUrl;
    const sampleKeys = Array.from(new Set((raw.sampleKeys || []).map((key) => String(key || '').trim()).filter(Boolean))).slice(0, 16);
    const id = makeId(requestUrl, source);
    const previous = captureMap.get(id);
    const next: NetworkDiscoveryCapture = previous
      ? {
        ...previous,
        pageUrl,
        method: String(raw.method || previous.method || 'GET').toUpperCase().slice(0, 12),
        status: Number.isFinite(raw.status) ? Number(raw.status) : previous.status,
        contentType: String(raw.contentType || previous.contentType || '').slice(0, 160),
        schemaHint: raw.schemaHint || previous.schemaHint || 'unknown',
        sampleKeys: Array.from(new Set([...(previous.sampleKeys || []), ...sampleKeys])).slice(0, 16),
        notes: Array.from(new Set([...(previous.notes || []), ...((raw.notes || []).map((note) => String(note || '').trim()).filter(Boolean))])).slice(0, 10),
        category: normalizeCategory(raw.category || previous.category || inferCategory(requestUrl, sampleKeys)),
        discoveredAt: Math.max(previous.discoveredAt, Number.isFinite(raw.discoveredAt) ? Number(raw.discoveredAt) : nowMs()),
      }
      : {
        id,
        pageUrl,
        requestUrl,
        method: String(raw.method || 'GET').toUpperCase().slice(0, 12),
        status: Number.isFinite(raw.status) ? Number(raw.status) : 0,
        contentType: String(raw.contentType || '').slice(0, 160),
        schemaHint: raw.schemaHint || 'unknown',
        sampleKeys,
        source,
        category: normalizeCategory(raw.category || inferCategory(requestUrl, sampleKeys)),
        notes: ((raw.notes || []).map((note) => String(note || '').trim()).filter(Boolean)).slice(0, 10),
        discoveredAt: Number.isFinite(raw.discoveredAt) ? Number(raw.discoveredAt) : nowMs(),
      };

    captureMap.set(id, next);
    out.push(next);

    await logSourceOpsEvent({
      kind: 'api',
      action: previous ? 'network-updated' : 'network-discovered',
      actor: source,
      title: next.requestUrl,
      detail: `schema=${next.schemaHint}; keys=${next.sampleKeys.slice(0, 6).join(', ') || 'na'}`,
      status: next.status > 0 ? String(next.status) : 'info',
      category: next.category,
      url: next.requestUrl,
      tags: [next.schemaHint, next.source, ...next.sampleKeys.slice(0, 4)],
    });
  }

  if (out.length > 0) {
    await persist();
  }
  return out;
}

export async function listNetworkDiscoveryCaptures(limit = 80): Promise<NetworkDiscoveryCapture[]> {
  await ensureLoaded();
  return Array.from(captureMap.values())
    .sort((a, b) => b.discoveredAt - a.discoveredAt)
    .slice(0, Math.max(1, limit));
}

export function networkCapturesToApiDiscoveryCandidates(
  captures: NetworkDiscoveryCapture[],
): ApiDiscoveryCandidate[] {
  return captures
    .filter((capture) => capture.schemaHint === 'json' || capture.requestUrl.includes('/api/') || capture.requestUrl.includes('graphql'))
    .map((capture) => {
      let baseUrl = capture.requestUrl;
      try {
        baseUrl = new URL(capture.requestUrl).origin;
      } catch {
        // keep raw URL
      }
      return {
        name: `Intercepted API (${new URL(capture.requestUrl).hostname})`,
        baseUrl,
        sampleUrl: capture.requestUrl,
        category: capture.category,
        confidence: Math.max(55, Math.min(96, 58 + capture.sampleKeys.length * 3 + (capture.schemaHint === 'json' ? 8 : 0))),
        reason: `playwright network intercept (${capture.source})`,
        discoveredBy: 'playwright',
        schemaHint: capture.schemaHint,
        hasRateLimitInfo: capture.notes.some((note) => /ratelimit/i.test(note)),
        hasTosInfo: capture.notes.some((note) => /terms|auth|api key/i.test(note)),
      } satisfies ApiDiscoveryCandidate;
    })
    .slice(0, 40);
}
