import type { AppContext, IntelligenceCache } from '@/app/app-context';
import type {
  ClusteredEvent,
  CyberThreat,
  InternetOutage,
  MilitaryFlight,
  MilitaryFlightCluster,
  MilitaryVessel,
  MilitaryVesselCluster,
  NewsItem,
  SocialUnrestEvent,
} from '@/types';
import type { AirportDelayAlert } from '@/services/aviation';
import type { Earthquake } from '@/services/earthquakes';
import type { PredictionMarket } from '@/services/prediction';
import type { SecurityAdvisory } from '@/services/security-advisories';
import { getPersistentCache, setPersistentCache } from './persistent-cache';

type FabricContextLike = Pick<
  AppContext,
  | 'allNews'
  | 'newsByCategory'
  | 'latestMarkets'
  | 'latestPredictions'
  | 'latestClusters'
  | 'intelligenceCache'
  | 'cyberThreatsCache'
>;

type SerializedNewsItem = Omit<NewsItem, 'pubDate'> & {
  pubDate: number;
};

type SerializedClusteredEvent = Omit<ClusteredEvent, 'firstSeen' | 'lastUpdated' | 'allItems'> & {
  firstSeen: number;
  lastUpdated: number;
  allItems: SerializedNewsItem[];
};

interface PersistedIntelligenceFabricSnapshot {
  generatedAt: string;
  allNews: SerializedNewsItem[];
  newsByCategory: Record<string, SerializedNewsItem[]>;
  latestMarkets: FabricContextLike['latestMarkets'];
  latestPredictions: PredictionMarket[];
  latestClusters: SerializedClusteredEvent[];
  intelligenceCache: Record<string, unknown>;
  cyberThreatsCache: CyberThreat[] | null;
}

export interface IntelligenceFabricSnapshot {
  generatedAt: string;
  allNews: NewsItem[];
  newsByCategory: Record<string, NewsItem[]>;
  latestMarkets: FabricContextLike['latestMarkets'];
  latestPredictions: PredictionMarket[];
  latestClusters: ClusteredEvent[];
  intelligenceCache: Partial<IntelligenceCache>;
  cyberThreatsCache: CyberThreat[] | null;
  summary: {
    newsCount: number;
    categoryCount: number;
    clusterCount: number;
    marketCount: number;
    predictionCount: number;
    sourceCount: number;
    reportCount: number;
    ontologyNodeCount: number;
    ideaCardCount: number;
  };
}

const FABRIC_CACHE_KEY = 'intelligence-fabric:v1';
const MAX_ALL_NEWS = 1600;
const MAX_CATEGORY_NEWS = 320;
const MAX_CLUSTERS = 320;
const MAX_MARKETS = 256;
const MAX_PREDICTIONS = 160;
const MAX_GENERIC_ARRAY = 240;

let currentFabricSnapshot: IntelligenceFabricSnapshot | null = null;

async function tryLoadFabricFromLocalProxy(): Promise<PersistedIntelligenceFabricSnapshot | null> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return null;
  try {
    const response = await fetch('/api/local-intelligence-fabric-cache', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const payload = await response.json() as { ok?: boolean; entry?: { data?: PersistedIntelligenceFabricSnapshot } };
    return payload?.entry?.data || null;
  } catch {
    return null;
  }
}

function asTime(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasMeaningfulValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value == null) return false;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function serializeNewsItem(item: NewsItem): SerializedNewsItem {
  return {
    ...item,
    pubDate: asTime(item.pubDate),
  };
}

function deserializeNewsItem(item: SerializedNewsItem): NewsItem {
  return {
    ...item,
    pubDate: new Date(asTime(item.pubDate)),
  };
}

function serializeCluster(cluster: ClusteredEvent): SerializedClusteredEvent {
  return {
    ...cluster,
    firstSeen: asTime(cluster.firstSeen),
    lastUpdated: asTime(cluster.lastUpdated),
    allItems: (cluster.allItems || []).map(serializeNewsItem),
  };
}

