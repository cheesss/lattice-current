import { getCountryBbox, getCountryNameByCode, matchCountryNamesInText } from './country-geometry';

export type GlintThreatLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface GlintNewsLocation {
  lat: number;
  lon: number;
  title: string;
  threatLevel: GlintThreatLevel;
  timestamp?: Date;
}

export interface GlintFeedRecord {
  id: string;
  sourceType: 'news' | 'tweet' | 'telegram' | 'reddit' | 'market' | 'unknown';
  sourceLabel: string;
  title: string;
  snippet?: string;
  link: string;
  timestamp: Date;
  countryCodes: string[];
  topics: string[];
  categories: string[];
}

interface GlintPublicCountry {
  count?: number;
  country?: string;
  recent?: number;
  volume?: number;
}

interface GlintPublicDot {
  c?: string;
  l?: string;
}

interface GlintPublicFlight {
  cat?: string;
  cs?: string;
  lat?: number;
  lng?: number;
  ts?: number;
}

interface GlintPublicGlobeResponse {
  countries?: GlintPublicCountry[];
  dots?: GlintPublicDot[];
  flights?: GlintPublicFlight[];
}

interface GlintPrivateFeedItem {
  id?: string;
  timestamp?: number;
  topics?: unknown;
  categories?: unknown;
  osint?: unknown;
  tweet?: {
    body?: string;
    link?: string;
    created_at?: number;
    user?: { handle?: string; display_name?: string } | null;
  } | null;
  news?: {
    headline?: string;
    description?: string;
    source?: string;
    url?: string;
    timestamp?: number;
  } | null;
  reddit?: {
    title?: string;
    body?: string;
    link?: string;
    subreddit?: string;
    timestamp?: number;
  } | null;
  telegram?: {
    text?: string;
    channel?: string;
    link?: string;
    timestamp?: number;
  } | null;
  related_market?: GlintRelatedMarket | null;
  related_markets?: unknown;
  country?: string;
  countries?: unknown;
  edges?: { countries?: unknown } | null;
}

interface GlintMoversEntry {
  feed_item?: GlintPrivateFeedItem | null;
  related_market?: GlintRelatedMarket | null;
  related_markets?: unknown;
}

interface GlintRelatedMarket {
  id?: string;
  slug?: string;
  condition_id?: string;
  title?: string;
  question?: string;
  description?: string;
  source?: string;
  categories?: unknown;
  event_id?: string;
  event_title?: string;
  event_slug?: string;
  impact_level?: string;
  impact_reason?: string;
  yes_probability?: number | string;
  no_probability?: number | string;
  yes_best_bid?: number | string;
  yes_best_ask?: number | string;
  no_best_bid?: number | string;
  no_best_ask?: number | string;
  yes_spread?: number | string;
  no_spread?: number | string;
  volume?: number | string;
  liquidity?: number | string;
  detected_yes_price?: number | string;
  detected_no_price?: number | string;
  highest_price_change?: number | string;
  highest_yes_price?: number | string;
  highest_no_price?: number | string;
  detected_at?: number | string;
  first_moved_at?: number | string;
  peaked_at?: number | string;
  end_date?: string;
}

interface GlintWsTokenResponse {
  ws_token?: string;
}

type GlintWsStatus =
  | 'connecting'
  | 'connected'
  | 'authenticated'
  | 'disconnected'
  | 'error';

type JsonRecord = Record<string, unknown>;

export interface GlintMarketWatchClientOptions {
  authToken?: string | null;
  rooms?: string[];
  reconnect?: boolean;
  onStatus?: (status: GlintWsStatus, detail?: string) => void;
  onMessage?: (message: JsonRecord) => void;
}

const GLINT_API_BASE = 'https://api.glint.trade';
const GLINT_PUBLIC_GLOBE_URL = `${GLINT_API_BASE}/api/public/globe`;
const GLINT_PRIVATE_FEED_BASE_URL = `${GLINT_API_BASE}/api/feed/v2`;
const GLINT_MOVERS_URL = `${GLINT_API_BASE}/api/movers`;
const GLINT_WS_URL = 'wss://api.glint.trade/ws';
const GLINT_WS_TOKEN_URL = `${GLINT_API_BASE}/api/auth/ws-token`;
const GLINT_PUBLIC_CACHE_TTL_MS = 30_000;
const GLINT_PRIVATE_CACHE_TTL_MS = 20_000;
const GLINT_FETCH_TIMEOUT_MS = 8_000;
const GLINT_FEED_PAGE_SIZE = 100;
const GLINT_FEED_MAX_PAGES = 4;
const GLINT_LOCAL_TOKEN_KEY = 'wm_glint_auth_token';

