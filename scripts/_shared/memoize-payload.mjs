/**
 * In-process micro-cache for heavy read-only payload builders.
 *
 * Many dashboard endpoints aggregate the same underlying data:
 *   /api/ops/status          calls buildOpsStatusPayload, etc.
 *   /api/dashboard/now-do    internally calls buildOpsStatusPayload + buildHotEventsPayload + buildTrendingThemesPayload
 *   /api/dashboard/health-summary  internally calls buildOpsStatusPayload + buildProductQualityPayload + buildHotEventsPayload
 *
 * The dashboard front-end fires all three (plus the underlying ones) in
 * parallel every 60 s, so without caching the heavy SQL runs 3× per tick
 * for nothing.
 *
 * This module provides a tiny TTL-cache wrapper so the second/third call
 * within a short window gets the already-computed result. TTL is short
 * (default 10 s) so freshness for genuinely slow polls (1+ minute apart)
 * is preserved.
 *
 * Cache is keyed by a string the caller chooses — typically the
 * function name plus stringified arguments. Values are stored as
 * Promises so concurrent in-flight calls share the same promise rather
 * than racing duplicates against each other.
 */

const DEFAULT_TTL_MS = 10_000;
const cache = new Map();

/**
 * Wrap a builder so calls within `ttlMs` reuse the result.
 *
 *   const memoizedHotEvents = memoize('hot-events', buildHotEventsPayload, 10_000);
 *   const a = await memoizedHotEvents(pool, opts);
 *   const b = await memoizedHotEvents(pool, opts);  // ← returns cached
 */
export function memoize(name, builder, ttlMs = DEFAULT_TTL_MS) {
  return async function memoized(...args) {
    const key = `${name}:${stableArgsKey(args)}`;
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) {
      return hit.promise;
    }
    const promise = Promise.resolve()
      .then(() => builder(...args))
      .catch((err) => {
        // Eject failed entries so the next call re-attempts instead of
        // serving the failure for the entire TTL.
        if (cache.get(key)?.promise === promise) cache.delete(key);
        throw err;
      });
    cache.set(key, { promise, expiresAt: now + ttlMs });
    return promise;
  };
}

/**
 * Best-effort args-to-key. Object args are serialised by entries. Promise /
 * client / pool / function args are skipped (their identity, not value,
 * matters and they should never be compared by structure).
 */
function stableArgsKey(args) {
  const parts = [];
  for (const a of args) {
    if (a == null) {
      parts.push('null');
    } else if (typeof a === 'function' || typeof a === 'symbol') {
      // skip
    } else if (typeof a === 'object') {
      // pg.Pool / Client / async function arg has internal state → skip
      // by checking for `query` method.
      if (typeof a.query === 'function') continue;
      try {
        parts.push(JSON.stringify(Object.entries(a).sort()));
      } catch {
        parts.push('{}');
      }
    } else {
      parts.push(String(a));
    }
  }
  return parts.join('|');
}

export function clearMemoizeCache() {
  cache.clear();
}

export function memoizeCacheSize() {
  return cache.size;
}