function deserializeCluster(cluster: SerializedClusteredEvent): ClusteredEvent {
  return {
    ...cluster,
    firstSeen: new Date(asTime(cluster.firstSeen)),
    lastUpdated: new Date(asTime(cluster.lastUpdated)),
    allItems: (cluster.allItems || []).map(deserializeNewsItem),
  };
}

function serializeDatedObject<T extends Record<string, unknown>>(value: T, dateKeys: string[]): Record<string, unknown> {
  const next: Record<string, unknown> = { ...value };
  for (const key of dateKeys) {
    if (next[key] != null) {
      next[key] = asTime(next[key]);
    }
  }
  return next;
}

function deserializeDatedObject<T extends Record<string, unknown>>(value: T, dateKeys: string[]): T {
  const next: Record<string, unknown> = { ...value };
  for (const key of dateKeys) {
    if (next[key] != null) {
      next[key] = new Date(asTime(next[key]));
    }
  }
  return next as T;
}

function serializeAirportDelay(alert: AirportDelayAlert): Record<string, unknown> {
  return serializeDatedObject(alert as unknown as Record<string, unknown>, ['updatedAt']);
}

function deserializeAirportDelay(alert: Record<string, unknown>): AirportDelayAlert {
  return deserializeDatedObject(alert, ['updatedAt']) as unknown as AirportDelayAlert;
}

function serializeOutage(outage: InternetOutage): Record<string, unknown> {
  return serializeDatedObject(outage as unknown as Record<string, unknown>, ['pubDate', 'endDate']);
}

function deserializeOutage(outage: Record<string, unknown>): InternetOutage {
  return deserializeDatedObject(outage, ['pubDate', 'endDate']) as unknown as InternetOutage;
}

function serializeProtest(event: SocialUnrestEvent): Record<string, unknown> {
  return serializeDatedObject(event as unknown as Record<string, unknown>, ['time']);
}

function deserializeProtest(event: Record<string, unknown>): SocialUnrestEvent {
  return deserializeDatedObject(event, ['time']) as unknown as SocialUnrestEvent;
}

function serializeEarthquakeRecord(event: Earthquake): Record<string, unknown> {
  return serializeDatedObject(event as unknown as Record<string, unknown>, ['time', 'occurredAt']);
}

function deserializeEarthquakeRecord(event: Record<string, unknown>): Earthquake {
  return deserializeDatedObject(event, ['time', 'occurredAt']) as unknown as Earthquake;
}

function serializeFlight(flight: MilitaryFlight): Record<string, unknown> {
  return serializeDatedObject(flight as unknown as Record<string, unknown>, ['lastSeen', 'firstSeen']);
}

function deserializeFlight(flight: Record<string, unknown>): MilitaryFlight {
  return deserializeDatedObject(flight, ['lastSeen', 'firstSeen']) as unknown as MilitaryFlight;
}

function serializeFlightCluster(cluster: MilitaryFlightCluster): Record<string, unknown> {
  return {
    ...cluster,
    flights: (cluster.flights || []).map(serializeFlight),
  };
}

function deserializeFlightCluster(cluster: Record<string, unknown>): MilitaryFlightCluster {
  const rawFlights = Array.isArray(cluster.flights) ? cluster.flights as Record<string, unknown>[] : [];
  return {
    ...(cluster as unknown as MilitaryFlightCluster),
    flights: rawFlights.map(deserializeFlight),
  };
}

function serializeVessel(vessel: MilitaryVessel): Record<string, unknown> {
  return serializeDatedObject(vessel as unknown as Record<string, unknown>, ['lastAisUpdate']);
}

function deserializeVessel(vessel: Record<string, unknown>): MilitaryVessel {
  return deserializeDatedObject(vessel, ['lastAisUpdate']) as unknown as MilitaryVessel;
}

function serializeVesselCluster(cluster: MilitaryVesselCluster): Record<string, unknown> {
  return {
    ...cluster,
    vessels: (cluster.vessels || []).map(serializeVessel),
  };
}

function deserializeVesselCluster(cluster: Record<string, unknown>): MilitaryVesselCluster {
  const rawVessels = Array.isArray(cluster.vessels) ? cluster.vessels as Record<string, unknown>[] : [];
  return {
    ...(cluster as unknown as MilitaryVesselCluster),
    vessels: rawVessels.map(deserializeVessel),
  };
}

