import { isDesktopRuntime } from './runtime';
import { invokeTauri } from './tauri-bridge';
import { isStorageQuotaExceeded, isQuotaError, markStorageQuotaExceeded } from '@/utils';

type CacheEnvelope<T> = {
  key: string;
  updatedAt: number;
  data: T;
};

const CACHE_PREFIX = 'worldmonitor-persistent-cache:';
const CACHE_DB_NAME = 'worldmonitor_persistent_cache';
const CACHE_DB_VERSION = 1;
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

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
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

export async function setPersistentCache<T>(key: string, data: T): Promise<void> {
  const payload: CacheEnvelope<T> = { key, data, updatedAt: Date.now() };

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
