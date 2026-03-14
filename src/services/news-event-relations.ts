import type {
  AisDensityZone,
  AisDisruptionEvent,
  ClusterRelations,
  ClusteredEvent,
  MilitaryFlight,
  MilitaryVessel,
  RelatedClusterRef,
} from '@/types';
import { getCountryAtCoordinates, matchCountryNamesInText, nameToCountryCode } from './country-geometry';

interface RollingEntry<T> {
  item: T;
  seenAt: number;
}

interface EventCorrelationSnapshot {
  flights: Map<string, RollingEntry<MilitaryFlight>>;
  vessels: Map<string, RollingEntry<MilitaryVessel>>;
  disruptions: Map<string, RollingEntry<AisDisruptionEvent>>;
  density: Map<string, RollingEntry<AisDensityZone>>;
  updatedAt: Date | null;
}

interface EventCorrelationUpdate {
  flights?: MilitaryFlight[];
  vessels?: MilitaryVessel[];
  disruptions?: AisDisruptionEvent[];
  density?: AisDensityZone[];
}

const FLIGHT_WINDOW_MS = 12 * 60 * 60 * 1000;
const VESSEL_WINDOW_MS = 18 * 60 * 60 * 1000;
const DISRUPTION_WINDOW_MS = 24 * 60 * 60 * 1000;
const DENSITY_WINDOW_MS = 8 * 60 * 60 * 1000;

const snapshot: EventCorrelationSnapshot = {
  flights: new Map(),
  vessels: new Map(),
  disruptions: new Map(),
  density: new Map(),
  updatedAt: null,
};

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'will', 'have', 'has',
  'its', 'about', 'into', 'after', 'before', 'amid', 'over', 'under', 'near',
  'says', 'say', 'said', 'new', 'latest', 'update', 'warns', 'report', 'reports',
  'global', 'market', 'markets', 'breaking', 'live', 'world', 'north', 'south',
  'east', 'west', 'could', 'may', 'can', 'are', 'was', 'were', 'been', 'being',
  'their', 'they', 'them', 'than', 'then', 'also', 'across', 'between',
]);

const AIR_KEYWORDS = [
  'airstrike', 'air strike', 'fighter', 'jet', 'sortie', 'air force', 'drone',
  'awacs', 'bomber', 'aircraft', 'intercept', 'recon', 'patrol aircraft',
];

const MARITIME_KEYWORDS = [
  'ship', 'shipping', 'vessel', 'naval', 'port', 'harbor', 'strait', 'chokepoint',
  'hormuz', 'suez', 'bab el mandeb', 'ait', 'cargo', 'tanker', 'container', 'fleet',
];

const ENTITY_ALIASES: Array<{ key: string; aliases: string[] }> = [
  { key: 'choke:hormuz', aliases: ['hormuz', 'strait of hormuz'] },
  { key: 'choke:suez', aliases: ['suez', 'suez canal'] },
  { key: 'choke:bab-el-mandeb', aliases: ['bab el mandeb', 'bab-al-mandab', 'mandeb'] },
  { key: 'choke:taiwan-strait', aliases: ['taiwan strait', 'formosa strait'] },
  { key: 'choke:bosporus', aliases: ['bosporus', 'bosphorus', 'turkish straits'] },
  { key: 'air:awacs', aliases: ['awacs', 'airborne warning'] },
  { key: 'air:recon', aliases: ['recon', 'reconnaissance', 'surveillance aircraft'] },
  { key: 'air:bomber', aliases: ['bomber', 'strategic bomber'] },
  { key: 'sea:carrier', aliases: ['carrier', 'aircraft carrier'] },
  { key: 'sea:destroyer', aliases: ['destroyer'] },
  { key: 'sea:frigate', aliases: ['frigate', 'corvette'] },
  { key: 'sea:submarine', aliases: ['submarine'] },
  { key: 'sea:tanker', aliases: ['tanker'] },
];

function normalizeCountryLike(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^[A-Z]{2}$/.test(trimmed.toUpperCase())) return trimmed.toUpperCase();
  return nameToCountryCode(trimmed) || null;
}

function tokenizeTitle(text: string): Set<string> {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return new Set<string>();
  const tokens = cleaned
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function includesAny(haystackLower: string, needles: string[]): boolean {
  return needles.some((needle) => haystackLower.includes(needle));
}

function toEntitySet(text: string): Set<string> {
  const lower = text.toLowerCase();
  const entities = new Set<string>();
  for (const { key, aliases } of ENTITY_ALIASES) {
    if (aliases.some((alias) => lower.includes(alias))) entities.add(key);
  }

  const countries = matchCountryNamesInText(lower);
  countries.forEach((code) => entities.add(`country:${code}`));

  if (includesAny(lower, AIR_KEYWORDS)) entities.add('domain:air');
  if (includesAny(lower, MARITIME_KEYWORDS)) entities.add('domain:sea');
  return entities;
}

function mergeEntitySets(...sets: Set<string>[]): Set<string> {
  const merged = new Set<string>();
  for (const set of sets) {
    for (const item of set) merged.add(item);
  }
  return merged;
}

function overlapCount(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const item of a) {
    if (b.has(item)) count++;
  }
  return count;
}