function serializeAdvisory(advisory: SecurityAdvisory): Record<string, unknown> {
  return serializeDatedObject(advisory as unknown as Record<string, unknown>, ['pubDate']);
}

function deserializeAdvisory(advisory: Record<string, unknown>): SecurityAdvisory {
  return deserializeDatedObject(advisory, ['pubDate']) as unknown as SecurityAdvisory;
}

function capArray<T>(value: T[] | undefined, limit = MAX_GENERIC_ARRAY): T[] {
  return Array.isArray(value) ? value.slice(0, Math.max(1, limit)) : [];
}

function serializeIntelligenceCache(cache: IntelligenceCache): Record<string, unknown> {
  const next: Record<string, unknown> = { ...cache };
  if (Array.isArray(cache.flightDelays)) next.flightDelays = capArray(cache.flightDelays).map(serializeAirportDelay);
  if (Array.isArray(cache.outages)) next.outages = capArray(cache.outages).map(serializeOutage);
  if (cache.protests?.events) {
    next.protests = {
      ...cache.protests,
      events: capArray(cache.protests.events).map(serializeProtest),
    };
  }
  if (Array.isArray(cache.earthquakes)) next.earthquakes = capArray(cache.earthquakes).map(serializeEarthquakeRecord);
  if (cache.military) {
    next.military = {
      ...cache.military,
      flights: capArray(cache.military.flights).map(serializeFlight),
      flightClusters: capArray(cache.military.flightClusters).map(serializeFlightCluster),
      vessels: capArray(cache.military.vessels).map(serializeVessel),
      vesselClusters: capArray(cache.military.vesselClusters).map(serializeVesselCluster),
    };
  }
  if (Array.isArray(cache.advisories)) next.advisories = capArray(cache.advisories).map(serializeAdvisory);
  if (Array.isArray(cache.apiSources)) next.apiSources = capArray(cache.apiSources, 320);
  if (Array.isArray(cache.multimodalFindings)) next.multimodalFindings = capArray(cache.multimodalFindings, 96);
  if (Array.isArray(cache.scheduledReports)) next.scheduledReports = capArray(cache.scheduledReports, 48);
  if (Array.isArray(cache.sourceCredibility)) next.sourceCredibility = capArray(cache.sourceCredibility, 96);
  if (Array.isArray(cache.sourceHealingSuggestions)) next.sourceHealingSuggestions = capArray(cache.sourceHealingSuggestions, 96);
  if (Array.isArray(cache.graphTimeslices)) next.graphTimeslices = capArray(cache.graphTimeslices, 48);
  if (Array.isArray(cache.ontologyEntities)) next.ontologyEntities = capArray(cache.ontologyEntities, 240);
  if (Array.isArray(cache.ontologyLedger)) next.ontologyLedger = capArray(cache.ontologyLedger, 120);
  if (Array.isArray(cache.networkDiscoveries)) next.networkDiscoveries = capArray(cache.networkDiscoveries, 120);
  if (Array.isArray(cache.multiHopInferences)) next.multiHopInferences = capArray(cache.multiHopInferences, 96);
  return next;
}

