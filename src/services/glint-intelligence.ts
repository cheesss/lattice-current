import {
  getCountryBbox,
  getCountryNameByCode,
  iso3ToIso2Code,
  matchCountryNamesInText,
  nameToCountryCode,
} from './country-geometry';
import { getGlintAuthToken, isGlintGeoEnabled, type GlintThreatLevel } from './glint';

export type GlintSourceKind = 'news' | 'tweet' | 'telegram' | 'reddit' | 'market' | 'unknown';

export interface GlintCountrySignal {
  code: string;
  countryName: string;
  lat: number;
  lon: number;
  signalCount: number;
  sourceCounts: Record<GlintSourceKind, number>;
  severityCounts: Record<GlintThreatLevel, number>;
  geopoliticalHits: number;
  economicHits: number;
  securityHits: number;
  // Kept for compatibility with existing scoring code.
  marketShock: number;
  marketVolume: number;
  topics: string[];
  categories: string[];
  lastTimestamp?: Date;
}

interface GlintPublicCountry {
  country?: string;
  recent?: number;
  volume?: number;
}

interface GlintPublicDot {
  c?: string;
  l?: string;
}

interface GlintPublicGlobeResponse {
  countries?: GlintPublicCountry[];
  dots?: GlintPublicDot[];
}

interface GlintFeedItem {
  id?: string;
  timestamp?: number;
  country?: string;
  countries?: unknown;
  topics?: unknown;
  categories?: unknown;
  osint?: unknown;
  related_market?: GlintRelatedMarket | null;
  related_markets?: unknown;
  tweet?: { body?: string } | null;
  news?: { headline?: string; description?: string; source?: string } | null;
  reddit?: { title?: string } | null;
  telegram?: { text?: string; channel?: string } | null;
  edges?: { countries?: unknown } | null;
}

interface GlintMoverEntry {
  rank?: number;
  feed_item?: GlintFeedItem | null;
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
  event_title?: string;
  event_slug?: string;
  impact_level?: string;
  impact_reason?: string;
  yes_probability?: number | string;
  no_probability?: number | string;
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

interface MutableCountrySignal {
  code: string;
  countryName: string;
  lat: number;
  lon: number;
  signalCount: number;
  sourceCounts: Record<GlintSourceKind, number>;
  severityCounts: Record<GlintThreatLevel, number>;
  geopoliticalHits: number;
  economicHits: number;
  securityHits: number;
  marketShockTotal: number;
  marketVolumeTotal: number;
  marketSignalCount: number;
  topics: Set<string>;
  categories: Set<string>;
  lastTimestampMs: number;
}

const GLINT_API_BASE = 'https://api.glint.trade';
const GLINT_MOVERS_URL = `${GLINT_API_BASE}/api/movers`;
const GLINT_FEED_URL = `${GLINT_API_BASE}/api/feed/v2`;
const GLINT_PUBLIC_GLOBE_URL = `${GLINT_API_BASE}/api/public/globe`;

const GLINT_FETCH_TIMEOUT_MS = 8_000;
const GLINT_MOVERS_CACHE_TTL_MS = 20_000;
const GLINT_FEED_CACHE_TTL_MS = 20_000;
const GLINT_PUBLIC_CACHE_TTL_MS = 30_000;
const GLINT_FEED_PAGE_SIZE = 100;
const GLINT_FEED_MAX_PAGES = 4;

const GEO_KEYWORDS = ['geopolitics', 'politics', 'world', 'regime', 'election', 'sanction', 'diplomatic'];
const ECON_KEYWORDS = ['economy', 'finance', 'inflation', 'rate', 'yield', 'oil', 'energy', 'commodity', 'trade', 'gdp'];
const SECURITY_KEYWORDS = ['war', 'strike', 'missile', 'drone', 'airstrike', 'military', 'attack', 'invasion', 'naval', 'conflict'];

let glintMoversCache: { tokenKey: string; timestamp: number; data: GlintMoverEntry[] } | null = null;
let glintFeedCache: { tokenKey: string; timestamp: number; data: GlintFeedItem[] } | null = null;
let glintPublicCache: { timestamp: number; data: GlintPublicGlobeResponse } | null = null;

function withTimeout(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => globalThis.clearTimeout(timer),
  };
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

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const text = getString(entry);
    if (text) out.push(text);
  }
  return out;
}

