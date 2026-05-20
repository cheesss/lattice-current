/**
 * S-Tier C3 — Demo mode runtime.
 *
 * When LATTICE_DEMO_MODE=1, the API serves data from a static snapshot file
 * (built by scripts/build-public-demo-snapshot.mjs) instead of the live
 * NAS PostgreSQL. This lets the dashboard run on Vercel / a static host
 * without any DB credentials, so external evaluators can click a public
 * URL and inspect a real (but read-only, sanitized) signal pipeline in
 * 5 seconds.
 *
 * What demo mode does:
 *   - All write APIs (review, watchlist mutations, user-prefs writes)
 *     return 403 with a clear "demo mode is read-only" message.
 *   - Reads continue to work; getSnapshot() loads the JSON once and caches
 *     it in memory. Subsequent reads are zero-cost.
 *
 * What it does NOT do (out of scope for this slice):
 *   - Re-implement every aggregation against the static JSON. Builders that
 *     need DB access still call PostgreSQL; in production-deployed demo mode
 *     a small read-replica or a pre-baked DuckDB file would replace that.
 *   - Implement aggregation queries against the snapshot. The snapshot is
 *     designed to be inspected raw, with the dashboard fetching a separate
 *     /api/demo/snapshot endpoint when in demo mode.
 *
 * Usage from the API layer:
 *   import { isDemoMode, blockIfDemoMode, loadDemoSnapshot } from './_shared/demo-mode.mjs';
 *   if (blockIfDemoMode(method)) return buildJsonResponse(...);
 */

import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

let cachedSnapshot = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 h

export function isDemoMode() {
  return String(process.env.LATTICE_DEMO_MODE || '').toLowerCase() === '1'
    || String(process.env.LATTICE_DEMO_MODE || '').toLowerCase() === 'true';
}

/**
 * Returns a 403 envelope when in demo mode AND the request is a write
 * (POST / PUT / DELETE / PATCH). Returns null otherwise so the caller
 * can fall through to its normal handler.
 */
export function blockIfDemoMode(method = 'GET') {
  if (!isDemoMode()) return null;
  const m = String(method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return null;
  return {
    status: 403,
    body: {
      ok: false,
      demoMode: true,
      error: 'Demo mode is read-only. Writes (review / watchlist mutations / preferences) are disabled in this environment. Self-host with a NAS DB to enable mutations.',
    },
  };
}

async function findLatestSnapshotPath() {
  const dir = path.resolve('data', 'public-demo');
  if (!existsSync(dir)) return null;
  const files = (await readdir(dir))
    .filter((name) => /^lattice-snapshot-\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  return path.join(dir, files[0]);
}

export async function loadDemoSnapshot({ forceRefresh = false } = {}) {
  if (!forceRefresh && cachedSnapshot && (Date.now() - cachedAt) < CACHE_TTL_MS) {
    return cachedSnapshot;
  }
  const snapshotPath = process.env.LATTICE_DEMO_SNAPSHOT_PATH
    ? path.resolve(process.env.LATTICE_DEMO_SNAPSHOT_PATH)
    : await findLatestSnapshotPath();
  if (!snapshotPath || !existsSync(snapshotPath)) {
    return null;
  }
  const raw = await readFile(snapshotPath, 'utf8');
  cachedSnapshot = JSON.parse(raw);
  cachedAt = Date.now();
  return cachedSnapshot;
}

export function clearDemoSnapshotCache() {
  cachedSnapshot = null;
  cachedAt = 0;
}