function reviveIntelligenceCache(raw: Record<string, unknown> | null | undefined): Partial<IntelligenceCache> {
  if (!raw) return {};
  const next: Partial<IntelligenceCache> = { ...(raw as Partial<IntelligenceCache>) };
  if (Array.isArray(raw.flightDelays)) next.flightDelays = raw.flightDelays.map((item) => deserializeAirportDelay(item as Record<string, unknown>));
  if (Array.isArray(raw.outages)) next.outages = raw.outages.map((item) => deserializeOutage(item as Record<string, unknown>));
  if (raw.protests && typeof raw.protests === 'object') {
    const protests = raw.protests as Record<string, unknown>;
    next.protests = {
      ...(protests as unknown as NonNullable<IntelligenceCache['protests']>),
      events: Array.isArray(protests.events)
        ? protests.events.map((item) => deserializeProtest(item as Record<string, unknown>))
        : [],
    };
  }
  if (Array.isArray(raw.earthquakes)) next.earthquakes = raw.earthquakes.map((item) => deserializeEarthquakeRecord(item as Record<string, unknown>));
  if (raw.military && typeof raw.military === 'object') {
    const military = raw.military as Record<string, unknown>;
    next.military = {
      ...(military as unknown as NonNullable<IntelligenceCache['military']>),
      flights: Array.isArray(military.flights)
        ? military.flights.map((item) => deserializeFlight(item as Record<string, unknown>))
        : [],
      flightClusters: Array.isArray(military.flightClusters)
        ? military.flightClusters.map((item) => deserializeFlightCluster(item as Record<string, unknown>))
        : [],
      vessels: Array.isArray(military.vessels)
        ? military.vessels.map((item) => deserializeVessel(item as Record<string, unknown>))
        : [],
      vesselClusters: Array.isArray(military.vesselClusters)
        ? military.vesselClusters.map((item) => deserializeVesselCluster(item as Record<string, unknown>))
        : [],
    };
  }
  if (Array.isArray(raw.advisories)) next.advisories = raw.advisories.map((item) => deserializeAdvisory(item as Record<string, unknown>));
  return next;
}