let glintPublicCache:
  | { timestamp: number; data: GlintPublicGlobeResponse }
  | null = null;
let glintPrivateCache:
  | { token: string; timestamp: number; data: GlintPrivateFeedItem[] }
  | null = null;

function toUpperCountryCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function getString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function normalizeEpochMs(value: number): number {
  return value > 0 && value < 10_000_000_000 ? value * 1_000 : value;
}

function getEpochMs(value: unknown): number | null {
  const numeric = getNumber(value);
  if (numeric !== null) return normalizeEpochMs(numeric);
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function looksLikeJwt(value: string): boolean {
  const clean = value.trim();
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(clean);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hasEditorialSource(item: GlintPrivateFeedItem): boolean {
  return Boolean(item.news || item.tweet || item.telegram || item.reddit);
}

function parseRelatedMarket(value: unknown): GlintRelatedMarket | null {
  if (!value || typeof value !== 'object') return null;
  return value as GlintRelatedMarket;
}

function extractRelatedMarkets(item: GlintPrivateFeedItem): GlintRelatedMarket[] {
  const collected: GlintRelatedMarket[] = [];
  const pushAny = (value: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const parsed = parseRelatedMarket(entry);
        if (parsed) collected.push(parsed);
      }
      return;
    }
    const parsed = parseRelatedMarket(value);
    if (parsed) collected.push(parsed);
  };

  pushAny(item.related_market);
  pushAny(item.related_markets);

  const deduped = new Map<string, GlintRelatedMarket>();
  for (const market of collected) {
    const key = getString(market.id)
      || getString(market.condition_id)
      || getString(market.question)
      || getString(market.title)
      || getString(market.slug);
    if (!key) continue;
    deduped.set(key, market);
  }
  return [...deduped.values()];
}

function extractOsintText(value: unknown, maxItems = 8): string[] {
  const out: string[] = [];
  const priorityKeys = ['title', 'headline', 'summary', 'description', 'body', 'text', 'message', 'source', 'label'];

  const push = (candidate: unknown): void => {
    const text = getString(candidate);
    if (!text || out.includes(text)) return;
    out.push(text);
  };

  const visit = (node: unknown, depth: number): void => {
    if (out.length >= maxItems || depth > 2 || node == null) return;
    if (typeof node === 'string') {
      push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const entry of node.slice(0, 6)) {
        visit(entry, depth + 1);
        if (out.length >= maxItems) return;
      }
      return;
    }
    if (typeof node !== 'object') return;

    const record = node as Record<string, unknown>;
    for (const key of priorityKeys) {
      visit(record[key], depth + 1);
      if (out.length >= maxItems) return;
    }

    for (const [key, entry] of Object.entries(record)) {
      if (priorityKeys.includes(key)) continue;
      if (typeof entry === 'string') push(entry);
      if (out.length >= maxItems) return;
    }
  };

  visit(value, 0);
  return out;
}

function hasOsintSignal(item: GlintPrivateFeedItem): boolean {
  if (item.osint == null || item.osint === false) return false;
  if (item.osint === true) return true;
  return extractOsintText(item.osint, 1).length > 0;
}

function hasAnySignalSource(item: GlintPrivateFeedItem): boolean {
  return hasEditorialSource(item) || extractRelatedMarkets(item).length > 0 || hasOsintSignal(item);
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const text = getString(entry);
    if (text) out.push(text);
  }
  return out;
}

function mergeUniqueStrings(values: string[][], maxItems: number): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const list of values) {
    for (const entry of list) {
      const text = entry.trim();
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(text);
      if (merged.length >= maxItems) return merged;
    }
  }
  return merged;
}

function formatCompactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return abs >= 100 ? value.toFixed(0) : value.toFixed(2).replace(/\.?0+$/, '');
}

function marketTitle(market: GlintRelatedMarket): string | null {
  return getString(market.question) || getString(market.title);
}

function marketLink(market: GlintRelatedMarket): string {
  return `https://glint.trade/${getString(market.slug) ? `?market=${encodeURIComponent(String(market.slug))}` : ''}`.replace(/\/\?/, '/?');
}

function marketShock(market: GlintRelatedMarket): number {
  const candidates: number[] = [];
  const addIfFinite = (value: unknown): void => {
    const numeric = getNumber(value);
    if (numeric !== null) candidates.push(Math.abs(numeric));
  };

  addIfFinite(market.highest_price_change);

  const yes = getNumber(market.yes_probability);
  const detectedYes = getNumber(market.detected_yes_price);
  if (yes !== null && detectedYes !== null) candidates.push(Math.abs(yes - detectedYes));

  const no = getNumber(market.no_probability);
  const detectedNo = getNumber(market.detected_no_price);
  if (no !== null && detectedNo !== null) candidates.push(Math.abs(no - detectedNo));

  addIfFinite(market.yes_spread);
  addIfFinite(market.no_spread);

  return candidates.length > 0 ? Math.max(...candidates) : 0;
}

