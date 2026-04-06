import {
  SeismologyServiceClient,
  type Earthquake,
  type ListEarthquakesResponse,
} from '@/generated/client/worldmonitor/seismology/v1/service_client';
import { createCircuitBreaker } from '@/utils';
import { getHydratedData } from '@/services/bootstrap';

// Re-export the proto Earthquake type as the domain's public type
export type { Earthquake };

const client = new SeismologyServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });
const breaker = createCircuitBreaker<ListEarthquakesResponse>({ name: 'Seismology', cacheTtlMs: 30 * 60 * 1000, persistCache: true });

const emptyFallback: ListEarthquakesResponse = { earthquakes: [] };

function normalizeEarthquake(raw: Partial<Earthquake> | Record<string, unknown>): Earthquake {
  const record = raw as Partial<Earthquake> & Record<string, unknown>;
  const location = record.location && typeof record.location === 'object'
    ? record.location as { latitude?: number; longitude?: number }
    : {
      latitude: Number(record.lat ?? record.latitude ?? 0),
      longitude: Number(record.lon ?? record.longitude ?? 0),
    };

  return {
    id: String(record.id || ''),
    place: String(record.place || ''),
    magnitude: Number(record.magnitude ?? 0),
    depthKm: Number(record.depthKm ?? record.depth ?? 0),
    location: {
      latitude: Number(location.latitude ?? 0),
      longitude: Number(location.longitude ?? 0),
    },
    occurredAt: typeof record.occurredAt === 'number'
      ? record.occurredAt
      : Date.parse(String(record.time || record.occurredAt || 0)) || 0,
    sourceUrl: String(record.sourceUrl || record.url || ''),
  };
}

export async function fetchEarthquakes(): Promise<Earthquake[]> {
  const hydrated = getHydratedData('earthquakes') as ListEarthquakesResponse | undefined;
  if (hydrated?.earthquakes?.length) return hydrated.earthquakes.map((item) => normalizeEarthquake(item));

  const response = await breaker.execute(async () => {
    return client.listEarthquakes({ minMagnitude: 0, start: 0, end: 0, pageSize: 0, cursor: '' });
  }, emptyFallback);
  return response.earthquakes.map((item) => normalizeEarthquake(item));
}
