import { getCachedJson, setCachedJson } from './redis';

export interface SnapshotMetadata {
  source: string;
  generatedAt: string;
  count: number;
}

export interface SnapshotPayload<T> {
  meta: SnapshotMetadata;
  [key: string]: T[] | SnapshotMetadata | any;
}

/**
 * Merges a fresh live snapshot array with a historical cached array.
 * Deduplicates items by a unique key and trims to a maximum trailing window.
 */
export async function mergeAndSetHistoricalSnapshot<T extends Record<string, any>>(
  key: string,
  newData: T[],
  dedupeKey: keyof T,
  maxItems: number,
  ttlSeconds: number,
  arrayKey: string = 'data',
  source: string = 'api'
): Promise<SnapshotPayload<T>> {
  const existing = await getCachedJson(key) as SnapshotPayload<T> | null;
  const historical = (existing?.[arrayKey] || []) as T[];

  // Merge the arrays
  const mergedMap = new Map<string, T>();
  
  // 1. Add older items first
  for (const item of historical) {
    const id = String(item[dedupeKey]);
    mergedMap.set(id, item);
  }
  
  // 2. Overwrite with fresh live items
  for (const item of newData) {
    const id = String(item[dedupeKey]);
    mergedMap.set(id, item);
  }

  let mergedArray = Array.from(mergedMap.values());
  
  // 4. Trim to maxItems
  if (mergedArray.length > maxItems) {
    mergedArray = mergedArray.slice(mergedArray.length - maxItems);
  }

  const payload: SnapshotPayload<T> = {
    meta: {
      source,
      generatedAt: new Date().toISOString(),
      count: mergedArray.length
    },
    [arrayKey]: mergedArray
  };

  await setCachedJson(key, payload, ttlSeconds);
  
  return payload;
}