function maxMarketShock(markets: GlintRelatedMarket[]): number {
  let max = 0;
  for (const market of markets) {
    max = Math.max(max, marketShock(market));
  }
  return max;
}

function buildMarketSnippet(market: GlintRelatedMarket): string {
  const parts: string[] = [];
  const source = getString(market.source);
  if (source) parts.push(`source: ${source}`);

  const impact = getString(market.impact_level);
  if (impact) parts.push(`impact: ${impact}`);

  const yes = getNumber(market.yes_probability);
  if (yes !== null) parts.push(`yes ${(yes * 100).toFixed(1)}%`);
  const no = getNumber(market.no_probability);
  if (no !== null) parts.push(`no ${(no * 100).toFixed(1)}%`);

  const volume = getNumber(market.volume);
  if (volume !== null) parts.push(`vol ${formatCompactNumber(volume)}`);
  const liquidity = getNumber(market.liquidity);
  if (liquidity !== null) parts.push(`liq ${formatCompactNumber(liquidity)}`);

  const shock = marketShock(market);
  if (shock > 0) parts.push(`shock ${(shock * 100).toFixed(1)}%`);

  const reason = getString(market.impact_reason);
  if (reason) parts.push(reason);

  return parts.join(' | ');
}

function deriveTimestampMs(item: GlintPrivateFeedItem, fallbackNow: boolean): number | null {
  const markets = extractRelatedMarkets(item);
  const candidates: unknown[] = [
    item.timestamp,
    item.news?.timestamp,
    item.tweet?.created_at,
    item.telegram?.timestamp,
    item.reddit?.timestamp,
  ];
  for (const market of markets) {
    candidates.push(market.detected_at, market.first_moved_at, market.peaked_at, market.end_date);
  }

  for (const candidate of candidates) {
    const ts = getEpochMs(candidate);
    if (ts !== null) return ts;
  }

  if (fallbackNow) return Date.now();
  return null;
}

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function parseThreatLevel(level: string | null | undefined): GlintThreatLevel {
  if (!level) return 'info';
  switch (level.trim().toLowerCase()) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'elevated':
    case 'medium':
      return 'medium';
    case 'low':
      return 'low';
    default:
      return 'info';
  }
}

function countryCentroid(code: string): { lat: number; lon: number } | null {
  const bbox = getCountryBbox(code);
  if (!bbox) return null;
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const lat = (minLat + maxLat) / 2;
  const lon = (minLon + maxLon) / 2;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function scatterCountryPoint(code: string, index: number): { lat: number; lon: number } | null {
  const center = countryCentroid(code);
  if (!center) return null;

  const bbox = getCountryBbox(code);
  const latSpan = bbox ? Math.max(0.3, Math.abs(bbox[3] - bbox[1])) : 2;
  const lonSpan = bbox ? Math.max(0.3, Math.abs(bbox[2] - bbox[0])) : 2;
  const maxLatJitter = Math.min(2.5, latSpan * 0.25);
  const maxLonJitter = Math.min(2.5, lonSpan * 0.25);

  const seed = hashSeed(`${code}:${index}`);
  const angle = ((seed % 360) * Math.PI) / 180;
  const radial = 0.25 + ((seed >>> 8) % 100) / 140;

  const lat = clamp(center.lat + Math.sin(angle) * maxLatJitter * radial, -85, 85);
  const lon = clamp(center.lon + Math.cos(angle) * maxLonJitter * radial, -180, 180);
  return { lat, lon };
}

function withTimeout(
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => globalThis.clearTimeout(timer),
  };
}

export function isGlintGeoEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_GLINT_GEO !== 'false';
}

export function getGlintAuthToken(): string | null {
  const envToken = getString(import.meta.env.VITE_GLINT_AUTH_TOKEN as unknown);
  if (envToken) return envToken;

  try {
    const local = getString(localStorage.getItem(GLINT_LOCAL_TOKEN_KEY));
    if (local) return local;
  } catch {
    // localStorage may be unavailable in sandboxed contexts.
  }
  return null;
}

export function setGlintAuthToken(token: string): void {
  const clean = token.trim();
  if (!clean) return;
  try {
    localStorage.setItem(GLINT_LOCAL_TOKEN_KEY, clean);
  } catch {
    // best effort
  }
}

