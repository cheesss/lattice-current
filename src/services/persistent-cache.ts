import { isDesktopRuntime } from './runtime';
import { invokeTauri } from './tauri-bridge';
import { isStorageQuotaExceeded, isQuotaError, markStorageQuotaExceeded } from '@/utils';

/**
 * Cache envelope with optional TTL metadata (Phase 4.1/4.4).
 * The `ttlMs` and `expiresAt` fields are added by Phase 4 and are optional
 * for backward compatibility with existing cached entries.
 */
type CacheEnvelope<T> = {
  key: string;
  updatedAt: number;
  data: T;
  /** TTL in milliseconds — 0 means "no expiration managed by client" */
  ttlMs?: number;
  /** Absolute expiration timestamp (updatedAt + ttlMs). Used for vacuum. */
  expiresAt?: number;
  /** Approximate byte size of JSON.stringify(data), for quota tracking. */
  sizeBytes?: number;
};

const CACHE_PREFIX = 'worldmonitor-persistent-cache:';
const CACHE_DB_NAME = 'worldmonitor_persistent_cache';
const CACHE_DB_VERSION = 2;
const CACHE_STORE = 'entries';
const NODE_CACHE_DIR_ENV = 'WORLDMONITOR_PERSISTENT_CACHE_DIR';
const NODE_FS_PROMISES_SPEC = ['node:', 'fs/promises'].join('');
const NODE_PATH_SPEC = ['node:', 'path'].join('');

let cacheDbPromise: Promise<IDBDatabase> | null = null;
let nodeModuleLoader: ((specifier: string) => Promise<unknown>) | null = null;

function isIndexedDbAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function canUseNodeFileCache(): boolean {
  return typeof window === 'undefined' && typeof process !== 'undefined' && typeof process.cwd === 'function';
}

type NodeCacheModules = {
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<unknown>;
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  writeFile: (path: string, data: string, encoding: BufferEncoding) => Promise<unknown>;
  rm: (path: string, options?: { force?: boolean }) => Promise<unknown>;
  path: {
    resolve: (...segments: string[]) => string;
    join: (...segments: string[]) => string;
  };
};

function getNodeModuleLoader(): (specifier: string) => Promise<unknown> {
  if (!nodeModuleLoader) {
    nodeModuleLoader = new Function('specifier', 'return import(specifier);') as (specifier: string) => Promise<unknown>;
  }
  return nodeModuleLoader;
}

async function loadNodeCacheModules(): Promise<NodeCacheModules> {
  const importModule = getNodeModuleLoader();
  const [fsPromises, path] = await Promise.all([
    importModule(NODE_FS_PROMISES_SPEC) as Promise<{
      mkdir: NodeCacheModules['mkdir'];
      readFile: NodeCacheModules['readFile'];
      writeFile: NodeCacheModules['writeFile'];
      rm: NodeCacheModules['rm'];
    }>,
    importModule(NODE_PATH_SPEC) as Promise<NodeCacheModules['path']>,
  ]);
  return {
    mkdir: fsPromises.mkdir,
    readFile: fsPromises.readFile,
    writeFile: fsPromises.writeFile,
    rm: fsPromises.rm,
    path,
  };
}

async function resolveNodeCacheFilePath(key: string): Promise<string> {
  const { mkdir, path } = await loadNodeCacheModules();
  const baseDir = process.env?.[NODE_CACHE_DIR_ENV]?.trim()
    ? path.resolve(process.env[NODE_CACHE_DIR_ENV]!)
    : path.resolve(process.cwd(), 'data', 'persistent-cache');
  await mkdir(baseDir, { recursive: true });
  return path.join(baseDir, `${encodeURIComponent(key)}.json`);
}

async function getFromNodeFile<T>(key: string): Promise<CacheEnvelope<T> | null> {
  const { readFile } = await loadNodeCacheModules();
  try {
    const filePath = await resolveNodeCacheFilePath(key);
    const raw = await readFile(filePath, 'utf8');
    return raw ? JSON.parse(raw) as CacheEnvelope<T> : null;
  } catch {
    return null;
  }
}

