/**
 * Pure-function nowcast fusion for the event dashboard API.
 *
 * Extracted from event-dashboard-api.mjs during the mega-file split pilot.
 * `loadLatestNowcastsForSignals` (DB reader) stays in the main file
 * because it couples to pg Pool + safeQuery — this module is the
 * pure combiner that tests import.
 */

/**
 * Fuse nowcasts into an existing (observed-origin) signal lookup without
 * overriding observed values. Proxy / composite / imputed origins do get
 * replaced by nowcasts when available.
 *
 * @param {{
 *   lookup: Record<string, number>,
 *   originMap: Record<string, { valueOrigin?: string, writerId?: string }>,
 *   nowcasts: Record<string, any>,
 * }}
 * @returns {{
 *   lookup: Record<string, number>,
 *   originMap: Record<string, any>,
 *   nowcastSummary: Record<string, any>,
 *   anyEstimated: boolean,
 * }}
 */
export function fuseNowcastsIntoLookup({ lookup, originMap, nowcasts }) {
  const nextLookup = { ...(lookup || {}) };
  const nextOrigin = { ...(originMap || {}) };
  const summary = {};
  for (const [signal, row] of Object.entries(nowcasts || {})) {
    const estimated = Number(row.estimated_value);
    if (!Number.isFinite(estimated)) continue;
    const observedOrigin = nextOrigin[signal]?.valueOrigin;
    if (observedOrigin === 'observed') continue; // never override observed
    nextLookup[signal] = estimated;
    summary[signal] = {
      value: estimated,
      method: row.estimate_method,
      confidence: row.estimate_confidence != null ? Number(row.estimate_confidence) : null,
      intervalLow: row.interval_low != null ? Number(row.interval_low) : null,
      intervalHigh: row.interval_high != null ? Number(row.interval_high) : null,
      featureVintageAt: row.feature_vintage_at,
      derivedFromSources: row.derived_from_sources,
      asOf: row.target_ts,
      generatedAt: row.created_at,
    };
    nextOrigin[signal] = { valueOrigin: 'estimated', writerId: row.estimate_method };
  }
  const anyEstimated = Object.values(nextOrigin).some((info) => info?.valueOrigin === 'estimated');
  return { lookup: nextLookup, originMap: nextOrigin, nowcastSummary: summary, anyEstimated };
}
