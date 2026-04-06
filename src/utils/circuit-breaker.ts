interface CircuitState {
  failures: number;
  cooldownUntil: number;
  lastError?: string;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export type BreakerDataMode = 'live' | 'cached' | 'unavailable';

export interface BreakerDataState {
  mode: BreakerDataMode;
  timestamp: number | null;
  offline: boolean;
}

export interface CircuitBreakerOptions {
  name: string;
  maxFailures?: number;
  cooldownMs?: number;
  cacheTtlMs?: number;
  /** Persist cache to IndexedDB across page reloads. Default: false.
   *  Opt-in only — cached payloads must be JSON-safe (no Date objects).
   *  Auto-disabled when cacheTtlMs === 0. */
  persistCache?: boolean;
  /** Cache tier for this breaker's data source (Phase 4.3).
   *  Used for TTL extension during cooldown. */
  cacheTier?: import('../config/cache-tiers').CacheTier;
}

const DEFAULT_MAX_FAILURES = 2;
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PERSISTENT_STALE_CEILING_MS = 24 * 60 * 60 * 1000; // 24h — discard persistent entries older than this


function isDesktopOfflineMode(): boolean {
  if (typeof window === 'undefined') return false;
  const hasTauri = Boolean((window as { __TAURI__?: unknown }).__TAURI__);
  return hasTauri && typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Multiplier applied to cache TTL when breaker enters cooldown (Phase 4.3) */
const COOLDOWN_TTL_EXTENSION_MULTIPLIER = 3;

export class CircuitBreaker<T> {
  private state: CircuitState = { failures: 0, cooldownUntil: 0 };
  private cache: CacheEntry<T> | null = null;
  private name: string;
  private maxFailures: number;
  private cooldownMs: number;
  private cacheTtlMs: number;
  private originalCacheTtlMs: number;
  private persistEnabled: boolean;
  private persistentLoaded = false;
  private persistentLoadPromise: Promise<void> | null = null;
  private lastDataState: BreakerDataState = { mode: 'unavailable', timestamp: null, offline: false };
  private backgroundRefreshPromise: Promise<void> | null = null;
  /** Optional recovery callback — called when breaker exits cooldown (Phase 4.3) */
  private recoveryCallbacks: Array<() => void> = [];

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.maxFailures = options.maxFailures ?? DEFAULT_MAX_FAILURES;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.originalCacheTtlMs = this.cacheTtlMs;
    this.persistEnabled = this.cacheTtlMs === 0
      ? false
      : (options.persistCache ?? false);
  }

  private get persistKey(): string {
    return `breaker:${this.name}`;
  }

  /** Hydrate in-memory cache from persistent storage on first call. */
  private hydratePersistentCache(): Promise<void> {
    if (this.persistentLoaded) return Promise.resolve();
    if (this.persistentLoadPromise) return this.persistentLoadPromise;

    this.persistentLoadPromise = (async () => {
      try {
        const { getPersistentCache } = await import('../services/persistent-cache');
        const entry = await getPersistentCache<T>(this.persistKey);
        if (entry == null || entry.data === undefined || entry.data === null) return;

        const age = Date.now() - entry.updatedAt;
        if (age > PERSISTENT_STALE_CEILING_MS) return;

        // Only hydrate if in-memory cache is empty (don't overwrite live data)
        if (this.cache === null) {
          this.cache = { data: entry.data, timestamp: entry.updatedAt };
          const withinTtl = (Date.now() - entry.updatedAt) < this.cacheTtlMs;
          this.lastDataState = {
            mode: withinTtl ? 'cached' : 'unavailable',
            timestamp: entry.updatedAt,
            offline: false,
          };
        }
      } catch (err) {
        console.warn(`[${this.name}] Persistent cache hydration failed:`, err);
      } finally {
        this.persistentLoaded = true;
        this.persistentLoadPromise = null;
      }
    })();

    return this.persistentLoadPromise;
  }

  /** Fire-and-forget write to persistent storage. */
  private writePersistentCache(data: T): void {
    import('../services/persistent-cache').then(({ setPersistentCache }) => {
      setPersistentCache(this.persistKey, data).catch(() => {});
    }).catch(() => {});
  }

  /** Fire-and-forget delete from persistent storage. */
  private deletePersistentCache(): void {
    import('../services/persistent-cache').then(({ deletePersistentCache }) => {
      deletePersistentCache(this.persistKey).catch(() => {});
    }).catch(() => {});
  }

  isOnCooldown(): boolean {
    if (Date.now() < this.state.cooldownUntil) {
      return true;
    }
    if (this.state.cooldownUntil > 0) {
      this.state = { failures: 0, cooldownUntil: 0 };
    }
    return false;
  }

  getCooldownRemaining(): number {
    return Math.max(0, Math.ceil((this.state.cooldownUntil - Date.now()) / 1000));
  }

  getStatus(): string {
    if (this.lastDataState.offline) {
      return this.lastDataState.mode === 'cached'
        ? 'offline mode (serving cached data)'
        : 'offline mode (live API unavailable)';
    }
    if (this.isOnCooldown()) {
      return `temporarily unavailable (retry in ${this.getCooldownRemaining()}s)`;
    }
    return 'ok';
  }

  getDataState(): BreakerDataState {
    return { ...this.lastDataState };
  }

  getCached(): T | null {
    if (this.cache && Date.now() - this.cache.timestamp < this.cacheTtlMs) {
      return this.cache.data;
    }
    return null;
  }

  getCachedOrDefault(defaultValue: T): T {
    return this.cache?.data ?? defaultValue;
  }

  recordSuccess(data: T): void {
    const wasOnCooldown = this.isOnCooldown();
    this.state = { failures: 0, cooldownUntil: 0 };
    this.cache = { data, timestamp: Date.now() };
    this.lastDataState = { mode: 'live', timestamp: Date.now(), offline: false };

    // Phase 4.3: Restore original cache TTL after recovery
    if (wasOnCooldown) {
      this.cacheTtlMs = this.originalCacheTtlMs;
    }

    if (this.persistEnabled) {
      this.writePersistentCache(data);
    }
    // Trigger health check if recovering from cooldown
    if (wasOnCooldown) {
      checkHealthTransition();
      // Phase 4.3: Fire recovery callbacks (fresh data replaces stale cache)
      for (const cb of this.recoveryCallbacks) {
        try { cb(); } catch { /* don't let callback errors cascade */ }
      }
    }
  }

  /**
   * Register a callback to be called when the breaker recovers from cooldown (Phase 4.3).
   * Useful for triggering immediate fresh data fetch after recovery.
   * Returns an unsubscribe function.
   */
  onRecovery(callback: () => void): () => void {
    this.recoveryCallbacks.push(callback);
    return () => {
      const idx = this.recoveryCallbacks.indexOf(callback);
      if (idx >= 0) this.recoveryCallbacks.splice(idx, 1);
    };
  }

  clearCache(): void {
    this.cache = null;
    this.backgroundRefreshPromise = null;
    this.persistentLoadPromise = null; // orphan any in-flight hydration
    if (this.persistEnabled) {
      this.deletePersistentCache();
    }
  }

  recordFailure(error?: string): void {
    this.state.failures++;
    this.state.lastError = error;
    if (this.state.failures >= this.maxFailures) {
      this.state.cooldownUntil = Date.now() + this.cooldownMs;
      // Phase 4.3: Extend cache TTL during cooldown so stale data stays available
      this.cacheTtlMs = this.originalCacheTtlMs * COOLDOWN_TTL_EXTENSION_MULTIPLIER;
      console.warn(`[${this.name}] On cooldown for ${this.cooldownMs / 1000}s after ${this.state.failures} failures (cache TTL extended to ${this.cacheTtlMs / 1000}s)`);
      // Trigger global health check on cooldown entry
      checkHealthTransition();
    }
  }

  async execute<R extends T>(
    fn: () => Promise<R>,
    defaultValue: R
  ): Promise<R> {
    const offline = isDesktopOfflineMode();

    // Hydrate from persistent storage on first call (~1-5ms IndexedDB read)
    if (this.persistEnabled && !this.persistentLoaded) {
      await this.hydratePersistentCache();
    }

    if (this.isOnCooldown()) {
      console.log(`[${this.name}] Currently unavailable, ${this.getCooldownRemaining()}s remaining`);
      const cachedFallback = this.getCached();
      if (cachedFallback !== null) {
        this.lastDataState = { mode: 'cached', timestamp: this.cache?.timestamp ?? null, offline };
        return cachedFallback as R;
      }
      this.lastDataState = { mode: 'unavailable', timestamp: null, offline };
      return this.getCachedOrDefault(defaultValue) as R;
    }

    const cached = this.getCached();
    if (cached !== null) {
      this.lastDataState = { mode: 'cached', timestamp: this.cache?.timestamp ?? null, offline };
      return cached as R;
    }

    // Stale-while-revalidate: if we have stale cached data (outside TTL but
    // within the 24h persistent ceiling), return it instantly and refresh in
    // the background. This prevents "Loading..." on every page reload when
    // the persistent cache is older than the TTL.
    // Skip SWR when cacheTtlMs === 0 (caching disabled) — the breaker may be
    // shared across calls with different request params (e.g. stocks vs commodities),
    // so returning stale data from a different call is wrong.
    if (this.cache !== null && this.cacheTtlMs > 0) {
      this.lastDataState = { mode: 'cached', timestamp: this.cache.timestamp, offline };
      // Fire-and-forget background refresh — guard against concurrent SWR fetches
      // so that multiple callers with stale cache don't each spawn a parallel request.
      if (!this.backgroundRefreshPromise) {
        this.backgroundRefreshPromise = fn().then(result => {
          this.recordSuccess(result);
        }).catch(e => {
          console.warn(`[${this.name}] Background refresh failed:`, e);
          this.recordFailure(String(e));
        }).finally(() => {
          this.backgroundRefreshPromise = null;
        });
      }
      return this.cache.data as R;
    }

    try {
      const result = await fn();
      this.recordSuccess(result);
      return result;
    } catch (e) {
      const msg = String(e);
      console.error(`[${this.name}] Failed:`, msg);
      this.recordFailure(msg);
      this.lastDataState = { mode: 'unavailable', timestamp: null, offline };
      return defaultValue;
    }
  }
}

// Registry of circuit breakers for global status
const breakers = new Map<string, CircuitBreaker<unknown>>();

export function createCircuitBreaker<T>(options: CircuitBreakerOptions): CircuitBreaker<T> {
  const breaker = new CircuitBreaker<T>(options);
  breakers.set(options.name, breaker as CircuitBreaker<unknown>);
  return breaker;
}

export function getCircuitBreakerStatus(): Record<string, string> {
  const status: Record<string, string> = {};
  breakers.forEach((breaker, name) => {
    status[name] = breaker.getStatus();
  });
  return status;
}

export function isCircuitBreakerOnCooldown(name: string): boolean {
  const breaker = breakers.get(name);
  return breaker ? breaker.isOnCooldown() : false;
}

export function getCircuitBreakerCooldownInfo(name: string): { onCooldown: boolean; remainingSeconds: number } {
  const breaker = breakers.get(name);
  if (!breaker) return { onCooldown: false, remainingSeconds: 0 };
  return {
    onCooldown: breaker.isOnCooldown(),
    remainingSeconds: breaker.getCooldownRemaining()
  };
}

export function removeCircuitBreaker(name: string): void {
  breakers.delete(name);
}

export function clearAllCircuitBreakers(): void {
  breakers.clear();
}

// ── Health Dashboard & Cascade Detection ────────────────────────────

export type SystemHealthLevel = 'healthy' | 'degraded' | 'critical';

export interface CircuitBreakerHealthReport {
  /** Overall system health based on breaker states */
  level: SystemHealthLevel;
  /** Total registered breakers */
  total: number;
  /** Breakers currently on cooldown */
  onCooldown: number;
  /** Breakers serving stale/cached data */
  servingStale: number;
  /** Breakers in healthy state */
  healthy: number;
  /** Names of breakers currently on cooldown */
  cooldownBreakers: string[];
  /** Cascade detected: 3+ breakers simultaneously on cooldown */
  cascadeDetected: boolean;
  /** Timestamp of this report */
  timestamp: number;
}

/**
 * Generates a health report across all registered circuit breakers.
 *
 * Health levels:
 * - healthy:  All breakers operational
 * - degraded: 1-2 breakers on cooldown (some data sources unavailable)
 * - critical: 3+ breakers on cooldown (cascade failure likely)
 */
export function getCircuitBreakerHealthReport(): CircuitBreakerHealthReport {
  const cooldownBreakers: string[] = [];
  let servingStale = 0;
  let healthy = 0;

  breakers.forEach((breaker, name) => {
    if (breaker.isOnCooldown()) {
      cooldownBreakers.push(name);
    } else {
      const dataState = breaker.getDataState();
      if (dataState.mode === 'cached' || dataState.mode === 'unavailable') {
        servingStale += 1;
      } else {
        healthy += 1;
      }
    }
  });

  const total = breakers.size;
  const onCooldown = cooldownBreakers.length;
  const CASCADE_THRESHOLD = 3;
  const cascadeDetected = onCooldown >= CASCADE_THRESHOLD;

  let level: SystemHealthLevel = 'healthy';
  if (onCooldown >= CASCADE_THRESHOLD) {
    level = 'critical';
  } else if (onCooldown > 0 || servingStale > total * 0.3) {
    level = 'degraded';
  }

  return {
    level,
    total,
    onCooldown,
    servingStale,
    healthy,
    cooldownBreakers,
    cascadeDetected,
    timestamp: Date.now(),
  };
}

/** Listener type for health change events */
type HealthChangeListener = (report: CircuitBreakerHealthReport) => void;
const healthListeners: HealthChangeListener[] = [];
let lastHealthLevel: SystemHealthLevel = 'healthy';

/**
 * Register a listener for health level changes.
 * Fires when the system transitions between healthy/degraded/critical.
 */
export function onHealthChange(listener: HealthChangeListener): () => void {
  healthListeners.push(listener);
  return () => {
    const idx = healthListeners.indexOf(listener);
    if (idx >= 0) healthListeners.splice(idx, 1);
  };
}

/** Whether the system is currently in degraded mode (Phase 4.3) */
let degradedModeActive = false;

/** Get whether degraded mode is currently active */
export function isDegradedMode(): boolean {
  return degradedModeActive;
}

/**
 * Check health and fire listeners if level changed.
 * Should be called after each breaker state change (failure/recovery).
 * Lightweight — only computes report when called.
 *
 * Phase 4.3: Automatically activates/deactivates degraded mode
 * when cascade detection changes.
 */
export function checkHealthTransition(): void {
  const report = getCircuitBreakerHealthReport();

  // Phase 4.3: Toggle degraded mode on cascade detection
  if (report.cascadeDetected && !degradedModeActive) {
    degradedModeActive = true;
    console.warn(`[circuit-breaker] Degraded mode ACTIVATED — ${report.onCooldown} breakers on cooldown: ${report.cooldownBreakers.join(', ')}`);
  } else if (!report.cascadeDetected && degradedModeActive) {
    degradedModeActive = false;
    console.warn('[circuit-breaker] Degraded mode DEACTIVATED — system recovering');
  }

  if (report.level !== lastHealthLevel) {
    lastHealthLevel = report.level;
    for (const listener of healthListeners) {
      try { listener(report); } catch { /* don't let listener errors cascade */ }
    }
  }
}