function getClusterCountryHints(cluster: ClusteredEvent): Set<string> {
  const hints = new Set<string>();
  const byName = matchCountryNamesInText(cluster.primaryTitle.toLowerCase());
  byName.forEach((code) => hints.add(code));

  if (cluster.lat != null && cluster.lon != null) {
    const hit = getCountryAtCoordinates(cluster.lat, cluster.lon);
    if (hit?.code) hints.add(hit.code);
  }

  return hints;
}

function getDynamicLinkThreshold(
  a: ClusteredEvent,
  b: ClusteredEvent,
  sharedCountry: number,
  sameThreat: number,
  timeProximity: number,
): number {
  let threshold = 0.3;
  if (a.sourceCount >= 3 || b.sourceCount >= 3) threshold -= 0.03;
  if (a.isAlert || b.isAlert) threshold -= 0.04;
  if (sharedCountry) threshold -= 0.04;
  if (sameThreat) threshold -= 0.03;
  if (timeProximity >= 1) threshold -= 0.03;
  return Math.max(0.14, Math.min(0.42, threshold));
}

function scoreClusterSimilarity(
  a: ClusteredEvent,
  b: ClusteredEvent,
  tokensA: Set<string>,
  tokensB: Set<string>,
  entitiesA: Set<string>,
  entitiesB: Set<string>,
  countryA: Set<string>,
  countryB: Set<string>,
): { score: number; threshold: number } {
  const lexicalSim = jaccard(tokensA, tokensB);
  const entitySim = jaccard(entitiesA, entitiesB);
  if (lexicalSim <= 0 && entitySim <= 0) return { score: 0, threshold: 1 };

  let sharedCountry = 0;
  for (const code of countryA) {
    if (countryB.has(code)) {
      sharedCountry = 1;
      break;
    }
  }

  const sameThreat = a.threat?.category && b.threat?.category && a.threat.category === b.threat.category ? 1 : 0;
  const deltaMinutes = Math.abs(a.lastUpdated.getTime() - b.lastUpdated.getTime()) / 60_000;
  const timeProximity = deltaMinutes <= 180 ? 1 : deltaMinutes <= 720 ? 0.5 : 0;
  const threshold = getDynamicLinkThreshold(a, b, sharedCountry, sameThreat, timeProximity);

  const score = lexicalSim * 0.55
    + entitySim * 0.2
    + sharedCountry * 0.12
    + sameThreat * 0.08
    + timeProximity * 0.05;

  return { score, threshold };
}

function buildRelatedNewsRefs(clusters: ClusteredEvent[]): Map<string, RelatedClusterRef[]> {
  const map = new Map<string, RelatedClusterRef[]>();
  const tokens = clusters.map((cluster) => tokenizeTitle(cluster.primaryTitle));
  const entities = clusters.map((cluster) => toEntitySet(cluster.primaryTitle));
  const countries = clusters.map((cluster) => getClusterCountryHints(cluster));

  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const a = clusters[i]!;
      const b = clusters[j]!;
      const aEntities = a.allItems.reduce((acc, item) => mergeEntitySets(acc, toEntitySet(item.title)), entities[i]!);
      const bEntities = b.allItems.reduce((acc, item) => mergeEntitySets(acc, toEntitySet(item.title)), entities[j]!);
      const { score, threshold } = scoreClusterSimilarity(
        a,
        b,
        tokens[i]!,
        tokens[j]!,
        aEntities,
        bEntities,
        countries[i]!,
        countries[j]!,
      );
      if (score < threshold) continue;

      const scorePct = Math.round(Math.max(1, Math.min(99, score * 100)));
      const listA = map.get(a.id) || [];
      listA.push({ id: b.id, title: b.primaryTitle, score: scorePct });
      map.set(a.id, listA);

      const listB = map.get(b.id) || [];
      listB.push({ id: a.id, title: a.primaryTitle, score: scorePct });
      map.set(b.id, listB);
    }
  }

  for (const [id, refs] of map.entries()) {
    refs.sort((x, y) => y.score - x.score);
    map.set(id, refs.slice(0, 3));
  }
  return map;
}

function eventEntityFromFlight(flight: MilitaryFlight): Set<string> {
  const entities = new Set<string>();
  entities.add(`air:${flight.aircraftType}`);
  entities.add('domain:air');
  const code = normalizeCountryLike(flight.operatorCountry);
  if (code) entities.add(`country:${code}`);
  return entities;
}

