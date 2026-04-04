/**
 * signal-history-buffer.ts — Temporal signal history with rolling statistics.
 *
 * Provides a ring-buffer backed by NAS PostgreSQL for tracking signal values
 * over time. Enables multi-window derived features (momentum, z-score)
 * that let the ML ensemble distinguish "short-term spike" from "long-term trend".
 *
 * Usage:
 *   const buf = new SignalHistoryBuffer();
 *   buf.push('vix', 28.5, '2025-03-15T12:00:00Z');
 *   buf.getMomentum('vix', 1, 7);  // 1-day vs 7-day momentum
 *   buf.getZScore('vix', 30);      // 30-day z-score
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SignalHistoryEntry {
  signalName: string;
  ts: number;       // epoch ms
  value: number;
}

export interface RollingStats {
  mean: number;
  std: number;
  min: number;
  max: number;
  latest: number;
  count: number;
}

export interface SignalHistoryReader {
  getWindow(signalName: string, windowDays: number): number[];
  getRollingStats(signalName: string, windowDays: number): RollingStats;
  getMomentum(signalName: string, shortDays: number, longDays: number): number;
  getZScore(signalName: string, windowDays: number): number;
  hasData(signalName: string, minDays?: number): boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_BUFFER_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class SignalHistoryBuffer implements SignalHistoryReader {
  private store = new Map<string, SignalHistoryEntry[]>();

  /**
   * Push a new value into the buffer.
   * Automatically evicts entries older than MAX_BUFFER_DAYS.
   */
  push(signalName: string, value: number, timestamp?: string | number | Date): void {
    if (!Number.isFinite(value)) return;

    const ts = timestamp != null
      ? new Date(timestamp).getTime()
      : Date.now();
    if (!Number.isFinite(ts)) return;

    let arr = this.store.get(signalName);
    if (!arr) {
      arr = [];
      this.store.set(signalName, arr);
    }

    arr.push({ signalName, ts, value });

    // Evict old entries
    const cutoff = Date.now() - MAX_BUFFER_DAYS * DAY_MS;
    while (arr.length > 0 && arr[0]!.ts < cutoff) {
      arr.shift();
    }
  }

  /**
   * Bulk load entries (e.g. from DB at startup).
   * Assumes entries are sorted by ts ascending.
   */
  bulkLoad(signalName: string, entries: { ts: number | string | Date; value: number }[]): void {
    const cutoff = Date.now() - MAX_BUFFER_DAYS * DAY_MS;
    const arr: SignalHistoryEntry[] = [];

    for (const e of entries) {
      const ts = new Date(e.ts).getTime();
      if (!Number.isFinite(ts) || ts < cutoff || !Number.isFinite(e.value)) continue;
      arr.push({ signalName, ts, value: e.value });
    }

    this.store.set(signalName, arr);
  }

  /**
   * Get raw values within a time window (most recent N days).
   */
  getWindow(signalName: string, windowDays: number): number[] {
    const arr = this.store.get(signalName);
    if (!arr || arr.length === 0) return [];

    const cutoff = Date.now() - windowDays * DAY_MS;
    const result: number[] = [];
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i]!.ts < cutoff) break;
      result.push(arr[i]!.value);
    }
    return result.reverse();
  }

  /**
   * Compute rolling statistics over a time window.
   */
  getRollingStats(signalName: string, windowDays: number): RollingStats {
    const values = this.getWindow(signalName, windowDays);
    if (values.length === 0) {
      return { mean: 0, std: 0, min: 0, max: 0, latest: 0, count: 0 };
    }

    const n = values.length;
    let sum = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of values) {
      sum += v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const avg = sum / n;

    let sumSq = 0;
    for (const v of values) {
      sumSq += (v - avg) ** 2;
    }
    const sigma = n > 1 ? Math.sqrt(sumSq / (n - 1)) : 0;

    return {
      mean: avg,
      std: sigma,
      min: lo,
      max: hi,
      latest: values[n - 1]!,
      count: n,
    };
  }

  /**
   * Compute momentum: (shortAvg - longAvg) / |longAvg|.
   * Positive = short-term is higher than long-term (rising).
   * Returns 0 when insufficient data.
   */
  getMomentum(signalName: string, shortDays: number, longDays: number): number {
    const shortStats = this.getRollingStats(signalName, shortDays);
    const longStats = this.getRollingStats(signalName, longDays);

    if (longStats.count < 2 || Math.abs(longStats.mean) < 1e-10) return 0;
    return (shortStats.mean - longStats.mean) / Math.abs(longStats.mean);
  }

  /**
   * Compute z-score of the latest value relative to rolling window.
   * Returns 0 when insufficient data.
   */
  getZScore(signalName: string, windowDays: number): number {
    const stats = this.getRollingStats(signalName, windowDays);
    if (stats.count < 5 || stats.std < 1e-10) return 0;
    return (stats.latest - stats.mean) / stats.std;
  }

  /**
   * Check if a signal has sufficient history for a given window.
   */
  hasData(signalName: string, minDays: number = 7): boolean {
    const arr = this.store.get(signalName);
    if (!arr || arr.length < 2) return false;
    const span = (arr[arr.length - 1]!.ts - arr[0]!.ts) / DAY_MS;
    return span >= minDays;
  }

  /**
   * List all signal names in the buffer.
   */
  signalNames(): string[] {
    return [...this.store.keys()];
  }

  /**
   * Clear all data for a signal (useful for testing).
   */
  clear(signalName?: string): void {
    if (signalName) {
      this.store.delete(signalName);
    } else {
      this.store.clear();
    }
  }
}