export function clearGlintAuthToken(): void {
  try {
    localStorage.removeItem(GLINT_LOCAL_TOKEN_KEY);
  } catch {
    // best effort
  }
}

export async function isGlintAuthTokenUsable(authToken?: string | null): Promise<boolean> {
  const token = authToken?.trim() || getGlintAuthToken() || '';
  if (!token) return false;
  const { signal, cleanup } = withTimeout(GLINT_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(GLINT_MOVERS_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
      signal,
    });
    if (!response.ok) return false;
    const body = await response.json().catch(() => null);
    return Array.isArray(body) || Boolean(body && Array.isArray((body as { data?: unknown[] }).data));
  } catch {
    return false;
  } finally {
    cleanup();
  }
}

async function fetchGlintPublicGlobe(): Promise<GlintPublicGlobeResponse | null> {
  const now = Date.now();
  if (glintPublicCache && now - glintPublicCache.timestamp < GLINT_PUBLIC_CACHE_TTL_MS) {
    return glintPublicCache.data;
  }

  const { signal, cleanup } = withTimeout(GLINT_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(GLINT_PUBLIC_GLOBE_URL, { signal });
    if (!response.ok) return null;
    const data = await response.json() as GlintPublicGlobeResponse;
    glintPublicCache = { timestamp: now, data };
    return data;
  } catch {
    return null;
  } finally {
    cleanup();
  }
}

async function fetchGlintPrivateFeed(authToken?: string | null): Promise<GlintPrivateFeedItem[]> {
  const token = authToken?.trim() || '';
  if (!token) return [];

  const now = Date.now();
  if (
    glintPrivateCache
    && glintPrivateCache.token === (token || 'cookie-session')
    && now - glintPrivateCache.timestamp < GLINT_PRIVATE_CACHE_TTL_MS
  ) {
    return glintPrivateCache.data;
  }

  const fetchPaged = async (headers: HeadersInit): Promise<GlintPrivateFeedItem[]> => {
    const collected: GlintPrivateFeedItem[] = [];
    for (let page = 1; page <= GLINT_FEED_MAX_PAGES; page += 1) {
      const url = `${GLINT_PRIVATE_FEED_BASE_URL}?page=${page}&count=${GLINT_FEED_PAGE_SIZE}`;
      const { signal, cleanup } = withTimeout(GLINT_FETCH_TIMEOUT_MS);
      let pageItems: GlintPrivateFeedItem[] = [];

      try {
        const response = await fetch(url, {
          signal,
          headers,
          credentials: 'include',
        });
        if (!response.ok) break;
        const data = await response.json() as unknown;
        if (!Array.isArray(data)) break;
        pageItems = data as GlintPrivateFeedItem[];
      } catch {
        break;
      } finally {
        cleanup();
      }

      if (pageItems.length === 0) break;
      collected.push(...pageItems);
      if (pageItems.length < GLINT_FEED_PAGE_SIZE) break;
    }
    return collected;
  };

  const fetchMovers = async (headers: HeadersInit): Promise<GlintPrivateFeedItem[]> => {
    const { signal, cleanup } = withTimeout(GLINT_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(GLINT_MOVERS_URL, {
        signal,
        headers,
        credentials: 'include',
      });
      if (!response.ok) return [];
      const data = await response.json() as unknown;
      if (!Array.isArray(data)) return [];

      const out: GlintPrivateFeedItem[] = [];
      for (const entry of data as GlintMoversEntry[]) {
        const item = entry?.feed_item;
        if (item && typeof item === 'object') {
          const merged: GlintPrivateFeedItem = { ...item };
          if (!merged.related_market && entry.related_market) {
            merged.related_market = entry.related_market;
          }
          if (merged.related_markets == null && Array.isArray(entry.related_markets)) {
            merged.related_markets = entry.related_markets;
          }
          out.push(merged);
          continue;
        }

        const detachedMarket = parseRelatedMarket(entry?.related_market);
        if (detachedMarket) {
          const fallbackId = getString(detachedMarket.id)
            || getString(detachedMarket.condition_id)
            || getString(detachedMarket.slug)
            || `market-${out.length + 1}`;
          const fallbackTs = getEpochMs(detachedMarket.detected_at)
            ?? getEpochMs(detachedMarket.end_date)
            ?? Date.now();
          out.push({
            id: `market:${fallbackId}`,
            timestamp: fallbackTs,
            related_market: detachedMarket,
            related_markets: entry.related_markets,
          });
        }
      }
      return out;
    } catch {
      return [];
    } finally {
      cleanup();
    }
  };

  let collect = token ? await fetchPaged({ Authorization: `Bearer ${token}` }) : [];
  if (collect.length === 0) {
    collect = await fetchPaged({});
  }

  if (collect.length === 0) {
    collect = token
      ? await fetchMovers({ Authorization: `Bearer ${token}` })
      : await fetchMovers({});
  }
  if (collect.length === 0 && token) {
    collect = await fetchMovers({});
  }

  const deduped = new Map<string, GlintPrivateFeedItem>();
  for (const item of collect) {
    if (!hasAnySignalSource(item)) continue;
    const markets = extractRelatedMarkets(item);
    const osint = extractOsintText(item.osint, 1);
    const id = getString(item.id);
    const ts = deriveTimestampMs(item, false) ?? 0;
    const title = getString(item.news?.headline)
      || getString(item.tweet?.body)
      || getString(item.telegram?.text)
      || getString(item.reddit?.title)
      || (markets[0] ? marketTitle(markets[0]) : null)
      || osint[0]
      || 'glint-feed-item';
    const key = id || `${title}:${ts}`;
    deduped.set(key, item);
  }

  const normalized = [...deduped.values()];
  glintPrivateCache = { token: token || 'cookie-session', timestamp: now, data: normalized };
  return normalized;
}