function eventEntityFromVessel(vessel: MilitaryVessel): Set<string> {
  const entities = new Set<string>();
  entities.add(`sea:${vessel.vesselType}`);
  entities.add('domain:sea');
  const code = normalizeCountryLike(vessel.operatorCountry);
  if (code) entities.add(`country:${code}`);
  return entities;
}

function eventEntityFromDisruption(disruption: AisDisruptionEvent): Set<string> {
  return toEntitySet(`${disruption.name} ${disruption.description || ''} ${disruption.region || ''}`);
}

function eventEntityFromDensity(zone: AisDensityZone): Set<string> {
  return toEntitySet(`${zone.name} ${zone.note || ''}`);
}

function getActiveStoreEntries<T>(
  store: Map<string, RollingEntry<T>>,
  ttlMs: number,
  now: number,
): T[] {
  const out: Array<{ item: T; seenAt: number }> = [];
  for (const [key, entry] of store.entries()) {
    if (now - entry.seenAt > ttlMs) {
      store.delete(key);
      continue;
    }
    out.push({ item: entry.item, seenAt: entry.seenAt });
  }
  out.sort((a, b) => b.seenAt - a.seenAt);
  return out.map((row) => row.item);
}

function dynamicRadius(base: number, sourceCount: number, hasDomainHit: boolean): number {
  const sourceScale = Math.min(1.25, 1 + sourceCount * 0.06);
  const domainBoost = hasDomainHit ? 1.2 : 1;
  return base * sourceScale * domainBoost;
}

function computeEventCorrelation(cluster: ClusteredEvent): Omit<ClusterRelations, 'relatedNews'> {
  const now = Date.now();
  const titleLower = cluster.primaryTitle.toLowerCase();
  const hasCoords = cluster.lat != null && cluster.lon != null;
  const anchorLat = cluster.lat ?? 0;
  const anchorLon = cluster.lon ?? 0;
  const countryHints = getClusterCountryHints(cluster);
  const headlineEntities = mergeEntitySets(
    toEntitySet(cluster.primaryTitle),
    ...cluster.allItems.slice(0, 6).map((item) => toEntitySet(item.title)),
  );

  let airMatches = 0;
  let maritimeMatches = 0;
  const evidence: string[] = [];

  const titleHasAir = headlineEntities.has('domain:air') || includesAny(titleLower, AIR_KEYWORDS);
  const titleHasSea = headlineEntities.has('domain:sea') || includesAny(titleLower, MARITIME_KEYWORDS);
  const sourceCount = Math.max(1, cluster.sourceCount);
  const airRadius = dynamicRadius(620, sourceCount, titleHasAir);
  const seaRadius = dynamicRadius(520, sourceCount, titleHasSea);
  const densityRadius = dynamicRadius(360, sourceCount, titleHasSea);

  const flights = getActiveStoreEntries(snapshot.flights, FLIGHT_WINDOW_MS, now);
  for (const flight of flights) {
    let matched = false;
    if (hasCoords && haversineKm(anchorLat, anchorLon, flight.lat, flight.lon) <= airRadius) matched = true;

    const opCode = normalizeCountryLike(flight.operatorCountry);
    if (!matched && opCode && countryHints.has(opCode)) matched = true;
    if (!matched) {
      const overlap = overlapCount(headlineEntities, eventEntityFromFlight(flight));
      matched = overlap > 0;
    }
    if (!matched) continue;

    airMatches++;
    if (evidence.length < 4) evidence.push(`AIR ${flight.aircraftType} ${flight.operatorCountry}`);
  }

  const vessels = getActiveStoreEntries(snapshot.vessels, VESSEL_WINDOW_MS, now);
  for (const vessel of vessels) {
    let matched = false;
    if (hasCoords && haversineKm(anchorLat, anchorLon, vessel.lat, vessel.lon) <= seaRadius) matched = true;

    const opCode = normalizeCountryLike(vessel.operatorCountry);
    if (!matched && opCode && countryHints.has(opCode)) matched = true;
    if (!matched) {
      const overlap = overlapCount(headlineEntities, eventEntityFromVessel(vessel));
      matched = overlap > 0;
    }
    if (!matched) continue;

    maritimeMatches++;
    if (evidence.length < 6) evidence.push(`SEA ${vessel.vesselType} ${vessel.operatorCountry}`);
  }

  const disruptions = getActiveStoreEntries(snapshot.disruptions, DISRUPTION_WINDOW_MS, now);
  for (const disruption of disruptions) {
    let matched = false;
    if (hasCoords && haversineKm(anchorLat, anchorLon, disruption.lat, disruption.lon) <= dynamicRadius(470, sourceCount, titleHasSea)) {
      matched = true;
    }
    if (!matched && titleLower.includes(disruption.name.toLowerCase())) matched = true;
    if (!matched && disruption.region && titleLower.includes(disruption.region.toLowerCase())) matched = true;
    if (!matched) {
      const overlap = overlapCount(headlineEntities, eventEntityFromDisruption(disruption));
      matched = overlap > 0;
    }
    if (!matched) continue;

    maritimeMatches++;
    if (evidence.length < 8) evidence.push(`AIS ${disruption.name}`);
  }

  if (hasCoords) {
    const densityZones = getActiveStoreEntries(snapshot.density, DENSITY_WINDOW_MS, now);
    for (const zone of densityZones) {
      if (haversineKm(anchorLat, anchorLon, zone.lat, zone.lon) > densityRadius) continue;
      if (zone.intensity < 35 && Math.abs(zone.deltaPct) < 12) continue;
      const overlap = overlapCount(headlineEntities, eventEntityFromDensity(zone));
      if (overlap === 0 && !titleHasSea) continue;
      maritimeMatches++;
      if (evidence.length < 9) evidence.push(`DENSITY ${zone.name}`);
    }
  }

  let confidence = 14;
  confidence += Math.min(26, airMatches * 3.5);
  confidence += Math.min(30, maritimeMatches * 3.8);
  if (titleHasAir && airMatches > 0) confidence += 7;
  if (titleHasSea && maritimeMatches > 0) confidence += 8;
  if (airMatches > 0 && maritimeMatches > 0) confidence += 11;
  if (cluster.sourceCount >= 3) confidence += 6;
  if (evidence.length >= 3) confidence += 4;
  confidence = Math.max(0, Math.min(99, Math.round(confidence)));

  return {
    airEventMatches: airMatches,
    maritimeEventMatches: maritimeMatches,
    confidenceScore: confidence,
    evidence,
  };
}