// ---------------------------------------------------------------------------
// PostgreSQL persistence helpers
// ---------------------------------------------------------------------------

export const SIGNAL_HISTORY_DDL = `
CREATE TABLE IF NOT EXISTS signal_history (
  signal_name TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (signal_name, ts)
);
CREATE INDEX IF NOT EXISTS idx_signal_history_name_ts
  ON signal_history (signal_name, ts DESC);
`;

export function buildInsertSignalSQL(signalName: string, ts: string, value: number): {
  text: string;
  values: (string | number)[];
} {
  return {
    text: `INSERT INTO signal_history (signal_name, ts, value)
           VALUES ($1, $2, $3)
           ON CONFLICT (signal_name, ts) DO UPDATE SET value = EXCLUDED.value`,
    values: [signalName, ts, value],
  };
}

export function buildLoadSignalSQL(signalName: string, lookbackDays: number = MAX_BUFFER_DAYS): {
  text: string;
  values: (string | number)[];
} {
  return {
    text: `SELECT ts, value FROM signal_history
           WHERE signal_name = $1 AND ts >= NOW() - INTERVAL '1 day' * $2
           ORDER BY ts ASC`,
    values: [signalName, lookbackDays],
  };
}

/**
 * Load all tracked signals from DB into a buffer instance.
 * Call at startup or at the beginning of a backtest.
 */
export async function loadBufferFromPostgres(
  pool: { query: (q: { text: string; values: unknown[] }) => Promise<{ rows: Record<string, unknown>[] }> },
  signals: string[],
  lookbackDays: number = MAX_BUFFER_DAYS,
): Promise<SignalHistoryBuffer> {
  const buffer = new SignalHistoryBuffer();

  for (const signal of signals) {
    const q = buildLoadSignalSQL(signal, lookbackDays);
    const { rows } = await pool.query(q);
    const entries = rows.map(r => ({
      ts: new Date(r.ts as string).getTime(),
      value: Number(r.value),
    }));
    buffer.bulkLoad(signal, entries);
  }

  return buffer;
}

/**
 * Persist a single signal value to DB.
 */
export async function persistSignalValue(
  pool: { query: (q: { text: string; values: unknown[] }) => Promise<unknown> },
  signalName: string,
  value: number,
  ts?: Date,
): Promise<void> {
  const timestamp = (ts ?? new Date()).toISOString();
  await pool.query(buildInsertSignalSQL(signalName, timestamp, value));
}
