import pg from 'pg';
import { createLogger, type StructuredLogger } from './logger.ts';

export interface ManagedPgPoolOptions {
  name: string;
  max?: number;
  idleTimeoutMillis?: number;
  allowExitOnIdle?: boolean;
  maxFailures?: number;
  cooldownMs?: number;
  logger?: StructuredLogger;
}

export interface ManagedPgPoolState {
  consecutiveFailures: number;
  disabledUntil: number;
  lastError: string;
}

export interface ManagedPgPool {
  getPool(): pg.Pool | null;
  close(): Promise<void>;
  getCircuitState(): ManagedPgPoolState;
  recordFailure(error: unknown): void;
  recordSuccess(): void;
}

function resolveEnv(keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return fallback;
}

export function resolveNasPgConfig(overrides: Partial<pg.PoolConfig> = {}): pg.PoolConfig {
  // Local-first override for the `docker compose` demo. DATABASE_URL is normalized
  // into discrete fields (keeping host/port/database/user populated for the pool
  // cache key) and mirrors scripts/_shared/nas-runtime.mjs. NAS behavior is
  // unchanged when DATABASE_URL and LATTICE_PG_* are unset.
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (databaseUrl && !overrides.host && !overrides.connectionString) {
    try {
      const parsed = new URL(databaseUrl);
      return {
        host: parsed.hostname || '127.0.0.1',
        port: parsed.port ? Number(parsed.port) : 5432,
        database: parsed.pathname ? decodeURIComponent(parsed.pathname.replace(/^\//, '')) : 'lattice',
        user: parsed.username ? decodeURIComponent(parsed.username) : 'postgres',
        password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
        max: 4,
        idleTimeoutMillis: 30_000,
        allowExitOnIdle: true,
        ...overrides,
      };
    } catch {
      // Unparseable URL: fall through to discrete-env resolution below.
    }
  }

  const host = resolveEnv(['LATTICE_PG_HOST', 'INTEL_PG_HOST', 'NAS_PG_HOST', 'PG_HOST'], '192.168.0.2');
  const portRaw = Number(resolveEnv(['LATTICE_PG_PORT', 'INTEL_PG_PORT', 'NAS_PG_PORT', 'PG_PORT'], '5433'));
  const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 5433;
  const database = resolveEnv(['LATTICE_PG_DATABASE', 'INTEL_PG_DATABASE', 'NAS_PG_DATABASE', 'PG_DATABASE', 'PGDATABASE'], 'lattice');
  const user = resolveEnv(['LATTICE_PG_USER', 'INTEL_PG_USER', 'NAS_PG_USER', 'PG_USER', 'PGUSER'], 'postgres');
  const password = resolveEnv(['LATTICE_PG_PASSWORD', 'INTEL_PG_PASSWORD', 'NAS_PG_PASSWORD', 'PG_PASSWORD', 'PGPASSWORD'], '');

  return {
    host,
    port,
    database,
    user,
    password: password || undefined,
    max: 4,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
    ...overrides,
  };
}

export function createManagedPgPool(options: ManagedPgPoolOptions): ManagedPgPool {
  const logger = options.logger ?? createLogger(options.name);
  const maxFailures = Math.max(1, Number(options.maxFailures ?? 3));
  const cooldownMs = Math.max(60_000, Number(options.cooldownMs ?? (5 * 60 * 1000)));

  let pool: pg.Pool | null = null;
  let poolCacheKey = '';
  let consecutiveFailures = 0;
  let disabledUntil = 0;
  let lastError = '';

  function recordFailure(error: unknown): void {
    consecutiveFailures += 1;
    lastError = String((error as Error)?.message || error || 'pool failure');
    if (consecutiveFailures >= maxFailures) {
      disabledUntil = Date.now() + cooldownMs;
      logger.warn('pool circuit open', {
        consecutiveFailures,
        cooldownMs,
        error: lastError,
      });
      if (pool) {
        void pool.end().catch(() => {});
        pool = null;
        poolCacheKey = '';
      }
    }
  }

  function recordSuccess(): void {
    consecutiveFailures = 0;
    disabledUntil = 0;
    lastError = '';
  }

  function getPool(): pg.Pool | null {
    if (Date.now() < disabledUntil) return null;

    const config = resolveNasPgConfig({
      max: options.max ?? 4,
      idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
      allowExitOnIdle: options.allowExitOnIdle ?? true,
    });
    const key = JSON.stringify({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      max: config.max,
    });

    if (pool && poolCacheKey === key) return pool;

    if (pool) {
      void pool.end().catch(() => {});
    }

    pool = new pg.Pool(config);
    pool.on('error', (error) => recordFailure(error));
    poolCacheKey = key;
    return pool;
  }

  async function close(): Promise<void> {
    if (!pool) return;
    const current = pool;
    pool = null;
    poolCacheKey = '';
    await current.end().catch(() => {});
  }

  function getCircuitState(): ManagedPgPoolState {
    return {
      consecutiveFailures,
      disabledUntil,
      lastError,
    };
  }

  return {
    getPool,
    close,
    getCircuitState,
    recordFailure,
    recordSuccess,
  };
}
