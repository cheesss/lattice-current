import type { AisDensityZone, AisDisruptionEvent } from '@/types';
import { createCircuitBreaker } from '@/utils';

const PORTWATCH_ARCGIS_BASE =
  'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/ArcGIS/rest/services';

const PORTWATCH_FETCH_TIMEOUT_MS = 30000;
const PORTWATCH_DISRUPTION_LIMIT = 120;
const PORTWATCH_CHOKEPOINT_LIMIT = 480;
const PORTWATCH_REGIONAL_LIMIT = 1200;

type AlertLevel = 'RED' | 'ORANGE' | 'YELLOW' | 'GREEN' | 'UNKNOWN';

interface ArcGisFeature<T> {
  attributes?: T;
}

interface ArcGisQueryResponse<T> {
  features?: Array<ArcGisFeature<T>>;
  error?: { code?: number; message?: string };
}

interface PortWatchDisruptionAttributes {
  eventid?: number;
  eventtype?: string;
  eventname?: string;
  alertlevel?: string;
  country?: string | null;
  fromdate?: number | string | null;
  todate?: number | string | null;
  severitytext?: string | null;
  n_affectedports?: number | null;
  affectedpopulation?: string | null;
  affectedports?: string | null;
  lat?: number | null;
  long?: number | null;
}

interface PortWatchChokepointAttributes {
  date?: number | string | null;
  portid?: string | null;
  portname?: string | null;
  n_container?: number | null;
  n_tanker?: number | null;
  n_total?: number | null;
  capacity?: number | null;
}

interface PortWatchRegionalAttributes {
  ISO3?: string | null;
  country?: string | null;
  date?: number | string | null;
  shipment?: number | null;
  shipment_30MA?: number | null;
  shipment_30MA_yoy_doy?: number | null;
}

export interface PortWatchDisruption {
  id: string;
  eventId: number;
  eventType: string;
  eventName: string;
  alertLevel: AlertLevel;
  country: string;
  fromDate: Date | null;
  toDate: Date | null;
  severityText: string;
  affectedPorts: number;
  affectedPopulation: string;
  affectedPortIds: string[];
  lat: number;
  lon: number;
}

export interface PortWatchChokepointSnapshot {
  id: string;
  name: string;
  date: Date | null;
  vesselCount: number;
  tankerCount: number;
  containerCount: number;
  capacity: number;
  lat: number;
  lon: number;
}

export interface PortWatchRegionalTradeSnapshot {
  iso3: string;
  country: string;
  date: Date | null;
  shipment: number;
  shipment30ma: number;
  shipmentYoY: number;
}

export interface PortWatchSnapshot {
  fetchedAt: Date;
  upstreamUnavailable: boolean;
  disruptions: PortWatchDisruption[];
  chokepoints: PortWatchChokepointSnapshot[];
  regionalTrade: PortWatchRegionalTradeSnapshot[];
}

const CHOKEPOINT_COORDS: Record<string, { lat: number; lon: number }> = {
  'Suez Canal': { lat: 30.3, lon: 32.3 },
  'Panama Canal': { lat: 9.08, lon: -79.68 },
  'Strait of Hormuz': { lat: 26.56, lon: 56.25 },
  'Bab el-Mandeb': { lat: 12.66, lon: 43.45 },
  'Strait of Malacca': { lat: 2.5, lon: 101.2 },
  Bosporus: { lat: 41.12, lon: 29.09 },
  'Cape of Good Hope': { lat: -34.36, lon: 18.5 },
  Gibraltar: { lat: 36.14, lon: -5.35 },
};

const breaker = createCircuitBreaker<PortWatchSnapshot>({
  name: 'PortWatch ArcGIS',
  maxFailures: 3,
  cooldownMs: 2 * 60 * 1000,
  cacheTtlMs: 8 * 60 * 1000,
  persistCache: true,
});

function timeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

function toDate(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1_000_000_000_000) return new Date(value);
    if (value > 1_000_000_000) return new Date(value * 1000);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed);
  }
  return null;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toAlertLevel(raw: unknown): AlertLevel {
  const normalized = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (normalized === 'RED' || normalized === 'ORANGE' || normalized === 'YELLOW' || normalized === 'GREEN') {
    return normalized;
  }
  return 'UNKNOWN';
}

function normalizePortwatchName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

function findChokepointCoords(name: string): { lat: number; lon: number } | null {
  const normalized = normalizePortwatchName(name);
  const direct = CHOKEPOINT_COORDS[name];
  if (direct) return direct;

  const found = Object.entries(CHOKEPOINT_COORDS).find(([key]) => {
    const keyNorm = normalizePortwatchName(key);
    return normalized.includes(keyNorm) || keyNorm.includes(normalized);
  });
  return found ? found[1] : null;
}

