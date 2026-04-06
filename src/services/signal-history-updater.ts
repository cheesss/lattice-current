/**
 * signal-history-updater.ts — Bridge between real-time data fetchers and signal_history table.
 *
 * When the app fetches new VIX, FRED data, or GDELT tensions, this module
 * pushes the values to NAS PostgreSQL signal_history so the adaptive-params
 * pipeline can consume them downstream.
 *
 * Uses the same lazy pg.Pool singleton pattern as article-ingestor.ts.
 * NAS PostgreSQL: 192.168.0.76:5433, DB: lattice
 */

import pg from 'pg';

// ---------------------------------------------------------------------------
// Pool management (lazy singleton, same pattern as article-ingestor.ts)
// ---------------------------------------------------------------------------

let pool: pg.Pool | null = null;
let poolCacheKey = '';
let consecutiveFailures = 0;
let disabledUntil = 0;
let lastPoolError = '';
const CIRCUIT_BREAKER_FAILS = Math.max(1, Number(process.env.SIGNAL_HISTORY_POOL_CIRCUIT_FAILS || 3));
const CIRCUIT_BREAKER_OPEN_MS = Math.max(60_000, Number(process.env.SIGNAL_HISTORY_POOL_CIRCUIT_OPEN_MS || (5 * 60 * 1000)));

function resolveNasPgConfig(): pg.PoolConfig {
  const env = (keys: string[], fallback: string): string => {
    for (const k of keys) {
      const v = String(process.env[k] || '').trim();
      if (v) return v;
    }
    return fallback;
  };

  const host = env(['INTEL_PG_HOST', 'NAS_PG_HOST', 'PG_HOST'], '192.168.0.76');
  const portRaw = Number(env(['INTEL_PG_PORT', 'NAS_PG_PORT', 'PG_PORT'], '5433'));
  const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 5433;
  const database = env(['INTEL_PG_DATABASE', 'NAS_PG_DATABASE', 'PG_DATABASE', 'PGDATABASE'], 'lattice');
  const user = env(['INTEL_PG_USER', 'NAS_PG_USER', 'PG_USER', 'PGUSER'], 'postgres');
  const password = env(['INTEL_PG_PASSWORD', 'NAS_PG_PASSWORD', 'PG_PASSWORD', 'PGPASSWORD'], '');

  return {
    host,
    port,
    database,
    user,
    password: password || undefined,
    max: 4,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
  };
}

function recordPoolFailure(error: unknown): void {
  consecutiveFailures += 1;
  lastPoolError = String((error as Error)?.message || error || 'pool failure');
  if (consecutiveFailures >= CIRCUIT_BREAKER_FAILS) {
    disabledUntil = Date.now() + CIRCUIT_BREAKER_OPEN_MS;
    console.warn(`[signal-history-updater] pool circuit open for ${Math.round(CIRCUIT_BREAKER_OPEN_MS / 1000)}s: ${lastPoolError}`);
    if (pool) {
      void pool.end().catch(() => { /* ignore */ });
      pool = null;
      poolCacheKey = '';
    }
  }
}

function recordPoolSuccess(): void {
  consecutiveFailures = 0;
  disabledUntil = 0;
  lastPoolError = '';
}

function getPool(): pg.Pool | null {
  if (Date.now() < disabledUntil) return null;
  const config = resolveNasPgConfig();
  const key = JSON.stringify({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
  });

  if (pool && poolCacheKey === key) return pool;

  if (pool) {
    void pool.end().catch(() => { /* ignore */ });
  }

  pool = new pg.Pool(config);
  pool.on('error', (err) => recordPoolFailure(err));
  poolCacheKey = key;
  return pool;
}

export async function closeSignalHistoryUpdaterPool(): Promise<void> {
  if (!pool) return;
  const ref = pool;
  pool = null;
  poolCacheKey = '';
  await ref.end().catch(() => { /* ignore */ });
}

export function getSignalHistoryUpdaterCircuitState(): { consecutiveFailures: number; disabledUntil: number; lastError: string } {
  return {
    consecutiveFailures,
    disabledUntil,
    lastError: lastPoolError,
  };
}

// ---------------------------------------------------------------------------
// Symbol-to-signal mapping
// ---------------------------------------------------------------------------