function upsertRollingStore<T>(
  store: Map<string, RollingEntry<T>>,
  items: T[],
  keyOf: (item: T) => string,
  now: number,
): void {
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    store.set(key, { item, seenAt: now });
  }
}

function pruneRollingStore<T>(
  store: Map<string, RollingEntry<T>>,
  ttlMs: number,
  now: number,
): void {
  for (const [key, entry] of store.entries()) {
    if (now - entry.seenAt > ttlMs) {
      store.delete(key);
    }
  }
}

function flightKey(item: MilitaryFlight): string {
  if (item.id) return `f:${item.id}`;
  if (item.hexCode) return `f:${item.hexCode}`;
  return `f:${item.callsign}:${item.lat.toFixed(2)}:${item.lon.toFixed(2)}`;
}

function vesselKey(item: MilitaryVessel): string {
  if (item.id) return `v:${item.id}`;
  if (item.mmsi) return `v:${item.mmsi}`;
  return `v:${item.name}:${item.lat.toFixed(2)}:${item.lon.toFixed(2)}`;
}

function disruptionKey(item: AisDisruptionEvent): string {
  if (item.id) return `d:${item.id}`;
  return `d:${item.name}:${item.lat.toFixed(2)}:${item.lon.toFixed(2)}`;
}

function densityKey(item: AisDensityZone): string {
  if (item.id) return `z:${item.id}`;
  return `z:${item.name}:${item.lat.toFixed(2)}:${item.lon.toFixed(2)}`;
}

export function updateEventCorrelationSnapshot(update: EventCorrelationUpdate): void {
  const now = Date.now();
  if (update.flights) upsertRollingStore(snapshot.flights, update.flights, flightKey, now);
  if (update.vessels) upsertRollingStore(snapshot.vessels, update.vessels, vesselKey, now);
  if (update.disruptions) upsertRollingStore(snapshot.disruptions, update.disruptions, disruptionKey, now);
  if (update.density) upsertRollingStore(snapshot.density, update.density, densityKey, now);

  pruneRollingStore(snapshot.flights, FLIGHT_WINDOW_MS, now);
  pruneRollingStore(snapshot.vessels, VESSEL_WINDOW_MS, now);
  pruneRollingStore(snapshot.disruptions, DISRUPTION_WINDOW_MS, now);
  pruneRollingStore(snapshot.density, DENSITY_WINDOW_MS, now);

  snapshot.updatedAt = new Date(now);
}

export function annotateClustersWithRelations(clusters: ClusteredEvent[]): ClusteredEvent[] {
  if (!Array.isArray(clusters) || clusters.length === 0) return clusters;
  const relatedMap = buildRelatedNewsRefs(clusters);

  return clusters.map((cluster) => {
    const relatedNews = relatedMap.get(cluster.id) || [];
    const event = computeEventCorrelation(cluster);
    const confidenceWithNews = Math.min(
      99,
      event.confidenceScore + Math.min(18, relatedNews.length * 5),
    );
    return {
      ...cluster,
      relations: {
        relatedNews,
        ...event,
        confidenceScore: confidenceWithNews,
      },
    };
  });
}