function pickPrivateItemTitle(item: GlintPrivateFeedItem): string {
  const related = extractRelatedMarkets(item);
  const osint = extractOsintText(item.osint, 1);
  return (
    getString(item.news?.headline)
    || getString(item.tweet?.body)
    || getString(item.reddit?.title)
    || getString(item.telegram?.text)
    || (related[0] ? marketTitle(related[0]) : null)
    || osint[0]
    || 'Glint feed signal'
  );
}

function extractPrivateTextBlobs(item: GlintPrivateFeedItem): string[] {
  const blobs: string[] = [];
  const markets = extractRelatedMarkets(item);
  const direct = [
    item.news?.headline,
    item.news?.description,
    item.tweet?.body,
    item.reddit?.title,
    item.telegram?.text,
  ];

  for (const market of markets.slice(0, 5)) {
    direct.push(
      market.question,
      market.title,
      market.description,
      market.event_title,
      market.impact_reason,
    );
  }

  for (const osintText of extractOsintText(item.osint)) {
    direct.push(osintText);
  }

  for (const entry of direct) {
    const text = getString(entry);
    if (text) blobs.push(text);
  }
  return blobs;
}

function extractPrivateCountryCodes(item: GlintPrivateFeedItem): string[] {
  const codes = new Set<string>();

  const ingestUnknownCountryList = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const entry of value) {
      const code = toUpperCountryCode(entry);
      if (code) codes.add(code);
    }
  };

  const direct = toUpperCountryCode(item.country);
  if (direct) codes.add(direct);

  ingestUnknownCountryList(item.countries);
  ingestUnknownCountryList(item.edges?.countries);

  const blobs = extractPrivateTextBlobs(item);
  for (const text of blobs) {
    const matched = matchCountryNamesInText(text);
    for (const code of matched) codes.add(code);
  }

  return [...codes];
}

function privateItemThreat(item: GlintPrivateFeedItem): GlintThreatLevel {
  if (item.telegram) return 'high';
  if (item.tweet) return 'medium';
  if (item.news) return 'medium';
  if (item.reddit) return 'low';
  const markets = extractRelatedMarkets(item);
  const shock = maxMarketShock(markets);
  if (shock >= 0.2) return 'high';
  if (shock >= 0.05) return 'medium';
  if (markets.length > 0) return 'low';
  if (hasOsintSignal(item)) return 'low';
  return 'info';
}

function buildPrivateMarkers(items: GlintPrivateFeedItem[], maxMarkers: number): GlintNewsLocation[] {
  const markers: GlintNewsLocation[] = [];

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item) continue;
    if (!hasAnySignalSource(item)) continue;
    const codes = extractPrivateCountryCodes(item);
    if (codes.length === 0) continue;

    const title = pickPrivateItemTitle(item);
    const threatLevel = privateItemThreat(item);
    const timestampMs = deriveTimestampMs(item, false);
    const timestamp = timestampMs !== null ? new Date(timestampMs) : undefined;

    let localIndex = 0;
    for (const code of codes.slice(0, 2)) {
      const point = scatterCountryPoint(code, i + localIndex);
      if (!point) continue;
      const countryName = getCountryNameByCode(code) || code;
      markers.push({
        lat: point.lat,
        lon: point.lon,
        title: `${title} (${countryName})`,
        threatLevel,
        timestamp,
      });
      localIndex += 1;
      if (markers.length >= maxMarkers) return markers;
    }
  }

  return markers;
}