async function setInNodeFile<T>(payload: CacheEnvelope<T>): Promise<void> {
  const { writeFile } = await loadNodeCacheModules();
  const filePath = await resolveNodeCacheFilePath(payload.key);
  await writeFile(filePath, JSON.stringify(payload), 'utf8');
}

async function deleteFromNodeFile(key: string): Promise<void> {
  const { rm } = await loadNodeCacheModules();
  try {
    const filePath = await resolveNodeCacheFilePath(key);
    await rm(filePath, { force: true });
  } catch {
    // Ignore delete failures for optional cache storage.
  }
}

function getCacheDb(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }

  if (cacheDbPromise) return cacheDbPromise;

  cacheDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);

    request.onerror = () => reject(request.error ?? new Error('Failed to open cache IndexedDB'));

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = (event as IDBVersionChangeEvent).oldVersion;
      // V1: create base store
      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains(CACHE_STORE)) {
          db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
        }
      }
      // V2: add expiresAt index for vacuum queries (Phase 4.4)
      if (oldVersion < 2) {
        const tx = (event.target as IDBOpenDBRequest).transaction!;
        const store = tx.objectStore(CACHE_STORE);
        if (!store.indexNames.contains('by_expiry')) {
          store.createIndex('by_expiry', 'expiresAt', { unique: false });
        }
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onclose = () => { cacheDbPromise = null; };
      resolve(db);
    };
  });

  return cacheDbPromise;
}