const SYMBOL_TO_SIGNAL: Record<string, string> = {
  // Market volatility
  '^VIX': 'vix',
  'VIXCLS': 'vix',
  // Rates & spreads
  'T10Y2Y': 'yieldSpread',
  'DGS10': 'treasury10y',
  'FEDFUNDS': 'fedFundsRate',
  'TEDRATE': 'tedSpread',
  // Credit stress
  'BAMLH0A0HYM2': 'hy_credit_spread',
  'BAMLC0A0CM': 'ig_credit_spread',
  // Macro
  'DTWEXBGS': 'dollarIndex',
  'DCOILWTICO': 'oilPrice',
  'NAPM': 'pmiManufacturing',
  'UNRATE': 'unemployment',
  'CPIAUCSL': 'cpiIndex',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function toISOTimestamp(ts?: string): string {
  if (ts != null && ts.length > 0) {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// 1. pushSignalFromMarketData
// ---------------------------------------------------------------------------

/**
 * Push a market data signal to signal_history.
 *
 * Maps known symbols (^VIX, VIXCLS, T10Y2Y, BAMLH0A0HYM2, DTWEXBGS,
 * DCOILWTICO) to their canonical signal names. Unknown symbols are ignored.
 *
 * ON CONFLICT DO NOTHING — duplicate (signal_name, ts) rows are silently
 * skipped.
 */
export async function pushSignalFromMarketData(
  symbol: string,
  price: number,
  timestamp?: string,
): Promise<void> {
  const signalName = SYMBOL_TO_SIGNAL[symbol];
  if (signalName == null) return;           // unknown symbol — nothing to do
  if (!Number.isFinite(price)) return;

  const ts = toISOTimestamp(timestamp);

  try {
    const db = getPool();
    if (!db) return;
    await db.query({
      text: `INSERT INTO signal_history (signal_name, ts, value)
             VALUES ($1, $2, $3)
             ON CONFLICT (signal_name, ts) DO NOTHING`,
      values: [signalName, ts, price],
    });
    recordPoolSuccess();
  } catch (err: unknown) {
    recordPoolFailure(err);
    console.error('[signal-history-updater] pushSignalFromMarketData failed:', err);
  }
}

// ---------------------------------------------------------------------------
// 2. pushGdeltStress
// ---------------------------------------------------------------------------

/**
 * Derive three stress signals from GDELT daily aggregation and push them to
 * signal_history.
 *
 *   marketStress         = clamp((-goldstein + 5) / 10, 0, 1)
 *   transmissionStrength = clamp(|tone| / 10, 0, 1)
 *   eventIntensity       = clamp(ln(1 + count) / 10, 0, 1)
 */
export async function pushGdeltStress(
  goldstein: number,
  tone: number,
  eventCount: number,
  date?: string,
): Promise<void> {
  if (!Number.isFinite(goldstein) || !Number.isFinite(tone) || !Number.isFinite(eventCount)) {
    return;
  }

  const ts = toISOTimestamp(date);
  const marketStress = clamp((-goldstein + 5) / 10, 0, 1);
  const transmissionStrength = clamp(Math.abs(tone) / 10, 0, 1);
  const eventIntensity = clamp(Math.log(1 + eventCount) / 10, 0, 1);

  const signals: Array<{ name: string; value: number }> = [
    { name: 'marketStress', value: marketStress },
    { name: 'transmissionStrength', value: transmissionStrength },
    { name: 'eventIntensity', value: eventIntensity },
  ];

  try {
    const db = getPool();
    if (!db) return;
    // Use a single client for the batch to avoid pool churn
    const client = await db.connect();
    try {
      for (const s of signals) {
        await client.query({
          text: `INSERT INTO signal_history (signal_name, ts, value)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (signal_name, ts) DO NOTHING`,
          values: [s.name, ts, s.value],
        });
      }
      recordPoolSuccess();
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    recordPoolFailure(err);
    console.error('[signal-history-updater] pushGdeltStress failed:', err);
  }
}

// ---------------------------------------------------------------------------
// 3. pushSignal (generic)
// ---------------------------------------------------------------------------

/**
 * Generic signal push — insert an arbitrary signal into signal_history.
 * ON CONFLICT DO NOTHING.
 */
export async function pushSignal(
  name: string,
  value: number,
  timestamp?: string,
): Promise<void> {
  if (!name || !Number.isFinite(value)) return;

  const ts = toISOTimestamp(timestamp);

  try {
    const db = getPool();
    if (!db) return;
    await db.query({
      text: `INSERT INTO signal_history (signal_name, ts, value)
             VALUES ($1, $2, $3)
             ON CONFLICT (signal_name, ts) DO NOTHING`,
      values: [name, ts, value],
    });
    recordPoolSuccess();
  } catch (err: unknown) {
    recordPoolFailure(err);
    console.error('[signal-history-updater] pushSignal failed:', err);
  }
}

// ---------------------------------------------------------------------------
// 4. getLatestSignals
// ---------------------------------------------------------------------------

/**
 * Retrieve the most recent value for every signal in signal_history.
 * Uses DISTINCT ON (signal_name) ORDER BY ts DESC to get one row per signal.
 */
export async function getLatestSignals(): Promise<Record<string, { value: number; ts: string }>> {
  const result: Record<string, { value: number; ts: string }> = {};

  try {
    const db = getPool();
    if (!db) return result;
    const { rows } = await db.query<{ signal_name: string; ts: string; value: number }>({
      text: `SELECT DISTINCT ON (signal_name) signal_name, ts, value
             FROM signal_history
             ORDER BY signal_name, ts DESC`,
    });
    recordPoolSuccess();

    for (const row of rows) {
      const name = String(row.signal_name);
      result[name] = {
        value: Number(row.value),
        ts: typeof row.ts === 'string' ? row.ts : new Date(row.ts as unknown as number).toISOString(),
      };
    }
  } catch (err: unknown) {
    recordPoolFailure(err);
    console.error('[signal-history-updater] getLatestSignals failed:', err);
  }

  return result;
}