function buildQueryUrl(serviceName: string, outFields: string, options: {
  resultRecordCount: number;
  orderByFields?: string;
  returnGeometry?: boolean;
  extra?: Record<string, string>;
}): string {
  const url = new URL(`${PORTWATCH_ARCGIS_BASE}/${serviceName}/FeatureServer/0/query`);
  url.searchParams.set('where', '1=1');
  url.searchParams.set('outFields', outFields);
  url.searchParams.set('resultRecordCount', String(options.resultRecordCount));
  url.searchParams.set('f', 'json');
  if (options.orderByFields) {
    url.searchParams.set('orderByFields', options.orderByFields);
  }
  if (options.returnGeometry === false) {
    url.searchParams.set('returnGeometry', 'false');
  }
  if (options.extra) {
    for (const [k, v] of Object.entries(options.extra)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

async function fetchArcGisRows<T>(
  serviceName: string,
  outFields: string,
  options: {
    resultRecordCount: number;
    orderByFields?: string;
    returnGeometry?: boolean;
    extra?: Record<string, string>;
  },
): Promise<T[]> {
  const url = buildQueryUrl(serviceName, outFields, options);
  const response = await fetch(url, {
    method: 'GET',
    signal: timeoutSignal(PORTWATCH_FETCH_TIMEOUT_MS),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`PortWatch ${serviceName} HTTP ${response.status}`);
  }
  const payload = await response.json() as ArcGisQueryResponse<T>;
  if (payload.error) {
    const code = payload.error.code ? ` ${payload.error.code}` : '';
    throw new Error(`PortWatch ${serviceName} error${code}: ${payload.error.message || 'unknown'}`);
  }
  return (payload.features || [])
    .map((feature) => feature.attributes)
    .filter((row): row is T => Boolean(row));
}

async function fetchDisruptions(): Promise<PortWatchDisruption[]> {
  const rows = await fetchArcGisRows<PortWatchDisruptionAttributes>(
    'portwatch_disruptions_database',
    'eventid,eventtype,eventname,alertlevel,country,fromdate,todate,severitytext,n_affectedports,affectedpopulation,affectedports,lat,long',
    {
      resultRecordCount: PORTWATCH_DISRUPTION_LIMIT,
      orderByFields: 'fromdate desc',
      returnGeometry: false,
    },
  );

  return rows
    .map((row) => {
      const eventId = Math.trunc(toNumber(row.eventid, 0));
      const lat = toNumber(row.lat, Number.NaN);
      const lon = toNumber(row.long, Number.NaN);
      if (!eventId || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const eventName = (row.eventname || '').trim();
      const country = (row.country || '').trim();
      const portIds = String(row.affectedports || '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      return {
        id: `portwatch-disruption-${eventId}`,
        eventId,
        eventType: (row.eventtype || 'UNSPECIFIED').trim(),
        eventName: eventName || `PortWatch Event ${eventId}`,
        alertLevel: toAlertLevel(row.alertlevel),
        country: country || 'Unknown',
        fromDate: toDate(row.fromdate),
        toDate: toDate(row.todate),
        severityText: String(row.severitytext || '').trim(),
        affectedPorts: Math.max(0, Math.trunc(toNumber(row.n_affectedports, 0))),
        affectedPopulation: String(row.affectedpopulation || '').trim(),
        affectedPortIds: portIds,
        lat,
        lon,
      } satisfies PortWatchDisruption;
    })
    .filter((item): item is PortWatchDisruption => Boolean(item));
}

async function fetchChokepoints(): Promise<PortWatchChokepointSnapshot[]> {
  const rows = await fetchArcGisRows<PortWatchChokepointAttributes>(
    'Daily_Chokepoints_Data',
    'date,portid,portname,n_container,n_tanker,n_total,capacity',
    {
      resultRecordCount: PORTWATCH_CHOKEPOINT_LIMIT,
      orderByFields: 'date desc',
      returnGeometry: false,
    },
  );

  const latestByPort = new Map<string, PortWatchChokepointSnapshot>();

  for (const row of rows) {
    const id = String(row.portid || '').trim();
    const name = String(row.portname || '').trim();
    if (!id || !name) continue;
    if (latestByPort.has(id)) continue;
    const coords = findChokepointCoords(name);
    if (!coords) continue;
    latestByPort.set(id, {
      id,
      name,
      date: toDate(row.date),
      vesselCount: Math.max(0, Math.trunc(toNumber(row.n_total, 0))),
      tankerCount: Math.max(0, Math.trunc(toNumber(row.n_tanker, 0))),
      containerCount: Math.max(0, Math.trunc(toNumber(row.n_container, 0))),
      capacity: Math.max(0, toNumber(row.capacity, 0)),
      lat: coords.lat,
      lon: coords.lon,
    });
  }

  return Array.from(latestByPort.values())
    .sort((a, b) => b.vesselCount - a.vesselCount)
    .slice(0, 24);
}

async function fetchRegionalTrade(): Promise<PortWatchRegionalTradeSnapshot[]> {
  const rows = await fetchArcGisRows<PortWatchRegionalAttributes>(
    'Daily_Trade_Data_REG',
    'ISO3,country,date,shipment,shipment_30MA,shipment_30MA_yoy_doy',
    {
      resultRecordCount: PORTWATCH_REGIONAL_LIMIT,
      orderByFields: 'date desc',
      returnGeometry: false,
    },
  );

  const latestByIso = new Map<string, PortWatchRegionalTradeSnapshot>();

  for (const row of rows) {
    const iso = String(row.ISO3 || '').trim().toUpperCase();
    const country = String(row.country || '').trim();
    if (!iso || !country) continue;
    if (latestByIso.has(iso)) continue;
    latestByIso.set(iso, {
      iso3: iso,
      country,
      date: toDate(row.date),
      shipment: toNumber(row.shipment, 0),
      shipment30ma: toNumber(row.shipment_30MA, 0),
      shipmentYoY: toNumber(row.shipment_30MA_yoy_doy, 0),
    });
  }

  return Array.from(latestByIso.values());
}

export async function fetchPortWatchSnapshot(): Promise<PortWatchSnapshot> {
  const fallback: PortWatchSnapshot = {
    fetchedAt: new Date(),
    upstreamUnavailable: true,
    disruptions: [],
    chokepoints: [],
    regionalTrade: [],
  };

  return breaker.execute(async () => {
    const [disruptions, chokepoints, regionalTrade] = await Promise.all([
      fetchDisruptions(),
      fetchChokepoints(),
      fetchRegionalTrade(),
    ]);

    return {
      fetchedAt: new Date(),
      upstreamUnavailable: false,
      disruptions,
      chokepoints,
      regionalTrade,
    };
  }, fallback);
}

function toSeverity(alertLevel: AlertLevel): 'low' | 'elevated' | 'high' {
  if (alertLevel === 'RED') return 'high';
  if (alertLevel === 'ORANGE' || alertLevel === 'YELLOW') return 'elevated';
  return 'low';
}

function scoreChokepointIntensity(row: PortWatchChokepointSnapshot): number {
  const vesselScore = Math.min(1, row.vesselCount / 120);
  const tankerBias = Math.min(0.35, row.tankerCount / 60);
  const containerBias = Math.min(0.25, row.containerCount / 80);
  const capacityBias = Math.min(0.3, row.capacity / 7_000_000);
  return Math.max(0.12, Math.min(1, vesselScore * 0.55 + tankerBias + containerBias + capacityBias));
}

export function toPortWatchAisOverlays(snapshot: PortWatchSnapshot): {
  disruptions: AisDisruptionEvent[];
  density: AisDensityZone[];
} {
  const disruptions: AisDisruptionEvent[] = snapshot.disruptions.map((item) => {
    const severity = toSeverity(item.alertLevel);
    const changePct =
      severity === 'high' ? 35 :
        severity === 'elevated' ? 18 : 8;

    const fromTs = item.fromDate?.getTime() ?? Date.now();
    const toTs = item.toDate?.getTime() ?? fromTs + 24 * 60 * 60 * 1000;
    const windowHours = Math.max(6, Math.round((toTs - fromTs) / (60 * 60 * 1000)));

    const descriptionParts = [
      item.severityText,
      item.affectedPopulation,
      item.affectedPorts > 0 ? `Affected ports: ${item.affectedPorts}` : '',
    ].filter(Boolean);

    return {
      id: item.id,
      name: item.eventName,
      type: 'chokepoint_congestion',
      lat: item.lat,
      lon: item.lon,
      severity,
      changePct,
      windowHours,
      vesselCount: item.affectedPorts > 0 ? item.affectedPorts : undefined,
      region: item.country || 'Global',
      description: descriptionParts.join(' | ') || 'PortWatch disruption event',
    };
  });

  const density: AisDensityZone[] = snapshot.chokepoints.map((item) => {
    const intensity = scoreChokepointIntensity(item);
    const capacityMillions = item.capacity > 0 ? item.capacity / 1_000_000 : 0;
    return {
      id: `portwatch-density-${item.id}`,
      name: item.name,
      lat: item.lat,
      lon: item.lon,
      intensity,
      deltaPct: Math.round(intensity * 40),
      shipsPerDay: item.vesselCount,
      note: capacityMillions > 0
        ? `Capacity ${capacityMillions.toFixed(2)}M tons`
        : 'PortWatch chokepoint snapshot',
    };
  });

  return { disruptions, density };
}
