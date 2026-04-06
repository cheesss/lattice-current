/**
 * Temporal Barrier — Phase 3
 *
 * Enforces point-in-time data access to prevent look-ahead bias.
 * All data access in replay/backtest contexts must pass through
 * the barrier to ensure no future information leaks into past frames.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TemporalViolation {
  timestamp: string;
  dataTimestamp: string;
  boundary: string;
  source: string;
  severity: 'warning' | 'error';
}

export interface TemporalBarrierStats {
  totalChecks: number;
  violations: number;
  lastViolation: TemporalViolation | null;
  lastAdvancedAt: string | null;
}

export type ViolationHandler = (violation: TemporalViolation) => void;

// ---------------------------------------------------------------------------
// TemporalBarrier
// ---------------------------------------------------------------------------

export class TemporalBarrier {
  private _boundary: Date;
  private _stats: TemporalBarrierStats;
  private _violations: TemporalViolation[] = [];
  private _maxViolationLog: number;
  private _strict: boolean;
  private _handlers: ViolationHandler[] = [];

  /**
   * @param boundary Initial knowledge boundary.
   * @param options.strict If true, validateAccess throws on violation instead of returning false.
   * @param options.maxViolationLog Max violations to store in memory (default 200).
   */
  constructor(
    boundary: Date,
    options: { strict?: boolean; maxViolationLog?: number } = {},
  ) {
    this._boundary = new Date(boundary.getTime());
    this._strict = options.strict ?? false;
    this._maxViolationLog = options.maxViolationLog ?? 200;
    this._stats = {
      totalChecks: 0,
      violations: 0,
      lastViolation: null,
      lastAdvancedAt: null,
    };
  }

  /** Current knowledge boundary. */
  get boundary(): Date {
    return new Date(this._boundary.getTime());
  }

  /** Read-only statistics. */
  get stats(): Readonly<TemporalBarrierStats> {
    return { ...this._stats };
  }

  /** All recorded violations. */
  get violations(): readonly TemporalViolation[] {
    return this._violations;
  }

  /** Register a handler called on each violation. */
  onViolation(handler: ViolationHandler): () => void {
    this._handlers.push(handler);
    return () => {
      const idx = this._handlers.indexOf(handler);
      if (idx >= 0) this._handlers.splice(idx, 1);
    };
  }

  /**
   * Validate whether data at the given timestamp is accessible.
   *
   * @param dataTimestamp Timestamp of the data being accessed.
   * @param source Description of the data source (for diagnostics).
   * @returns true if access is allowed, false if it would be look-ahead.
   * @throws Error in strict mode when a violation is detected.
   */
  validateAccess(dataTimestamp: Date | string, source: string = 'unknown'): boolean {
    this._stats.totalChecks++;

    const ts = typeof dataTimestamp === 'string' ? new Date(dataTimestamp) : dataTimestamp;
    if (ts.getTime() <= this._boundary.getTime()) {
      return true;
    }

    // Violation detected
    const violation: TemporalViolation = {
      timestamp: new Date().toISOString(),
      dataTimestamp: ts.toISOString(),
      boundary: this._boundary.toISOString(),
      source,
      severity: this._strict ? 'error' : 'warning',
    };

    this._stats.violations++;
    this._stats.lastViolation = violation;

    if (this._violations.length < this._maxViolationLog) {
      this._violations.push(violation);
    }

    for (const handler of this._handlers) {
      try {
        handler(violation);
      } catch {
        // swallow handler errors
      }
    }

    if (this._strict) {
      throw new TemporalViolationError(violation);
    }

    return false;
  }

  /**
   * Advance the temporal boundary forward.
   * The boundary can only move forward, never backward.
   *
   * @param newBoundary The new boundary timestamp.
   * @throws Error if newBoundary is before the current boundary.
   */
  advanceTo(newBoundary: Date | string): void {
    const ts = typeof newBoundary === 'string' ? new Date(newBoundary) : newBoundary;
    if (ts.getTime() < this._boundary.getTime()) {
      throw new Error(
        `TemporalBarrier: Cannot move boundary backward. ` +
        `Current=${this._boundary.toISOString()}, Requested=${ts.toISOString()}`
      );
    }
    this._boundary = new Date(ts.getTime());
    this._stats.lastAdvancedAt = ts.toISOString();
  }

  /** Reset the barrier for reuse (clears violations and stats). */
  reset(newBoundary: Date): void {
    this._boundary = new Date(newBoundary.getTime());
    this._violations = [];
    this._stats = {
      totalChecks: 0,
      violations: 0,
      lastViolation: null,
      lastAdvancedAt: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class TemporalViolationError extends Error {
  readonly violation: TemporalViolation;

  constructor(violation: TemporalViolation) {
    super(
      `TemporalBarrier violation: data at ${violation.dataTimestamp} ` +
      `exceeds boundary ${violation.boundary} (source: ${violation.source})`
    );
    this.name = 'TemporalViolationError';
    this.violation = violation;
  }
}

// ---------------------------------------------------------------------------
// Helper: Filter data arrays through temporal barrier
// ---------------------------------------------------------------------------

/** Filter an array of timestamped items through the barrier. */
export function filterByBarrier<T extends { timestamp?: string }>(
  items: T[],
  barrier: TemporalBarrier,
  source: string,
): T[] {
  return items.filter((item: T) => {
    if (!item.timestamp) return true; // items without timestamps pass through
    return barrier.validateAccess(item.timestamp, source);
  });
}

/** Filter market data through the barrier. */
export function filterMarketsByBarrier<T extends { timestamp?: string; symbol?: string }>(
  markets: T[],
  barrier: TemporalBarrier,
): T[] {
  return markets.filter((market: T) => {
    if (!market.timestamp) return true;
    return barrier.validateAccess(market.timestamp, `market:${market.symbol ?? 'unknown'}`);
  });
}

/**
 * Create a "no-op" barrier that allows all access (for live mode).
 * This avoids needing null checks throughout the codebase.
 */
export function createPassthroughBarrier(): TemporalBarrier {
  return new TemporalBarrier(new Date('9999-12-31T23:59:59.999Z'));
}
