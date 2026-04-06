/**
 * State Management Types — Phase 1
 *
 * Defines the interfaces for the state store abstraction,
 * write-ahead log, and state events.
 */

// ---------------------------------------------------------------------------
// State Store Interface
// ---------------------------------------------------------------------------

export interface StateStore {
  /** Retrieve a value by key. Returns null if not found or expired. */
  get<T>(key: string): Promise<T | null>;

  /** Set a value by key. Overwrites any existing value. */
  set<T>(key: string, value: T): Promise<void>;

  /**
   * Atomically read-modify-write a key.
   * The updater receives the current value (or null) and returns the new value.
   */
  update<T>(key: string, updater: (prev: T | null) => T): Promise<T>;

  /**
   * Execute multiple set operations atomically.
   * Either all succeed or none are applied.
   */
  transaction(ops: StateOperation[]): Promise<void>;

  /** Subscribe to changes on a key. Returns an unsubscribe function. */
  subscribe(key: string, listener: StateChangeListener): () => void;

  /** Take an atomic snapshot of all state. */
  snapshot(): Promise<StateSnapshot>;

  /** Restore state from a previously taken snapshot. */
  restore(snapshot: StateSnapshot): Promise<void>;

  /** List all keys currently in the store. */
  keys(): Promise<string[]>;

  /** Delete a key. */
  delete(key: string): Promise<void>;

  /** Clear all state. */
  clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// State Operations
// ---------------------------------------------------------------------------

export interface StateSetOperation {
  type: 'set';
  key: string;
  value: unknown;
}

export interface StateDeleteOperation {
  type: 'delete';
  key: string;
}

export type StateOperation = StateSetOperation | StateDeleteOperation;

// ---------------------------------------------------------------------------
// State Snapshots
// ---------------------------------------------------------------------------

export interface StateSnapshot {
  id: string;
  timestamp: string;
  entries: Map<string, unknown>;
  version: number;
}

// ---------------------------------------------------------------------------
// State Change Events
// ---------------------------------------------------------------------------

export interface StateChangeEvent {
  key: string;
  previousValue: unknown | null;
  newValue: unknown | null;
  timestamp: string;
  source: StateChangeSource;
}

export type StateChangeSource = 'live' | 'replay' | 'restore' | 'migration' | 'manual';

export type StateChangeListener = (event: StateChangeEvent) => void;

// ---------------------------------------------------------------------------
// Write-Ahead Log Types
// ---------------------------------------------------------------------------

export interface WALEntry {
  id: number;
  timestamp: string;
  key: string;
  operation: 'set' | 'update' | 'delete';
  previousValue: string | null; // JSON-serialised
  newValue: string | null; // JSON-serialised
  committed: boolean;
}

export interface WALStore {
  /** Append an entry to the log. Returns the entry ID. */
  append(entry: Omit<WALEntry, 'id'>): Promise<number>;

  /** Mark an entry as committed. */
  commit(id: number): Promise<void>;

  /** Get all uncommitted entries (for recovery). */
  getUncommitted(): Promise<WALEntry[]>;

  /** Remove committed entries older than the given timestamp. */
  prune(olderThan: string): Promise<number>;

  /** Get the total entry count. */
  count(): Promise<number>;
}
