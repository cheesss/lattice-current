/**
 * PersistentCacheStateStoreAdapter — IS-4
 *
 * Bridges the existing PersistentCache (IndexedDB/FS) with the StateStore
 * interface from Phase 1. This allows gradual migration without rewriting
 * the storage backend.
 *
 * Provides:
 * - Transaction safety via snapshot/restore
 * - StateStore-compatible API
 * - Schema migration hook point
 */

import type {
  StateStore,
  StateOperation,
  StateSnapshot,
  StateChangeEvent,
  StateChangeListener,
  StateChangeSource,
} from './types';
import { getPersistentCache, setPersistentCache, deletePersistentCache } from '../persistent-cache';

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class PersistentCacheStateStoreAdapter implements StateStore {
  private _listeners = new Map<string, Set<StateChangeListener>>();
  private _lastSnapshotEntries: Map<string, unknown> | null = null;

  // -----------------------------------------------------------------------
  // Core CRUD
  // -----------------------------------------------------------------------

  async get<T>(key: string): Promise<T | null> {
    const envelope = await getPersistentCache<T>(key);
    if (!envelope) return null;
    return envelope.data ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await setPersistentCache(key, value);
    await this._trackKey(key);
    this._notify(key, 'live');
  }

  async update<T>(key: string, updater: (prev: T | null) => T): Promise<T> {
    const prev = await this.get<T>(key);
    const next = updater(prev);
    await this.set(key, next);
    return next;
  }

  // -----------------------------------------------------------------------
  // Transaction support (best-effort via snapshot/restore)
  // -----------------------------------------------------------------------

  async transaction(ops: StateOperation[]): Promise<void> {
    const snap = await this.snapshot();
    try {
      for (const op of ops) {
        if (op.type === 'set') {
          await setPersistentCache(op.key, op.value);
        } else if (op.type === 'delete') {
          await deletePersistentCache(op.key);
        }
      }
      // Notify after successful commit
      for (const op of ops) {
        this._notify(op.key, 'live');
      }
    } catch (err) {
      // Rollback on failure
      await this.restore(snap);
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // Subscription
  // -----------------------------------------------------------------------

  subscribe(key: string, listener: StateChangeListener): () => void {
    if (!this._listeners.has(key)) {
      this._listeners.set(key, new Set());
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this._listeners.get(key)!.add(listener);
    return () => {
      this._listeners.get(key)?.delete(listener);
    };
  }

  // -----------------------------------------------------------------------
  // Snapshot / Restore
  // -----------------------------------------------------------------------

  async snapshot(): Promise<StateSnapshot> {
    const allKeys = await this.keys();
    const entries = new Map<string, unknown>();
    for (const key of allKeys) {
      entries.set(key, await this.get(key));
    }
    this._lastSnapshotEntries = new Map(entries);
    return {
      id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      entries,
      version: 1,
    };
  }

  async restore(snap: StateSnapshot): Promise<void> {
    const currentKeys = await this.keys();
    const snapKeys = new Set(snap.entries.keys());
    for (const key of currentKeys) {
      if (!snapKeys.has(key)) {
        await deletePersistentCache(key);
      }
    }
    for (const [key, value] of snap.entries) {
      await setPersistentCache(key, value);
    }
    this._lastSnapshotEntries = null;
  }

  /** Check if there's a cached snapshot available for quick rollback. */
  hasSnapshot(): boolean {
    return this._lastSnapshotEntries !== null;
  }

  // -----------------------------------------------------------------------
  // Key management
  // -----------------------------------------------------------------------

  async keys(): Promise<string[]> {
    // PersistentCache doesn't expose a keys() method.
    // We track known keys through a meta-key.
    const meta = await getPersistentCache<string[]>('__state_store_keys__');
    return meta?.data ?? [];
  }

  async delete(key: string): Promise<void> {
    await deletePersistentCache(key);
    await this._untrackKey(key);
    this._notify(key, 'live');
  }

  async clear(): Promise<void> {
    const allKeys = await this.keys();
    for (const key of allKeys) {
      await deletePersistentCache(key);
    }
    await deletePersistentCache('__state_store_keys__');
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private async _trackKey(key: string): Promise<void> {
    if (key === '__state_store_keys__') return;
    const meta = await getPersistentCache<string[]>('__state_store_keys__');
    const keys = meta?.data ?? [];
    if (!keys.includes(key)) {
      keys.push(key);
      await setPersistentCache('__state_store_keys__', keys);
    }
  }

  private async _untrackKey(key: string): Promise<void> {
    if (key === '__state_store_keys__') return;
    const meta = await getPersistentCache<string[]>('__state_store_keys__');
    const keys = meta?.data ?? [];
    const idx = keys.indexOf(key);
    if (idx >= 0) {
      keys.splice(idx, 1);
      await setPersistentCache('__state_store_keys__', keys);
    }
  }

  private _notify(key: string, source: StateChangeSource, previousValue: unknown = null, newValue: unknown = null): void {
    const listeners = this._listeners.get(key);
    if (!listeners) return;
    const event: StateChangeEvent = {
      key,
      previousValue,
      newValue,
      source,
      timestamp: new Date().toISOString(),
    };
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // swallow listener errors
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

let _instance: PersistentCacheStateStoreAdapter | null = null;

export function getStateStoreAdapter(): PersistentCacheStateStoreAdapter {
  if (!_instance) {
    _instance = new PersistentCacheStateStoreAdapter();
  }
  return _instance;
}
