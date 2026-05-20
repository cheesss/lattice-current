/**
 * Signal-quality classification + response-mode metadata for the event
 * dashboard API.
 *
 * Extracted from event-dashboard-api.mjs during the mega-file split pilot.
 * DB-coupled loaders (loadLatestSignalsWithQuality, detectLiveQuoteFeed)
 * stay in the main file because they depend on the pg Pool + safeQuery.
 * Everything here is pure — no DB, no I/O.
 */

export const SIGNAL_LABELS = {
  vix: 'VIX',
  yieldSpread: 'Yield Spread',
  hy_credit_spread: 'HY Credit',
  dollarIndex: 'Dollar',
  oilPrice: 'Oil',
  marketStress: 'Market Stress',
  transmissionStrength: 'Transmission',
  eventIntensity: 'Event Intensity',
};

export const KPI_SIGNAL_CHANNELS = new Set([
  'vix',
  'yieldSpread',
  'hy_credit_spread',
  'dollarIndex',
  'oilPrice',
  'marketStress',
  'transmissionStrength',
]);

// Stale thresholds reflect publication cadence of the upstream source, not
// arbitrary freshness preferences. Values shorter than the upstream's natural
// lag generate misleading "stale signal" alerts even when the fetcher is
// healthy (e.g., FRED daily series typically publish 2-5 days after observation).
export const SIGNAL_STALE_THRESHOLD_HOURS = Object.freeze({
  vix: 36,                  // Yahoo intraday — fast
  yieldSpread: 120,         // FRED DGS10/DGS2 lag 3-5d
  hy_credit_spread: 120,    // FRED BAMLH0A0HYM2 lag 3-5d
  ig_credit_spread: 120,    // FRED BAMLC0A0CM lag 3-5d
  treasury10y: 120,         // FRED DGS10 lag 3-5d
  fedFundsRate: 240,        // monthly publish (~10d cadence)
  cpiIndex: 1080,           // monthly (~45d delay)
  unemployment: 1080,       // monthly
  dollarIndex: 48,          // Yahoo end-of-day
  oilPrice: 120,            // Yahoo daily settlement
  marketStress: 120,        // derived from credit spreads (inherits FRED lag)
  transmissionStrength: 48, // computed locally
});

export const DATA_TIMESTAMP_KEYS = new Set([
  'createdAt', 'created_at', 'updatedAt', 'updated_at',
  'dataUpdatedAt', 'data_updated_at',
  'oldestInternalUpdatedAt', 'oldest_internal_updated_at',
  'latestInternalUpdatedAt', 'latest_internal_updated_at',
  'publishedAt', 'published_at',
  'completedAt', 'completed_at',
  'recordedAt', 'recorded_at',
  'capturedAt', 'captured_at',
  'signalCapturedAt', 'signal_captured_at',
  'rawSnapshotUpdatedAt', 'raw_snapshot_updated_at',
  'eventDate', 'event_date',
  'ts',
]);

export const MODE_STALE_THRESHOLD_HOURS = Object.freeze({
  live: 24,
  cache: 24,
  delayed: 72,
  fallback: 0,
  nowcast: 6,
  imputed: 12,
  composite: 12,
  mirrored: 0,
  backfill: null,
  replay: null,
});

export const ALLOWED_RESPONSE_MODES = new Set([
  'live', 'delayed', 'nowcast', 'imputed', 'composite',
  'mirrored', 'backfill', 'replay', 'fallback', 'cache',
]);

export const OBSERVED_MODES = new Set(['live', 'delayed']);
export const ESTIMATED_MODES = new Set(['nowcast', 'imputed', 'composite']);

