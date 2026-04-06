/**
 * Execution Context — Phase 3
 *
 * Provides isolated execution environments for live, replay, backtest,
 * and evaluation modes. Each context carries its own state store and
 * temporal boundary to prevent look-ahead bias.
 */

import type { StateStore } from './state/types';
import { InMemoryStateStore } from './state/in-memory-state-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExecutionMode = 'live' | 'replay' | 'backtest' | 'evaluation';

export interface ExecutionContextConfig {
  mode: ExecutionMode;
  stateStore: StateStore;
  knowledgeBoundary: Date;
  allowedDataSources: string[];
  randomSeed?: number;
}

export interface BacktestConfig {
  startDate: Date;
  endDate: Date;
  allowedDataSources?: string[];
  randomSeed?: number;
}

export interface ReplayConfig {
  startDate: Date;
  endDate: Date;
  allowedDataSources?: string[];
}

// ---------------------------------------------------------------------------
// ExecutionContext class
// ---------------------------------------------------------------------------

export class ExecutionContext {
  readonly mode: ExecutionMode;
  readonly stateStore: StateStore;
  readonly allowedDataSources: readonly string[];
  readonly randomSeed: number | undefined;

  private _knowledgeBoundary: Date;
  private _frozen: boolean = false;

  constructor(config: ExecutionContextConfig) {
    this.mode = config.mode;
    this.stateStore = config.stateStore;
    this._knowledgeBoundary = new Date(config.knowledgeBoundary.getTime());
    this.allowedDataSources = Object.freeze([...config.allowedDataSources]);
    this.randomSeed = config.randomSeed;
  }

  get knowledgeBoundary(): Date {
    return new Date(this._knowledgeBoundary.getTime());
  }

  /** Advance the knowledge boundary (only forward, never backward, silently ignored when frozen). */
  advanceKnowledgeBoundary(newBoundary: Date): void {
    if (this._frozen) {
      return;
    }
    if (newBoundary.getTime() < this._knowledgeBoundary.getTime()) {
      throw new Error(
        `Cannot move knowledge boundary backward: ` +
        `current=${this._knowledgeBoundary.toISOString()}, ` +
        `requested=${newBoundary.toISOString()}`
      );
    }
    this._knowledgeBoundary = new Date(newBoundary.getTime());
  }

  /** Check if a data timestamp is accessible under current boundary. */
  isAccessible(dataTimestamp: Date): boolean {
    return dataTimestamp.getTime() <= this._knowledgeBoundary.getTime();
  }

  /** Check if a data source is allowed in this context. */
  isDataSourceAllowed(source: string): boolean {
    if (this.allowedDataSources.length === 0) return true; // empty = all allowed
    return this.allowedDataSources.includes(source);
  }

  /** Whether this is a live (non-isolated) context. */
  get isLive(): boolean {
    return this.mode === 'live';
  }

  /** Whether this context isolates state (backtest/replay/evaluation). */
  get isIsolated(): boolean {
    return this.mode !== 'live';
  }

  /** Freeze the context to prevent further boundary advances (for test windows). */
  freeze(): void {
    this._frozen = true;
  }

  get isFrozen(): boolean {
    return this._frozen;
  }

  /** Deterministic random based on seed (simple LCG with proper 32-bit math). */
  seededRandom(): number {
    if (this.randomSeed == null) return Math.random();
    // Use Math.imul for correct 32-bit integer multiplication (avoids float precision loss)
    const next = (Math.imul(this.randomSeed, 1664525) + 1013904223) >>> 0;
    (this as { randomSeed: number | undefined }).randomSeed = next;
    return (next >>> 1) / 0x7fffffff;
  }
}

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

/** Default data sources available in live mode. */
const ALL_DATA_SOURCES = ['markets', 'news', 'clusters', 'reports', 'keywordGraph', 'transmission'];

let _liveStateStore: StateStore | null = null;

/** Register the live state store (called once at app startup). */
export function registerLiveStateStore(store: StateStore): void {
  _liveStateStore = store;
}

/** Get the registered live state store. */
export function getLiveStateStore(): StateStore | null {
  return _liveStateStore;
}

/** Create a live execution context with the real state store. */
export function createLiveContext(stateStore?: StateStore): ExecutionContext {
  const store = stateStore ?? _liveStateStore;
  if (!store) {
    throw new Error('No live state store registered. Call registerLiveStateStore() first or pass a store.');
  }
  return new ExecutionContext({
    mode: 'live',
    stateStore: store,
    knowledgeBoundary: new Date(), // live = current time
    allowedDataSources: ALL_DATA_SOURCES,
  });
}

/** Create a replay context with isolated (empty) state. */
export function createReplayContext(config: ReplayConfig): ExecutionContext {
  return new ExecutionContext({
    mode: 'replay',
    stateStore: new InMemoryStateStore('replay'),
    knowledgeBoundary: config.startDate,
    allowedDataSources: config.allowedDataSources ?? ALL_DATA_SOURCES,
  });
}

/** Create a backtest context with isolated (empty) state. */
export function createBacktestContext(config: BacktestConfig): ExecutionContext {
  return new ExecutionContext({
    mode: 'backtest',
    stateStore: new InMemoryStateStore('replay'),
    knowledgeBoundary: config.startDate,
    allowedDataSources: config.allowedDataSources ?? ALL_DATA_SOURCES,
    randomSeed: config.randomSeed,
  });
}

/** Create an evaluation context for walk-forward testing. */
export function createEvaluationContext(config: BacktestConfig): ExecutionContext {
  return new ExecutionContext({
    mode: 'evaluation',
    stateStore: new InMemoryStateStore('replay'),
    knowledgeBoundary: config.startDate,
    allowedDataSources: config.allowedDataSources ?? ALL_DATA_SOURCES,
    randomSeed: config.randomSeed,
  });
}