function buildPublicMarkers(payload: GlintPublicGlobeResponse, maxMarkers: number): GlintNewsLocation[] {
  const markers: GlintNewsLocation[] = [];
  const usedKeys = new Set<string>();

  const pushMarker = (marker: GlintNewsLocation): void => {
    const qLat = Math.round(marker.lat * 10) / 10;
    const qLon = Math.round(marker.lon * 10) / 10;
    const key = `${qLat}:${qLon}:${marker.title.slice(0, 36).toLowerCase()}`;
    if (usedKeys.has(key)) return;
    usedKeys.add(key);
    markers.push(marker);
  };

  if (Array.isArray(payload.flights)) {
    for (let i = 0; i < payload.flights.length && markers.length < maxMarkers; i += 1) {
      const flight = payload.flights[i];
      if (!flight) continue;
      const lat = Number(flight.lat);
      const lon = Number(flight.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const callsign = getString(flight.cs) || getString(flight.cat) || 'Unknown';
      pushMarker({
        lat,
        lon,
        title: `Glint flight ${callsign}`,
        threatLevel: 'medium',
        timestamp: (() => {
          const ts = getEpochMs(flight.ts);
          return ts !== null ? new Date(ts) : undefined;
        })(),
      });
    }
  }

  if (Array.isArray(payload.dots)) {
    for (let i = 0; i < payload.dots.length && markers.length < maxMarkers; i += 1) {
      const dot = payload.dots[i];
      if (!dot) continue;
      const code = toUpperCountryCode(dot.c);
      if (!code) continue;
      const point = scatterCountryPoint(code, i);
      if (!point) continue;
      const countryName = getCountryNameByCode(code) || code;
      pushMarker({
        lat: point.lat,
        lon: point.lon,
        title: `Glint hotspot ${countryName}`,
        threatLevel: parseThreatLevel(dot.l),
      });
    }
  }

  if (markers.length >= maxMarkers) return markers.slice(0, maxMarkers);

  // If dots are sparse, backfill with country summaries.
  if (Array.isArray(payload.countries)) {
    const rankedCountries = [...payload.countries]
      .filter((entry): entry is GlintPublicCountry & { country: string } => !!toUpperCountryCode(entry.country))
      .sort((a, b) => Number(b.recent || 0) - Number(a.recent || 0))
      .slice(0, 15);

    for (let i = 0; i < rankedCountries.length && markers.length < maxMarkers; i += 1) {
      const entry = rankedCountries[i];
      if (!entry) continue;
      const code = toUpperCountryCode(entry.country);
      if (!code) continue;
      const point = scatterCountryPoint(code, i + 200);
      if (!point) continue;
      const countryName = getCountryNameByCode(code) || code;
      const recent = Number(entry.recent || 0);
      const threatLevel: GlintThreatLevel = recent >= 10 ? 'high' : recent >= 4 ? 'medium' : 'low';
      pushMarker({
        lat: point.lat,
        lon: point.lon,
        title: `Glint activity ${countryName}`,
        threatLevel,
      });
    }
  }

  return markers.slice(0, maxMarkers);
}

function mergeAndLimitMarkers(
  primary: GlintNewsLocation[],
  secondary: GlintNewsLocation[],
  maxMarkers: number,
): GlintNewsLocation[] {
  const merged: GlintNewsLocation[] = [];
  const seen = new Set<string>();
  const push = (item: GlintNewsLocation) => {
    const qLat = Math.round(item.lat * 10) / 10;
    const qLon = Math.round(item.lon * 10) / 10;
    const key = `${qLat}:${qLon}:${item.title.slice(0, 42).toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  };
  for (const item of primary) {
    push(item);
    if (merged.length >= maxMarkers) return merged;
  }
  for (const item of secondary) {
    push(item);
    if (merged.length >= maxMarkers) return merged;
  }
  return merged;
}

export async function fetchGlintGeoMarkers(
  options: { authToken?: string | null; maxMarkers?: number } = {},
): Promise<GlintNewsLocation[]> {
  if (!isGlintGeoEnabled()) return [];

  const maxMarkers = Number.isFinite(options.maxMarkers)
    ? Math.max(1, Number(options.maxMarkers))
    : 80;

  const token = options.authToken ?? getGlintAuthToken();
  const privateMarkersPromise = fetchGlintPrivateFeed(token).then((items) => buildPrivateMarkers(items, maxMarkers));
  const publicMarkersPromise = fetchGlintPublicGlobe().then((payload) => {
    if (!payload) return [];
    return buildPublicMarkers(payload, maxMarkers);
  });

  const [privateMarkers, publicMarkers] = await Promise.all([
    privateMarkersPromise,
    publicMarkersPromise,
  ]);

  return mergeAndLimitMarkers(privateMarkers, publicMarkers, maxMarkers);
}

function resolveRecordCountryCodes(item: GlintPrivateFeedItem): string[] {
  return extractPrivateCountryCodes(item).slice(0, 6);
}

function deriveRecordTimestamp(item: GlintPrivateFeedItem): Date {
  return new Date(deriveTimestampMs(item, true) || Date.now());
}

function toGlintFeedRecords(item: GlintPrivateFeedItem): GlintFeedRecord[] {
  if (!hasAnySignalSource(item)) return [];

  const topics = parseStringArray(item.topics).slice(0, 10);
  const categories = parseStringArray(item.categories).slice(0, 10);
  const countryCodes = resolveRecordCountryCodes(item);
  const timestamp = deriveRecordTimestamp(item);
  const markets = extractRelatedMarkets(item);
  const osintBlobs = extractOsintText(item.osint);
  const fallbackSeed = `${pickPrivateItemTitle(item)}:${timestamp.getTime()}`;
  const baseId = getString(item.id) || `glint-${hashSeed(fallbackSeed)}`;

  const records: GlintFeedRecord[] = [];

  if (item.news) {
    records.push({
      id: baseId,
      sourceType: 'news',
      sourceLabel: getString(item.news.source) || 'news',
      title: getString(item.news.headline) || 'Glint news signal',
      snippet: getString(item.news.description) || undefined,
      link: getString(item.news.url) || 'https://glint.trade/',
      timestamp,
      countryCodes,
      topics,
      categories,
    });
  } else if (item.tweet) {
    const source = getString(item.tweet.user?.display_name)
      || getString(item.tweet.user?.handle)
      || 'tweet';
    records.push({
      id: baseId,
      sourceType: 'tweet',
      sourceLabel: source,
      title: getString(item.tweet.body) || 'Glint tweet signal',
      link: getString(item.tweet.link) || 'https://glint.trade/',
      timestamp,
      countryCodes,
      topics,
      categories,
    });
  } else if (item.telegram) {
    records.push({
      id: baseId,
      sourceType: 'telegram',
      sourceLabel: getString(item.telegram.channel) || 'telegram',
      title: getString(item.telegram.text) || 'Glint telegram signal',
      link: getString(item.telegram.link) || 'https://glint.trade/',
      timestamp,
      countryCodes,
      topics,
      categories,
    });
  } else if (item.reddit) {
    records.push({
      id: baseId,
      sourceType: 'reddit',
      sourceLabel: getString(item.reddit.subreddit) || 'reddit',
      title: getString(item.reddit.title) || 'Glint reddit signal',
      snippet: getString(item.reddit.body) || undefined,
      link: getString(item.reddit.link) || 'https://glint.trade/',
      timestamp,
      countryCodes,
      topics,
      categories,
    });
  }

  for (let index = 0; index < markets.length; index += 1) {
    const market = markets[index];
    if (!market) continue;
    const marketKey = getString(market.id)
      || getString(market.condition_id)
      || getString(market.slug)
      || `market-${index + 1}`;
    const marketTopics = mergeUniqueStrings([
      topics,
      [getString(market.slug), getString(market.event_slug), getString(market.event_title)].filter(Boolean) as string[],
    ], 12);
    const marketCategories = mergeUniqueStrings([
      categories,
      parseStringArray(market.categories),
    ], 12);

    records.push({
      id: `${baseId}:market:${marketKey}`,
      sourceType: 'market',
      sourceLabel: getString(market.source) || 'market',
      title: marketTitle(market) || 'Glint market signal',
      snippet: buildMarketSnippet(market) || undefined,
      link: marketLink(market),
      timestamp,
      countryCodes,
      topics: marketTopics,
      categories: marketCategories,
    });
  }

  if (records.length === 0) {
    records.push({
      id: `${baseId}:unknown`,
      sourceType: 'unknown',
      sourceLabel: 'unknown',
      title: osintBlobs[0] || pickPrivateItemTitle(item),
      snippet: osintBlobs.slice(1, 4).join(' | ') || undefined,
      link: 'https://glint.trade/',
      timestamp,
      countryCodes,
      topics,
      categories,
    });
  }

  return records;
}

export async function fetchGlintFeedRecords(
  options: { authToken?: string | null; maxItems?: number } = {},
): Promise<GlintFeedRecord[]> {
  if (!isGlintGeoEnabled()) return [];

  const maxItems = Number.isFinite(options.maxItems)
    ? Math.max(1, Number(options.maxItems))
    : 120;

  const token = options.authToken ?? getGlintAuthToken();
  const items = await fetchGlintPrivateFeed(token);
  if (items.length === 0) return [];

  const deduped = new Map<string, GlintFeedRecord>();
  for (const item of items) {
    const itemRecords = toGlintFeedRecords(item);
    for (const record of itemRecords) {
      const existing = deduped.get(record.id);
      if (!existing || record.timestamp.getTime() >= existing.timestamp.getTime()) {
        deduped.set(record.id, record);
      }
    }
  }

  const records = [...deduped.values()];
  records.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return records.slice(0, maxItems);
}

async function fetchGlintWsToken(authToken?: string | null): Promise<string | null> {
  const token = authToken?.trim() || '';
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const { signal, cleanup } = withTimeout(GLINT_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(GLINT_WS_TOKEN_URL, {
      signal,
      headers,
      credentials: 'include',
    });
    if (!response.ok) return null;
    const payload = await response.json() as GlintWsTokenResponse & { token?: string };
    const wsToken = getString(payload.ws_token) || getString(payload.token);
    if (wsToken) return wsToken;
  } catch {
    // fall through to direct-token fallback
  } finally {
    cleanup();
  }

  // If sync provided a ws JWT directly, use it without re-fetching.
  if (token && looksLikeJwt(token)) {
    return token;
  }
  return null;
}

export class GlintMarketWatchClient {
  private options: GlintMarketWatchClientOptions;
  private ws: WebSocket | null = null;
  private reconnectDelayMs = 1_000;
  private reconnectTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private manuallyClosed = false;
  private authenticated = false;

  constructor(options: GlintMarketWatchClientOptions) {
    this.options = {
      reconnect: true,
      // Default to non-market rooms to avoid Polymarket-linked stream payloads.
      rooms: ['feed', 'flight_events'],
      ...options,
    };
  }

  public async connect(): Promise<void> {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (!getString(this.options.authToken)) {
      this.emitStatus('disconnected', 'Glint auth token missing');
      return;
    }

    this.manuallyClosed = false;
    this.emitStatus('connecting');
    const wsToken = await fetchGlintWsToken(this.options.authToken);
    if (!wsToken) {
      this.emitStatus('error', 'Failed to obtain Glint ws token');
      this.scheduleReconnect();
      return;
    }

    try {
      const ws = new WebSocket(GLINT_WS_URL);
      this.ws = ws;
      ws.onopen = () => {
        this.reconnectDelayMs = 1_000;
        ws.send(JSON.stringify({ token: wsToken }));
        this.emitStatus('connected');
      };
      ws.onmessage = (event: MessageEvent<string>) => {
        this.handleMessage(event.data);
      };
      ws.onclose = () => {
        this.ws = null;
        this.authenticated = false;
        this.emitStatus('disconnected');
        this.scheduleReconnect();
      };
      ws.onerror = () => {
        this.emitStatus('error', 'Glint ws error');
      };
    } catch (error) {
      this.emitStatus('error', error instanceof Error ? error.message : 'Glint ws connect error');
      this.scheduleReconnect();
    }
  }

  public disconnect(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer !== null) {
      globalThis.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.authenticated = false;
  }

  private emitStatus(status: GlintWsStatus, detail?: string): void {
    this.options.onStatus?.(status, detail);
  }

  private scheduleReconnect(): void {
    if (this.manuallyClosed || !this.options.reconnect) return;
    if (this.reconnectTimer !== null) return;
    const delay = this.reconnectDelayMs;
    this.reconnectTimer = globalThis.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectDelayMs = Math.min(delay * 2, 30_000);
  }

  private handleMessage(raw: string): void {
    let parsed: JsonRecord | null = null;
    try {
      parsed = JSON.parse(raw) as JsonRecord;
    } catch {
      return;
    }
    if (!parsed) return;

    const action = getString(parsed.action);
    if (action === 'authenticate') {
      const success = Boolean(parsed.success);
      if (!success) {
        this.emitStatus('error', 'Glint ws authentication failed');
        this.ws?.close();
        return;
      }
      this.authenticated = true;
      this.emitStatus('authenticated');
      this.joinConfiguredRooms();
      return;
    }

    this.options.onMessage?.(parsed);
  }

  private joinConfiguredRooms(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated) return;
    const rooms = this.options.rooms || ['feed', 'flight_events'];
    for (const room of rooms) {
      this.ws.send(JSON.stringify({ action: 'join_room', room }));
    }
  }
}