export function toIsoTimestamp(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export function collectPayloadTimestamps(value, timestamps = [], depth = 0) {
  if (!value || depth > 8) return timestamps;
  if (Array.isArray(value)) {
    for (const item of value) collectPayloadTimestamps(item, timestamps, depth + 1);
    return timestamps;
  }
  if (typeof value !== 'object') return timestamps;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'generatedAt' || key === 'generated_at') continue;
    if (DATA_TIMESTAMP_KEYS.has(key)) {
      const iso = toIsoTimestamp(child);
      if (iso) timestamps.push(Date.parse(iso));
      continue;
    }
    if (child && typeof child === 'object') {
      collectPayloadTimestamps(child, timestamps, depth + 1);
    }
  }
  return timestamps;
}

export function latestInternalTimestamp(payload) {
  const timestamps = collectPayloadTimestamps(payload).filter((value) => Number.isFinite(value));
  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

export function firstTimestamp(...values) {
  for (const value of values) {
    const iso = toIsoTimestamp(value);
    if (iso) return iso;
  }
  return null;
}

export function inferResponseMode(payload, extra) {
  const payloadMeta = payload?.meta && typeof payload.meta === 'object' ? payload.meta : {};
  const explicitMode = extra.mode || payloadMeta.mode;
  if (explicitMode) {
    const normalized = String(explicitMode);
    if (ALLOWED_RESPONSE_MODES.has(normalized)) return normalized;
  }
  if (extra.cacheHit || payloadMeta.cacheHit) return 'cache';
  const text = [
    extra.window,
    payloadMeta.window,
    payload?.window,
    extra.source,
    payloadMeta.source,
    payload?.source,
  ].filter(Boolean).join(' ').toLowerCase();
  if (text.includes('fallback')) return 'fallback';
  return 'live';
}

export function deriveValueOrigin(mode) {
  if (OBSERVED_MODES.has(mode)) return 'observed';
  if (ESTIMATED_MODES.has(mode)) return 'estimated';
  return 'research';
}

export function signalAgeHours(ts) {
  const iso = toIsoTimestamp(ts);
  if (!iso) return null;
  const age = (Date.now() - Date.parse(iso)) / 3_600_000;
  return Number.isFinite(age) ? age : null;
}

export function classifySignalQuality(channel, latestRow = {}, samples = []) {
  const normalizedChannel = String(channel || latestRow.signal_name || latestRow.channel || '').trim();
  const maxAgeHours = SIGNAL_STALE_THRESHOLD_HOURS[normalizedChannel] ?? 48;
  const updatedAt = toIsoTimestamp(latestRow.ts || latestRow.updatedAt);
  const ageHours = signalAgeHours(updatedAt);
  const normalizedSamples = samples
    .map((sample) => ({
      ts: toIsoTimestamp(sample.ts || sample.updatedAt),
      value: Number(sample.value),
    }))
    .filter((sample) => sample.ts && Number.isFinite(sample.value))
    .sort((left, right) => Date.parse(right.ts) - Date.parse(left.ts));

  const latestValue = Number(latestRow.value);
  let repeatedCount = 0;
  if (Number.isFinite(latestValue)) {
    const latestRounded = latestValue.toFixed(6);
    for (const sample of normalizedSamples) {
      if (Number(sample.value).toFixed(6) !== latestRounded) break;
      repeatedCount += 1;
    }
  }
  const mirrored = normalizedSamples.length >= 6 && repeatedCount >= 6;
  const stale = ageHours == null || ageHours > maxAgeHours;
  const valueOrigin = String(latestRow.value_origin || 'observed');
  const writerId = latestRow.writer_id ? String(latestRow.writer_id) : null;

  let status;
  let reason = null;
  if (valueOrigin === 'proxy') {
    status = 'proxy';
    reason = writerId
      ? `value is a proxy (writer=${writerId})`
      : 'value is a proxy, not a direct observation';
  } else if (valueOrigin === 'composite') {
    status = 'composite';
    reason = writerId
      ? `value is composite/derived (writer=${writerId})`
      : 'value is composite/derived from other signals';
  } else if (valueOrigin === 'imputed') {
    status = 'imputed';
    reason = 'value is imputed/nowcast';
  } else if (mirrored) {
    status = 'mirrored';
    reason = `latest ${repeatedCount} samples repeat the same value`;
  } else if (stale) {
    status = 'stale';
    reason = ageHours == null
      ? 'missing signal timestamp'
      : `signal age ${Math.round(ageHours)}h exceeds ${maxAgeHours}h threshold`;
  } else {
    status = 'observed';
  }

  return {
    status,
    mirrored,
    stale,
    repeatedCount,
    ageHours: Number.isFinite(ageHours) ? Math.round(ageHours * 10) / 10 : null,
    maxAgeHours,
    valueOrigin,
    writerId,
    reason,
  };
}

export function deriveResponseMeta(payload = {}, extra = {}) {
  const payloadMeta = payload?.meta && typeof payload.meta === 'object' ? payload.meta : {};
  const generatedAt = firstTimestamp(extra.generatedAt) || new Date().toISOString();
  const latestInternalUpdatedAt = firstTimestamp(
    extra.latestInternalUpdatedAt,
    payloadMeta.latestInternalUpdatedAt,
    payload.latestInternalUpdatedAt,
  ) || latestInternalTimestamp(payload);
  const dataUpdatedAt = firstTimestamp(
    extra.dataUpdatedAt,
    payloadMeta.dataUpdatedAt,
    payload.dataUpdatedAt,
    payloadMeta.updatedAt,
    payload.updatedAt,
    latestInternalUpdatedAt,
  );
  const windowLabel = extra.window ?? payloadMeta.window ?? payload.window ?? null;
  const source = extra.source ?? payloadMeta.source ?? payload.source ?? null;
  const mode = inferResponseMode(payload, extra);
  const staleThresholdHours = extra.maxAgeHours
    ?? payloadMeta.maxAgeHours
    ?? MODE_STALE_THRESHOLD_HOURS[mode]
    ?? null;

  let stale = Boolean(payloadMeta.stale) || Boolean(extra.stale);
  let staleReason = extra.staleReason || payloadMeta.staleReason || null;
  if (mode === 'fallback') {
    stale = true;
    staleReason ||= `fallback data window${windowLabel ? `: ${windowLabel}` : ''}`;
  }
  if (mode === 'mirrored') {
    stale = true;
    staleReason ||= 'data is mirrored from earlier timestamp, not a new observation';
  }
  if (extra.cacheHit || payloadMeta.cacheHit) {
    stale = true;
    staleReason ||= extra.cacheReason || payloadMeta.cacheReason || 'served from cache after refresh failure';
  }
  if (dataUpdatedAt && Number.isFinite(Number(staleThresholdHours)) && staleThresholdHours > 0) {
    const ageHours = (Date.now() - Date.parse(dataUpdatedAt)) / 3_600_000;
    if (Number.isFinite(ageHours) && ageHours > staleThresholdHours) {
      stale = true;
      staleReason ||= `data age ${Math.round(ageHours)}h exceeds ${staleThresholdHours}h ${mode} threshold`;
    }
  }

  const valueOrigin = deriveValueOrigin(mode);
  const validAsOf = firstTimestamp(
    extra.validAsOf,
    payloadMeta.validAsOf,
    payload?.validAsOf,
    dataUpdatedAt,
  );

  return {
    generatedAt,
    updatedAt: dataUpdatedAt,
    dataUpdatedAt,
    latestInternalUpdatedAt,
    mode,
    valueOrigin,
    validAsOf,
    window: windowLabel,
    source,
    stale,
    staleReason,
  };
}

export function withMeta(payload, extra = {}) {
  const payloadMeta = payload?.meta && typeof payload.meta === 'object' ? payload.meta : {};
  const derived = deriveResponseMeta(payload, extra);
  return {
    ...payload,
    meta: {
      ...payloadMeta,
      ...extra,
      ...derived,
    },
  };
}