function dedupeNewsItems(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const deduped: NewsItem[] = [];
  for (const item of items) {
    const key = [item.link, item.title, item.source, asTime(item.pubDate)].join('::');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function mergeNewsItems(current: NewsItem[], previous: NewsItem[] | undefined, limit: number): NewsItem[] {
  return dedupeNewsItems([...(current || []), ...(previous || [])])
    .sort((left, right) => asTime(right.pubDate) - asTime(left.pubDate))
    .slice(0, limit);
}

function mergeClusters(current: ClusteredEvent[], previous: ClusteredEvent[] | undefined, limit: number): ClusteredEvent[] {
  const merged = new Map<string, ClusteredEvent>();
  for (const cluster of [...(current || []), ...(previous || [])]) {
    const key = String(cluster.id || `${cluster.primaryLink || ''}::${cluster.primaryTitle}`);
    const existing = merged.get(key);
    if (!existing || asTime(cluster.lastUpdated) > asTime(existing.lastUpdated)) {
      merged.set(key, cluster);
    }
  }
  return Array.from(merged.values())
    .sort((left, right) => asTime(right.lastUpdated) - asTime(left.lastUpdated))
    .slice(0, limit);
}

function mergeNewsByCategory(
  current: Record<string, NewsItem[]>,
  previous: Record<string, NewsItem[]> | undefined,
): Record<string, NewsItem[]> {
  const keys = new Set<string>([
    ...Object.keys(current || {}),
    ...Object.keys(previous || {}),
  ]);
  const entries: Array<[string, NewsItem[]]> = [];
  for (const key of keys) {
    const merged = mergeNewsItems(current?.[key] || [], previous?.[key] || [], MAX_CATEGORY_NEWS);
    if (merged.length > 0) entries.push([key, merged]);
  }
  return Object.fromEntries(entries);
}

function flattenNewsByCategory(newsByCategory: Record<string, NewsItem[]> | undefined): NewsItem[] {
  const flattened = Object.values(newsByCategory || {}).flatMap((items) => items || []);
  return dedupeNewsItems(flattened)
    .sort((left, right) => asTime(right.pubDate) - asTime(left.pubDate))
    .slice(0, MAX_ALL_NEWS);
}

function mergeIntelligenceCache(
  current: Partial<IntelligenceCache>,
  previous: Partial<IntelligenceCache> | undefined,
): Partial<IntelligenceCache> {
  const merged: Partial<IntelligenceCache> = {};
  const keys = new Set<string>([
    ...Object.keys(previous || {}),
    ...Object.keys(current || {}),
  ]);
  for (const key of keys) {
    const currentValue = (current as Record<string, unknown>)[key];
    const previousValue = (previous as Record<string, unknown> | undefined)?.[key];
    (merged as Record<string, unknown>)[key] = hasMeaningfulValue(currentValue) ? currentValue : previousValue;
  }
  return merged;
}

function buildSummary(snapshot: Omit<IntelligenceFabricSnapshot, 'summary'>): IntelligenceFabricSnapshot['summary'] {
  return {
    newsCount: snapshot.allNews.length,
    categoryCount: Object.keys(snapshot.newsByCategory).length,
    clusterCount: snapshot.latestClusters.length,
    marketCount: snapshot.latestMarkets.length,
    predictionCount: snapshot.latestPredictions.length,
    sourceCount: new Set(snapshot.allNews.map((item) => item.source).filter(Boolean)).size,
    reportCount: snapshot.intelligenceCache.scheduledReports?.length ?? 0,
    ontologyNodeCount: snapshot.intelligenceCache.ontologyGraph?.nodes?.length ?? 0,
    ideaCardCount: snapshot.intelligenceCache.investmentIntelligence?.ideaCards?.length ?? 0,
  };
}

function serializeSnapshot(snapshot: IntelligenceFabricSnapshot): PersistedIntelligenceFabricSnapshot {
  return {
    generatedAt: snapshot.generatedAt,
    allNews: snapshot.allNews.map(serializeNewsItem),
    newsByCategory: Object.fromEntries(
      Object.entries(snapshot.newsByCategory).map(([key, items]) => [key, items.map(serializeNewsItem)]),
    ),
    latestMarkets: snapshot.latestMarkets.slice(0, MAX_MARKETS),
    latestPredictions: snapshot.latestPredictions.slice(0, MAX_PREDICTIONS),
    latestClusters: snapshot.latestClusters.map(serializeCluster),
    intelligenceCache: serializeIntelligenceCache(snapshot.intelligenceCache as IntelligenceCache),
    cyberThreatsCache: snapshot.cyberThreatsCache,
  };
}

function deserializeSnapshot(snapshot: PersistedIntelligenceFabricSnapshot): IntelligenceFabricSnapshot {
  const base = {
    generatedAt: snapshot.generatedAt,
    allNews: (snapshot.allNews || []).map(deserializeNewsItem),
    newsByCategory: Object.fromEntries(
      Object.entries(snapshot.newsByCategory || {}).map(([key, items]) => [key, (items || []).map(deserializeNewsItem)]),
    ),
    latestMarkets: snapshot.latestMarkets || [],
    latestPredictions: snapshot.latestPredictions || [],
    latestClusters: (snapshot.latestClusters || []).map(deserializeCluster),
    intelligenceCache: reviveIntelligenceCache(snapshot.intelligenceCache),
    cyberThreatsCache: snapshot.cyberThreatsCache ?? null,
  };
  return {
    ...base,
    summary: buildSummary(base),
  };
}

function buildSnapshotFromContext(
  ctx: FabricContextLike,
  previous: IntelligenceFabricSnapshot | null,
): IntelligenceFabricSnapshot {
  const mergedNewsByCategory = mergeNewsByCategory(ctx.newsByCategory, previous?.newsByCategory);
  const normalizedCurrentAllNews = hasMeaningfulValue(ctx.allNews)
    ? ctx.allNews
    : flattenNewsByCategory(mergedNewsByCategory);
  const base = {
    generatedAt: new Date().toISOString(),
    allNews: mergeNewsItems(normalizedCurrentAllNews, previous?.allNews, MAX_ALL_NEWS),
    newsByCategory: mergedNewsByCategory,
    latestMarkets: hasMeaningfulValue(ctx.latestMarkets)
      ? ctx.latestMarkets.slice(0, MAX_MARKETS)
      : (previous?.latestMarkets || []).slice(0, MAX_MARKETS),
    latestPredictions: hasMeaningfulValue(ctx.latestPredictions)
      ? ctx.latestPredictions.slice(0, MAX_PREDICTIONS)
      : (previous?.latestPredictions || []).slice(0, MAX_PREDICTIONS),
    latestClusters: mergeClusters(ctx.latestClusters, previous?.latestClusters, MAX_CLUSTERS),
    intelligenceCache: mergeIntelligenceCache(ctx.intelligenceCache, previous?.intelligenceCache),
    cyberThreatsCache: hasMeaningfulValue(ctx.cyberThreatsCache)
      ? (ctx.cyberThreatsCache || []).slice(0, MAX_GENERIC_ARRAY)
      : (previous?.cyberThreatsCache || []).slice(0, MAX_GENERIC_ARRAY),
  };
  return {
    ...base,
    summary: buildSummary(base),
  };
}

export async function getIntelligenceFabricSnapshot(forceRefresh = false): Promise<IntelligenceFabricSnapshot | null> {
  if (currentFabricSnapshot && !forceRefresh) {
    return currentFabricSnapshot;
  }
  let cached = await getPersistentCache<PersistedIntelligenceFabricSnapshot>(FABRIC_CACHE_KEY);
  if (!cached?.data) {
    const remoteData = await tryLoadFabricFromLocalProxy();
    if (remoteData) {
      cached = {
        key: FABRIC_CACHE_KEY,
        updatedAt: Date.now(),
        data: remoteData,
      };
      void setPersistentCache(FABRIC_CACHE_KEY, remoteData).catch(() => undefined);
    }
  }
  if (!cached?.data) {
    currentFabricSnapshot = null;
    return null;
  }
  currentFabricSnapshot = deserializeSnapshot(cached.data);
  return currentFabricSnapshot;
}

export function getIntelligenceFabricSnapshotSync(): IntelligenceFabricSnapshot | null {
  return currentFabricSnapshot;
}

export async function persistIntelligenceFabricSnapshotFromContext(
  ctx: FabricContextLike,
): Promise<IntelligenceFabricSnapshot> {
  const previous = await getIntelligenceFabricSnapshot();
  const snapshot = buildSnapshotFromContext(ctx, previous);
  currentFabricSnapshot = snapshot;
  await setPersistentCache(FABRIC_CACHE_KEY, serializeSnapshot(snapshot));
  return snapshot;
}

export function getFabricBackedRuntimeView(ctx: FabricContextLike): FabricContextLike {
  const fabric = currentFabricSnapshot;
  const currentNewsByCategory = hasMeaningfulValue(ctx.newsByCategory)
    ? ctx.newsByCategory
    : fabric?.newsByCategory ?? {};
  const currentAllNews = hasMeaningfulValue(ctx.allNews)
    ? ctx.allNews
    : flattenNewsByCategory(currentNewsByCategory);
  if (!fabric) {
    return {
      allNews: currentAllNews,
      newsByCategory: currentNewsByCategory,
      latestMarkets: ctx.latestMarkets,
      latestPredictions: ctx.latestPredictions,
      latestClusters: ctx.latestClusters,
      intelligenceCache: ctx.intelligenceCache,
      cyberThreatsCache: ctx.cyberThreatsCache,
    };
  }

  return {
    allNews: hasMeaningfulValue(currentAllNews) ? currentAllNews : fabric.allNews,
    newsByCategory: currentNewsByCategory,
    latestMarkets: hasMeaningfulValue(ctx.latestMarkets) ? ctx.latestMarkets : fabric.latestMarkets,
    latestPredictions: hasMeaningfulValue(ctx.latestPredictions) ? ctx.latestPredictions : fabric.latestPredictions,
    latestClusters: hasMeaningfulValue(ctx.latestClusters) ? ctx.latestClusters : fabric.latestClusters,
    intelligenceCache: mergeIntelligenceCache(ctx.intelligenceCache, fabric.intelligenceCache),
    cyberThreatsCache: hasMeaningfulValue(ctx.cyberThreatsCache) ? ctx.cyberThreatsCache : fabric.cyberThreatsCache,
  };
}

export async function hydrateContextFromPersistedIntelligenceFabric(
  ctx: FabricContextLike,
): Promise<IntelligenceFabricSnapshot | null> {
  const snapshot = await getIntelligenceFabricSnapshot();
  if (!snapshot) return null;

  const view = getFabricBackedRuntimeView(ctx);
  ctx.allNews = view.allNews;
  ctx.newsByCategory = view.newsByCategory;
  ctx.latestMarkets = view.latestMarkets;
  ctx.latestPredictions = view.latestPredictions;
  ctx.latestClusters = view.latestClusters;
  ctx.intelligenceCache = view.intelligenceCache;
  ctx.cyberThreatsCache = view.cyberThreatsCache;
  return snapshot;
}