async function getFromIndexedDb<T>(key: string): Promise<CacheEnvelope<T> | null> {
  const db = await getCacheDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readonly');
    const store = tx.objectStore(CACHE_STORE);
    const request = store.get(key);
    request.onsuccess = () => resolve((request.result as CacheEnvelope<T> | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function setInIndexedDb<T>(payload: CacheEnvelope<T>): Promise<void> {
  const db = await getCacheDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(CACHE_STORE).put(payload);
  });
}

export async function getPersistentCache<T>(key: string): Promise<CacheEnvelope<T> | null> {
  if (isDesktopRuntime()) {
    try {
      const value = await invokeTauri<CacheEnvelope<T> | null>('read_cache_entry', { key });
      return value ?? null;
    } catch (error) {
      console.warn('[persistent-cache] Desktop read failed; falling back to browser storage', error);
    }
  }

  if (isIndexedDbAvailable()) {
    try {
      return await getFromIndexedDb<T>(key);
    } catch (error) {
      console.warn('[persistent-cache] IndexedDB read failed; falling back to localStorage', error);
      cacheDbPromise = null;
    }
  }

  if (canUseNodeFileCache()) {
    try {
      return await getFromNodeFile<T>(key);
    } catch (error) {
      console.warn('[persistent-cache] Node file read failed; falling back to localStorage', error);
    }
  }

  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${key}`);
    return raw ? JSON.parse(raw) as CacheEnvelope<T> : null;
  } catch {
    return null;
  }
}

/**
 * Write a value to persistent cache.
 * @param key   Cache key
 * @param data  Value to store
 * @param ttlMs Optional TTL in ms. When set, entries are eligible for vacuum cleanup.
 */
export async function setPersistentCache<T>(key: string, data: T, ttlMs?: number): Promise<void> {
  const now = Date.now();
  const jsonStr = JSON.stringify(data);
  const sizeBytes = jsonStr.length * 2; // rough UTF-16 byte estimate
  const payload: CacheEnvelope<T> = {
    key,
    data,
    updatedAt: now,
    ttlMs: ttlMs ?? 0,
    expiresAt: ttlMs && ttlMs > 0 ? now + ttlMs : 0,
    sizeBytes,
  };

  if (isDesktopRuntime()) {
    try {
      await invokeTauri<void>('write_cache_entry', { key, value: JSON.stringify(payload) });
      return;
    } catch (error) {
      console.warn('[persistent-cache] Desktop write failed; falling back to browser storage', error);
    }
  }

  if (isIndexedDbAvailable() && !isStorageQuotaExceeded()) {
    try {
      await setInIndexedDb(payload);
      return;
    } catch (error) {
      if (isQuotaError(error)) markStorageQuotaExceeded();
      else console.warn('[persistent-cache] IndexedDB write failed; falling back to localStorage', error);
      cacheDbPromise = null;
    }
  }

  if (canUseNodeFileCache()) {
    try {
      await setInNodeFile(payload);
      return;
    } catch (error) {
      console.warn('[persistent-cache] Node file write failed; falling back to localStorage', error);
    }
  }

  if (isStorageQuotaExceeded()) return;
  try {
    localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(payload));
  } catch (error) {
    if (isQuotaError(error)) markStorageQuotaExceeded();
  }
}

export async function deletePersistentCache(key: string): Promise<void> {
  if (isDesktopRuntime()) {
    try {
      await invokeTauri<void>('delete_cache_entry', { key });
      return;
    } catch {
      // Fall through to browser storage
    }
  }

  if (isIndexedDbAvailable()) {
    try {
      const db = await getCacheDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(CACHE_STORE, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore(CACHE_STORE).delete(key);
      });
      return;
    } catch (error) {
      console.warn('[persistent-cache] IndexedDB delete failed; falling back to localStorage', error);
      cacheDbPromise = null;
    }
  }

  if (canUseNodeFileCache()) {
    try {
      await deleteFromNodeFile(key);
      return;
    } catch (error) {
      console.warn('[persistent-cache] Node file delete failed; falling back to localStorage', error);
    }
  }

  if (isStorageQuotaExceeded()) return;
  try {
    localStorage.removeItem(`${CACHE_PREFIX}${key}`);
  } catch {
    // Ignore
  }
}

export function cacheAgeMs(updatedAt: number): number {
  return Math.max(0, Date.now() - updatedAt);
}

export function describeFreshness(updatedAt: number): string {
  const age = cacheAgeMs(updatedAt);
  const mins = Math.floor(age / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Vacuum & Quota Management (Phase 4.4) ──────────────────────────────────

/** Maximum total cache size in bytes (50 MB). */
const MAX_CACHE_SIZE_BYTES = 50 * 1024 * 1024;

/** Stale ceiling — entries older than this are always removed (24h). */
const STALE_CEILING_MS = 24 * 60 * 60 * 1000;

export interface VacuumResult {
  /** Number of expired entries removed */
  expiredRemoved: number;
  /** Number of entries removed via LRU eviction for quota */
  evictedForQuota: number;
  /** Total entries remaining */
  remaining: number;
  /** Estimated total size in bytes after vacuum */
  totalSizeBytes: number;
  /** Time taken in ms */
  durationMs: number;
}

/**
 * Remove expired entries from IndexedDB and enforce quota limits.
 * Should be called at app startup and periodically.
 *
 * Strategy:
 * 1. Delete all entries where expiresAt > 0 && expiresAt < now
 * 2. Delete all entries older than STALE_CEILING_MS
 * 3. If total size exceeds MAX_CACHE_SIZE_BYTES, evict oldest entries (LRU)
 */
export async function vacuumPersistentCache(): Promise<VacuumResult> {
  const t0 = Date.now();
  const result: VacuumResult = {
    expiredRemoved: 0,
    evictedForQuota: 0,
    remaining: 0,
    totalSizeBytes: 0,
    durationMs: 0,
  };

  if (!isIndexedDbAvailable()) {
    result.durationMs = Date.now() - t0;
    return result;
  }

  try {
    const db = await getCacheDb();
    const now = Date.now();
    const staleCutoff = now - STALE_CEILING_MS;

    // Phase 1: Remove expired entries (using expiresAt index)
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, 'readwrite');
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();

      const store = tx.objectStore(CACHE_STORE);

      // Use expiresAt index if available, otherwise scan all
      if (store.indexNames.contains('by_expiry')) {
        // Get entries with expiresAt between 1 and now (0 means no expiry)
        const range = IDBKeyRange.bound(1, now);
        const cursorReq = store.index('by_expiry').openCursor(range);
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            result.expiredRemoved++;
            cursor.delete();
            cursor.continue();
          }
        };
      }
    });

    // Phase 2: Remove entries past stale ceiling
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, 'readwrite');
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();

      const store = tx.objectStore(CACHE_STORE);
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        const entry = cursor.value as CacheEnvelope<unknown>;
        if (entry.updatedAt < staleCutoff) {
          result.expiredRemoved++;
          cursor.delete();
        }
        cursor.continue();
      };
    });

    // Phase 3: Quota enforcement — collect all entries, sort by updatedAt, evict oldest
    const allEntries = await new Promise<CacheEnvelope<unknown>[]>((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, 'readonly');
      const store = tx.objectStore(CACHE_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result ?? []) as CacheEnvelope<unknown>[]);
      req.onerror = () => reject(req.error);
    });

    let totalSize = 0;
    for (const entry of allEntries) {
      totalSize += entry.sizeBytes ?? 0;
    }

    if (totalSize > MAX_CACHE_SIZE_BYTES) {
      // Sort oldest first for LRU eviction
      const sorted = [...allEntries].sort((a, b) => a.updatedAt - b.updatedAt);
      const keysToEvict: string[] = [];

      while (totalSize > MAX_CACHE_SIZE_BYTES * 0.8 && sorted.length > 0) {
        const oldest = sorted.shift()!;
        totalSize -= oldest.sizeBytes ?? 0;
        keysToEvict.push(oldest.key);
      }

      if (keysToEvict.length > 0) {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(CACHE_STORE, 'readwrite');
          tx.onerror = () => reject(tx.error);
          tx.oncomplete = () => resolve();
          const store = tx.objectStore(CACHE_STORE);
          for (const key of keysToEvict) {
            store.delete(key);
            result.evictedForQuota++;
          }
        });
      }
    }

    result.remaining = allEntries.length - result.expiredRemoved - result.evictedForQuota;
    result.totalSizeBytes = totalSize;
  } catch (err) {
    console.warn('[persistent-cache] Vacuum failed:', err);
  }

  result.durationMs = Date.now() - t0;
  return result;
}

/**
 * Get an estimate of the current cache size and entry count.
 */
export async function getCacheStats(): Promise<{ entryCount: number; totalSizeBytes: number }> {
  if (!isIndexedDbAvailable()) {
    return { entryCount: 0, totalSizeBytes: 0 };
  }

  try {
    const db = await getCacheDb();
    const entries = await new Promise<CacheEnvelope<unknown>[]>((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, 'readonly');
      const store = tx.objectStore(CACHE_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result ?? []) as CacheEnvelope<unknown>[]);
      req.onerror = () => reject(req.error);
    });

    let totalSize = 0;
    for (const entry of entries) {
      totalSize += entry.sizeBytes ?? 0;
    }

    return { entryCount: entries.length, totalSizeBytes: totalSize };
  } catch {
    return { entryCount: 0, totalSizeBytes: 0 };
  }
}

/**
 * Check if a cached entry's TTL has expired.
 * Returns true if the entry should be refreshed.
 * Entries without TTL metadata are never considered expired by this check.
 */
export function isCacheEntryExpired<T>(entry: CacheEnvelope<T> | null): boolean {
  if (!entry) return true;
  if (!entry.expiresAt || entry.expiresAt <= 0) return false;
  return Date.now() >= entry.expiresAt;
}

// ── Auto-vacuum scheduling ───────────────────────────────────────────────────

const VACUUM_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
let vacuumTimer: ReturnType<typeof setInterval> | null = null;

export function startAutoVacuum(): void {
  if (vacuumTimer) return;
  vacuumTimer = setInterval(() => {
    void vacuumPersistentCache().catch(() => {});
  }, VACUUM_INTERVAL);
}

export function stopAutoVacuum(): void {
  if (vacuumTimer) {
    clearInterval(vacuumTimer);
    vacuumTimer = null;
  }
}

// Start auto-vacuum on module load
startAutoVacuum();