function toCountryCode(value: unknown): string | null {
  const text = getString(value);
  if (!text) return null;
  const upper = text.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  if (/^[A-Z]{3}$/.test(upper)) {
    const iso2 = iso3ToIso2Code(upper);
    if (iso2) return iso2;
  }
  return nameToCountryCode(text);
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

function parseRelatedMarket(value: unknown): GlintRelatedMarket | null {
  if (!value || typeof value !== 'object') return null;
  return value as GlintRelatedMarket;
}

function extractRelatedMarkets(item: GlintFeedItem): GlintRelatedMarket[] {
  const out: GlintRelatedMarket[] = [];
  const add = (value: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const market = parseRelatedMarket(entry);
        if (market) out.push(market);
      }
      return;
    }
    const market = parseRelatedMarket(value);
    if (market) out.push(market);
  };

  add(item.related_market);
  add(item.related_markets);

  const deduped = new Map<string, GlintRelatedMarket>();
  for (const market of out) {
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

function hasOsintSignal(item: GlintFeedItem): boolean {
  if (item.osint == null || item.osint === false) return false;
  if (item.osint === true) return true;
  return extractOsintText(item.osint, 1).length > 0;
}

function inferSourceKinds(item: GlintFeedItem): GlintSourceKind[] {
  const kinds: GlintSourceKind[] = [];
  if (item.news) kinds.push('news');
  if (item.tweet) kinds.push('tweet');
  if (item.telegram) kinds.push('telegram');
  if (item.reddit) kinds.push('reddit');
  if (extractRelatedMarkets(item).length > 0) kinds.push('market');
  if (kinds.length === 0) kinds.push('unknown');
  return kinds;
}

function hasAnySignalSource(item: GlintFeedItem): boolean {
  return Boolean(item.news || item.tweet || item.telegram || item.reddit)
    || extractRelatedMarkets(item).length > 0
    || hasOsintSignal(item);
}

function marketShock(markets: GlintRelatedMarket[]): number {
  let maxShock = 0;
  for (const market of markets) {
    const candidates: number[] = [];

    const highest = getNumber(market.highest_price_change);
    if (highest !== null) candidates.push(Math.abs(highest));

    const yes = getNumber(market.yes_probability);
    const detectedYes = getNumber(market.detected_yes_price);
    if (yes !== null && detectedYes !== null) candidates.push(Math.abs(yes - detectedYes));

    const no = getNumber(market.no_probability);
    const detectedNo = getNumber(market.detected_no_price);
    if (no !== null && detectedNo !== null) candidates.push(Math.abs(no - detectedNo));

    const yesSpread = getNumber(market.yes_spread);
    if (yesSpread !== null) candidates.push(Math.abs(yesSpread));
    const noSpread = getNumber(market.no_spread);
    if (noSpread !== null) candidates.push(Math.abs(noSpread));

    if (candidates.length > 0) {
      maxShock = Math.max(maxShock, ...candidates);
    }
  }
  return maxShock;
}

function marketVolume(markets: GlintRelatedMarket[]): number {
  let total = 0;
  for (const market of markets) {
    const volume = getNumber(market.volume);
    if (volume !== null) total += Math.max(0, volume);
  }
  return total;
}

function inferThreatFromSources(kinds: GlintSourceKind[], markets: GlintRelatedMarket[], hasOsint: boolean): GlintThreatLevel {
  if (kinds.includes('telegram')) return 'high';
  if (kinds.includes('tweet') || kinds.includes('news')) return 'medium';
  if (kinds.includes('reddit')) return 'low';
  if (kinds.includes('market')) {
    const shock = marketShock(markets);
    if (shock >= 0.2) return 'high';
    if (shock >= 0.05) return 'medium';
    return 'low';
  }
  if (hasOsint) return 'low';
  return 'info';
}

function extractItemTextBlobs(item: GlintFeedItem): string[] {
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

  for (const value of direct) {
    const text = getString(value);
    if (text) blobs.push(text);
  }

  return blobs;
}

function extractItemCountries(item: GlintFeedItem, textBlobs: string[]): string[] {
  const codes = new Set<string>();

  const addCode = (value: unknown) => {
    const code = toCountryCode(value);
    if (code) codes.add(code);
  };

  addCode(item.country);

  if (Array.isArray(item.countries)) {
    for (const entry of item.countries) addCode(entry);
  }

  if (Array.isArray(item.edges?.countries)) {
    for (const entry of item.edges.countries) addCode(entry);
  }

  for (const text of textBlobs) {
    for (const code of matchCountryNamesInText(text)) {
      codes.add(code);
    }
  }

  return [...codes];
}

function includesAny(haystack: string[], keywords: string[]): boolean {
  const lower = haystack.map((token) => token.toLowerCase());
  return keywords.some((keyword) => lower.some((token) => token.includes(keyword)));
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

function createSourceCounts(): Record<GlintSourceKind, number> {
  return { news: 0, tweet: 0, telegram: 0, reddit: 0, market: 0, unknown: 0 };
}

function createSeverityCounts(): Record<GlintThreatLevel, number> {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

function scoreSignalPriority(signal: GlintCountrySignal): number {
  const sev = signal.severityCounts;
  return (
    sev.critical * 10
    + sev.high * 7
    + sev.medium * 4
    + sev.low * 2
    + signal.signalCount * 1.5
    + signal.securityHits * 1.4
    + signal.geopoliticalHits * 1.1
    + Math.min(6, signal.marketShock * 20)
    + Math.min(6, Math.log10(signal.marketVolume + 1))
  );
}

function toPublicSignal(
  code: string,
  recent: number,
  dots: Record<GlintThreatLevel, number>,
  volume: number = 0,
): GlintCountrySignal | null {
  const center = countryCentroid(code);
  if (!center) return null;

  const severityCounts = createSeverityCounts();
  for (const key of Object.keys(dots) as GlintThreatLevel[]) {
    severityCounts[key] = dots[key] || 0;
  }

  if (
    recent > 0
    && severityCounts.critical === 0
    && severityCounts.high === 0
    && severityCounts.medium === 0
    && severityCounts.low === 0
  ) {
    severityCounts[recent >= 8 ? 'high' : recent >= 3 ? 'medium' : 'low'] = recent;
  }

  const signalCount = Math.max(1, recent, severityCounts.critical + severityCounts.high + severityCounts.medium + severityCounts.low);
  return {
    code,
    countryName: getCountryNameByCode(code) || code,
    lat: center.lat,
    lon: center.lon,
    signalCount,
    sourceCounts: createSourceCounts(),
    severityCounts,
    geopoliticalHits: recent,
    economicHits: 0,
    securityHits: severityCounts.critical + severityCounts.high,
    marketShock: 0,
    marketVolume: Math.max(0, volume),
    topics: [],
    categories: ['geopolitics'],
  };
}

function createTokenKey(authToken: string | null): string {
  const token = getString(authToken);
  return token ? `bearer:${token.slice(0, 12)}` : 'cookie-session';
}

function normalizeFeedPayload(payload: unknown): GlintFeedItem[] {
  if (!Array.isArray(payload)) return [];

  const out: GlintFeedItem[] = [];
  for (const row of payload) {
    if (!row || typeof row !== 'object') continue;

    // /api/movers shape
    if ('feed_item' in row) {
      const entry = row as { feed_item?: unknown; related_market?: unknown; related_markets?: unknown };
      if (entry.feed_item && typeof entry.feed_item === 'object') {
        const merged = { ...(entry.feed_item as GlintFeedItem) };
        if (!merged.related_market && entry.related_market && typeof entry.related_market === 'object') {
          merged.related_market = entry.related_market as GlintRelatedMarket;
        }
        if (merged.related_markets == null && Array.isArray(entry.related_markets)) {
          merged.related_markets = entry.related_markets;
        }
        out.push(merged);
      } else if (entry.related_market && typeof entry.related_market === 'object') {
        const detached = entry.related_market as GlintRelatedMarket;
        const fallbackId = getString(detached.id)
          || getString(detached.condition_id)
          || getString(detached.slug)
          || `market-${out.length + 1}`;
        const fallbackTs = getEpochMs(detached.detected_at)
          ?? getEpochMs(detached.end_date)
          ?? Date.now();
        out.push({
          id: `market:${fallbackId}`,
          timestamp: fallbackTs,
          related_market: detached,
          related_markets: entry.related_markets,
        });
      }
      continue;
    }

    // /api/feed/v2 shape
    out.push(row as GlintFeedItem);
  }

  return out;
}

async function fetchGlintMovers(authToken: string | null): Promise<GlintMoverEntry[]> {
  const token = getString(authToken);
  if (!token) return [];

  const tokenKey = createTokenKey(authToken);
  const now = Date.now();
  if (glintMoversCache && glintMoversCache.tokenKey === tokenKey && now - glintMoversCache.timestamp < GLINT_MOVERS_CACHE_TTL_MS) {
    return glintMoversCache.data;
  }

  const fetchOnce = async (headers: HeadersInit): Promise<GlintMoverEntry[]> => {
    const { signal, cleanup } = withTimeout(GLINT_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(GLINT_MOVERS_URL, {
        signal,
        headers,
        credentials: 'include',
      });
      if (!response.ok) return [];
      const payload = await response.json() as unknown;
      if (!Array.isArray(payload)) return [];
      return payload as GlintMoverEntry[];
    } catch {
      return [];
    } finally {
      cleanup();
    }
  };

  const withAuthHeaders: Record<string, string> = {};
  if (token) withAuthHeaders.Authorization = `Bearer ${token}`;

  let movers = await fetchOnce(withAuthHeaders);
  if (movers.length === 0 && token) {
    movers = await fetchOnce({});
  }

  if (movers.length > 0) {
    glintMoversCache = { tokenKey, timestamp: now, data: movers };
  }

  return movers;
}

async function fetchGlintFeed(authToken: string | null): Promise<GlintFeedItem[]> {
  const token = getString(authToken);
  if (!token) return [];

  const tokenKey = createTokenKey(authToken);
  const now = Date.now();
  if (glintFeedCache && glintFeedCache.tokenKey === tokenKey && now - glintFeedCache.timestamp < GLINT_FEED_CACHE_TTL_MS) {
    return glintFeedCache.data;
  }

  const fetchPaged = async (headers: HeadersInit): Promise<GlintFeedItem[]> => {
    const collected: GlintFeedItem[] = [];

    for (let page = 1; page <= GLINT_FEED_MAX_PAGES; page += 1) {
      const url = `${GLINT_FEED_URL}?page=${page}&count=${GLINT_FEED_PAGE_SIZE}`;
      const { signal, cleanup } = withTimeout(GLINT_FETCH_TIMEOUT_MS);
      let normalized: GlintFeedItem[] = [];

      try {
        const response = await fetch(url, {
          signal,
          headers,
          credentials: 'include',
        });
        if (!response.ok) break;
        const payload = await response.json() as unknown;
        normalized = normalizeFeedPayload(payload);
      } catch {
        break;
      } finally {
        cleanup();
      }

      if (normalized.length === 0) break;
      collected.push(...normalized);
      if (normalized.length < GLINT_FEED_PAGE_SIZE) break;
    }

    return collected;
  };

  const withAuthHeaders: Record<string, string> = {};
  if (token) withAuthHeaders.Authorization = `Bearer ${token}`;

  let items = await fetchPaged(withAuthHeaders);
  if (items.length === 0 && token) {
    items = await fetchPaged({});
  }

  const deduped = new Map<string, GlintFeedItem>();
  for (const item of items) {
    if (!hasAnySignalSource(item)) continue;
    const markets = extractRelatedMarkets(item);
    const osintBlobs = extractOsintText(item.osint, 1);
    const id = getString(item.id);
    const ts = getEpochMs(item.timestamp)
      ?? getEpochMs(markets[0]?.detected_at)
      ?? getEpochMs(markets[0]?.first_moved_at)
      ?? getEpochMs(markets[0]?.peaked_at)
      ?? 0;
    const fallbackTitle = getString(item.news?.headline)
      || getString(item.tweet?.body)
      || getString(item.telegram?.text)
      || getString(item.reddit?.title)
      || getString(markets[0]?.question)
      || getString(markets[0]?.title)
      || osintBlobs[0]
      || 'item';
    const fallback = `${fallbackTitle}:${ts}`;
    const key = id || fallback;
    deduped.set(key, item);
  }

  const normalized = [...deduped.values()];
  if (normalized.length > 0) {
    glintFeedCache = { tokenKey, timestamp: now, data: normalized };
  }

  return normalized;
}

async function fetchGlintPublicGlobe(): Promise<GlintPublicGlobeResponse | null> {
  const now = Date.now();
  if (glintPublicCache && now - glintPublicCache.timestamp < GLINT_PUBLIC_CACHE_TTL_MS) {
    return glintPublicCache.data;
  }

  const { signal, cleanup } = withTimeout(GLINT_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(GLINT_PUBLIC_GLOBE_URL, { signal, credentials: 'include' });
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

function getOrCreateCountryAccumulator(byCountry: Map<string, MutableCountrySignal>, code: string): MutableCountrySignal | null {
  const existing = byCountry.get(code);
  if (existing) return existing;

  const center = countryCentroid(code);
  if (!center) return null;

  const created: MutableCountrySignal = {
    code,
    countryName: getCountryNameByCode(code) || code,
    lat: center.lat,
    lon: center.lon,
    signalCount: 0,
    sourceCounts: createSourceCounts(),
    severityCounts: createSeverityCounts(),
    geopoliticalHits: 0,
    economicHits: 0,
    securityHits: 0,
    marketShockTotal: 0,
    marketVolumeTotal: 0,
    marketSignalCount: 0,
    topics: new Set<string>(),
    categories: new Set<string>(),
    lastTimestampMs: 0,
  };

  byCountry.set(code, created);
  return created;
}

function accumulateItemIntoCountryMap(byCountry: Map<string, MutableCountrySignal>, item: GlintFeedItem): void {
  if (!hasAnySignalSource(item)) return;

  const sourceKinds = inferSourceKinds(item);
  const relatedMarkets = extractRelatedMarkets(item);
  const osint = hasOsintSignal(item);
  const textBlobs = extractItemTextBlobs(item);
  const countries = extractItemCountries(item, textBlobs);
  if (countries.length === 0) return;

  const categories = [
    ...parseStringArray(item.categories),
    ...relatedMarkets.flatMap((market) => parseStringArray(market.categories)),
  ];
  const topics = parseStringArray(item.topics);
  const contextTokens = [...topics, ...categories, ...textBlobs];

  const geopolitical = includesAny(contextTokens, GEO_KEYWORDS);
  const economic = includesAny(contextTokens, ECON_KEYWORDS);
  const security = includesAny(contextTokens, SECURITY_KEYWORDS);

  const threat = inferThreatFromSources(sourceKinds, relatedMarkets, osint);
  const timestampCandidates: unknown[] = [item.timestamp];
  for (const market of relatedMarkets) {
    timestampCandidates.push(market.detected_at, market.first_moved_at, market.peaked_at, market.end_date);
  }
  let timestampMs: number | null = null;
  for (const value of timestampCandidates) {
    timestampMs = getEpochMs(value);
    if (timestampMs !== null) break;
  }
  if (timestampMs == null) timestampMs = Date.now();

  const itemMarketShock = marketShock(relatedMarkets);
  const itemMarketVolume = marketVolume(relatedMarkets);

  for (const code of countries.slice(0, 3)) {
    const acc = getOrCreateCountryAccumulator(byCountry, code);
    if (!acc) continue;

    acc.signalCount += 1;
    for (const kind of sourceKinds) {
      acc.sourceCounts[kind] += 1;
    }
    acc.severityCounts[threat] += 1;

    if (geopolitical) acc.geopoliticalHits += 1;
    if (economic) acc.economicHits += 1;
    if (security) acc.securityHits += 1;

    if (itemMarketShock > 0 || itemMarketVolume > 0) {
      acc.marketShockTotal += itemMarketShock;
      acc.marketVolumeTotal += itemMarketVolume;
      acc.marketSignalCount += 1;
    }

    for (const topic of topics) acc.topics.add(topic);
    for (const category of categories) acc.categories.add(category);

    acc.lastTimestampMs = Math.max(acc.lastTimestampMs, timestampMs);
  }
}

function buildCountrySignalsFromItems(items: GlintFeedItem[], maxCountries: number): GlintCountrySignal[] {
  const byCountry = new Map<string, MutableCountrySignal>();

  for (const item of items) {
    accumulateItemIntoCountryMap(byCountry, item);
  }

  const signals: GlintCountrySignal[] = [];
  for (const acc of byCountry.values()) {
    signals.push({
      code: acc.code,
      countryName: acc.countryName,
      lat: acc.lat,
      lon: acc.lon,
      signalCount: acc.signalCount,
      sourceCounts: acc.sourceCounts,
      severityCounts: acc.severityCounts,
      geopoliticalHits: acc.geopoliticalHits,
      economicHits: acc.economicHits,
      securityHits: acc.securityHits,
      marketShock: acc.marketSignalCount > 0 ? acc.marketShockTotal / acc.marketSignalCount : 0,
      marketVolume: acc.marketVolumeTotal,
      topics: [...acc.topics].slice(0, 12),
      categories: [...acc.categories].slice(0, 12),
      lastTimestamp: acc.lastTimestampMs > 0 ? new Date(acc.lastTimestampMs) : undefined,
    });
  }

  return signals.sort((a, b) => scoreSignalPriority(b) - scoreSignalPriority(a)).slice(0, maxCountries);
}

function buildCountrySignalsFromMovers(entries: GlintMoverEntry[], maxCountries: number): GlintCountrySignal[] {
  const items = normalizeFeedPayload(entries as unknown);
  return buildCountrySignalsFromItems(items, maxCountries);
}

function buildCountrySignalsFromPublicGlobe(payload: GlintPublicGlobeResponse, maxCountries: number): GlintCountrySignal[] {
  const dotSeverityByCountry = new Map<string, Record<GlintThreatLevel, number>>();

  if (Array.isArray(payload.dots)) {
    for (const dot of payload.dots) {
      const code = toCountryCode(dot.c);
      if (!code) continue;

      let levels = dotSeverityByCountry.get(code);
      if (!levels) {
        levels = createSeverityCounts();
        dotSeverityByCountry.set(code, levels);
      }

      levels[parseThreatLevel(getString(dot.l))] += 1;
    }
  }

  const signals: GlintCountrySignal[] = [];
  const seen = new Set<string>();

  for (const country of payload.countries || []) {
    const code = toCountryCode(country.country);
    if (!code) continue;

    seen.add(code);
    const recent = Math.max(0, Number(country.recent || 0));
    const dots = dotSeverityByCountry.get(code) || createSeverityCounts();

    const signal = toPublicSignal(code, recent, dots, Number(country.volume || 0));
    if (signal) signals.push(signal);
  }

  for (const [code, dots] of dotSeverityByCountry) {
    if (seen.has(code)) continue;

    const dotCount = dots.critical + dots.high + dots.medium + dots.low + dots.info;
    const signal = toPublicSignal(code, dotCount, dots);
    if (signal) signals.push(signal);
  }

  return signals.sort((a, b) => scoreSignalPriority(b) - scoreSignalPriority(a)).slice(0, maxCountries);
}

function mergeCountrySignals(primary: GlintCountrySignal[], secondary: GlintCountrySignal[], maxCountries: number): GlintCountrySignal[] {
  const merged = new Map<string, GlintCountrySignal>();

  const add = (incoming: GlintCountrySignal): void => {
    const existing = merged.get(incoming.code);
    if (!existing) {
      merged.set(incoming.code, {
        ...incoming,
        topics: [...incoming.topics],
        categories: [...incoming.categories],
      });
      return;
    }

    existing.signalCount += incoming.signalCount;

    for (const key of Object.keys(existing.sourceCounts) as GlintSourceKind[]) {
      existing.sourceCounts[key] += incoming.sourceCounts[key] || 0;
    }

    for (const key of Object.keys(existing.severityCounts) as GlintThreatLevel[]) {
      existing.severityCounts[key] += incoming.severityCounts[key] || 0;
    }

    existing.geopoliticalHits += incoming.geopoliticalHits;
    existing.economicHits += incoming.economicHits;
    existing.securityHits += incoming.securityHits;
    existing.marketShock = Math.max(existing.marketShock, incoming.marketShock);
    existing.marketVolume += incoming.marketVolume;

    existing.topics = [...new Set([...existing.topics, ...incoming.topics])].slice(0, 12);
    existing.categories = [...new Set([...existing.categories, ...incoming.categories])].slice(0, 12);

    const existingTs = existing.lastTimestamp?.getTime() || 0;
    const incomingTs = incoming.lastTimestamp?.getTime() || 0;
    if (incomingTs > existingTs) existing.lastTimestamp = incoming.lastTimestamp;
  };

  for (const signal of primary) add(signal);
  for (const signal of secondary) add(signal);

  return [...merged.values()]
    .sort((a, b) => scoreSignalPriority(b) - scoreSignalPriority(a))
    .slice(0, maxCountries);
}

export async function fetchGlintCountrySignals(
  options: { authToken?: string | null; maxCountries?: number } = {},
): Promise<GlintCountrySignal[]> {
  if (!isGlintGeoEnabled()) return [];

  const maxCountries = Number.isFinite(options.maxCountries)
    ? Math.max(1, Number(options.maxCountries))
    : 60;

  const token = options.authToken ?? getGlintAuthToken();

  const [movers, feedItems, publicGlobe] = await Promise.all([
    fetchGlintMovers(token),
    fetchGlintFeed(token),
    fetchGlintPublicGlobe(),
  ]);

  const moverSignals = buildCountrySignalsFromMovers(movers, maxCountries);
  const feedSignals = buildCountrySignalsFromItems(feedItems, maxCountries);
  const combinedSignals = mergeCountrySignals(moverSignals, feedSignals, maxCountries);

  if (!publicGlobe) return combinedSignals;

  const publicSignals = buildCountrySignalsFromPublicGlobe(publicGlobe, maxCountries);
  if (combinedSignals.length === 0) return publicSignals;

  return mergeCountrySignals(combinedSignals, publicSignals, maxCountries);
}
