/**
 * Unified Cache TTL Configuration — Phase 4.1
 *
 * Single source of truth for all cache TTL values across the 3-tier caching stack:
 *   Edge CDN (Vercel/Cloudflare) → Redis (Upstash) → Client (IndexedDB/localStorage)
 *
 * Each CacheTier maps to standardised TTL values. Individual server handlers and
 * client-side code should import from this module instead of defining ad-hoc TTLs.
 *
 * The tier system reflects data freshness requirements:
 *   fast    — realtime-ish data (flight status, live prices)
 *   medium  — near-realtime (market quotes, prediction markets)
 *   slow    — periodic updates (conflict events, cyber threats)
 *   static  — rarely changing (research papers, military bases)
 *   daily   — once-a-day updates (critical minerals, BIS data)
 *   no-store — never cached (vessel tracking, aircraft tracking)
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type CacheTier = 'fast' | 'medium' | 'slow' | 'static' | 'daily' | 'no-store';

export interface CacheTTLConfig {
  /** CDN edge cache TTL in seconds (Cache-Control s-maxage) */
  cdnSeconds: number;
  /** Redis cache TTL in seconds */
  redisSeconds: number;
  /** Client-side (IndexedDB/localStorage) TTL in milliseconds */
  clientMs: number;
  /** CDN stale-while-revalidate window in seconds */
  cdnSwrSeconds: number;
  /** CDN stale-if-error fallback window in seconds */
  cdnSieSeconds: number;
}

// ── TTL Definitions ──────────────────────────────────────────────────────────

export const CACHE_TIER_CONFIG: Readonly<Record<CacheTier, CacheTTLConfig>> = {
  fast: {
    cdnSeconds: 120,         // 2 min
    redisSeconds: 180,       // 3 min
    clientMs: 5 * 60_000,    // 5 min
    cdnSwrSeconds: 60,
    cdnSieSeconds: 600,
  },
  medium: {
    cdnSeconds: 300,         // 5 min
    redisSeconds: 600,       // 10 min
    clientMs: 15 * 60_000,   // 15 min
    cdnSwrSeconds: 120,
    cdnSieSeconds: 900,
  },
  slow: {
    cdnSeconds: 900,         // 15 min
    redisSeconds: 1_800,     // 30 min
    clientMs: 60 * 60_000,   // 1 hour
    cdnSwrSeconds: 300,
    cdnSieSeconds: 3_600,
  },
  static: {
    cdnSeconds: 3_600,       // 1 hour
    redisSeconds: 21_600,    // 6 hours
    clientMs: 24 * 60 * 60_000, // 24 hours
    cdnSwrSeconds: 600,
    cdnSieSeconds: 14_400,
  },
  daily: {
    cdnSeconds: 21_600,      // 6 hours
    redisSeconds: 86_400,    // 24 hours
    clientMs: 48 * 60 * 60_000, // 48 hours
    cdnSwrSeconds: 7_200,
    cdnSieSeconds: 172_800,
  },
  'no-store': {
    cdnSeconds: 0,
    redisSeconds: 0,
    clientMs: 0,
    cdnSwrSeconds: 0,
    cdnSieSeconds: 0,
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Get the CacheTTLConfig for a given tier. */
export function getTierConfig(tier: CacheTier): CacheTTLConfig {
  return CACHE_TIER_CONFIG[tier];
}

/** Get the Redis TTL in seconds for a given tier. */
export function getRedisTtl(tier: CacheTier): number {
  return CACHE_TIER_CONFIG[tier].redisSeconds;
}

/** Get the client-side TTL in milliseconds for a given tier. */
export function getClientTtlMs(tier: CacheTier): number {
  return CACHE_TIER_CONFIG[tier].clientMs;
}

/**
 * Build a Cache-Control header value for the given tier.
 * Used by gateway.ts for CDN cache headers.
 */
export function buildCacheControlHeader(tier: CacheTier): string {
  if (tier === 'no-store') return 'no-store';
  const cfg = CACHE_TIER_CONFIG[tier];
  return `public, s-maxage=${cfg.cdnSeconds}, stale-while-revalidate=${cfg.cdnSwrSeconds}, stale-if-error=${cfg.cdnSieSeconds}`;
}

/**
 * Build a CDN-Cache-Control header for Cloudflare.
 * More aggressive than standard Cache-Control since CF can revalidate via ETag.
 * Returns null for no-store tier.
 */
export function buildCdnCacheControlHeader(tier: CacheTier): string | null {
  if (tier === 'no-store') return null;
  const cfg = CACHE_TIER_CONFIG[tier];
  // CF TTLs are ~2× the standard s-maxage for efficient revalidation
  const cfSMaxAge = cfg.cdnSeconds * 2;
  const cfSwr = cfg.cdnSwrSeconds * 2;
  const cfSie = cfg.cdnSieSeconds * 2;
  return `public, s-maxage=${cfSMaxAge}, stale-while-revalidate=${cfSwr}, stale-if-error=${cfSie}`;
}

/**
 * Extend a tier's TTL by a multiplier (used during CircuitBreaker cooldown).
 * Returns a new CacheTTLConfig with extended values.
 */
export function extendTierTtl(tier: CacheTier, multiplier: number): CacheTTLConfig {
  const base = CACHE_TIER_CONFIG[tier];
  if (tier === 'no-store') return base;
  return {
    cdnSeconds: Math.round(base.cdnSeconds * multiplier),
    redisSeconds: Math.round(base.redisSeconds * multiplier),
    clientMs: Math.round(base.clientMs * multiplier),
    cdnSwrSeconds: Math.round(base.cdnSwrSeconds * multiplier),
    cdnSieSeconds: Math.round(base.cdnSieSeconds * multiplier),
  };
}

/**
 * Check if a TTL value (in ms) has expired since a given timestamp.
 */
export function isTtlExpired(updatedAt: number, ttlMs: number): boolean {
  if (ttlMs <= 0) return true;
  return Date.now() - updatedAt >= ttlMs;
}
