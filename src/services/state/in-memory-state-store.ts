/**
 * In-Memory State Store — Phase 1
 *
 * Reference implementation of StateStore.
 * Used for development, testing, and backtest isolation.
 * All state lives in memory and is lost on process termination.
 */

import type {
  StateStore,
  StateOperation,
  StateSnapshot,
  StateChangeEvent,
  StateChangeSource,
  StateChangeListener,
} from './types';

let nextSnapshotId = 1;

export class InMemoryStateStore implements StateStore {
  private data = new Map<string, unknown>();
  private listeners = new Map<string, Set<StateChangeListener>>();
  private globalListeners = new Set<StateChangeListener>();
  private version = 0;
  private source: StateChangeSource;

  constructor(source: StateChangeSource = 'live') {
    this.source = source;
  }

  // -------------------------------------------------------------------------
  // Core CRUD
  // -------------------------------------------------------------------------

  async get<T>(key: string): Promise<T | null> {
    const value = this.data.get(key);
    if (value === undefined) return null;
    // Return a deep copy to prevent external mutation
    return structuredClone(value) as T;
  }

  async set<T>(key: string, value: T): Promise<void> {
    const prev = this.data.get(key) ?? null;
    const cloned = structuredClone(value);
    this.data.set(key, cloned);
    this.version++;
    this.emit(key, prev, cloned);
  }

  async update<T>(key: string, updater: (prev: T | null) => T): Promise<T> {
    const prev = (this.data.get(key) as T) ?? null;
    const prevClone = prev != null ? structuredClone(prev) : null;
    const next = updater(prevClone);
    const nextClone = structuredClone(next);
    this.data.set(key, nextClone);
    this.version++;
    this.emit(key, prev, nextClone);
    return structuredClone(nextClone) as T;
  }

  async delete(key: string): Promise<void> {
    const prev = this.data.get(key) ?? null;
    this.data.delete(key);
    this.version++;
    this.emit(key, prev, null);
  }

  // -------------------------------------------------------------------------
  // Transaction
  // -------------------------------------------------------------------------

  async transaction(ops: StateOperation[]): Promise<void> {
    // Collect previous values for event emission
    const events: Array<{ key: string; prev: unknown | null; next: unknown | null }> = [];

    for (const op of ops) {
      const prev = this.data.get(op.key) ?? null;
      if (op.type === 'set') {
        const cloned = structuredClone(op.value);
        this.data.set(op.key, cloned);
        events.push({ key: op.key, prev, next: cloned });
      } else if (op.type === 'delete') {
        this.data.delete(op.key);
        events.push({ key: op.key, prev, next: null });
      }
    }

    this.version++;

    for (const e of events) {
      this.emit(e.key, e.prev, e.next);
    }
  }

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  subscribe(key: string, listener: StateChangeListener): () => void {
    if (key === '*') {
      this.globalListeners.add(listener);
      return () => { this.globalListeners.delete(listener); };
    }
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(key);
    };
  }

  // -------------------------------------------------------------------------
  // Snapshot / Restore
  // -------------------------------------------------------------------------

  async snapshot(): Promise<StateSnapshot> {
    return {
      id: `snap-${nextSnapshotId++}`,
      timestamp: new Date().toISOString(),
      entries: structuredClone(this.data),
      version: this.version,
    };
  }

  async restore(snapshot: StateSnapshot): Promise<void> {
    this.data = structuredClone(snapshot.entries);
    this.version = snapshot.version;
    // Emit restore events for all keys
    for (const [key, value] of this.data) {
      this.emit(key, null, value);
    }
  }

  // -------------------------------------------------------------------------
  // Utility
  // -------------------------------------------------------------------------

  async keys(): Promise<string[]> {
    return Array.from(this.data.keys());
  }

  async clear(): Promise<void> {
    const allKeys = Array.from(this.data.keys());
    this.data.clear();
    this.version++;
    for (const key of allKeys) {
      this.emit(key, null, null);
    }
  }

  /** Get the current version counter (for testing). */
  getVersion(): number {
    return this.version;
  }

  /** Get the current entry count (for testing). */
  size(): number {
    return this.data.size;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private emit(key: string, previousValue: unknown | null, newValue: unknown | null): void {
    const event: StateChangeEvent = {
      key,
      previousValue,
      newValue,
      timestamp: new Date().toISOString(),
      source: this.source,
    };

    const keyListeners = this.listeners.get(key);
    if (keyListeners) {
      for (const listener of keyListeners) {
        try { listener(event); } catch { /* swallow listener errors */ }
      }
    }

    for (const listener of this.globalListeners) {
      try { listener(event); } catch { /* swallow */ }
    }
  }
}
