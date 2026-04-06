/**
 * Write-Ahead Log — Phase 1
 *
 * In-memory WAL implementation that records state mutations
 * before they are applied, enabling recovery from partial failures.
 *
 * For production, this would be backed by a durable store (file system,
 * IndexedDB, or PostgreSQL). This implementation serves as the
 * reference and is used in development/testing.
 */

import type { WALEntry, WALStore } from './types';

let nextEntryId = 1;

export class InMemoryWALStore implements WALStore {
  private entries: WALEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries = 10_000) {
    this.maxEntries = maxEntries;
  }

  async append(entry: Omit<WALEntry, 'id'>): Promise<number> {
    const id = nextEntryId++;
    this.entries.push({ ...entry, id });

    // Auto-prune if we exceed max entries (keep uncommitted)
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.filter(
        (e) => !e.committed || this.entries.indexOf(e) > this.entries.length - this.maxEntries / 2,
      );
    }

    return id;
  }

  async commit(id: number): Promise<void> {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) {
      entry.committed = true;
    }
  }

  async getUncommitted(): Promise<WALEntry[]> {
    return this.entries.filter((e) => !e.committed);
  }

  async prune(olderThan: string): Promise<number> {
    const cutoff = new Date(olderThan).getTime();
    const before = this.entries.length;
    this.entries = this.entries.filter(
      (e) => !e.committed || new Date(e.timestamp).getTime() >= cutoff,
    );
    return before - this.entries.length;
  }

  async count(): Promise<number> {
    return this.entries.length;
  }

  /** Get all entries (for testing/debugging). */
  getAll(): WALEntry[] {
    return [...this.entries];
  }
}

// ---------------------------------------------------------------------------
// WAL-Wrapped State Store
// ---------------------------------------------------------------------------

import type { StateStore, StateOperation, StateSnapshot, StateChangeListener } from './types';

/**
 * Wraps any StateStore with WAL protection.
 * Every mutation is logged before being applied.
 * On recovery, uncommitted entries can be rolled back.
 */
export class WALProtectedStateStore implements StateStore {
  private inner: StateStore;
  private wal: WALStore;

  constructor(inner: StateStore, wal: WALStore) {
    this.inner = inner;
    this.wal = wal;
  }

  async get<T>(key: string): Promise<T | null> {
    return this.inner.get<T>(key);
  }

  async set<T>(key: string, value: T): Promise<void> {
    const prev = await this.inner.get(key);
    const walId = await this.wal.append({
      timestamp: new Date().toISOString(),
      key,
      operation: 'set',
      previousValue: prev != null ? JSON.stringify(prev) : null,
      newValue: JSON.stringify(value),
      committed: false,
    });

    await this.inner.set(key, value);
    await this.wal.commit(walId);
  }

  async update<T>(key: string, updater: (prev: T | null) => T): Promise<T> {
    const prev = await this.inner.get<T>(key);
    const next = updater(prev);

    const walId = await this.wal.append({
      timestamp: new Date().toISOString(),
      key,
      operation: 'update',
      previousValue: prev != null ? JSON.stringify(prev) : null,
      newValue: JSON.stringify(next),
      committed: false,
    });

    await this.inner.set(key, next);
    await this.wal.commit(walId);
    return next;
  }

  async delete(key: string): Promise<void> {
    const prev = await this.inner.get(key);
    const walId = await this.wal.append({
      timestamp: new Date().toISOString(),
      key,
      operation: 'delete',
      previousValue: prev != null ? JSON.stringify(prev) : null,
      newValue: null,
      committed: false,
    });

    await this.inner.delete(key);
    await this.wal.commit(walId);
  }

  async transaction(ops: StateOperation[]): Promise<void> {
    // Log all operations first
    const walIds: number[] = [];
    for (const op of ops) {
      const prev = await this.inner.get(op.key);
      const walId = await this.wal.append({
        timestamp: new Date().toISOString(),
        key: op.key,
        operation: op.type === 'set' ? 'set' : 'delete',
        previousValue: prev != null ? JSON.stringify(prev) : null,
        newValue: op.type === 'set' ? JSON.stringify(op.value) : null,
        committed: false,
      });
      walIds.push(walId);
    }

    // Apply all operations
    await this.inner.transaction(ops);

    // Commit all WAL entries
    for (const walId of walIds) {
      await this.wal.commit(walId);
    }
  }

  subscribe(key: string, listener: StateChangeListener): () => void {
    return this.inner.subscribe(key, listener);
  }

  async snapshot(): Promise<StateSnapshot> {
    return this.inner.snapshot();
  }

  async restore(snapshot: StateSnapshot): Promise<void> {
    return this.inner.restore(snapshot);
  }

  async keys(): Promise<string[]> {
    return this.inner.keys();
  }

  async clear(): Promise<void> {
    return this.inner.clear();
  }

  /**
   * Recovery: roll back any uncommitted operations.
   * Call this on startup to restore consistency.
   */
  async recover(): Promise<number> {
    const uncommitted = await this.wal.getUncommitted();
    let recovered = 0;

    // Process in reverse order (most recent first)
    for (let i = uncommitted.length - 1; i >= 0; i--) {
      const entry = uncommitted[i]!;

      if (entry.operation === 'delete' && entry.previousValue != null) {
        // Restore the deleted value
        await this.inner.set(entry.key, JSON.parse(entry.previousValue));
        recovered++;
      } else if (
        (entry.operation === 'set' || entry.operation === 'update') &&
        entry.previousValue != null
      ) {
        // Restore the previous value
        await this.inner.set(entry.key, JSON.parse(entry.previousValue));
        recovered++;
      } else if (
        (entry.operation === 'set' || entry.operation === 'update') &&
        entry.previousValue == null
      ) {
        // Key didn't exist before — delete it
        await this.inner.delete(entry.key);
        recovered++;
      }

      // Mark as committed (recovered)
      await this.wal.commit(entry.id);
    }

    return recovered;
  }
}
