#!/usr/bin/env node
/**
 * Event Intelligence dashboard API.
 *
 * Canonical goal:
 * - one stable contract for the Event Intelligence panel
 * - graceful fallback to cached/stale data
 * - usable responses even when some upstream analysis tables are empty
 */

import http from 'node:http';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { createLogger } from './_shared/structured-logger.mjs';
import { computeCalibrationDiagnostic } from './_shared/calibration-diagnostic.mjs';
import { computeDataQualityMetrics } from './_shared/data-quality-check.mjs';
import { buildFreshnessAudit } from './audit-data-freshness.mjs';
import { buildNowcastStatusPayload } from './_shared/nowcast-status-builder.mjs';
import {
  HOT_EVENTS_MIN_PROMOTION_CONTROLS,
  buildHotEventsPayload,
  buildTrendingThemesPayload,
  buildMetaModelHealthPayload,
  buildExplainEventPayload,
  buildSourceDiversityAuditPayload,
  buildThemeImpactPayload,
} from './_shared/event-intelligence-builder.mjs';
import {
  buildEventTimelinePayload,
  buildEventNarrativePayload,
  buildSimilarEventsPayload,
  buildRegimeScenarioPayload,
  buildCurrentRegimeBriefPayload,
  buildAssetDossierPayload,
  buildWeeklyDigestPayload,
  buildCorrelationBreaksPayload,
} from './_shared/ai-analysis-builder.mjs';
import { getBudgetStatus } from './_shared/automation-budget.mjs';
import { getRecentAutomationActions } from './_shared/automation-audit.mjs';
import {
  ensureInboxAuditSchema,
  recordInboxAction,
  recentInboxActions,
  newRequestId,
  hashRequestBody,
} from './_shared/inbox-audit.mjs';
import {
  setWatchlistState,
  getWatchlistEntry,
  removeWatchlistEntry,
  listWatchlist,
  VALID_WATCHLIST_STATES,
  VALID_WATCHLIST_ITEM_TYPES,
} from './_shared/user-watchlist.mjs';
import { getUserPrefs, setUserPrefs, resetUserPrefs } from './_shared/user-prefs.mjs';
import { isDemoMode, blockIfDemoMode, loadDemoSnapshot } from './_shared/demo-mode.mjs';
import { buildModelComparisonPayload } from './_shared/model-comparison.mjs';
import { buildProductQualityPayload } from './_shared/product-quality-metrics.mjs';
import { sendAlert } from './_shared/alert-notifier.mjs';
import {
  getPendingApprovals,
  loadApprovalById,
  markApprovalReviewed,
} from './_shared/approval-queue.mjs';
import { executeProposal, ensureExecutorSchema, reviewCodexProposalById } from './proposal-executor.mjs';
import {
  buildCompactInvestmentSnapshot,
  buildCompactMacroSnapshot,
  buildCompactRiskSnapshot,
  buildCompactValidationSnapshot,
  buildThemeShellSnapshotPayloads,
} from './_shared/theme-shell-snapshot-builders.mjs';
import {
  buildCategoryTrendsPayload,
  buildDailyDigestPayload,
  buildFollowedThemeBriefingPayload,
  buildQuarterlyInsightsPayload,
  buildSharedThemeBriefPayload,
  buildThemeBriefPayload,
  buildThemeBriefExportPayload,
  buildThemeEvolutionPayload,
  buildTrendPyramidPayload,
  loadThemeNotebookEntry,
  upsertThemeNotebookEntry,
} from './_shared/trend-dashboard-queries.mjs';
import {
  applyDiscoveryTriageDecision,
  buildDiscoveryTriagePayload,
  buildStructuralAlertsPayload,
  dismissStructuralAlert,
} from './_shared/trend-workbench.mjs';
import {
  mapThemeToTaxonomy,
  rankThemesForText,
} from './_shared/theme-taxonomy.mjs';
import { isLowSignalAddRssProposal } from './_shared/rss-proposal-quality.mjs';
import { isLowValueGoogleNewsSourceName } from './_shared/google-news-source-policy.mjs';
import {
  MAP_LENS_FILTER_TERMS,
  MAP_LENS_ANCHORS,
  TRANSMISSION_TARGETS,
  normalizeLensFilter,
  normalizeLensText,
  matchesLensFilter,
  inferMapLensAnchor,
} from './_shared/dashboard-map-lens.mjs';
import {
  CACHE_DIR,
  readJsonCache,
  writeJsonCache,
  hasRenderableData,
  toCacheToken,
  buildCacheKey,
  hasDynamicSinceParams,
  buildSinceToken,
} from './_shared/dashboard-cache.mjs';
import {
  sanitizeTopicText,
  splitTopicTerms,
  buildTopicArticleProfile,
  buildTopicRecentArticleScore,
} from './_shared/dashboard-topic-scoring.mjs';
import {
  SIGNAL_LABELS,
  KPI_SIGNAL_CHANNELS,
  SIGNAL_STALE_THRESHOLD_HOURS,
  DATA_TIMESTAMP_KEYS,
  MODE_STALE_THRESHOLD_HOURS,
  ALLOWED_RESPONSE_MODES,
  OBSERVED_MODES,
  ESTIMATED_MODES,
  toIsoTimestamp,
  collectPayloadTimestamps,
  latestInternalTimestamp,
  firstTimestamp,
  inferResponseMode,
  deriveValueOrigin,
  signalAgeHours,
  classifySignalQuality,
  deriveResponseMeta,
  withMeta,
} from './_shared/dashboard-signal-quality.mjs';
import { fuseNowcastsIntoLookup } from './_shared/dashboard-nowcast-fusion.mjs';

// Re-exported for test consumers
// (tests/event-dashboard-topic-article-matching.test.mjs,
//  tests/event-dashboard-freshness-contract.test.mjs,
//  tests/nowcast-fusion.test.mjs).
export { buildTopicArticleProfile, buildTopicRecentArticleScore };
export { classifySignalQuality, withMeta, deriveResponseMeta };
export { fuseNowcastsIntoLookup };
export {
  inferArticleDashboardTheme,
  normalizeDashboardThemeKey,
  sanitizeArticleDisplaySource,
  shouldRenderTodayEvent,
};

loadOptionalEnvFile();

const { Pool } = pg;
const PORT = Number(process.env.DASHBOARD_PORT || 46200);
const EVIDENCE_GRADE_WINDOW_DAYS = 365;
const AUDIT_DIR = path.resolve('data', 'audits');
const DATA_FRESHNESS_AUDIT_TTL_MS = Number(process.env.DATA_FRESHNESS_AUDIT_TTL_MS || 5 * 60 * 1000);
const SERVER_CACHE_FALLBACK_TTL_MS = Number(process.env.DASHBOARD_CACHE_FALLBACK_TTL_MS || 60 * 60 * 1000);
const HOT_THEME_HAWKES_MAX_AGE_HOURS = Number(process.env.HOT_THEME_HAWKES_MAX_AGE_HOURS || 72);
const ARTICLE_LIVE_MAX_AGE_HOURS = Number(process.env.ARTICLE_LIVE_MAX_AGE_HOURS || 24);
const SIDECAR_BASE_URL = String(
  process.env.LATTICE_SIDECAR_BASE_URL
  || process.env.LOCAL_API_BASE_URL
  || (process.env.LOCAL_API_PORT ? `http://127.0.0.1:${process.env.LOCAL_API_PORT}` : 'http://127.0.0.1:46123'),
).replace(/\/+$/, '');
const SIDECAR_PROXY_TIMEOUT_MS = Number(process.env.SIDECAR_PROXY_TIMEOUT_MS || 10_000);
const OPAQUE_DISCOVERY_THEME_PATTERN = /^dt-[a-z0-9]+$/i;
const logger = createLogger('event-dashboard-api');

// Lightweight Array coercion helper used by the emerging-tech topic detail
// fallback path. Pulled inline because the existing copies live in builders
// that aren't imported here, and a runtime ReferenceError was crashing
// /api/emerging-tech/:topicId with HTTP 500 ("asArray is not defined").
function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  if (typeof value === 'object') return Object.values(value);
  return [];
}
let pool = null;
let poolConfig = null;
let poolConfigError = null;

function getPgConfig() {
  if (!poolConfig && !poolConfigError) {
    try {
      poolConfig = {
        ...resolveNasPgConfig(),
        max: Number(process.env.EVENT_DASHBOARD_PG_POOL_MAX || 20),
        idleTimeoutMillis: Number(process.env.EVENT_DASHBOARD_PG_IDLE_MS || 30_000),
        connectionTimeoutMillis: Number(process.env.EVENT_DASHBOARD_PG_CONNECT_MS || 10_000),
      };
    } catch (error) {
      poolConfigError = error;
    }
  }
  if (!poolConfig) {
    throw poolConfigError;
  }
  return poolConfig;
}

function getPool() {
  if (!pool) {
    pool = new Pool(getPgConfig());
  }
  return pool;
}

export async function closeEventDashboardResources() {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}

function buildJsonResponse(data, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(data),
  };
}

function sendResponse(res, response) {
  res.writeHead(response.status, {
    'Content-Type': response.contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(response.body);
}

function parseUrl(url) {
  const [pathname, qs] = String(url || '/').split('?');
  return {
    pathname,
    segments: pathname.split('/').filter(Boolean),
    params: new URLSearchParams(qs || ''),
  };
}

async function safeQuery(text, values = []) {
  try {
    return await getPool().query(text, values);
  } catch (error) {
    logger.warn('database query failed', {
      queryPreview: String(text || '').trim().slice(0, 80),
      error: String(error?.message || error || 'query failed'),
    });
    logger.metric('db.query_error_count', 1);
    return { rows: [] };
  }
}

async function loadLatestSignalsWithQuality() {
  // signal_history may or may not have value_origin/writer_id columns depending
  // on whether scripts/migrations/add-signal-history-origin.mjs has been run.
  // Use COALESCE-to-default via a detection step so the API keeps working
  // on pre-migration databases.
  const columnsR = await safeQuery(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'signal_history'
  `);
  const availableColumns = new Set(columnsR.rows.map((row) => String(row.column_name)));
  const originExpr = availableColumns.has('value_origin')
    ? 'value_origin'
    : `'observed'::text AS value_origin`;
  const writerExpr = availableColumns.has('writer_id')
    ? 'writer_id'
    : 'NULL::text AS writer_id';
  const selectList = ['signal_name', 'ts', 'value', originExpr, writerExpr].join(', ');

  const [latestSignalsR, signalSamplesR] = await Promise.all([
    safeQuery(`
      SELECT DISTINCT ON (signal_name) ${selectList}
      FROM signal_history
      ORDER BY signal_name, ts DESC
    `),
    safeQuery(`
      WITH ranked AS (
        SELECT
          signal_name,
          ts,
          value,
          ROW_NUMBER() OVER (PARTITION BY signal_name ORDER BY ts DESC) AS rn
        FROM signal_history
      )
      SELECT signal_name, ts, value
      FROM ranked
      WHERE rn <= 12
      ORDER BY signal_name, ts DESC
    `),
  ]);
  const samplesBySignal = new Map();
  for (const row of signalSamplesR.rows) {
    const key = String(row.signal_name || '');
    if (!samplesBySignal.has(key)) samplesBySignal.set(key, []);
    samplesBySignal.get(key).push(row);
  }
  const rows = latestSignalsR.rows.map((row) => {
    const signalName = String(row.signal_name || '');
    return {
      signal_name: signalName,
      ts: row.ts,
      value: Number(row.value || 0),
      value_origin: row.value_origin || 'observed',
      writer_id: row.writer_id || null,
      quality: classifySignalQuality(signalName, row, samplesBySignal.get(signalName) || []),
    };
  });
  const qualityBySignal = Object.fromEntries(rows.map((row) => [row.signal_name, row.quality]));
  const originBySignal = Object.fromEntries(rows.map((row) => [row.signal_name, {
    valueOrigin: row.value_origin,
    writerId: row.writer_id,
  }]));
  const criticalRows = rows.filter((row) => KPI_SIGNAL_CHANNELS.has(row.signal_name));
  const degradedRows = criticalRows.filter((row) => row.quality.status !== 'observed');
  const mirroredRows = degradedRows.filter((row) => row.quality.status === 'mirrored');
  const staleRows = degradedRows.filter((row) => row.quality.status === 'stale');
  const mode = mirroredRows.length > 0 ? 'delayed' : 'live';
  const stale = staleRows.length > 0 || mirroredRows.length > 0;
  const staleReason = mirroredRows.length > 0
    ? `${mirroredRows.map((row) => SIGNAL_LABELS[row.signal_name] || row.signal_name).join(', ')} signal history appears mirrored`
    : staleRows.length > 0
      ? `${staleRows.map((row) => SIGNAL_LABELS[row.signal_name] || row.signal_name).join(', ')} signal history is stale`
      : null;
  return {
    rows,
    qualityBySignal,
    originBySignal,
    mode,
    stale,
    staleReason,
  };
}

async function detectLiveQuoteFeed() {
  const tableCheck = await safeQuery(`SELECT to_regclass('market_quotes') AS table_name`);
  const configured = Boolean(tableCheck.rows?.[0]?.table_name);
  if (!configured) {
    return {
      configured: false,
      status: 'unavailable',
      table: 'market_quotes',
      reason: 'market_quotes table not found; KPI strip is using signal_history, not a live quote feed',
    };
  }
  const quote = await safeQuery(`
    SELECT symbol, provider, observed_at, fetched_at, last_price
    FROM market_quotes
    WHERE symbol = '^VIX'
    ORDER BY fetched_at DESC
    LIMIT 1
  `);
  const latest = quote.rows?.[0] || null;
  if (!latest) {
    return {
      configured: true,
      status: 'empty',
      table: 'market_quotes',
      reason: 'market_quotes exists but has no ^VIX rows',
    };
  }
  const fetchedAt = toIsoTimestamp(latest.fetched_at);
  const observedAt = toIsoTimestamp(latest.observed_at);
  const fetchedAgeHours = signalAgeHours(fetchedAt);
  const observedAgeHours = signalAgeHours(observedAt);
  const stale = fetchedAgeHours == null || fetchedAgeHours > 4 || observedAgeHours == null || observedAgeHours > 36;
  return {
    configured: true,
    status: stale ? 'stale' : 'configured',
    table: 'market_quotes',
    symbol: String(latest.symbol || '^VIX'),
    provider: String(latest.provider || 'unknown'),
    fetchedAt,
    observedAt,
    lastPrice: Number(latest.last_price),
    fetchedAgeHours: Number.isFinite(fetchedAgeHours) ? Math.round(fetchedAgeHours * 10) / 10 : null,
    observedAgeHours: Number.isFinite(observedAgeHours) ? Math.round(observedAgeHours * 10) / 10 : null,
    reason: stale ? 'market_quotes ^VIX row is stale or missing observed time' : null,
  };
}


async function resolveWithCache(cacheKey, buildPayload) {
  try {
    const payload = await buildPayload();
    if (!hasRenderableData(payload)) {
      throw new Error('empty payload');
    }
    const enriched = withMeta(payload);
    await writeJsonCache(cacheKey, enriched);
    logger.metric('api.cache_miss', 1, { cacheKey });
    return buildJsonResponse(enriched);
  } catch (error) {
    const cached = await readJsonCache(cacheKey);
    if (cached && canUseServerCacheFallback(cacheKey, cached)) {
      logger.metric('api.cache_hit', 1, { cacheKey });
      return buildJsonResponse(withMeta(cached, {
        cacheHit: true,
        mode: 'cache',
        stale: true,
        cacheReason: String(error?.message || error || 'cache fallback'),
      }));
    }
    if (cached) {
      logger.warn('server cache fallback rejected because cache is stale', {
        cacheKey,
        generatedAt: cacheGeneratedAt(cached),
        reason: String(error?.message || error || 'cache fallback'),
      });
    }
    logger.metric('api.cache_miss', 1, { cacheKey });
    throw error;
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  return JSON.parse(text);
}

async function fetchJsonWithTimeout(url, timeoutMs = SIDECAR_PROXY_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }
    return {
      ok: response.ok,
      status: response.status,
      payload,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function buildSidecarProxyPayload(endpoint) {
  try {
    const result = await fetchJsonWithTimeout(`${SIDECAR_BASE_URL}${endpoint}`);
    return {
      ok: result.ok,
      status: result.status,
      sidecarBaseUrl: SIDECAR_BASE_URL,
      endpoint,
      payload: result.payload,
    };
  } catch (error) {
    return {
      ok: false,
      status: 503,
      sidecarBaseUrl: SIDECAR_BASE_URL,
      endpoint,
      error: String(error?.message || error),
    };
  }
}

function normalizeTemperatureValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value, minimum, maximum) {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function timestampMs(value) {
  const iso = toIsoTimestamp(value);
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function latestIsoTimestampFrom(...values) {
  const max = values
    .flat()
    .map(timestampMs)
    .filter((value) => Number.isFinite(value))
    .reduce((current, value) => Math.max(current, value), 0);
  return max > 0 ? new Date(max).toISOString() : null;
}

function ageHoursFrom(value, now = new Date()) {
  const ms = timestampMs(value);
  if (!ms) return null;
  return Math.max(0, (now.getTime() - ms) / 36e5);
}

function isFreshWithinHours(value, maxAgeHours, now = new Date()) {
  const age = ageHoursFrom(value, now);
  return age != null && age <= maxAgeHours;
}

function cacheGeneratedAt(payload) {
  return toIsoTimestamp(payload?.meta?.generatedAt || payload?.generatedAt || payload?.meta?.updatedAt || payload?.updatedAt);
}

function canUseServerCacheFallback(cacheKey, payload, now = new Date()) {
  const generatedAt = cacheGeneratedAt(payload);
  if (!generatedAt) return false;
  const ageMs = now.getTime() - Date.parse(generatedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0) return false;
  const key = String(cacheKey || '');
  const ttlMs = key === 'today' || key === 'live-status'
    ? Math.min(SERVER_CACHE_FALLBACK_TTL_MS, 15 * 60 * 1000)
    : SERVER_CACHE_FALLBACK_TTL_MS;
  return ageMs <= ttlMs;
}

function normalizeSignalQueueTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function classifyTemperature(intensity) {
  if (intensity >= 0.8) return 'HOT';
  if (intensity >= 0.45) return 'WARM';
  if (intensity >= 0.2) return 'COOL';
  return 'COLD';
}

function isOpaqueDiscoveryTheme(value) {
  return OPAQUE_DISCOVERY_THEME_PATTERN.test(String(value || '').trim());
}

function normalizeDashboardThemeKey(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === 'unknown' || isOpaqueDiscoveryTheme(raw)) return null;
  const canonical = mapThemeToTaxonomy(raw);
  return canonical && canonical !== 'unknown' ? canonical : null;
}

function inferArticleDashboardTheme(row) {
  const explicit = normalizeDashboardThemeKey(row?.raw_theme)
    || normalizeDashboardThemeKey(row?.auto_theme)
    || normalizeDashboardThemeKey(row?.theme_key)
    || normalizeDashboardThemeKey(row?.theme)
    || normalizeDashboardThemeKey(row?.legacy_theme);
  if (explicit) return explicit;

  const ranked = rankThemesForText(
    [row?.title, row?.summary, row?.source].filter(Boolean).join(' '),
    { includeParents: false, limit: 1 },
  );
  const best = ranked[0];
  return best && Number(best.score || 0) >= 0.8 ? best.theme : null;
}

function decodeDashboardHtmlEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
    })
    .replace(/&#(\d+);/g, (_, decimal) => {
      const codePoint = Number.parseInt(decimal, 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
    })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function sanitizeArticleDisplaySource(source, title = '') {
  const rawSource = decodeDashboardHtmlEntities(source).trim();
  const rawTitle = decodeDashboardHtmlEntities(title).trim();
  const cleanedSource = rawSource
    .replace(/\s+source(?:\s+\d{8})?$/i, '')
    .replace(/^codex\s+(?:e2e|retest)\s+/i, '')
    .trim();
  if (!cleanedSource.toLowerCase().startsWith('google news:')) return cleanedSource;

  const titleParts = rawTitle.split(/\s[-–—]\s/).map((part) => part.trim()).filter(Boolean);
  const publisher = titleParts.length > 1 ? titleParts.at(-1) : null;
  return publisher || 'Google News';
}

function shouldRenderTodayEvent(event) {
  return Boolean(String(event?.title || '').trim() && normalizeDashboardThemeKey(event?.theme));
}

function mapExpectedReactions(rows) {
  return rows.slice(0, 5).map((row) => {
    const magnitude = Number(row.avg_return ?? row.avgReturn ?? 0);
    return {
      symbol: String(row.symbol || ''),
      direction: magnitude >= 0 ? 'up' : 'down',
      magnitude: Math.abs(magnitude),
    };
  });
}

function periodToDays(period) {
  switch (String(period || '').trim().toLowerCase()) {
    case 'week':
      return 7;
    case 'month':
      return 30;
    case 'year':
      return 365;
    default:
      return 90;
  }
}

async function readPersistentCachePayload(cacheKey) {
  const filePath = path.join('data', 'persistent-cache', `${encodeURIComponent(cacheKey)}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const payload = JSON.parse(await readFile(filePath, 'utf8'));
    return payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  } catch {
    return null;
  }
}

async function buildMapLensOverlayPayload(params) {
  const filter = normalizeLensFilter(params.get('filter'));
  const theme = String(params.get('theme') || '').trim().toLowerCase();
  const days = periodToDays(params.get('period'));

  const [eventRows, e2Rows, transmissionCache] = await Promise.all([
    safeQuery(`
      SELECT id, theme, representative_title, event_date, COALESCE(article_count, 0)::int AS article_count, COALESCE(source_count, 0)::int AS source_count
      FROM canonical_events
      WHERE event_date >= CURRENT_DATE - ($1 * INTERVAL '1 day')
      ORDER BY event_date DESC, article_count DESC, source_count DESC
      LIMIT 180
    `, [days]),
    safeQuery(`
      WITH article_quality AS (
        SELECT aem.canonical_event_id,
               COUNT(*) FILTER (WHERE a.market_relevance IS NOT NULL)::int AS known_market_relevance_articles,
               COUNT(*) FILTER (WHERE a.market_relevance IN ('high', 'medium'))::int AS market_relevant_articles,
               COUNT(*) FILTER (WHERE a.market_relevance = 'low')::int AS low_relevance_articles
          FROM article_event_map aem
          JOIN articles a ON a.id = aem.article_id
         GROUP BY aem.canonical_event_id
      )
      SELECT
        ce.id AS canonical_event_id,
        ce.theme,
        ce.representative_title,
        ce.event_date,
        eu.symbol,
        eu.horizon,
        eu.uplift,
        eu.t_stat,
        eu.n_controls,
        eu.evidence_grade
      FROM event_uplift eu
      JOIN canonical_events ce ON ce.id = eu.canonical_event_id
      LEFT JOIN article_quality aq ON aq.canonical_event_id = ce.id
      WHERE eu.evidence_grade = 'E2'
        AND ABS(COALESCE(eu.t_stat, 0)) >= 2
        AND COALESCE(eu.n_controls, 0) >= ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
        AND NOT (
          COALESCE(aq.known_market_relevance_articles, 0) > 0
          AND COALESCE(aq.market_relevant_articles, 0) = 0
          AND COALESCE(aq.low_relevance_articles, 0) > 0
        )
        AND ce.event_date >= CURRENT_DATE - ($1 * INTERVAL '1 day')
      ORDER BY ABS(COALESCE(eu.uplift, 0)) DESC, ABS(COALESCE(eu.t_stat, 0)) DESC, ce.event_date DESC
      LIMIT 80
    `, [Math.max(days, 30)]),
    readPersistentCachePayload('event-market-transmission:v1'),
  ]);

  const eventMarkers = eventRows.rows
    .map((row) => {
      const eventTheme = String(row.theme || '').trim().toLowerCase();
      const title = String(row.representative_title || '').trim();
      const text = normalizeLensText(eventTheme, title);
      if (theme && !text.includes(theme)) return null;
      if (!matchesLensFilter(filter, text)) return null;
      const anchor = inferMapLensAnchor(title, eventTheme, filter);
      if (!anchor) return null;
      return {
        id: `event-${row.id}`,
        title,
        theme: eventTheme || null,
        lat: anchor.lat,
        lon: anchor.lon,
        intensity: Math.max(1, Number(row.article_count || 0) * 0.8 + Number(row.source_count || 0) * 1.2),
        publishedAt: row.event_date ? new Date(row.event_date).toISOString() : null,
      };
    })
    .filter(Boolean)
    .slice(0, 36);

  const e2Signals = e2Rows.rows
    .map((row) => {
      const eventTheme = String(row.theme || '').trim().toLowerCase();
      const title = String(row.representative_title || '').trim();
      const text = normalizeLensText(eventTheme, title, row.symbol);
      if (theme && !text.includes(theme)) return null;
      if (!matchesLensFilter(filter, text)) return null;
      const anchor = inferMapLensAnchor(title, eventTheme, filter);
      if (!anchor) return null;
      return {
        id: `e2-${row.canonical_event_id}-${String(row.symbol || '').toLowerCase()}`,
        title,
        theme: eventTheme || null,
        symbol: String(row.symbol || '').trim() || null,
        horizon: String(row.horizon || '').trim() || null,
        evidenceGrade: String(row.evidence_grade || '').trim() || null,
        uplift: Number.isFinite(Number(row.uplift)) ? Number(row.uplift) : null,
        tStat: Number.isFinite(Number(row.t_stat)) ? Number(row.t_stat) : null,
        lat: anchor.lat,
        lon: anchor.lon,
        publishedAt: row.event_date ? new Date(row.event_date).toISOString() : null,
      };
    })
    .filter(Boolean)
    .slice(0, 24);

  const transmissionSnapshot = transmissionCache?.snapshot && typeof transmissionCache.snapshot === 'object'
    ? transmissionCache.snapshot
    : transmissionCache;
  const transmissionEdges = Array.isArray(transmissionSnapshot?.edges) ? transmissionSnapshot.edges : [];
  const transmissionArcs = transmissionEdges
    .map((edge, index) => {
      const title = String(edge?.eventTitle || '').trim();
      const relationType = String(edge?.relationType || '').trim().toLowerCase();
      const text = normalizeLensText(title, edge?.marketSymbol, relationType);
      if (theme && !text.includes(theme)) return null;
      if (!matchesLensFilter(filter, text)) return null;
      const source = inferMapLensAnchor(title, '', filter);
      const target = TRANSMISSION_TARGETS[relationType] || TRANSMISSION_TARGETS.country;
      const strength = Number(edge?.strength || 0);
      if (!source || !target || !Number.isFinite(strength) || strength <= 0) return null;
      return {
        id: `transmission-${index}-${relationType}-${String(edge?.marketSymbol || 'edge').toLowerCase()}`,
        title,
        relationType,
        strength,
        sourceLat: source.lat,
        sourceLon: source.lon,
        targetLat: target.lat,
        targetLon: target.lon,
        targetLabel: String(edge?.marketSymbol || target.label || 'Transmission'),
      };
    })
    .filter(Boolean)
    .slice(0, 28);

  return {
    generatedAt: new Date().toISOString(),
    filter,
    eventMarkers,
    e2Signals,
    transmissionArcs,
    summary: {
      events: eventMarkers.length,
      e2Signals: e2Signals.length,
      transmissionArcs: transmissionArcs.length,
    },
  };
}

async function buildLiveStatus() {
  const now = new Date();
  const [signalState, quoteFeed, tempsR, pendingR, articlesR, recentThemesR] = await Promise.all([
    loadLatestSignalsWithQuality(),
    detectLiveQuoteFeed(),
    safeQuery(`
      SELECT DISTINCT ON (theme) theme, normalized_temperature, event_date, updated_at
      FROM event_hawkes_intensity
      ORDER BY theme, event_date DESC
    `),
    safeQuery(`
      SELECT COUNT(*)::int AS count
      FROM pending_outcomes
      WHERE status IN ('pending', 'waiting')
    `),
    safeQuery(`
      SELECT COUNT(*)::int AS count, MAX(published_at) AS latest_published_at
      FROM articles
      WHERE published_at >= NOW() - INTERVAL '24 hours'
    `),
    safeQuery(`
      WITH recent_theme_rows AS (
        SELECT
          CASE
            WHEN COALESCE(NULLIF(TRIM(t.theme_key), ''), NULLIF(TRIM(t.auto_theme), '')) = 'tech' THEN 'technology-general'
            WHEN COALESCE(NULLIF(TRIM(t.theme_key), ''), NULLIF(TRIM(t.auto_theme), '')) = 'economy' THEN 'macroeconomics'
            WHEN COALESCE(NULLIF(TRIM(t.theme_key), ''), NULLIF(TRIM(t.auto_theme), '')) = 'politics' THEN 'geopolitics'
            WHEN COALESCE(NULLIF(TRIM(t.theme_key), ''), NULLIF(TRIM(t.auto_theme), '')) = 'energy' THEN 'clean-energy'
            ELSE COALESCE(NULLIF(TRIM(t.theme_key), ''), NULLIF(TRIM(t.auto_theme), ''))
          END AS theme,
          a.published_at
        FROM auto_article_themes t
        JOIN articles a ON a.id = t.article_id
        WHERE a.published_at >= NOW() - INTERVAL '7 days'
      )
      SELECT theme, COUNT(*)::int AS count, MAX(published_at) AS latest_published_at
      FROM recent_theme_rows
      WHERE theme IS NOT NULL
        AND theme <> ''
        AND theme !~* '^dt-[a-z0-9]+$'
        AND theme <> 'unknown'
      GROUP BY theme
      ORDER BY count DESC
      LIMIT 8
    `),
  ]);

  const freshHawkesRows = tempsR.rows.filter((row) => (
    isFreshWithinHours(row.event_date, HOT_THEME_HAWKES_MAX_AGE_HOURS, now)
    || isFreshWithinHours(row.updated_at, HOT_THEME_HAWKES_MAX_AGE_HOURS, now)
  ));
  const temperatureRows = freshHawkesRows.length > 0 ? freshHawkesRows : recentThemesR.rows;
  const temperatureSource = freshHawkesRows.length > 0 ? 'event_hawkes_intensity' : 'recent_article_themes';
  const maxRecentThemeCount = Math.max(...recentThemesR.rows.map((row) => Number(row.count || 0)), 1);
  const temperatures = temperatureRows
    .filter((row) => !isOpaqueDiscoveryTheme(row.theme))
    .map((row) => {
      const intensity = normalizeTemperatureValue(
        row.normalized_temperature ?? Math.min(1, Number(row.count || 0) / maxRecentThemeCount),
      );
      return {
        theme: String(row.theme || 'unknown'),
        temperature: classifyTemperature(intensity),
        intensity,
        updatedAt: row.updated_at || row.latest_published_at || row.event_date || null,
        source: temperatureSource,
      };
    });

  const signals = signalState.rows.map((row) => {
    const channel = String(row.signal_name || '');
    return {
      channel,
      value: Number(row.value || 0),
      label: SIGNAL_LABELS[channel] || channel,
      updatedAt: row.ts,
      quality: row.quality,
    };
  });
  const articleCount24h = Number(articlesR.rows[0]?.count || 0);
  const latestArticlePublishedAt = toIsoTimestamp(articlesR.rows[0]?.latest_published_at);
  const articleAgeHours = latestArticlePublishedAt ? ageHoursFrom(latestArticlePublishedAt, now) : null;
  const articlesStale = !latestArticlePublishedAt || Number(articleAgeHours) > ARTICLE_LIVE_MAX_AGE_HOURS;
  const latestSignalAt = latestIsoTimestampFrom(signals.map((row) => row.updatedAt));
  const latestTemperatureAt = latestIsoTimestampFrom(temperatures.map((row) => row.updatedAt));
  const dataUpdatedAt = latestIsoTimestampFrom(latestArticlePublishedAt, latestSignalAt, latestTemperatureAt);

  return {
    temperatures,
    signals,
    signalQuality: signalState.qualityBySignal,
    pending: Number(pendingR.rows[0]?.count || 0),
    todayArticles: articleCount24h,
    articleFreshness: {
      latestPublishedAt: latestArticlePublishedAt,
      ageHours: Number.isFinite(articleAgeHours) ? Math.round(articleAgeHours * 10) / 10 : null,
      stale: articlesStale,
      count24h: articleCount24h,
      maxAgeHours: ARTICLE_LIVE_MAX_AGE_HOURS,
    },
    temperatureSource,
    temperatureFreshness: {
      source: temperatureSource,
      fallbackUsed: freshHawkesRows.length === 0 && tempsR.rows.length > 0,
      reason: freshHawkesRows.length === 0 && tempsR.rows.length > 0
        ? 'event_hawkes_intensity is stale; using recent article themes'
        : null,
    },
    meta: {
      mode: signalState.mode,
      dataUpdatedAt,
      latestInternalUpdatedAt: dataUpdatedAt,
      stale: signalState.stale || quoteFeed.status !== 'configured' || articlesStale,
      staleReason: [
        signalState.staleReason,
        quoteFeed.status === 'configured' ? null : quoteFeed.reason,
        articlesStale ? `article age ${articleAgeHours == null ? 'unknown' : Math.round(articleAgeHours)}h exceeds ${ARTICLE_LIVE_MAX_AGE_HOURS}h threshold` : null,
      ].filter(Boolean).join('; ') || null,
      quoteFeed,
    },
  };
}

/**
 * Pure: merge nowcast rows into the observed lookup/originMap so that KPI
 * payloads show estimated values when observed is missing or non-observed.
 * Extracted for testability (buildSignalSummary wires the pg calls).
 *
 * @param {{lookup: Record<string, unknown>, originMap: Record<string, any>,
 *          nowcasts: Record<string, any>}} args
 * @returns {{lookup: Record<string, unknown>, originMap: Record<string, any>,
 *            nowcastSummary: Record<string, any>, anyEstimated: boolean}}
 */
async function loadLatestNowcastsForSignals(signalNames) {
  if (!Array.isArray(signalNames) || !signalNames.length) return {};
  // estimated_signal_nowcasts may not exist yet (Phase 1 migration pending)
  const tableCheck = await safeQuery(`SELECT to_regclass('estimated_signal_nowcasts') AS t`);
  if (!tableCheck.rows?.[0]?.t) return {};
  // Also ensure model_registry exists — we filter fused nowcasts to only
  // models whose promotion_state ∈ ('shadow','active'). Without that gate
  // a gate-failing candidate model would silently leak to the dashboard.
  const registryCheck = await safeQuery(`SELECT to_regclass('model_registry') AS t`);
  if (!registryCheck.rows?.[0]?.t) return {};
  const { rows } = await safeQuery(`
    SELECT DISTINCT ON (est.signal_name)
      est.signal_name, est.target_ts, est.estimated_value, est.estimate_method,
      est.estimate_confidence, est.interval_low, est.interval_high,
      est.feature_vintage_at, est.derived_from_sources, est.last_observed_at, est.created_at,
      est.model_version, mr.promotion_state
    FROM estimated_signal_nowcasts est
    JOIN model_registry mr
      ON mr.target_signal = est.signal_name
     AND mr.model_version = est.model_version
    WHERE est.signal_name = ANY($1)
      AND est.last_observed_at IS NULL
      AND mr.promotion_state IN ('shadow','active')
    ORDER BY est.signal_name, est.created_at DESC
  `, [signalNames]);
  return Object.fromEntries(rows.map((row) => [String(row.signal_name), row]));
}

async function buildSignalSummary() {
  const [signalState, quoteFeed, vixHistoryR] = await Promise.all([
    loadLatestSignalsWithQuality(),
    detectLiveQuoteFeed(),
    safeQuery(`
      SELECT ts, value
      FROM signal_history
      WHERE signal_name = 'vix'
        AND ts >= NOW() - INTERVAL '30 days'
      ORDER BY ts
      LIMIT 64
    `),
  ]);

  const rows = signalState.rows;
  const lookup = Object.fromEntries(rows.map((row) => [row.signal_name, row.value]));
  const originMap = signalState.originBySignal || {};

  // Fuse in nowcasts for signals where the observed value is missing or
  // non-observed (proxy/composite). Never overwrite observed values.
  const nowcastCandidates = new Set();
  for (const key of ['vix', 'yieldSpread', 'hy_credit_spread', 'treasury10y', 'ig_credit_spread', 'oilPrice', 'dollarIndex', 'marketStress', 'transmissionStrength']) {
    const origin = originMap[key]?.valueOrigin;
    if (origin !== 'observed') nowcastCandidates.add(key);
    if (lookup[key] == null || !Number.isFinite(Number(lookup[key]))) nowcastCandidates.add(key);
  }
  const nowcasts = await loadLatestNowcastsForSignals(Array.from(nowcastCandidates));
  const fused = fuseNowcastsIntoLookup({ lookup, originMap, nowcasts });
  const fusedLookup = fused.lookup;
  const fusedOriginMap = fused.originMap;
  const nowcastSummary = fused.nowcastSummary;
  const anyEstimated = fused.anyEstimated;

  const vix = Number(fusedLookup.vix);
  const riskGauge = Number.isFinite(vix)
    ? Number(clamp(45 + (vix - 20) * 2, 4, 100).toFixed(1))
    : null;
  const riskState = Number.isFinite(vix)
    ? (vix > 25 ? 'risk-off' : vix < 18 ? 'risk-on' : 'balanced')
    : null;

  const responseMode = anyEstimated ? 'nowcast' : signalState.mode;

  return {
    vix: Number.isFinite(vix) ? vix : null,
    yieldSpread: Number.isFinite(Number(fusedLookup.yieldSpread)) ? Number(fusedLookup.yieldSpread) : null,
    oilPrice: Number.isFinite(Number(fusedLookup.oilPrice)) ? Number(fusedLookup.oilPrice) : null,
    dollarIndex: Number.isFinite(Number(fusedLookup.dollarIndex)) ? Number(fusedLookup.dollarIndex) : null,
    hyCreditSpread: Number.isFinite(Number(fusedLookup.hy_credit_spread)) ? Number(fusedLookup.hy_credit_spread) : null,
    marketStress: Number.isFinite(Number(fusedLookup.marketStress)) ? Number(fusedLookup.marketStress) : null,
    riskGauge,
    riskState,
    vixHistory: vixHistoryR.rows.map((row) => Number(row.value || 0)).filter((value) => Number.isFinite(value)),
    rows,
    signalQuality: signalState.qualityBySignal,
    signalOrigin: fusedOriginMap,
    nowcasts: nowcastSummary,
    meta: {
      mode: responseMode,
      stale: signalState.stale || quoteFeed.status !== 'configured',
      staleReason: [signalState.staleReason, quoteFeed.status === 'configured' ? null : quoteFeed.reason].filter(Boolean).join('; ') || null,
      quoteFeed,
    },
  };
}

async function buildHeatmap() {
  const primary = await safeQuery(`
    WITH ranked AS (
      SELECT
        theme,
        symbol,
        hit_rate,
        avg_return,
        sample_size,
        ABS(sensitivity_zscore) AS zscore,
        ROW_NUMBER() OVER (PARTITION BY theme ORDER BY ABS(sensitivity_zscore) DESC, sample_size DESC) AS theme_rank
      FROM stock_sensitivity_matrix
      WHERE horizon = '2w'
    ),
    top_themes AS (
      SELECT theme
      FROM ranked
      GROUP BY theme
      ORDER BY MAX(zscore) DESC NULLS LAST, SUM(sample_size) DESC
      LIMIT 8
    ),
    top_symbols AS (
      SELECT symbol
      FROM ranked
      GROUP BY symbol
      ORDER BY MAX(zscore) DESC NULLS LAST, SUM(sample_size) DESC
      LIMIT 10
    )
    SELECT r.theme, r.symbol, r.hit_rate, r.avg_return
    FROM ranked r
    JOIN top_themes tt ON tt.theme = r.theme
    JOIN top_symbols ts ON ts.symbol = r.symbol
    WHERE r.theme_rank <= 10
    ORDER BY r.theme, r.symbol
  `);

  const rows = primary.rows.length > 0
    ? primary.rows
    : (await safeQuery(`
      SELECT theme, symbol, AVG(hit::int)::float AS hit_rate, AVG(forward_return_pct)::float AS avg_return
      FROM labeled_outcomes
      WHERE horizon = '2w'
      GROUP BY theme, symbol
      ORDER BY theme, symbol
      LIMIT 120
    `)).rows;

  const themes = Array.from(new Set(rows.map((row) => String(row.theme || 'unknown'))));
  const symbols = Array.from(new Set(rows.map((row) => String(row.symbol || ''))));
  const cells = rows.map((row) => ({
    theme: String(row.theme || 'unknown'),
    symbol: String(row.symbol || ''),
    hitRate: Number(row.hit_rate || 0),
    avgReturn: Number(row.avg_return || 0),
  }));

  return { themes, symbols, cells };
}

async function materializeTodayEvents(articleRows, window) {
  if (!articleRows.length) {
    return { events: [], meta: { window: 'collecting' } };
  }

  const articleIds = articleRows.map((row) => Number(row.id)).filter(Number.isFinite);
  const themesR = articleIds.length > 0
    ? await safeQuery(`
      SELECT
        article_id,
        auto_theme,
        theme_key,
        COALESCE(NULLIF(TRIM(theme_key), ''), NULLIF(TRIM(auto_theme), '')) AS raw_theme
      FROM auto_article_themes
      WHERE article_id = ANY($1::int[])
    `, [articleIds])
    : { rows: [] };

  const themeByArticle = new Map();
  for (const row of themesR.rows) {
    const articleId = Number(row.article_id);
    if (!Number.isFinite(articleId) || themeByArticle.has(articleId)) continue;
    const theme = inferArticleDashboardTheme(row);
    if (theme) themeByArticle.set(articleId, theme);
  }
  for (const row of articleRows) {
    const articleId = Number(row.id);
    if (!Number.isFinite(articleId) || themeByArticle.has(articleId)) continue;
    const theme = inferArticleDashboardTheme(row);
    if (theme) themeByArticle.set(articleId, theme);
  }

  const distinctThemes = Array.from(new Set([...themeByArticle.values()].filter(Boolean)));
  const sensitivityR = distinctThemes.length > 0
    ? await safeQuery(`
      SELECT theme, symbol, avg_return
      FROM stock_sensitivity_matrix
      WHERE horizon = '2w' AND theme = ANY($1::text[])
      ORDER BY theme, ABS(avg_return) DESC
    `, [distinctThemes])
    : { rows: [] };

  const reactionsByTheme = new Map();
  for (const row of sensitivityR.rows) {
    const theme = String(row.theme || 'unknown');
    const bucket = reactionsByTheme.get(theme) || [];
    bucket.push(row);
    reactionsByTheme.set(theme, bucket);
  }

  const events = articleRows
    .map((row) => {
      const theme = themeByArticle.get(Number(row.id)) || null;
      return {
        title: decodeDashboardHtmlEntities(row.title || ''),
        source: sanitizeArticleDisplaySource(row.source, row.title),
        publishedAt: row.published_at,
        theme,
        expectedReactions: mapExpectedReactions(reactionsByTheme.get(theme) || []),
      };
    })
    .filter(shouldRenderTodayEvent)
    .slice(0, 40);

  return {
    events,
    meta: {
      window,
      dataUpdatedAt: latestIsoTimestampFrom((events.length > 0 ? events : articleRows).map((row) => row.publishedAt || row.published_at)),
    },
  };
}

async function buildTodayEvents() {
  const recent24h = await safeQuery(`
    SELECT id, title, summary, source, published_at, theme, legacy_theme
    FROM articles
    WHERE published_at >= NOW() - INTERVAL '24 hours'
    ORDER BY published_at DESC
    LIMIT 240
  `);

  if (recent24h.rows.length > 0) {
    const today = await materializeTodayEvents(recent24h.rows, '24h');
    if (today.events.length > 0) return today;
  }

  const fallbackRows = (await safeQuery(`
      SELECT id, title, summary, source, published_at, theme, legacy_theme
      FROM articles
      WHERE published_at >= NOW() - INTERVAL '7 days'
      ORDER BY published_at DESC
      LIMIT 500
    `)).rows;
  return materializeTodayEvents(fallbackRows, '7d-fallback');
}

async function buildStrategies(params) {
  const theme = String(params.get('theme') || '').trim();
  const symbol = String(params.get('symbol') || '').trim().toUpperCase();

  const primary = await safeQuery(`
    SELECT
      CONCAT(theme, ' / ', symbol, COALESCE(' ' || direction, '')) AS name,
      sharpe_ratio,
      COALESCE(avg_pnl_pct, total_return_pct, 0) AS expected_return,
      COALESCE(max_drawdown_pct, 0) AS max_drawdown,
      theme
    FROM whatif_simulations
    WHERE ($1 = '' OR theme = $1) AND ($2 = '' OR symbol = $2)
    ORDER BY sharpe_ratio DESC
    LIMIT 12
  `, [theme, symbol]);

  const rows = primary.rows.length > 0
    ? primary.rows
    : (await safeQuery(`
      SELECT
        CONCAT(theme, ' / ', symbol) AS name,
        CASE
          WHEN COALESCE(return_vol, 0) > 0 THEN avg_return / NULLIF(return_vol, 0)
          ELSE avg_return
        END AS sharpe_ratio,
        avg_return AS expected_return,
        COALESCE(baseline_vol, return_vol, 0) AS max_drawdown,
        theme
      FROM stock_sensitivity_matrix
      WHERE horizon = '2w'
        AND ($1 = '' OR theme = $1)
        AND ($2 = '' OR symbol = $2)
      ORDER BY sharpe_ratio DESC NULLS LAST
      LIMIT 12
    `, [theme, symbol])).rows;

  return {
    strategies: rows.map((row) => ({
      name: String(row.name || `${row.theme || ''}`),
      sharpe: Number(row.sharpe_ratio || 0),
      expectedReturn: Number(row.expected_return || 0),
      maxDrawdown: Number(row.max_drawdown || 0),
      theme: String(row.theme || ''),
    })),
  };
}

function ageScore(ageMs, strongThresholdMs, weakThresholdMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0;
  if (ageMs <= strongThresholdMs) return 1;
  if (ageMs <= weakThresholdMs) return 0.5;
  return 0;
}

function computeApiHealthScore(metricsSnapshot) {
  const metrics = Array.isArray(metricsSnapshot?.metrics) ? metricsSnapshot.metrics : [];
  let requestCount = 0;
  let errorCount = 0;
  for (const metric of metrics) {
    if (metric?.name === 'api.request_count') requestCount += Number(metric.value || 0);
    if (metric?.name === 'api.error_count') errorCount += Number(metric.value || 0);
  }
  if (requestCount <= 0) return 1;
  const errorRate = clamp(errorCount / requestCount, 0, 1);
  return Number(clamp(1 - errorRate * 2, 0, 1).toFixed(4));
}

async function computeSystemHealth() {
  let dbHealthy = 1;
  try {
    await getPool().query('SELECT 1');
  } catch {
    dbHealthy = 0;
  }

  const [articlesFreshnessR, signalsFreshnessR, pendingR] = dbHealthy
    ? await Promise.all([
      safeQuery(`
        SELECT EXTRACT(EPOCH FROM (NOW() - MAX(published_at))) * 1000 AS age_ms,
               COUNT(*)::int AS count
        FROM articles
      `),
      safeQuery(`
        SELECT EXTRACT(EPOCH FROM (NOW() - MAX(ts))) * 1000 AS age_ms,
               COUNT(*)::int AS count
        FROM signal_history
      `),
      safeQuery(`
        SELECT COUNT(*)::int AS count
        FROM pending_outcomes
        WHERE status IN ('pending','waiting')
      `),
    ])
    : [{ rows: [] }, { rows: [] }, { rows: [] }];

  const articleAgeMs = Number(articlesFreshnessR.rows[0]?.age_ms);
  const signalAgeMs = Number(signalsFreshnessR.rows[0]?.age_ms);
  const articleCount = Number(articlesFreshnessR.rows[0]?.count || 0);
  const signalCount = Number(signalsFreshnessR.rows[0]?.count || 0);
  const pendingCount = Number(pendingR.rows[0]?.count || 0);

  const dataFreshness = articleCount > 0
    ? ageScore(articleAgeMs, 6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000)
    : 0;
  const signalFreshness = signalCount > 0
    ? ageScore(signalAgeMs, 18 * 60 * 60 * 1000, 72 * 60 * 60 * 1000)
    : 0;
  const apiHealth = computeApiHealthScore(logger.getMetrics());
  const compositeScore = Number((
    dbHealthy * 0.3
    + dataFreshness * 0.25
    + signalFreshness * 0.25
    + apiHealth * 0.2
  ).toFixed(4));
  const status = compositeScore >= 0.8
    ? 'healthy'
    : compositeScore >= 0.6
      ? 'degraded'
      : 'critical';

  return {
    status,
    compositeScore,
    components: {
      dbHealthy,
      dataFreshness,
      signalFreshness,
      apiHealth,
    },
    db: dbHealthy ? 'connected' : 'disconnected',
    articles: articleCount,
    signals: signalCount,
    pending: pendingCount,
    articleAgeMs: Number.isFinite(articleAgeMs) ? Math.round(articleAgeMs) : null,
    signalAgeMs: Number.isFinite(signalAgeMs) ? Math.round(signalAgeMs) : null,
    timestamp: new Date().toISOString(),
  };
}

async function buildHealth() {
  return computeSystemHealth();
}

async function buildDataQuality() {
  return computeDataQualityMetrics(getPool());
}

// ── /api/ops/status (S-Level Phase 7 minimal) ─────────────────────────────
// Single-pane operator health: services, freshness, model, recent issues.
// Designed to be the canonical "is the system healthy" endpoint.

const OPS_DAEMON_STATE_PATH = path.resolve('data', 'daemon-state.json');
const OPS_ACCUMULATOR_STATE_PATH = path.resolve('data', 'historical', 'accumulator-state.json');
const OPS_ALERTS_PATH = path.resolve('data', 'alerts.json');
const OPS_META_MODEL_URL = process.env.META_MODEL_URL || 'http://127.0.0.1:8100';
const OPS_DAEMON_FRESH_MS = 30 * 60 * 1000;       // 2x the 15-minute daemon tick
const OPS_ACCUMULATOR_FRESH_MS = 90 * 60 * 1000;  // accumulator cycles include slow network backfills
const OPS_HTTP_PROBE_TIMEOUT_MS = 1500;
const OPS_RECENT_ISSUE_LIMIT = 10;

async function probeFileService(stateFilePath, freshThresholdMs) {
  try {
    const { stat: statFn } = await import('node:fs/promises');
    const s = await statFn(stateFilePath);
    const ageMs = Date.now() - s.mtimeMs;
    return {
      status: ageMs <= freshThresholdMs ? 'ok' : 'stale',
      lastTickAt: new Date(s.mtimeMs).toISOString(),
      ageMs,
      ageMinutes: Math.round(ageMs / 60_000),
    };
  } catch {
    return { status: 'missing', lastTickAt: null, ageMs: null, ageMinutes: null };
  }
}

async function probeMetaModelService() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPS_HTTP_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${OPS_META_MODEL_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return {
      status: res.ok ? 'ok' : 'unhealthy',
      http: res.status,
      url: OPS_META_MODEL_URL,
    };
  } catch (err) {
    clearTimeout(timer);
    const reason = err?.name === 'AbortError' ? 'timeout' : String(err?.message || err);
    return { status: 'unreachable', http: null, url: OPS_META_MODEL_URL, reason };
  }
}

async function loadRecentOpsAlerts(limit = OPS_RECENT_ISSUE_LIMIT) {
  try {
    const raw = await readFile(OPS_ALERTS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => {
        const message = typeof entry?.message === 'string' ? entry.message : '';
        // Legacy read-only /api/calibration calls used to emit this as a
        // meta-model critical alert even though it measured sensitivity-matrix
        // calibration. Keep the raw log on disk, but do not surface it as an
        // active ops issue.
        return !(entry?.context?.type === 'model_drift' && message.startsWith('Meta-model calibration drift:'));
      })
      .slice(-limit)
      .reverse()
      .map((entry) => ({
        timestamp: entry?.timestamp ?? null,
        severity: entry?.severity ?? 'info',
        message: typeof entry?.message === 'string' ? entry.message.slice(0, 240) : '',
      }));
  } catch {
    return [];
  }
}

function rollUpOpsLevel({ daemon, accumulator, metaModel, modelLevel, freshness }) {
  // Critical conditions: master daemon stale/missing, meta-model unreachable, model failed.
  if (daemon.status !== 'ok') return 'critical';
  if (metaModel.status === 'unreachable' || modelLevel === 'critical') return 'critical';
  // Warning conditions: accumulator stale, calibration warning, feature lag, meta-model unhealthy.
  if (accumulator.status !== 'ok') return 'warning';
  if (modelLevel === 'warning') return 'warning';
  if (metaModel.status === 'unhealthy') return 'warning';
  if (Number.isFinite(freshness?.featureLagDays) && freshness.featureLagDays >= 1) return 'warning';
  if (Number.isFinite(freshness?.featureStaleEventCount) && freshness.featureStaleEventCount > 0) return 'warning';
  return 'ok';
}

async function buildOpsStatusPayload(pool) {
  const generatedAt = new Date().toISOString();

  // Run independent probes in parallel.
  const [daemon, accumulator, metaModel, recentIssues, modelHealth] = await Promise.all([
    probeFileService(OPS_DAEMON_STATE_PATH, OPS_DAEMON_FRESH_MS),
    probeFileService(OPS_ACCUMULATOR_STATE_PATH, OPS_ACCUMULATOR_FRESH_MS),
    probeMetaModelService(),
    loadRecentOpsAlerts(),
    buildMetaModelHealthPayload(pool).catch((err) => ({
      ok: false,
      error: String(err?.message || err),
      summary: {
        level: 'critical',
        pipelineFreshness: null,
        latestEval: null,
        activeModel: null,
        symbolCoverage: null,
      },
    })),
  ]);

  // buildMetaModelHealthPayload nests freshness/eval/activeModel/symbolCoverage
  // inside `.summary` (see scripts/_shared/event-intelligence-builder.mjs return shape).
  const modelSummary = modelHealth?.summary || {};
  const pipelineFreshness = modelSummary.pipelineFreshness || null;
  const symbolCoverage = modelSummary.symbolCoverage || null;
  const latestEval = modelSummary.latestEval || null;
  const activeModelName =
    modelSummary.activeModel?.modelVersion ||
    modelSummary.activeModel?.modelId ||
    modelSummary.activeModel?.model_version ||
    latestEval?.modelVersion ||
    latestEval?.model_version ||
    null;
  const modelLevel = modelSummary.level || 'unknown';
  const modelHealthStatus = modelSummary.healthStatus || modelLevel;

  const freshness = pipelineFreshness
    ? {
      latestArticleDateKey: pipelineFreshness.latestArticleDateKey ?? null,
      latestFeatureArticleDateKey: pipelineFreshness.latestFeatureArticleDateKey ?? null,
      latestPredictedArticleDateKey: pipelineFreshness.latestPredictedArticleDateKey ?? null,
      featureLagDays: pipelineFreshness.featureLagDays ?? null,
      featureLagHours: pipelineFreshness.featureLagHours ?? null,
      featureStaleEventCount: pipelineFreshness.featureStaleEventCount ?? 0,
      // S-Tier §A4: copy predictionStaleCount through so the actionableInstructions
      // builder can fire its threshold checks. The field is set by
      // buildMetaModelHealthPayload when model_predictions table exists.
      predictionStaleCount: pipelineFreshness.predictionStaleCount ?? 0,
      articles24h: pipelineFreshness.articles24h ?? 0,
      events24h: pipelineFreshness.events24h ?? 0,
    }
    : null;

  const summaryLevel = rollUpOpsLevel({ daemon, accumulator, metaModel, modelLevel, freshness });
  const summaryNotes = [];
  if (daemon.status !== 'ok') summaryNotes.push(`master-daemon ${daemon.status} (${daemon.ageMinutes ?? '?'} min)`);
  if (accumulator.status !== 'ok') summaryNotes.push(`data-accumulator ${accumulator.status}`);
  if (metaModel.status !== 'ok') summaryNotes.push(`meta-model server ${metaModel.status}`);
  if (Number.isFinite(freshness?.featureLagDays) && freshness.featureLagDays >= 1) {
    summaryNotes.push(`event_features lag ${freshness.featureLagDays.toFixed(0)}d`);
  }
  if (Number.isFinite(freshness?.featureStaleEventCount) && freshness.featureStaleEventCount > 0) {
    summaryNotes.push(`${freshness.featureStaleEventCount} stale feature rows`);
  }
  if (modelLevel === 'warning') {
    summaryNotes.push(modelSummary.notes?.[0] || 'model health warning');
  } else if (modelHealthStatus === 'watch') {
    summaryNotes.push(modelSummary.notes?.[0] || 'model watch: calibrated but monitor next validation fold');
  }

  // S-Tier §A4: actionable instructions. Each item is a concrete operator
  // command paired with the condition that triggered it, so a human (or a
  // dashboard) can immediately do the right thing without parsing every
  // sub-field. The master-daemon's existing 2h meta-model-infer task is the
  // self-heal path; these instructions cover the case where the daemon is
  // behind or the threshold has been crossed since the last tick.
  const actionableInstructions = [];
  if (daemon.status !== 'ok') {
    actionableInstructions.push({
      severity: 'critical',
      condition: `master-daemon is ${daemon.status} (${daemon.ageMinutes ?? '?'} min since last tick)`,
      action: 'Restart the master daemon: `npm run daemon` (or check the systemd/PM2 supervisor).',
    });
  }
  if (metaModel.status === 'unreachable') {
    actionableInstructions.push({
      severity: 'critical',
      condition: 'meta-model-server is unreachable',
      action: 'Restart: `python scripts/meta-model-server.py` and verify it binds 8100.',
    });
  }
  if (Number.isFinite(freshness?.featureStaleEventCount) && freshness.featureStaleEventCount > 0) {
    actionableInstructions.push({
      severity: 'warning',
      condition: `${freshness.featureStaleEventCount} stale event_features rows`,
      action: 'Run repair task once: `node scripts/master-daemon.mjs --task repair-stale-features --once`',
    });
  }
  if (Number.isFinite(freshness?.featureLagDays) && freshness.featureLagDays >= 1) {
    actionableInstructions.push({
      severity: 'warning',
      condition: `event_features lag ${freshness.featureLagDays.toFixed(0)} day(s) behind latest article date`,
      action: 'Trigger event-engine: `node scripts/incremental-event-engine-fast.mjs --skip-controls`',
    });
  }
  // Stale prediction surfacing — the value also lives on /api/hot-events
  // modelTrust, but we duplicate here so /api/ops/status alone can drive
  // the operator's day.
  const stalePredictionCount = Number(freshness?.predictionStaleCount ?? 0);
  if (stalePredictionCount >= 1000) {
    actionableInstructions.push({
      severity: 'critical',
      condition: `${stalePredictionCount} stale model_predictions (≥ 1000) — model-driven ranking is currently disabled in /api/hot-events`,
      action: 'Run: `node --import tsx scripts/meta-model-infer.mjs` to refresh predictions, or wait up to 2h for the master-daemon meta-model-infer cron.',
    });
  } else if (stalePredictionCount >= 200) {
    actionableInstructions.push({
      severity: 'warning',
      condition: `${stalePredictionCount} stale model_predictions (≥ 200)`,
      action: 'Predictions will refresh on the next master-daemon meta-model-infer cycle. To force now: `node --import tsx scripts/meta-model-infer.mjs`',
    });
  }
  if (modelHealthStatus === 'calibration-warning') {
    actionableInstructions.push({
      severity: 'warning',
      condition: `model calibration drifting (worst-split ECE ${(latestEval?.worstEce ?? 0).toFixed(3)})`,
      action: 'Re-calibrate: `python scripts/calibrate-meta-model.py --apply` and inspect data/meta-*.calibration.json.',
    });
  }

  return {
    ok: true,
    generatedAt,
    summary: {
      level: summaryLevel,
      notes: summaryNotes,
    },
    services: {
      api: { status: 'ok', port: Number(process.env.PORT || 46200) },
      masterDaemon: daemon,
      dataAccumulator: accumulator,
      metaModel,
    },
    freshness,
    model: {
      activeModel: activeModelName,
      healthStatus: modelHealthStatus,
      worstSplitECE: latestEval?.worstEce ?? null,
      worstSplitBrier: latestEval?.worstBrierScore ?? null,
      aggregateBrier: latestEval?.brierScore ?? null,
      aggregateECE: latestEval?.ece ?? null,
      effectiveBrier: modelSummary.effectiveMetrics?.brier ?? latestEval?.brierScore ?? null,
      effectiveECE: modelSummary.effectiveMetrics?.ece ?? latestEval?.ece ?? null,
      calibrated: Boolean(modelSummary.effectiveMetrics?.calibrated),
      calibration: modelSummary.calibration ?? null,
      promotionGates: Array.isArray(modelSummary.promotionGates) ? modelSummary.promotionGates : [],
      recommendedActions: Array.isArray(modelSummary.recommendedActions) ? modelSummary.recommendedActions : [],
      level: modelLevel,
    },
    symbolCoverage: symbolCoverage
      ? {
        themeCount: symbolCoverage.themeCount ?? 0,
        coveredThemeCount: symbolCoverage.coveredThemeCount ?? 0,
        coveragePct: symbolCoverage.coveragePct ?? 0,
        missingThemes: Array.isArray(symbolCoverage.missingThemes) ? symbolCoverage.missingThemes : [],
      }
      : null,
    actionableInstructions,
    recentIssues,
  };
}

function auditDateToken(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function normalizeFreshnessAuditPayload(payload, auditPath, extra = {}) {
  return {
    ok: true,
    auditPath: auditPath ? path.relative(process.cwd(), auditPath).replace(/\\/g, '/') : null,
    generatedAt: payload.generatedAt || null,
    summary: payload.summary || null,
    findings: Array.isArray(payload.findings) ? payload.findings : [],
    nas: payload.nas || null,
    backfill: payload.backfill || null,
    cache: {
      checkedFiles: payload.cache?.checkedFiles || 0,
      issues: Array.isArray(payload.cache?.issues) ? payload.cache.issues.slice(0, 20) : [],
    },
    ...extra,
  };
}

async function readLatestDataFreshnessAuditArtifact() {
  if (!existsSync(AUDIT_DIR)) {
    return {
      ok: false,
      error: 'No data freshness audit directory found',
      auditPath: null,
      summary: null,
      findings: [],
    };
  }
  const files = (await readdir(AUDIT_DIR))
    .filter((name) => /^data-freshness-\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort()
    .reverse();
  if (!files.length) {
    return {
      ok: false,
      error: 'No data freshness audit artifact found',
      auditPath: null,
      summary: null,
      findings: [],
    };
  }
  const file = files[0];
  const auditPath = path.join(AUDIT_DIR, file);
  const payload = JSON.parse(await readFile(auditPath, 'utf8'));
  return normalizeFreshnessAuditPayload(payload, auditPath, { source: 'artifact' });
}

async function writeDataFreshnessAuditArtifact(payload, now = new Date()) {
  await mkdir(AUDIT_DIR, { recursive: true });
  const auditPath = path.join(AUDIT_DIR, `data-freshness-${auditDateToken(now)}.json`);
  await writeFile(auditPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return auditPath;
}

async function loadLatestDataFreshnessAudit(options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  const existing = await readLatestDataFreshnessAuditArtifact();
  const existingAgeMs = existing.ok && existing.generatedAt
    ? Date.now() - Date.parse(existing.generatedAt)
    : Number.POSITIVE_INFINITY;
  if (!forceRefresh && existing.ok && Number.isFinite(existingAgeMs) && existingAgeMs >= 0 && existingAgeMs <= DATA_FRESHNESS_AUDIT_TTL_MS) {
    return existing;
  }

  const now = new Date();
  try {
    const audit = await buildFreshnessAudit({ cwd: process.cwd(), now, envFile: '.env.local' });
    const auditPath = await writeDataFreshnessAuditArtifact(audit, now);
    return normalizeFreshnessAuditPayload(audit, auditPath, { source: 'live-refresh' });
  } catch (error) {
    if (existing.ok) {
      return {
        ...existing,
        stale: true,
        refreshError: String(error?.message || error),
      };
    }
    return {
      ok: false,
      error: String(error?.message || error),
      auditPath: null,
      summary: null,
      findings: [],
    };
  }
}

async function readLatestSourceRepairAuditArtifact() {
  if (!existsSync(AUDIT_DIR)) {
    return {
      ok: false,
      error: 'No source repair audit directory found',
      auditPath: null,
      audit: null,
    };
  }
  const files = (await readdir(AUDIT_DIR))
    .filter((name) => /^source-repair-closed-loop-.*\.json$/.test(name))
    .sort()
    .reverse();
  if (!files.length) {
    return {
      ok: false,
      error: 'No source repair audit artifact found',
      auditPath: null,
      audit: null,
    };
  }
  const auditPath = path.join(AUDIT_DIR, files[0]);
  const audit = JSON.parse(await readFile(auditPath, 'utf8'));
  return {
    ok: audit?.ok !== false,
    auditPath: path.relative(process.cwd(), auditPath).replace(/\\/g, '/'),
    generatedAt: audit.finishedAt || audit.generatedAt || audit.startedAt || null,
    audit,
  };
}

function summarizeApprovalCounts(approvals = []) {
  const counts = {
    total: approvals.length,
    pending: 0,
    needsFix: 0,
    rejected: 0,
    executed: 0,
    sourceNeedsFix: 0,
  };
  for (const item of approvals) {
    const status = String(item?.status || 'unknown');
    if (status === 'pending') counts.pending += 1;
    if (status === 'needs-fix') counts.needsFix += 1;
    if (status === 'rejected') counts.rejected += 1;
    if (status === 'executed') counts.executed += 1;
    if (status === 'needs-fix' && String(item?.action_type || item?.actionType || '') === 'add-rss') {
      counts.sourceNeedsFix += 1;
    }
  }
  return counts;
}

async function buildSourceRepairStatusPayload() {
  const [audit, approvalQueue, freshness] = await Promise.all([
    readLatestSourceRepairAuditArtifact(),
    buildApprovalQueuePayload().catch(() => ({ approvals: [] })),
    loadLatestDataFreshnessAudit({ forceRefresh: false }).catch((error) => ({ ok: false, error: String(error?.message || error) })),
  ]);
  const approvals = Array.isArray(approvalQueue.approvals) ? approvalQueue.approvals : [];
  const historical = audit.audit?.historical && typeof audit.audit.historical === 'object' ? audit.audit.historical : {};
  const countedSuccesses = Number(audit.audit?.countedSuccesses ?? historical.eventMappedSources ?? 0);
  const targetSuccesses = Number(audit.audit?.targetSuccesses ?? 20);
  const sourceRepairSummary = {
    countedSuccesses,
    targetSuccesses,
    targetMet: countedSuccesses >= targetSuccesses,
    thisRunSuccesses: Number(audit.audit?.pipelineSuccesses ?? audit.audit?.successes?.length ?? 0),
    registeredSources: Number(historical.seededSources ?? 0),
    themedSources: Number(historical.themedSources ?? 0),
    eventMappedSources: Number(historical.eventMappedSources ?? 0),
    codexRepairActiveSources: Number(historical.codexRepairActiveSources ?? 0),
    codexRepairEventMappedSources: Number(historical.codexRepairEventMappedSources ?? 0),
    fullHeuristic: Boolean(audit.audit?.inputs?.fullHeuristic),
    catalogBootstrap: Boolean(audit.audit?.inputs?.catalogBootstrap),
    codeRepairEnabled: Boolean(audit.audit?.inputs?.enableCodeRepair),
  };
  return {
    ok: Boolean(audit.ok && sourceRepairSummary.targetMet),
    generatedAt: new Date().toISOString(),
    auditPath: audit.auditPath,
    sourceRepair: sourceRepairSummary,
    approval: summarizeApprovalCounts(approvals),
    freshness: {
      ok: freshness.ok !== false,
      articleCount24h: freshness.summary?.articleCount24h ?? null,
      articleCount72h: freshness.summary?.articleCount72h ?? null,
      latestPublishedAt: freshness.nas?.articles?.latestPublishedAt ?? null,
      findings: freshness.summary?.findings ?? null,
      cacheIssues: freshness.summary?.cacheIssues ?? null,
    },
    audit: audit.audit,
  };
}

async function buildCodexQuality() {
  let persistedMetrics = {
    totalCalls: 0,
    parseSuccess: 0,
    parseFail: 0,
    validationErrors: 0,
    avgConfidence: 0,
    parseSuccessRate: 0,
    lastCallAt: null,
    lastWarnings: [],
  };

  try {
    const metricsPath = path.resolve('data', 'codex-quality.json');
    if (existsSync(metricsPath)) {
      persistedMetrics = {
        ...persistedMetrics,
        ...JSON.parse(await readFile(metricsPath, 'utf8')),
      };
    }
  } catch {
    // best-effort metrics hydration
  }

  let promptMetrics = { prompts: {}, history: [] };
  try {
    const promptMetricsPath = path.resolve('data', 'codex-prompt-metrics.json');
    if (existsSync(promptMetricsPath)) {
      const parsed = JSON.parse(await readFile(promptMetricsPath, 'utf8'));
      if (parsed && typeof parsed === 'object') promptMetrics = parsed;
    }
  } catch {
    // best-effort prompt wrapper metrics hydration
  }

  const auditDirs = [
    path.resolve('data', 'automation', 'codex-audit'),
    path.resolve('codex-audit'),
  ].filter((dirPath, index, list) => list.indexOf(dirPath) === index);

  const auditEntries = [];
  for (const auditDir of auditDirs) {
    if (!existsSync(auditDir)) continue;
    const names = await readdir(auditDir).catch(() => []);
    for (const name of names.filter((value) => value.endsWith('.json')).slice(-50)) {
      try {
        const parsed = JSON.parse(await readFile(path.join(auditDir, name), 'utf8'));
        auditEntries.push(parsed);
      } catch {
        // ignore malformed audit rows
      }
    }
  }

  const successfulAuditProposals = auditEntries
    .map((entry) => entry?.proposal)
    .filter((proposal) => proposal && typeof proposal === 'object');
  const auditValidationWarnings = auditEntries.flatMap((entry) => {
    const direct = Array.isArray(entry?.validationWarnings) ? entry.validationWarnings : [];
    const nested = Array.isArray(entry?.proposal?.validationWarnings) ? entry.proposal.validationWarnings : [];
    return [...direct, ...nested];
  });
  const auditConfidenceValues = successfulAuditProposals
    .map((proposal) => Number(proposal.confidence))
    .filter((value) => Number.isFinite(value));
  const auditAvgConfidence = auditConfidenceValues.length > 0
    ? auditConfidenceValues.reduce((sum, value) => sum + value, 0) / auditConfidenceValues.length
    : 0;

  const totalCalls = Math.max(Number(persistedMetrics.totalCalls || 0), auditEntries.length);
  const parseSuccess = Math.max(Number(persistedMetrics.parseSuccess || 0), successfulAuditProposals.length);
  const parseFail = Math.max(Number(persistedMetrics.parseFail || 0), Math.max(0, totalCalls - parseSuccess));
  const validationErrors = Math.max(Number(persistedMetrics.validationErrors || 0), auditValidationWarnings.length);
  const avgConfidence = Number(persistedMetrics.avgConfidence || 0) > 0
    ? Number(persistedMetrics.avgConfidence)
    : auditAvgConfidence;
  const promptEntries = Object.values(promptMetrics.prompts || {}).filter((entry) => entry && typeof entry === 'object');
  const wrapperTotalCalls = promptEntries.reduce((sum, entry) => sum + Number(entry.totalCalls || 0), 0);
  const wrapperParseSuccess = promptEntries.reduce((sum, entry) => sum + Number(entry.parseSuccessCount || 0), 0);
  const wrapperParseFail = promptEntries.reduce((sum, entry) => sum + Number(entry.parseFailCount || 0), 0);
  const promptHistory = Array.isArray(promptMetrics.history) ? promptMetrics.history : [];
  const latestPrompt = promptHistory[0] || null;

  return {
    totalCalls,
    parseSuccess,
    parseFail,
    validationErrors,
    avgConfidence: Number(avgConfidence.toFixed(4)),
    parseSuccessRate: totalCalls > 0 ? Number((parseSuccess / totalCalls).toFixed(4)) : 0,
    lastCallAt: persistedMetrics.lastCallAt || null,
    lastWarnings: Array.isArray(persistedMetrics.lastWarnings) ? persistedMetrics.lastWarnings : [],
    recentAuditEntries: auditEntries.length,
    recentValidationWarnings: auditValidationWarnings.slice(-10),
    jsonWrapper: {
      totalCalls: wrapperTotalCalls,
      parseSuccess: wrapperParseSuccess,
      parseFail: wrapperParseFail,
      parseSuccessRate: wrapperTotalCalls > 0 ? Number((wrapperParseSuccess / wrapperTotalCalls).toFixed(4)) : 0,
      latestLabel: latestPrompt?.label || null,
      latestModel: latestPrompt?.model || null,
      latestFailureKind: latestPrompt?.failureKind || null,
      latestAttempts: Number(latestPrompt?.attempts || 0),
      latestParsed: latestPrompt ? Boolean(latestPrompt.parsed) : null,
      latestAt: latestPrompt?.at || null,
    },
  };
}

async function buildEmergingTechList(includeNoise = false) {
  const noiseFilter = includeNoise ? '' : "AND COALESCE(category, '') != 'other'";
  const { rows } = await safeQuery(`
    SELECT
      id,
      COALESCE(label, initcap(array_to_string(keywords[1:3], ' '))) AS label,
      description,
      category,
      stage,
      article_count,
      momentum,
      research_momentum,
      source_quality_score,
      source_quality_breakdown,
      novelty,
      diversity,
      cohesion,
      parent_theme,
      status,
      updated_at
    FROM discovery_topics
    WHERE status IN ('labeled', 'reported') ${noiseFilter}
    ORDER BY momentum DESC NULLS LAST, article_count DESC
    LIMIT 50
  `);
  return {
    topics: rows.map((row) => ({
      id: String(row.id || ''),
      label: String(row.label || ''),
      description: String(row.description || ''),
      category: String(row.category || ''),
      stage: String(row.stage || ''),
      articleCount: Number(row.article_count || 0),
      momentum: Number(row.momentum || 0),
      researchMomentum: Number(row.research_momentum || 0),
      sourceQualityScore: Number(row.source_quality_score || 0),
      sourceQualityBreakdown: row.source_quality_breakdown || {},
      novelty: Number(row.novelty || 0),
      diversity: Number(row.diversity || 0),
      cohesion: Number(row.cohesion || 0),
      parentTheme: String(row.parent_theme || 'emerging-tech'),
      status: String(row.status || 'pending'),
      updatedAt: row.updated_at,
    })),
  };
}

async function buildEmergingTechDetail(topicId) {
  const topicResponse = await safeQuery(`
    SELECT *
    FROM discovery_topics
    WHERE id = $1
    LIMIT 1
  `, [topicId]);
  const topic = topicResponse.rows[0];
  if (!topic) {
    return { topic: null, report: null, symbols: [], articles: [], latestLinkedArticles: [], articleMeta: null };
  }

  const articleProfile = buildTopicArticleProfile(topic);
  const allQueryTerms = [...articleProfile.strong, ...articleProfile.support, ...(articleProfile.geoContext || []), ...(articleProfile.focusTerms || [])];
  const candidateTermCount = Math.min(allQueryTerms.length, 16);
  const candidateWhere = allQueryTerms
    .slice(0, candidateTermCount)
    .map((_, index) => `(a.title ILIKE $${index + 1} OR COALESCE(a.summary, '') ILIKE $${index + 1})`)
    .join(' OR ');
  const excludeArxiv = String(topic.parent_theme || '') === 'geopolitics' || String(topic.category || '') === 'geopolitics';

  const [linkedArticlesResponse, candidateArticlesResponse, reportResponse, symbolsResponse] = await Promise.all([
    safeQuery(`
      SELECT a.id, a.title, a.summary, a.source, a.published_at, a.url, a.theme, a.legacy_theme
      FROM discovery_topic_articles dta
      JOIN articles a ON a.id = dta.article_id
      WHERE dta.topic_id = $1
      ORDER BY a.published_at DESC
      LIMIT 300
    `, [topicId]),
    safeQuery(`
      SELECT a.id, a.title, a.summary, a.source, a.published_at, a.url, a.theme, a.legacy_theme
      FROM articles a
      WHERE a.published_at >= NOW() - INTERVAL '90 days'
        ${excludeArxiv ? "AND COALESCE(a.source, '') NOT ILIKE 'arxiv%'" : ''}
        AND (${candidateWhere || 'FALSE'})
      ORDER BY a.published_at DESC
      LIMIT 300
    `, allQueryTerms.slice(0, candidateTermCount).map((term) => `%${term}%`).length
      ? allQueryTerms.slice(0, candidateTermCount).map((term) => `%${term}%`)
      : []),
    safeQuery(`
      SELECT *
      FROM tech_reports
      WHERE topic_id = $1
      ORDER BY generated_at DESC
      LIMIT 1
    `, [topicId]),
    safeQuery(`
      SELECT symbol, avg_return, hit_rate, sample_size
      FROM stock_sensitivity_matrix
      WHERE theme = $1 OR theme = $2
      ORDER BY sample_size DESC, ABS(avg_return) DESC NULLS LAST
      LIMIT 12
    `, [topicId, String(topic.parent_theme || 'emerging-tech')]),
  ]);

  const linkedArticles = linkedArticlesResponse.rows
    .filter((row) => !isLowValueGoogleNewsSourceName(row.source))
    .map((row) => ({
    id: Number(row.id || 0),
    title: String(row.title || ''),
    source: String(row.source || ''),
    publishedAt: row.published_at,
    url: String(row.url || ''),
    summary: String(row.summary || ''),
    theme: String(row.theme || ''),
    legacyTheme: String(row.legacy_theme || ''),
    matchType: 'linked',
  }));

  const linkedById = new Map(linkedArticles.map((article) => [article.id, article]));
  const recentCandidates = [];
  for (const row of candidateArticlesResponse.rows) {
    if (isLowValueGoogleNewsSourceName(row.source)) continue;
    const candidate = {
      id: Number(row.id || 0),
      title: String(row.title || ''),
      source: String(row.source || ''),
      publishedAt: row.published_at,
      url: String(row.url || ''),
      summary: String(row.summary || ''),
      theme: String(row.theme || ''),
      legacyTheme: String(row.legacy_theme || ''),
      matchType: linkedById.has(Number(row.id || 0)) ? 'linked' : 'derived',
    };
    const scoring = buildTopicRecentArticleScore({
      title: candidate.title,
      summary: candidate.summary,
      source: candidate.source,
      theme: candidate.theme,
      legacy_theme: candidate.legacyTheme,
      published_at: candidate.publishedAt,
    }, topicId, topic.parent_theme, articleProfile);
    const isLinked = linkedById.has(candidate.id);
    if (!isLinked && scoring.strongHitCount < 1 && scoring.focusHitCount < 1) continue;
    if (excludeArxiv && (scoring.geoHitCount < 1 || scoring.focusHitCount < 1)) continue;
    if (scoring.score < (isLinked ? 4 : 8)) continue;
    recentCandidates.push({
      ...candidate,
      score: scoring.score,
      matchedStrong: scoring.matchedStrong,
      matchedSupport: scoring.matchedSupport,
      matchedGeo: scoring.matchedGeo,
      matchedFocus: scoring.matchedFocus,
    });
  }

  for (const article of linkedArticles) {
    const publishedAt = article.publishedAt ? new Date(article.publishedAt).getTime() : 0;
    if (!(publishedAt > 0) || (Date.now() - publishedAt) > 90 * 24 * 36e5) continue;
    const scoring = buildTopicRecentArticleScore({
      title: article.title,
      summary: article.summary,
      source: article.source,
      theme: article.theme,
      legacy_theme: article.legacyTheme,
      published_at: article.publishedAt,
    }, topicId, topic.parent_theme, articleProfile);
    if (excludeArxiv && (scoring.geoHitCount < 1 || scoring.focusHitCount < 1)) continue;
    if (scoring.score < 4) continue;
    recentCandidates.push({
      ...article,
      score: scoring.score,
      matchedStrong: scoring.matchedStrong,
      matchedSupport: scoring.matchedSupport,
      matchedGeo: scoring.matchedGeo,
      matchedFocus: scoring.matchedFocus,
    });
  }

  const dedupedRecentArticles = [];
  const seenRecentIds = new Set();
  for (const article of recentCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(b.publishedAt) - new Date(a.publishedAt);
  })) {
    if (seenRecentIds.has(article.id)) continue;
    seenRecentIds.add(article.id);
    dedupedRecentArticles.push(article);
    if (dedupedRecentArticles.length >= 20) break;
  }

  const latestLinkedArticles = linkedArticles
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 20);

  const latestLinkedPublishedAt = latestLinkedArticles[0]?.publishedAt || null;
  const derivedRecentCount = dedupedRecentArticles.filter((article) => article.matchType === 'derived').length;
  const linkedRecentCount = dedupedRecentArticles.filter((article) => article.matchType === 'linked').length;
  const effectiveReport = reportResponse.rows[0]
    ? {
        ...reportResponse.rows[0],
        top_articles: dedupedRecentArticles.length
          ? dedupedRecentArticles.slice(0, 10).map((article) => ({
              id: article.id,
              title: article.title,
              source: article.source,
              published_at: article.publishedAt,
              url: article.url,
              match_type: article.matchType,
            }))
          : asArray(reportResponse.rows[0].top_articles)
            .filter((article) => !isLowValueGoogleNewsSourceName(article?.source)),
      }
    : null;

  return {
    topic: {
      id: String(topic.id || ''),
      label: String(topic.label || ''),
      description: String(topic.description || ''),
      category: String(topic.category || ''),
      stage: String(topic.stage || ''),
      keywords: Array.isArray(topic.keywords) ? topic.keywords : [],
      articleCount: Number(topic.article_count || 0),
      momentum: Number(topic.momentum || 0),
      researchMomentum: Number(topic.research_momentum || 0),
      sourceQualityScore: Number(topic.source_quality_score || 0),
      sourceQualityBreakdown: topic.source_quality_breakdown || {},
      novelty: Number(topic.novelty || 0),
      diversity: Number(topic.diversity || 0),
      cohesion: Number(topic.cohesion || 0),
      parentTheme: String(topic.parent_theme || 'emerging-tech'),
      keyCompanies: Array.isArray(topic.key_companies) ? topic.key_companies : [],
      keyTechnologies: Array.isArray(topic.key_technologies) ? topic.key_technologies : [],
      monthlyCounts: topic.monthly_counts || {},
      codexMetadata: topic.codex_metadata || {},
      updatedAt: topic.updated_at,
    },
    report: effectiveReport,
    symbols: symbolsResponse.rows.map((row) => ({
      symbol: String(row.symbol || ''),
      avgReturn: Number(row.avg_return || 0),
      hitRate: Number(row.hit_rate || 0),
      sampleSize: Number(row.sample_size || 0),
    })),
    articles: dedupedRecentArticles.map((article) => ({
      id: article.id,
      title: article.title,
      source: article.source,
      publishedAt: article.publishedAt,
      url: article.url,
      matchType: article.matchType,
      matchedStrong: article.matchedStrong,
      matchedSupport: article.matchedSupport,
      matchedGeo: article.matchedGeo,
      matchedFocus: article.matchedFocus,
    })),
    latestLinkedArticles: latestLinkedArticles.map((article) => ({
      id: article.id,
      title: article.title,
      source: article.source,
      publishedAt: article.publishedAt,
      url: article.url,
      matchType: article.matchType,
    })),
    articleMeta: {
      windowDays: 90,
      recentCount: dedupedRecentArticles.length,
      linkedRecentCount,
      derivedRecentCount,
      latestLinkedPublishedAt,
      usingFallback: derivedRecentCount > 0,
      status: dedupedRecentArticles.length > 0 ? 'recent-available' : 'linked-only',
    },
  };
}

async function buildEmergingTechTimeline(includeNoise = false) {
  const noiseFilter = includeNoise ? '' : "AND COALESCE(category, '') != 'other'";
  const { rows } = await safeQuery(`
    SELECT id, COALESCE(label, id) AS label, monthly_counts
    FROM discovery_topics
    WHERE status IN ('labeled', 'reported') ${noiseFilter}
    ORDER BY momentum DESC NULLS LAST, article_count DESC
    LIMIT 30
  `);
  return {
    topics: rows.map((row) => ({
      id: String(row.id || ''),
      label: String(row.label || ''),
      monthlyCounts: row.monthly_counts || {},
    })),
  };
}

async function buildLatestReports(limitParam, includeNoise = false) {
  const limit = Math.max(1, Math.min(50, Number(limitParam) || 20));
  const fetchLimit = Math.min(160, limit * 4);
  const noiseFilter = includeNoise
    ? ''
    : "WHERE COALESCE(dt.category, '') != 'other'";
  const { rows } = await safeQuery(`
    SELECT tr.id, tr.topic_id, tr.topic_label, tr.generated_at, tr.momentum, tr.research_momentum, tr.source_quality_score, tr.tracking_score
    FROM tech_reports tr
    LEFT JOIN discovery_topics dt ON dt.id = tr.topic_id
    ${noiseFilter}
    ORDER BY tr.generated_at DESC
    LIMIT $1
  `, [fetchLimit]);
  const deduped = [];
  const seenTopics = new Set();
  for (const row of rows) {
    const topicKey = String(row.topic_id || row.id || '').trim();
    if (!topicKey || seenTopics.has(topicKey)) continue;
    seenTopics.add(topicKey);
    deduped.push(row);
  }
  return { reports: deduped.slice(0, limit) };
}

async function buildReportDetail(reportId) {
  const { rows } = await safeQuery(`
    SELECT
      tr.*,
      dt.label AS topic_name,
      dt.description AS topic_description,
      dt.category AS topic_category,
      dt.stage AS topic_stage,
      dt.source_quality_breakdown AS topic_source_quality_breakdown,
      dt.key_companies AS topic_key_companies,
      dt.key_technologies AS topic_key_technologies
    FROM tech_reports tr
    LEFT JOIN discovery_topics dt ON dt.id = tr.topic_id
    WHERE tr.id = $1
    LIMIT 1
  `, [reportId]);
  const row = rows[0] || null;
  if (!row) {
    return { report: null, topic: null };
  }
  return {
    report: row,
    topic: {
      id: String(row.topic_id || ''),
      label: String(row.topic_name || row.topic_label || row.topic_id || ''),
      description: String(row.topic_description || ''),
      category: String(row.topic_category || ''),
      stage: String(row.topic_stage || ''),
      sourceQualityBreakdown: row.topic_source_quality_breakdown || {},
      keyCompanies: Array.isArray(row.topic_key_companies) ? row.topic_key_companies : [],
      keyTechnologies: Array.isArray(row.topic_key_technologies) ? row.topic_key_technologies : [],
    },
  };
}

async function buildWeeklyDigest() {
  const digestDir = path.resolve('data');
  const entries = (await readdir(digestDir).catch(() => []))
    .filter((name) => /^weekly-digest-\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort()
    .reverse();
  if (entries.length === 0) {
    return { digest: null };
  }
  const digest = JSON.parse(await readFile(path.join(digestDir, entries[0]), 'utf8'));
  return { digest };
}

async function buildAutomationBudgetPayload() {
  try {
    const [budget, approvals, actions] = await Promise.all([
      getBudgetStatus(getPool()),
      getPendingApprovals(getPool(), 20),
      getRecentAutomationActions(getPool(), 24, 50),
    ]);
    return {
      budget,
      approvals,
      recentActions: actions,
    };
  } catch {
    return {
      budget: {
        hourly: {},
        daily: {},
        weekly: {},
        killSwitchActive: false,
      },
      approvals: [],
      recentActions: [],
    };
  }
}

async function buildAutomationLogPayload() {
  const hours = 24;
  try {
    const actions = await getRecentAutomationActions(getPool(), hours, 200);
    return {
      hours,
      actions,
    };
  } catch {
    return {
      hours,
      actions: [],
    };
  }
}

async function buildApprovalQueuePayload(options = {}) {
  const includeFinal = Boolean(options?.includeFinal);
  try {
    const approvals = await getPendingApprovals(getPool(), 200, { includeFinal });
    return { approvals };
  } catch {
    return { approvals: [] };
  }
}

async function readPersistentCacheSnapshot(cacheKey) {
  const filePath = path.resolve('data', 'persistent-cache', `${encodeURIComponent(cacheKey)}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    return parsed?.data?.snapshot ?? null;
  } catch {
    return null;
  }
}

function coerceReviewDecision(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'accept' || normalized === 'approve' || normalized === 'approved') return 'accept';
  if (normalized === 'reject' || normalized === 'rejected' || normalized === 'deny') return 'reject';
  return null;
}

function normalizeProposalReviewStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized) return 'pending';
  return normalized;
}

function classifyRiskLevel(score) {
  if (score >= 70) return 'critical';
  if (score >= 52) return 'high';
  if (score >= 34) return 'elevated';
  return 'watch';
}

function classifyMacroVerdict({ vix, marketStress, hyCredit, transmission }) {
  if ((Number.isFinite(vix) && vix >= 26)
    || (Number.isFinite(marketStress) && marketStress >= 0.72)
    || (Number.isFinite(hyCredit) && hyCredit >= 4.5)) {
    return 'defensive';
  }
  if ((Number.isFinite(vix) && vix <= 18)
    && (Number.isFinite(marketStress) ? marketStress <= 0.45 : true)
    && (Number.isFinite(transmission) ? transmission >= 0.2 : true)) {
    return 'constructive';
  }
  return 'watch';
}

/**
 * Build proposal-inbox payload.
 *
 * Default (S-Level §Phase 2): actionable items only — excludes 'executed'
 * and 'dead' states. Pass { includeFinal: true } to include them. The
 * inbox surface in the dashboard must NEVER pass includeFinal=true; only
 * a future history view should.
 */
async function buildProposalInboxPayload(options = {}) {
  const includeFinal = Boolean(options?.includeFinal);
  const proposalSql = includeFinal
    ? `
      SELECT id, proposal_type, payload, status, result, reasoning, source, created_at, executed_at
      FROM codex_proposals
      ORDER BY created_at DESC
      LIMIT 40
    `
    : `
      SELECT id, proposal_type, payload, status, result, reasoning, source, created_at, executed_at
      FROM codex_proposals
      WHERE status NOT IN ('executed', 'dead')
      ORDER BY created_at DESC
      LIMIT 40
    `;
  const [proposalRows, approvalPayload] = await Promise.all([
    safeQuery(proposalSql),
    buildApprovalQueuePayload({ includeFinal }),
  ]);

  const proposals = proposalRows.rows.map((row) => ({
    id: Number(row.id),
    proposal_type: String(row.proposal_type || 'proposal'),
    proposalType: String(row.proposal_type || 'proposal'),
    payload: row.payload || {},
    status: normalizeProposalReviewStatus(row.status),
    result: row.result || null,
    reasoning: row.reasoning || null,
    source: row.source || null,
    created_at: row.created_at || null,
    createdAt: row.created_at || null,
    executed_at: row.executed_at || null,
    executedAt: row.executed_at || null,
  }));

  const approvals = Array.isArray(approvalPayload.approvals) ? approvalPayload.approvals : [];
  const actionableProposals = proposals.filter((item) => (
    ['pending', 'pending-review', 'pending-approval', 'approved'].includes(item.status)
    && !isLowSignalAddRssProposal(item)
  ));

  return {
    proposals: actionableProposals,
    approvals,
    summary: {
      pendingProposals: actionableProposals.length,
      pendingApprovals: approvals.length,
      actionableCount: actionableProposals.length + approvals.length,
    },
  };
}

async function reviewCodexProposal(proposalId, body = {}) {
  const decision = coerceReviewDecision(body.decision);
  if (!decision) {
    return buildJsonResponse({ error: 'decision must be accept or reject' }, 400);
  }
  const requestId = newRequestId();
  const bodyHash = hashRequestBody(body);
  const reviewer = String(body.reviewer || 'theme-dashboard').slice(0, 120);

  // Capture prev state before mutation so audit log records the transition
  // accurately even if the review function returns the post-state only.
  let prevState = null;
  try {
    const { rows } = await getPool().query(
      `SELECT status FROM codex_proposals WHERE id = $1 LIMIT 1`,
      [Number(proposalId)],
    );
    prevState = rows[0]?.status ?? null;
  } catch {
    // Non-fatal — audit will record null prev_state.
  }

  try {
    const reviewed = await reviewCodexProposalById(getPool(), proposalId, decision, {
      reviewer,
      reason: String(body.reason || ''),
      dryRun: body.dryRun === true,
    });
    const proposal = reviewed?.proposal || {};
    const nextState = String(reviewed.status || proposal.status || 'pending');

    // Audit. Best-effort: failure to write must not break the user action.
    if (!body.dryRun) {
      try {
        await recordInboxAction(getPool(), {
          itemType: 'proposal',
          itemId: String(proposalId),
          prevState,
          nextState,
          decision,
          reviewer,
          requestId,
          bodyHash,
          note: body.reason ? String(body.reason) : null,
        });
      } catch (auditErr) {
        logger.warn('inbox audit write failed', {
          itemType: 'proposal',
          itemId: String(proposalId),
          error: String(auditErr?.message || auditErr),
        });
      }
    }

    return buildJsonResponse({
      proposal: {
        id: Number(proposal.id || proposalId),
        proposal_type: String(proposal.proposal_type || proposal.proposalType || 'proposal'),
        proposalType: String(proposal.proposal_type || proposal.proposalType || 'proposal'),
        payload: proposal.payload || {},
        status: nextState,
        result: reviewed.result ?? proposal.result ?? null,
        created_at: proposal.created_at || proposal.createdAt || null,
        createdAt: proposal.created_at || proposal.createdAt || null,
        executed_at: proposal.executed_at || proposal.executedAt || null,
        executedAt: proposal.executed_at || proposal.executedAt || null,
        alreadyFinal: Boolean(reviewed.alreadyFinal),
      },
      audit: { requestId },
    });
  } catch (error) {
    const message = String(error?.message || error || 'proposal review failed');
    const status = /not found/i.test(message) ? 404 : 500;
    return buildJsonResponse({ error: message, audit: { requestId } }, status);
  }
}

async function reviewApprovalQueueItem(queueId, body = {}) {
  const decision = coerceReviewDecision(body.decision);
  if (!decision) {
    return buildJsonResponse({ error: 'decision must be accept or reject' }, 400);
  }
  const requestId = newRequestId();
  const bodyHash = hashRequestBody(body);
  const reviewer = String(body.reviewer || 'theme-dashboard').slice(0, 120);
  const approval = await loadApprovalById(getPool(), queueId);
  if (!approval) {
    return buildJsonResponse({ error: 'approval queue item not found', audit: { requestId } }, 404);
  }

  const prevState = String(approval.status || 'pending').toLowerCase();

  // Best-effort audit helper used by every return path below.
  const writeAudit = async (nextState, note) => {
    try {
      await recordInboxAction(getPool(), {
        itemType: 'approval',
        itemId: String(queueId),
        prevState,
        nextState,
        decision,
        reviewer,
        requestId,
        bodyHash,
        note: note || (body.reason ? String(body.reason) : null),
      });
    } catch (auditErr) {
      logger.warn('inbox audit write failed', {
        itemType: 'approval',
        itemId: String(queueId),
        error: String(auditErr?.message || auditErr),
      });
    }
  };

  if (['approved', 'rejected', 'executed'].includes(prevState)) {
    return buildJsonResponse({
      approval,
      execution: null,
      alreadyFinal: true,
      audit: { requestId },
    });
  }

  if (decision === 'reject') {
    const reviewed = await markApprovalReviewed(getPool(), queueId, {
      decision: 'rejected',
      reviewer,
      note: body.reason ? String(body.reason) : 'Rejected in proposal inbox',
    });
    await writeAudit('rejected');
    return buildJsonResponse({
      approval: reviewed,
      execution: null,
      alreadyFinal: false,
      audit: { requestId },
    });
  }

  try {
    await ensureExecutorSchema(getPool());
    const payload = approval.payload && typeof approval.payload === 'object' ? approval.payload : {};
    const execution = await executeProposal(getPool(), {
      ...payload,
      payload,
      type: String(approval.action_type || 'unknown'),
      human_approved: true,
    }, {
      dryRun: body.dryRun === true,
      humanApproved: true,
    });

    if (body.dryRun === true) {
      // No state change → no audit row (dry-runs are intentionally not audited
      // as taken actions; they'd flood the log without representing a decision).
      return buildJsonResponse({
        approval,
        execution,
        dryRun: true,
        alreadyFinal: false,
        audit: { requestId, dryRun: true },
      });
    }

    if (execution?.skipped === true) {
      const skipNote = `skipped: ${execution.reason || execution.summary || 'execution skipped without registration'}`;
      const reviewed = await markApprovalReviewed(getPool(), queueId, {
        decision: 'needs-fix',
        reviewer,
        note: skipNote,
      });
      await writeAudit('needs-fix', skipNote);
      return buildJsonResponse({
        approval: reviewed,
        execution,
        alreadyFinal: false,
        skipped: true,
        needsFix: true,
        audit: { requestId },
      });
    }

    const note = execution?.summary
      || execution?.reason
      || `Executed ${String(approval.action_type || 'approval action')}`;
    const reviewed = await markApprovalReviewed(getPool(), queueId, {
      decision: 'executed',
      reviewer,
      note,
    });
    await writeAudit('executed', note);
    return buildJsonResponse({
      approval: reviewed,
      execution,
      alreadyFinal: false,
      audit: { requestId },
    });
  } catch (error) {
    const message = String(error?.message || error || 'approval execution failed');
    return buildJsonResponse({
      error: message,
      approval,
      audit: { requestId },
    }, /not found/i.test(message) ? 404 : 500);
  }
}

async function buildRiskSnapshot(params = new URLSearchParams()) {
  return buildCompactRiskSnapshot({
    safeQuery,
    buildStructuralAlerts: buildStructuralAlertsPayload,
    period: resolveDashboardPeriod(params),
  });
}

async function buildMacroSnapshot() {
  return buildCompactMacroSnapshot({ safeQuery });
}

async function buildInvestmentSnapshot() {
  return buildCompactInvestmentSnapshot({ safeQuery });
}

async function buildValidationSnapshot() {
  return buildCompactValidationSnapshot();
}

function resolveDashboardPeriod(params, fallback = 'quarter') {
  const value = String(params?.get?.('period') || fallback).trim().toLowerCase();
  return ['week', 'month', 'quarter', 'year'].includes(value) ? value : fallback;
}

async function buildThemeShellSnapshots(params = new URLSearchParams()) {
  return buildThemeShellSnapshotPayloads({
    safeQuery,
    buildStructuralAlerts: buildStructuralAlertsPayload,
    period: resolveDashboardPeriod(params),
  });
}

export async function resolveEventDashboardResponse(rawUrl, requestMeta = {}) {
  const { pathname, segments, params } = parseUrl(rawUrl);
  const method = String(requestMeta.method || 'GET').toUpperCase();
  const body = requestMeta.body && typeof requestMeta.body === 'object' ? requestMeta.body : {};
  try {
    // S-Tier C3: demo-mode write block. POST/PUT/DELETE/PATCH return 403
    // when LATTICE_DEMO_MODE=1 so the public sandbox stays read-only.
    // GET routes pass through.
    const demoBlock = blockIfDemoMode(method);
    if (demoBlock) {
      return buildJsonResponse(demoBlock.body, demoBlock.status);
    }

    // ── /api/demo/snapshot (S-Tier C3) ──
    // Returns the static snapshot (built by build-public-demo-snapshot.mjs)
    // when one is available. Used by the sandbox dashboard to render real
    // events without needing the live NAS DB.
    if (segments[0] === 'api' && segments[1] === 'demo' && segments[2] === 'snapshot') {
      try {
        const snap = await loadDemoSnapshot();
        if (!snap) {
          return buildJsonResponse({
            ok: false,
            error: 'No demo snapshot found. Run scripts/build-public-demo-snapshot.mjs to generate one.',
            demoMode: isDemoMode(),
          }, 404);
        }
        return buildJsonResponse({
          ok: true,
          demoMode: isDemoMode(),
          generatedAt: snap.generatedAt,
          counts: snap.counts,
          windowMonths: snap.windowMonths,
          attribution: snap.attribution,
          // The full themes/events/articles arrays are large — stream them
          // separately via /api/demo/snapshot/<section> if needed.
          // For now we ship the metadata + small theme list.
          themes: snap.themes,
        });
      } catch (err) {
        logger.warn('demo/snapshot route failed', { error: String(err?.message || err) });
        return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
      }
    }
    if (segments[0] === 'api' && segments[1] === 'demo' && segments[2] === 'snapshot' && segments[3]) {
      // /api/demo/snapshot/<section> — events|articles|uplift|predictions
      try {
        const snap = await loadDemoSnapshot();
        if (!snap) return buildJsonResponse({ ok: false, error: 'no snapshot' }, 404);
        const section = segments[3];
        const limit = Math.max(1, Math.min(2000, Number(params.get('limit')) || 100));
        const offset = Math.max(0, Number(params.get('offset')) || 0);
        const sectionMap = {
          events: snap.canonicalEvents,
          articles: snap.articles,
          uplift: snap.eventUplift,
          predictions: snap.modelPredictions,
        };
        const rows = sectionMap[section];
        if (!Array.isArray(rows)) {
          return buildJsonResponse({ ok: false, error: `unknown section: ${section}` }, 404);
        }
        return buildJsonResponse({
          ok: true,
          section,
          total: rows.length,
          offset,
          limit,
          rows: rows.slice(offset, offset + limit),
        });
      } catch (err) {
        return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
      }
    }

    // ── /api/health ──
    if (segments[0] === 'api' && segments[1] === 'health') {
      const payload = await buildHealth();
      return buildJsonResponse(payload, payload.status === 'critical' ? 503 : 200);
    }

    // ── /api/product-quality (S-Tier §7) ──
    // Five product-quality metrics (theme_relevance_precision,
    // brief_completeness, evidence_coverage, noise_suppression_rate,
    // actionability_score) plus their S-tier targets, rolled up into a
    // single summary.level (ok/warning/unknown). The endpoint is
    // intentionally separate from /api/ops/status — that one watches
    // technical health (services, freshness, model state); this one
    // watches whether the product is delivering useful information.
    if (segments[0] === 'api' && segments[1] === 'product-quality') {
      try {
        const payload = await buildProductQualityPayload({
          pool: getPool(),
          safeQuery,
          buildBrief: buildThemeBriefPayload,
        });
        const httpStatus = payload.summary?.level === 'critical' ? 503 : 200;
        return buildJsonResponse(payload, httpStatus);
      } catch (err) {
        logger.warn('product-quality route failed', { error: String(err?.message || err) });
        return buildJsonResponse(
          { ok: false, error: String(err?.message || err), generatedAt: new Date().toISOString() },
          500,
        );
      }
    }

    // ── /api/user-prefs (S-Tier C1) ──
    // GET /api/user-prefs[?user=]   — read prefs (defaults if absent)
    // POST /api/user-prefs          — partial merge update
    // DELETE /api/user-prefs        — reset to defaults
    if (segments[0] === 'api' && segments[1] === 'user-prefs') {
      try {
        const userId = String(body.userId || params.get('user') || 'default').slice(0, 120);
        if (method === 'GET') {
          const prefs = await getUserPrefs(userId);
          return buildJsonResponse({ ok: true, userId, prefs });
        }
        if (method === 'POST') {
          const prefs = await setUserPrefs(userId, body || {});
          return buildJsonResponse({ ok: true, userId, prefs });
        }
        if (method === 'DELETE') {
          const prefs = await resetUserPrefs(userId);
          return buildJsonResponse({ ok: true, userId, prefs, reset: true });
        }
        return buildJsonResponse({ error: 'unsupported method on user-prefs' }, 405);
      } catch (err) {
        logger.warn('user-prefs route failed', { error: String(err?.message || err) });
        return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
      }
    }

    // ── /api/model-comparison (S-Tier B1) ──
    if (segments[0] === 'api' && segments[1] === 'model-comparison') {
      try {
        const payload = await buildModelComparisonPayload(getPool());
        return buildJsonResponse(payload);
      } catch (err) {
        logger.warn('model-comparison route failed', { error: String(err?.message || err) });
        return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
      }
    }

    // ── /api/dashboard/health-summary (S-Tier A4) ──
    // Single envelope combining ops/status, product-quality, and the
    // hot-events.modelTrust / themeFraming signal so the dashboard can
    // render one unified system-health view instead of stitching four
    // separate endpoints together.
    if (segments[0] === 'api' && segments[1] === 'dashboard' && segments[2] === 'health-summary') {
      try {
        const [opsPayload, productPayload, hotPayload] = await Promise.all([
          buildOpsStatusPayload(getPool()).catch((err) => ({ ok: false, error: String(err?.message || err), summary: { level: 'unknown' } })),
          buildProductQualityPayload({ pool: getPool(), safeQuery, buildBrief: buildThemeBriefPayload })
            .catch((err) => ({ ok: false, error: String(err?.message || err), summary: { level: 'unknown' } })),
          buildHotEventsPayload(getPool(), { limit: 1, lookbackDays: 7 })
            .catch(() => ({ modelTrust: null, themeFraming: null, laneCounts: null })),
        ]);

        const dataLevel = (() => {
          const fresh = opsPayload?.freshness;
          if (!fresh) return 'unknown';
          if ((fresh.featureStaleEventCount ?? 0) > 0) return 'warning';
          if ((fresh.featureLagDays ?? 0) >= 1) return 'warning';
          return 'ok';
        })();
        const pipelineLevel = (() => {
          const services = opsPayload?.services || {};
          if (services.masterDaemon?.status !== 'ok') return 'critical';
          if (services.dataAccumulator?.status !== 'ok') return 'warning';
          return 'ok';
        })();
        const modelLevel = (() => {
          const trust = hotPayload?.modelTrust;
          if (trust?.level === 'disabled') return 'critical';
          if (trust?.level === 'stale') return 'warning';
          if (opsPayload?.model?.healthStatus === 'calibration-warning') return 'warning';
          return 'ok';
        })();
        const productLevel = productPayload?.summary?.level || 'unknown';

        const overall = (() => {
          const levels = [dataLevel, pipelineLevel, modelLevel, productLevel];
          if (levels.includes('critical')) return 'critical';
          if (levels.includes('warning')) return 'warning';
          if (levels.every((l) => l === 'ok')) return 'ok';
          return 'unknown';
        })();

        return buildJsonResponse({
          ok: true,
          generatedAt: new Date().toISOString(),
          overall,
          pillars: {
            data: {
              level: dataLevel,
              latestArticleDateKey: opsPayload?.freshness?.latestArticleDateKey ?? null,
              featureLagDays: opsPayload?.freshness?.featureLagDays ?? null,
              featureStaleEventCount: opsPayload?.freshness?.featureStaleEventCount ?? 0,
              articles24h: opsPayload?.freshness?.articles24h ?? 0,
            },
            pipeline: {
              level: pipelineLevel,
              masterDaemon: opsPayload?.services?.masterDaemon?.status ?? 'unknown',
              dataAccumulator: opsPayload?.services?.dataAccumulator?.status ?? 'unknown',
              metaModel: opsPayload?.services?.metaModel?.status ?? 'unknown',
              api: opsPayload?.services?.api?.status ?? 'unknown',
            },
            model: {
              level: modelLevel,
              activeModel: opsPayload?.model?.activeModel ?? null,
              calibration: opsPayload?.model?.healthStatus ?? 'unknown',
              modelTrust: hotPayload?.modelTrust?.level ?? 'unknown',
              stalePredictionCount: hotPayload?.modelTrust?.stalePredictionCount ?? null,
              worstSplitECE: opsPayload?.model?.worstSplitECE ?? null,
            },
            product: {
              level: productLevel,
              themeRelevancePrecision: productPayload?.metrics?.theme_relevance_precision ?? null,
              briefCompleteness: productPayload?.metrics?.brief_completeness ?? null,
              evidenceCoverage: productPayload?.metrics?.evidence_coverage ?? null,
              actionabilityScore: productPayload?.metrics?.actionability_score ?? null,
              noiseSuppressionRate: productPayload?.metrics?.noise_suppression_rate ?? null,
            },
          },
          actionables: opsPayload?.actionableInstructions ?? [],
          laneCounts: hotPayload?.laneCounts ?? null,
          themeFraming: hotPayload?.themeFraming ?? null,
        }, overall === 'critical' ? 503 : 200);
      } catch (err) {
        logger.warn('dashboard/health-summary route failed', { error: String(err?.message || err) });
        return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
      }
    }

    // ── /api/dashboard/now-do (S-Tier A3) ──
    // Single prescriptive recommendation — "the one thing the operator
    // should do right now". Priority queue:
    //   1. ops critical → run-instruction
    //   2. validated > 0 → "open inbox"
    //   3. pending > 0 → "inspect blockers"
    //   4. noise_only → "watch trending themes"
    //   5. otherwise → "system idle"
    if (segments[0] === 'api' && segments[1] === 'dashboard' && segments[2] === 'now-do') {
      try {
        const [opsPayload, hotPayload, trendingPayload] = await Promise.all([
          buildOpsStatusPayload(getPool()).catch(() => null),
          buildHotEventsPayload(getPool(), { limit: 5, lookbackDays: 7 }).catch(() => null),
          buildTrendingThemesPayload(getPool(), { windowDays: 7, limit: 1 }).catch(() => null),
        ]);

        const counts = hotPayload?.laneCounts || { validated: 0, pending: 0, watch: 0, noise: 0 };
        const criticalActionable = (opsPayload?.actionableInstructions || []).find(
          (a) => a.severity === 'critical',
        );
        const topTrending = trendingPayload?.themes?.[0] || null;

        let recommendation;
        if (criticalActionable) {
          recommendation = {
            priority: 'critical',
            icon: '⚠',
            label: criticalActionable.condition,
            action: criticalActionable.action,
            target: '/api/ops/status',
          };
        } else if (counts.validated > 0) {
          recommendation = {
            priority: 'primary',
            icon: '✓',
            label: `${counts.validated} validated signal${counts.validated === 1 ? '' : 's'} ready for review`,
            action: 'Open Decision Inbox to triage',
            target: '#inbox',
          };
        } else if (counts.pending > 0) {
          recommendation = {
            priority: 'primary',
            icon: '○',
            label: `${counts.pending} pending validation — blocked on controls or t-stat`,
            action: 'Inspect blockers; promote manually if structural',
            target: '#inbox?lane=pending',
          };
        } else if (topTrending) {
          recommendation = {
            priority: 'secondary',
            icon: '✦',
            label: `No validated signals yet. Top trending: ${topTrending.theme} (${topTrending.articlesNow} articles${topTrending.articlesChangePct != null ? `, ${topTrending.articlesChangePct >= 0 ? '+' : ''}${topTrending.articlesChangePct}%` : ''})`,
            action: 'Open theme brief',
            target: `/api/theme-brief/${encodeURIComponent(topTrending.theme)}`,
          };
        } else {
          recommendation = {
            priority: 'idle',
            icon: '·',
            label: 'System idle. Articles ingested but no actionable theme yet.',
            action: 'Wait for next pipeline tick or check ops/status',
            target: '/api/ops/status',
          };
        }

        return buildJsonResponse({
          ok: true,
          generatedAt: new Date().toISOString(),
          recommendation,
          counts,
        });
      } catch (err) {
        logger.warn('dashboard/now-do route failed', { error: String(err?.message || err) });
        return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
      }
    }

    // ── /api/ops/status (Phase 7 minimal) ──
    if (segments[0] === 'api' && segments[1] === 'ops' && segments[2] === 'status') {
      try {
        const payload = await buildOpsStatusPayload(getPool());
        const httpStatus = payload.summary?.level === 'critical' ? 503 : 200;
        return buildJsonResponse(payload, httpStatus);
      } catch (err) {
        logger.warn('ops/status route failed', { error: String(err?.message || err) });
        return buildJsonResponse(
          { ok: false, error: String(err?.message || err), generatedAt: new Date().toISOString() },
          500,
        );
      }
    }

    if (segments[0] === 'api' && segments[1] === 'calibration') {
      const emitAlert = params.get('emit_alert') === '1' || params.get('alert') === '1';
      return buildJsonResponse(await computeCalibrationDiagnostic(getPool(), emitAlert ? { alertFn: sendAlert } : {}));
    }

    if (segments[0] === 'api' && segments[1] === 'kpi-summary') {
      return buildJsonResponse(withMeta(await buildSignalSummary()));
    }

    if (segments[0] === 'api' && segments[1] === 'signals' && segments.length === 2) {
      return buildJsonResponse(withMeta(await buildSignalSummary()));
    }

    if (segments[0] === 'api' && segments[1] === 'data-quality') {
      return buildJsonResponse(await buildDataQuality());
    }

    if (segments[0] === 'api' && segments[1] === 'data-freshness-audit') {
      return buildJsonResponse(await loadLatestDataFreshnessAudit({ forceRefresh: params.get('refresh') === '1' }));
    }

    if (segments[0] === 'api' && segments[1] === 'source-repair-status') {
      return buildJsonResponse(await buildSourceRepairStatusPayload());
    }

    if (segments[0] === 'api' && segments[1] === 'nowcast-status') {
      try {
        const payload = await buildNowcastStatusPayload(getPool());
        const status = payload?.summary?.level === 'critical' ? 503 : 200;
        return buildJsonResponse(payload, status);
      } catch (err) {
        logger.warn('nowcast-status route failed', { error: String(err?.message || err) });
        return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
      }
    }

    if (segments[0] === 'api' && segments[1] === 'hot-events') {
      try {
        // S-Tier §2: clients may request a subset of lanes for theme pages
        // or noise-suppressed home views. lane=all returns everything.
        const laneParam = params.get('lane');
        const themeParam = params.get('theme');
        const payload = await buildHotEventsPayload(getPool(), {
          limit: Number(params.get('limit') || 10),
          lookbackDays: Number(params.get('lookback') || 7),
          laneFilter: laneParam ? laneParam.split(/[,\s]+/) : null,
          themeFilter: themeParam || null,
        });
        return buildJsonResponse(payload);
      } catch (err) {
        logger.warn('hot-events route failed', { error: String(err?.message || err) });
        return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
      }
    }

    // ── /api/themes/trending (S-Tier N7) ──
    // Article-volume change ranking as a fallback when event_uplift /
    // evidence-grade pipeline is catching up. Always-on signal that
    // works regardless of validated lane state.
    //   ?window=7   — comparison window in days (now vs prior, max 30)
    //   ?limit=12   — max themes returned (max 50)
    //   ?min=2      — minimum article_count per included event
    if (segments[0] === 'api' && segments[1] === 'themes' && segments[2] === 'trending') {
      try {
        const payload = await buildTrendingThemesPayload(getPool(), {
          windowDays: Number(params.get('window') || 7),
          limit: Number(params.get('limit') || 12),
          minArticleCount: Number(params.get('min') || 2),
        });
        return buildJsonResponse(payload);
      } catch (err) {
        logger.warn('themes/trending route failed', { error: String(err?.message || err) });
        return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
      }
    }

    if (segments[0] === 'api' && segments[1] === 'meta-model-health') {
      try {
        const payload = await buildMetaModelHealthPayload(getPool());
        const status = payload?.summary?.level === 'critical' ? 503 : 200;
        return buildJsonResponse(payload, status);
      } catch (err) {
        logger.warn('meta-model-health route failed', { error: String(err?.message || err) });
        return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
      }
    }

    if (segments[0] === 'api' && segments[1] === 'explain-event' && segments[2]) {
      try {
        const payload = await buildExplainEventPayload(getPool(), { eventId: segments[2] });
        return buildJsonResponse(payload, payload.ok ? 200 : 404);
      } catch (err) {
        logger.warn('explain-event route failed', { error: String(err?.message || err) });
        return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
      }
    }

    if (segments[0] === 'api' && segments[1] === 'theme-symbols-bulk') {
      try {
        const themesRaw = String(params.get('themes') || '').trim();
        if (!themesRaw) return buildJsonResponse({ ok: true, themes: {} });
        const themes = themesRaw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 20);
        if (!themes.length) return buildJsonResponse({ ok: true, themes: {} });
        const limit = Math.min(5, Math.max(1, Number(params.get('limit') || 3)));
        const { rows } = await getPool().query(
          `
          SELECT theme, symbol, quality_score, correlation, reaction_count, directional_edge,
                 avg_abs_reaction, outcome_hit_rate, outcome_avg_return,
                 ROW_NUMBER() OVER (PARTITION BY LOWER(theme) ORDER BY COALESCE(quality_score, 0) DESC NULLS LAST, reaction_count DESC) AS rn
            FROM auto_theme_symbols
           WHERE LOWER(theme) = ANY($1::text[])
          `,
          [themes],
        );
        const byTheme = {};
        for (const r of rows) {
          if (Number(r.rn) > limit) continue;
          const key = String(r.theme).toLowerCase();
          if (!byTheme[key]) byTheme[key] = [];
          byTheme[key].push({
            symbol: r.symbol,
            qualityScore: r.quality_score == null ? null : Number(r.quality_score),
            correlation: r.correlation == null ? null : Number(r.correlation),
            reactionCount: Number(r.reaction_count ?? 0),
            directionalEdge: r.directional_edge == null ? null : Number(r.directional_edge),
            avgAbsReaction: r.avg_abs_reaction == null ? null : Number(r.avg_abs_reaction),
            outcomeHitRate: r.outcome_hit_rate == null ? null : Number(r.outcome_hit_rate),
            outcomeAvgReturn: r.outcome_avg_return == null ? null : Number(r.outcome_avg_return),
          });
        }
        return buildJsonResponse({ ok: true, themes: byTheme });
      } catch (err) {
        logger.warn('theme-symbols-bulk route failed', { error: String(err?.message || err) });
        return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
      }
    }

    if (segments[0] === 'api' && segments[1] === 'event-timeline') {
      try {
        const payload = await buildEventTimelinePayload(getPool(), {
          days: Number(params.get('days') || 90),
          theme: params.get('theme') || null,
        });
        return buildJsonResponse(payload);
      } catch (err) {
        logger.warn('event-timeline failed', { error: String(err?.message || err) });
        return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
      }
    }

    if (segments[0] === 'api' && segments[1] === 'event-narrative' && segments[2]) {
      try {
        const payload = await buildEventNarrativePayload(getPool(), {
          eventId: segments[2],
          forceRefresh: params.get('refresh') === '1',
        });
        return buildJsonResponse(payload, payload.ok ? 200 : 400);
      } catch (err) {
        logger.warn('event-narrative failed', { error: String(err?.message || err) });
        return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
      }
    }

    if (segments[0] === 'api' && segments[1] === 'similar-events' && segments[2]) {
      try {
        const payload = await buildSimilarEventsPayload(getPool(), {
          eventId: segments[2],
          limit: Number(params.get('limit') || 6),
        });
        return buildJsonResponse(payload, payload.ok ? 200 : 400);
      } catch (err) {
        logger.warn('similar-events failed', { error: String(err?.message || err) });
        return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
      }
    }

    if (segments[0] === 'api' && segments[1] === 'regime-scenario') {
      try {
        const payload = await buildRegimeScenarioPayload(getPool(), {
          vix: params.get('vix') ? Number(params.get('vix')) : null,
          yieldSpread: params.get('yieldSpread') ? Number(params.get('yieldSpread')) : null,
          oilPrice: params.get('oilPrice') ? Number(params.get('oilPrice')) : null,
        });
        return buildJsonResponse(payload);
      } catch (err) {
        logger.warn('regime-scenario failed', { error: String(err?.message || err) });
        return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
      }
    }

    if (segments[0] === 'api' && segments[1] === 'current-regime-brief') {
      try {
        const payload = await buildCurrentRegimeBriefPayload(getPool(), {
          useCodex: params.get('codex') === '1',
          forceRefresh: params.get('refresh') === '1',
        });
        return buildJsonResponse(payload, payload.ok ? 200 : 500);
      } catch (err) {
        logger.warn('current-regime-brief failed', { error: String(err?.message || err) });
        return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
      }
    }

    if (segments[0] === 'api' && segments[1] === 'asset-dossier' && segments[2]) {
      try {
        const payload = await buildAssetDossierPayload(getPool(), { symbol: segments[2] });
        return buildJsonResponse(payload, payload.ok ? 200 : 400);
      } catch (err) {
        logger.warn('asset-dossier failed', { error: String(err?.message || err) });
        return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
      }
    }

    if (segments[0] === 'api' && segments[1] === 'weekly-digest') {
      try {
        const payload = await buildWeeklyDigestPayload(getPool(), {
          forceRefresh: params.get('refresh') === '1',
        });
        return buildJsonResponse(payload, payload.ok ? 200 : 500);
      } catch (err) {
        logger.warn('weekly-digest failed', { error: String(err?.message || err) });
        return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
      }
    }

    if (segments[0] === 'api' && segments[1] === 'correlation-breaks') {
      try {
        const payload = await buildCorrelationBreaksPayload(getPool());
        return buildJsonResponse(payload);
      } catch (err) {
        logger.warn('correlation-breaks failed', { error: String(err?.message || err) });
        return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
      }
    }

    if (segments[0] === 'api' && segments[1] === 'theme-impact' && segments[2]) {
      try {
        const payload = await buildThemeImpactPayload(getPool(), {
          theme: segments[2],
          horizon: params.get('horizon') || null,
          symbolLimit: Number(params.get('limit') || 12),
        });
        return buildJsonResponse(payload, payload.ok ? 200 : 400);
      } catch (err) {
        logger.warn('theme-impact route failed', { error: String(err?.message || err) });
        return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
      }
    }

    if (segments[0] === 'api' && segments[1] === 'source-diversity-audit') {
      try {
        const payload = await buildSourceDiversityAuditPayload(getPool(), {
          windowHours: Number(params.get('window') || 24),
        });
        const status = payload?.level === 'critical' ? 503 : 200;
        return buildJsonResponse(payload, status);
      } catch (err) {
        logger.warn('source-diversity-audit route failed', { error: String(err?.message || err) });
        return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
      }
    }

    if (segments[0] === 'api' && segments[1] === 'runtime-observability') {
      const payload = await buildSidecarProxyPayload('/api/local-runtime-observability');
      return buildJsonResponse(payload, payload.ok ? 200 : 503);
    }

    if (segments[0] === 'api' && segments[1] === 'automation-ops-snapshot') {
      const payload = await buildSidecarProxyPayload('/api/local-automation-ops-snapshot');
      return buildJsonResponse(payload, payload.ok ? 200 : 503);
    }

    if (segments[0] === 'api' && segments[1] === 'codex-quality') {
      return buildJsonResponse(await buildCodexQuality());
    }

    if (segments[0] === 'api' && segments[1] === 'automation-budget') {
      return buildJsonResponse(await buildAutomationBudgetPayload());
    }

    if (segments[0] === 'api' && segments[1] === 'automation-log') {
      return buildJsonResponse(await buildAutomationLogPayload());
    }

    if (segments[0] === 'api' && segments[1] === 'proposal-inbox') {
      const includeFinal = params.get('include_final') === '1' || params.get('includeFinal') === '1';
      return buildJsonResponse(await buildProposalInboxPayload({ includeFinal }));
    }

    if (segments[0] === 'api' && segments[1] === 'codex-proposals' && segments[2] && segments[3] === 'review' && method === 'POST') {
      return await reviewCodexProposal(segments[2], body);
    }

    if (segments[0] === 'api' && segments[1] === 'approval-queue' && segments[2] && segments[3] === 'review' && method === 'POST') {
      return await reviewApprovalQueueItem(segments[2], body);
    }

    if (segments[0] === 'api' && segments[1] === 'approval-queue') {
      const includeFinal = params.get('include_final') === '1' || params.get('includeFinal') === '1';
      return buildJsonResponse(await buildApprovalQueuePayload({ includeFinal }));
    }

    if (segments[0] === 'api' && segments[1] === 'runtime-issues' && !segments[2] && method === 'POST') {
      try {
        const { captureRuntimeIssue, classifyIssue } = await import('./_shared/runtime-issue-writer.mjs');
        const classification = String(body.classification || '').trim() || classifyIssue(body.surface, body.action, body.responseStatus, body.errorMessage);
        const result = captureRuntimeIssue({ ...body, classification });
        return buildJsonResponse({ ok: true, id: result.id, path: result.path });
      } catch (err) {
        return buildJsonResponse({ ok: false, error: String(err?.message || err) });
      }
    }

    if (segments[0] === 'api' && segments[1] === 'runtime-issues' && !segments[2] && method === 'GET') {
      try {
        const { readdirSync, readFileSync, existsSync } = await import('node:fs');
        const issuesDir = path.resolve('data', 'runtime-issues');
        if (!existsSync(issuesDir)) return buildJsonResponse({ issues: [], total: 0 });
        const files = [];
        for (const dateDir of readdirSync(issuesDir).sort().reverse()) {
          const full = path.join(issuesDir, dateDir);
          try {
            for (const f of readdirSync(full).filter(n => n.endsWith('.json') && !n.startsWith('investigation-')).sort().reverse()) {
              files.push(path.join(full, f));
              if (files.length >= 50) break;
            }
          } catch {}
          if (files.length >= 50) break;
        }
        const issues = files.map(fp => {
          try {
            const issue = JSON.parse(readFileSync(fp, 'utf8'));
            if (issue.responseBody && String(issue.responseBody).length > 500) {
              issue.responseBody = String(issue.responseBody).slice(0, 500) + '…';
            }
            return issue;
          } catch { return null; }
        }).filter(Boolean);
        return buildJsonResponse({ issues, total: issues.length });
      } catch (err) {
        return buildJsonResponse({ issues: [], total: 0, error: String(err?.message || err) });
      }
    }

    if (segments[0] === 'api' && segments[1] === 'risk-snapshot') {
      return buildJsonResponse(await buildRiskSnapshot(params));
    }

    if (segments[0] === 'api' && segments[1] === 'macro-snapshot') {
      return buildJsonResponse(await buildMacroSnapshot());
    }

    if (segments[0] === 'api' && segments[1] === 'investment-snapshot') {
      return buildJsonResponse(await buildInvestmentSnapshot());
    }

    if (segments[0] === 'api' && segments[1] === 'validation-snapshot') {
      return buildJsonResponse(await buildValidationSnapshot());
    }

    if (segments[0] === 'api' && segments[1] === 'theme-shell-snapshots') {
      return buildJsonResponse(await buildThemeShellSnapshots(params));
    }

    if (segments[0] === 'api' && segments[1] === 'emerging-tech' && segments.length === 2) {
      const includeNoise = params.get('include_noise') === '1';
      return buildJsonResponse(await buildEmergingTechList(includeNoise));
    }

    if (segments[0] === 'api' && segments[1] === 'emerging-tech' && segments[2] === 'timeline') {
      const includeNoise = params.get('include_noise') === '1';
      return buildJsonResponse(await buildEmergingTechTimeline(includeNoise));
    }

    if (segments[0] === 'api' && segments[1] === 'emerging-tech' && segments[2]) {
      return buildJsonResponse(await buildEmergingTechDetail(segments[2]));
    }

    if (segments[0] === 'api' && segments[1] === 'reports' && segments[2] === 'latest') {
      const includeNoise = params.get('include_noise') === '1';
      return buildJsonResponse(await buildLatestReports(params.get('limit'), includeNoise));
    }

    if (segments[0] === 'api' && segments[1] === 'trend-pyramid') {
      return await resolveWithCache(
        buildCacheKey('trend-pyramid', params.get('period') || 'quarter', params.get('category') || 'all', params.get('limit') || '6'),
        () => buildTrendPyramidPayload(safeQuery, params),
      );
    }

    if (segments[0] === 'api' && segments[1] === 'theme-evolution' && segments[2]) {
      const parentTheme = decodeURIComponent(segments[2] || '');
      return await resolveWithCache(
        buildCacheKey(
          'theme-evolution',
          parentTheme,
          params.get('period') || 'quarter',
          params.get('from') || 'auto',
          params.get('to') || 'auto',
          params.get('periods') || '8',
          params.get('limit') || '8',
        ),
        () => buildThemeEvolutionPayload(parentTheme, safeQuery, params),
      );
    }

    if (segments[0] === 'api' && segments[1] === 'theme-brief' && segments[2]) {
      const theme = decodeURIComponent(segments[2] || '');
      const wantNarrative = params.get('narrative') === 'llm';
      // S-Tier D1: optional LLM narrative — augments briefStructure with
      // Codex-generated specific lines. Falls back gracefully on Codex
      // failure or daily budget exhaustion.
      const enhanceWithNarrative = async (briefPayload) => {
        if (!wantNarrative || !briefPayload) return briefPayload;
        try {
          const { buildThemeNarrativePayload } = await import('./_shared/ai-analysis-builder.mjs');
          const period = params.get('period') || 'quarter';
          const narrativeResult = await buildThemeNarrativePayload(getPool(), {
            theme,
            period,
            briefPayload,
            forceRefresh: params.get('refresh') === '1',
          });
          if (narrativeResult?.ok && narrativeResult.narrative && !narrativeResult.exhausted) {
            // Merge: replace each section's templated content with LLM lines
            // ONLY when the LLM produced non-empty content for that section.
            // Original templated content stays as fallback for empty sections.
            const merged = { ...(briefPayload.briefStructure || {}) };
            const n = narrativeResult.narrative;
            for (const key of ['whatChanged', 'whyMatters', 'caveats', 'monitor']) {
              if (Array.isArray(n[key]) && n[key].length > 0) merged[key] = n[key];
            }
            // Evidence is structured (items/classes) — only replace items.
            if (Array.isArray(n.evidence) && n.evidence.length > 0) {
              merged.evidence = {
                items: n.evidence,
                classes: briefPayload.briefStructure?.evidence?.classes || [],
              };
            }
            // Related — narrative provides flat list; we put under entities.
            if (Array.isArray(n.related) && n.related.length > 0) {
              merged.related = {
                ...(briefPayload.briefStructure?.related || {}),
                entities: n.related,
              };
            }
            return {
              ...briefPayload,
              briefStructure: merged,
              narrativeSource: narrativeResult.cached ? 'cache' : 'llm-fresh',
              narrativeGeneratedAt: narrativeResult.generatedAt,
            };
          }
          // Budget exhausted or LLM failed — keep original templated brief +
          // surface the reason so the dashboard can show a banner.
          return {
            ...briefPayload,
            narrativeSource: narrativeResult?.exhausted ? 'budget-exhausted' : 'llm-failed',
            narrativeError: narrativeResult?.error || narrativeResult?.reason || null,
          };
        } catch (err) {
          logger.warn('theme-brief narrative augmentation failed', { error: String(err?.message || err) });
          return { ...briefPayload, narrativeSource: 'llm-failed', narrativeError: String(err?.message || err) };
        }
      };

      if (hasDynamicSinceParams(params) || wantNarrative) {
        // narrative=llm bypasses cache so the user gets the latest LLM output
        // (or the LLM cache layer handles it via theme_narrative_cache).
        const base = await buildThemeBriefPayload(theme, safeQuery, params);
        const enriched = await enhanceWithNarrative(base);
        return buildJsonResponse(withMeta(enriched, {
          cacheable: false,
          cacheReason: wantNarrative ? 'llm-narrative' : 'dynamic-since',
        }));
      }
      return await resolveWithCache(
        buildCacheKey(
          'theme-brief',
          theme,
          params.get('period') || 'quarter',
          params.get('digest_limit') || '3',
          params.get('article_limit') || '5',
          buildSinceToken(params, 'since'),
        ),
        () => buildThemeBriefPayload(theme, safeQuery, params),
      );
    }

    if (segments[0] === 'api' && segments[1] === 'theme-brief-notebook' && segments[2]) {
      const theme = decodeURIComponent(segments[2] || '');
      const periodType = params.get('period') || body.periodType || 'quarter';
      if (method === 'POST') {
        return buildJsonResponse(withMeta(await upsertThemeNotebookEntry(safeQuery, theme, periodType, {
          label: body.label,
          noteMarkdown: body.noteMarkdown,
          tags: body.tags,
          pinned: body.pinned,
          shareRequested: body.shareRequested,
          unshareRequested: body.unshareRequested,
          metadata: body.metadata,
        }), {
          cacheable: false,
        }));
      }
      return buildJsonResponse(withMeta(await loadThemeNotebookEntry(safeQuery, theme, periodType), {
        cacheable: false,
      }));
    }

    if (segments[0] === 'api' && segments[1] === 'theme-brief-export' && segments[2]) {
      const theme = decodeURIComponent(segments[2] || '');
      return buildJsonResponse(withMeta(await buildThemeBriefExportPayload(theme, safeQuery, params), {
        cacheable: false,
      }));
    }

    if (segments[0] === 'api' && segments[1] === 'theme-brief-shared' && segments[2]) {
      const shared = await buildSharedThemeBriefPayload(decodeURIComponent(segments[2] || ''), safeQuery, params);
      if (!shared) return buildJsonResponse({ error: 'Shared Theme Brief not found' }, 404);
      return buildJsonResponse(withMeta(shared, {
        cacheable: false,
      }));
    }

    if (segments[0] === 'api' && segments[1] === 'structural-alerts') {
      if (method === 'POST' && segments[2] === 'dismiss') {
        return buildJsonResponse(withMeta(await dismissStructuralAlert({ query: safeQuery }, body.alertKey || body.alert_key || params.get('alert_key')), {
          cacheable: false,
        }));
      }
      return buildJsonResponse(await buildStructuralAlertsPayload(safeQuery, params));
    }

    if (segments[0] === 'api' && segments[1] === 'discovery-triage') {
      if (method === 'POST' && segments[2] === 'review') {
        const requestId = newRequestId();
        const bodyHash = hashRequestBody(body);
        const reviewer = String(body.reviewer || 'theme-dashboard').slice(0, 120);
        const topicId = body.topicId || body.topic_id || body.id;
        // Capture pre-decision promotion_state for accurate audit transition.
        let prevState = null;
        if (topicId) {
          try {
            const { rows } = await getPool().query(
              `SELECT promotion_state FROM discovery_topics WHERE id = $1 LIMIT 1`,
              [String(topicId)],
            );
            prevState = rows[0]?.promotion_state ?? null;
          } catch {
            // Non-fatal — audit will record null prev_state.
          }
        }
        const result = await applyDiscoveryTriageDecision({ query: safeQuery }, body);
        const nextState = result?.topic?.promotion_state
          ?? result?.promotion_state
          ?? body.decision
          ?? null;
        if (topicId) {
          try {
            await recordInboxAction(getPool(), {
              itemType: 'discovery',
              itemId: String(topicId),
              prevState,
              nextState: nextState ? String(nextState) : null,
              decision: String(body.decision || '').slice(0, 64) || null,
              reviewer,
              requestId,
              bodyHash,
              note: body.reason ? String(body.reason) : null,
            });
          } catch (auditErr) {
            logger.warn('inbox audit write failed', {
              itemType: 'discovery',
              itemId: String(topicId),
              error: String(auditErr?.message || auditErr),
            });
          }
        }
        return buildJsonResponse(withMeta({ ...result, audit: { requestId } }, {
          cacheable: false,
        }));
      }
      return buildJsonResponse(await buildDiscoveryTriagePayload(safeQuery, params));
    }

    // ── /api/inbox/audit (S-Level §Phase 2) ──
    // Recent operator decisions across all 4 inbox item types. Useful for
    // history views, dispute resolution, and verifying that an action was
    // actually written through.
    //
    // Optional filters:
    //   ?type=discovery|approval|proposal|e2_signal
    //   ?id=<item id>
    //   ?limit=<int, max 500, default 100>
    if (segments[0] === 'api' && segments[1] === 'inbox' && segments[2] === 'audit') {
      try {
        const rows = await recentInboxActions(getPool(), {
          itemType: params.get('type'),
          itemId: params.get('id'),
          limit: Number(params.get('limit') || 100),
        });
        return buildJsonResponse({ ok: true, count: rows.length, entries: rows });
      } catch (err) {
        logger.warn('inbox/audit route failed', { error: String(err?.message || err) });
        return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
      }
    }

    // ── /api/watchlist (S-Tier §4) ──
    // Persist user follow / mute / dismiss / snooze state for items that
    // have no DB-side review queue (e2_signal type, themes, symbols).
    //
    //   GET    /api/watchlist[?type=&state=]           list user entries
    //   GET    /api/watchlist/<type>/<id>              query single entry
    //   POST   /api/watchlist                          upsert {itemType,itemId,state,snoozeUntil?,note?}
    //   DELETE /api/watchlist/<type>/<id>              remove entry
    //
    // userId comes from body.userId or query.user; defaults to 'default' until
    // auth lands. Each successful mutation also writes an inbox-audit row with
    // item_type='e2_signal' (or whatever VALID_WATCHLIST_ITEM_TYPES says).
    if (segments[0] === 'api' && segments[1] === 'watchlist') {
      try {
        const userId = String(body.userId || params.get('user') || 'default').slice(0, 120);
        const reviewer = String(body.reviewer || 'dashboard-ui').slice(0, 160);

        // GET /api/watchlist (no extra segments) — list mode
        if (method === 'GET' && !segments[2]) {
          const rows = await listWatchlist(getPool(), {
            userId,
            itemType: params.get('type'),
            state: params.get('state'),
            active: params.get('include_expired') !== '1',
            limit: Number(params.get('limit') || 200),
          });
          return buildJsonResponse({ ok: true, count: rows.length, entries: rows });
        }

        // GET /api/watchlist/<type>/<id> — single lookup
        if (method === 'GET' && segments[2] && segments[3]) {
          const row = await getWatchlistEntry(getPool(), {
            userId,
            itemType: segments[2],
            itemId: decodeURIComponent(segments[3]),
          });
          return buildJsonResponse({ ok: true, entry: row });
        }

        // POST /api/watchlist — upsert
        if (method === 'POST' && !segments[2]) {
          const requestId = newRequestId();
          const bodyHash = hashRequestBody(body);
          const itemType = String(body.itemType || body.item_type || '').toLowerCase();
          const itemId = String(body.itemId || body.item_id || '').trim();
          const nextState = body.state ? String(body.state).toLowerCase() : null;
          const snoozeUntil = body.snoozeUntil || body.snooze_until || null;
          if (!VALID_WATCHLIST_ITEM_TYPES.has(itemType)) {
            return buildJsonResponse({
              error: `invalid itemType — expected one of ${[...VALID_WATCHLIST_ITEM_TYPES].join(', ')}`,
              audit: { requestId },
            }, 400);
          }
          if (nextState && !VALID_WATCHLIST_STATES.has(nextState)) {
            return buildJsonResponse({
              error: `invalid state — expected one of ${[...VALID_WATCHLIST_STATES].join(', ')}`,
              audit: { requestId },
            }, 400);
          }
          // Capture prev state for the audit transition.
          const prevRow = await getWatchlistEntry(getPool(), { userId, itemType, itemId });
          const prevState = prevRow?.state ?? null;

          const result = await setWatchlistState(getPool(), {
            userId,
            itemType,
            itemId,
            state: nextState,
            snoozeUntil,
            note: body.note ? String(body.note) : null,
          });

          // Audit. Best-effort: failure must not break the user action.
          try {
            await recordInboxAction(getPool(), {
              itemType: VALID_WATCHLIST_ITEM_TYPES.has(itemType) && itemType !== 'e2_signal' ? 'e2_signal' : itemType,
              itemId,
              prevState,
              nextState,
              decision: nextState,
              reviewer,
              requestId,
              bodyHash,
              note: body.note ? String(body.note) : null,
            });
          } catch (auditErr) {
            logger.warn('watchlist audit write failed', {
              itemType,
              itemId,
              error: String(auditErr?.message || auditErr),
            });
          }

          return buildJsonResponse({ ok: true, entry: result, audit: { requestId } });
        }

        // DELETE /api/watchlist/<type>/<id>
        if (method === 'DELETE' && segments[2] && segments[3]) {
          const requestId = newRequestId();
          const itemType = String(segments[2]).toLowerCase();
          const itemId = decodeURIComponent(segments[3]);
          const prevRow = await getWatchlistEntry(getPool(), { userId, itemType, itemId });
          const result = await removeWatchlistEntry(getPool(), { userId, itemType, itemId });
          try {
            await recordInboxAction(getPool(), {
              itemType: itemType === 'e2_signal' ? 'e2_signal' : 'e2_signal',
              itemId,
              prevState: prevRow?.state ?? null,
              nextState: null,
              decision: 'remove',
              reviewer,
              requestId,
              bodyHash: null,
            });
          } catch (auditErr) {
            logger.warn('watchlist audit (delete) write failed', { error: String(auditErr?.message || auditErr) });
          }
          return buildJsonResponse({ ok: true, removed: result.removed, audit: { requestId } });
        }

        return buildJsonResponse({ error: 'unsupported watchlist route' }, 405);
      } catch (err) {
        logger.warn('watchlist route failed', { error: String(err?.message || err) });
        return buildJsonResponse({ ok: false, error: String(err?.message || err) }, 500);
      }
    }

    if (segments[0] === 'api' && segments[1] === 'followed-theme-briefing') {
      if (hasDynamicSinceParams(params)) {
        return buildJsonResponse(withMeta(await buildFollowedThemeBriefingPayload(safeQuery, params), {
          cacheable: false,
          cacheReason: 'dynamic-since',
        }));
      }
      return await resolveWithCache(
        buildCacheKey(
          'followed-theme-briefing',
          params.get('themes') || 'none',
          params.get('period') || 'week',
          params.get('limit') || '5',
          params.get('snapshot_date') || 'auto',
          params.get('refresh') || '0',
          buildSinceToken(params, 'since'),
        ),
        () => buildFollowedThemeBriefingPayload(safeQuery, params),
      );
    }

    if (segments[0] === 'api' && segments[1] === 'category-trends') {
      const category = decodeURIComponent(segments[2] || params.get('category') || '');
      return await resolveWithCache(
        buildCacheKey('category-trends', category || 'all', params.get('period') || 'quarter', params.get('limit') || '6'),
        () => buildCategoryTrendsPayload(safeQuery, category, params),
      );
    }

    if (segments[0] === 'api' && segments[1] === 'insights' && segments[2] === 'quarterly') {
      return await resolveWithCache(
        buildCacheKey('quarterly-insights', params.get('period') || 'quarter', params.get('category') || 'all', params.get('limit') || '10'),
        () => buildQuarterlyInsightsPayload(safeQuery, params),
      );
    }

    if (segments[0] === 'api' && segments[1] === 'quarterly-insights') {
      return await resolveWithCache(
        buildCacheKey('quarterly-insights', params.get('period') || 'quarter', params.get('category') || 'all', params.get('limit') || '10'),
        () => buildQuarterlyInsightsPayload(safeQuery, params),
      );
    }

    if (segments[0] === 'api' && segments[1] === 'reports' && segments[2]) {
      return buildJsonResponse(await buildReportDetail(decodeURIComponent(segments[2])));
    }

    if (segments[0] === 'api' && segments[1] === 'daily-digest') {
      return await resolveWithCache(
        buildCacheKey(
          'daily-digest',
          params.get('date') || 'today',
          params.get('theme') || 'all',
          params.get('category') || 'all',
          params.get('limit') || '5',
        ),
        () => buildDailyDigestPayload(safeQuery, params),
      );
    }

    if (segments[0] === 'api' && segments[1] === 'digest' && segments[2] === 'daily') {
      return await resolveWithCache(
        buildCacheKey(
          'daily-digest',
          params.get('date') || 'today',
          params.get('theme') || 'all',
          params.get('category') || 'all',
          params.get('limit') || '5',
        ),
        () => buildDailyDigestPayload(safeQuery, params),
      );
    }

    if (segments[0] === 'api' && segments[1] === 'digest' && segments[2] === 'weekly') {
      return buildJsonResponse(await buildWeeklyDigest());
    }

    if (segments[0] === 'api' && segments[1] === 'metrics') {
      return buildJsonResponse(logger.getMetrics());
    }

    if (segments[0] === 'api' && segments[1] === 'sensitivity') {
      const r = await safeQuery(`
        SELECT theme, symbol, horizon, sample_size, avg_return, hit_rate, sensitivity_zscore, interpretation
        FROM stock_sensitivity_matrix
        ORDER BY theme, ABS(sensitivity_zscore) DESC
      `);
      return buildJsonResponse(r.rows);
    }

    if (segments[0] === 'api' && segments[1] === 'regime') {
      const theme = segments[2] || '';
      const symbol = (segments[3] || '').toUpperCase();
      const r = await safeQuery(`
        SELECT *
        FROM regime_conditional_impact
        WHERE ($1 = '' OR theme = $1) AND ($2 = '' OR symbol = $2)
        ORDER BY theme, symbol, regime
      `, [theme, symbol]);
      return buildJsonResponse(r.rows);
    }

    if (segments[0] === 'api' && segments[1] === 'hawkes') {
      const theme = segments[2] || 'conflict';
      const r = await safeQuery(`
        SELECT event_date, article_count, hawkes_intensity, normalized_temperature, is_surge
        FROM event_hawkes_intensity
        WHERE theme = $1
        ORDER BY event_date
      `, [theme]);
      return buildJsonResponse(r.rows);
    }

    if (segments[0] === 'api' && segments[1] === 'whatif') {
      return await resolveWithCache('whatif', () => buildStrategies(params));
    }

    if (segments[0] === 'api' && segments[1] === 'event-search') {
      const q = String(params.get('q') || '').trim();
      const r = await safeQuery(`
        SELECT DISTINCT ON (e.article_id)
          e.article_id, e.event_date, e.title, e.source, e.theme, e.symbol,
          e.forward_return_pct, e.hit, e.reaction_pattern, e.causal_explanation
        FROM event_impact_profiles e
        WHERE e.title ILIKE $1 AND e.horizon = '2w'
        ORDER BY e.article_id, ABS(e.forward_return_pct) DESC
        LIMIT 50
      `, [`%${q}%`]);
      return buildJsonResponse(r.rows);
    }

    // ── /api/stock/:symbol/conditions ──
    if (segments[0] === 'api' && segments[1] === 'stock' && segments[3] === 'conditions') {
      const symbol = (segments[2] || '').toUpperCase();
      const r = await safeQuery(`
        SELECT condition_type, condition_value, avg_return, hit_rate, sample_size
        FROM conditional_sensitivity
        WHERE symbol = $1 AND horizon = '2w' AND sample_size >= 30
        ORDER BY condition_type, condition_value
      `, [symbol]);
      return buildJsonResponse({ conditions: r.rows });
    }

    if (segments[0] === 'api' && segments[1] === 'stock') {
      const symbol = (segments[2] || '').toUpperCase();
      const [sens, regime, whatif, patterns] = await Promise.all([
        safeQuery('SELECT * FROM stock_sensitivity_matrix WHERE symbol = $1 ORDER BY horizon', [symbol]),
        safeQuery('SELECT * FROM regime_conditional_impact WHERE symbol = $1 ORDER BY theme, regime', [symbol]),
        safeQuery('SELECT * FROM whatif_simulations WHERE symbol = $1 ORDER BY sharpe_ratio DESC', [symbol]),
        safeQuery(`
          SELECT reaction_pattern, COUNT(*) AS n, AVG(forward_return_pct::numeric) AS avg_ret
          FROM event_impact_profiles
          WHERE symbol = $1 AND horizon = '2w' AND reaction_pattern IS NOT NULL
          GROUP BY reaction_pattern
          ORDER BY n DESC
        `, [symbol]),
      ]);
      return buildJsonResponse({ sensitivity: sens.rows, regime: regime.rows, whatif: whatif.rows, patterns: patterns.rows });
    }

    if (segments[0] === 'api' && segments[1] === 'trends') {
      const topics = {
        'AI/LLM': ['AI', 'artificial intelligence', 'GPT', 'LLM'],
        Semiconductor: ['semiconductor', 'chip', 'TSMC'],
        'Cyber Security': ['cyber', 'ransomware', 'hack'],
        'EV/Battery': ['EV', 'battery', 'electric vehicle'],
        'Drone/Robotics': ['drone', 'robot', 'autonomous'],
        'Nuclear/Fusion': ['nuclear', 'fusion', 'SMR'],
        'Biotech/Gene': ['biotech', 'CRISPR', 'mRNA'],
        Renewable: ['solar', 'renewable', 'hydrogen'],
      };
      const pairs = Object.entries(topics).flatMap(([name, keywords]) => keywords.map((keyword) => [name, keyword]));
      const valuesSql = pairs.map((_, index) => `($${index * 2 + 1}::text, $${index * 2 + 2}::text)`).join(', ');
      const r = await safeQuery(
        `
        WITH topic_keywords(topic, keyword) AS (VALUES ${valuesSql}),
        monthly AS (
          SELECT tk.topic AS name,
                 DATE_TRUNC('month', a.published_at)::date AS month,
                 COUNT(DISTINCT a.id)::int AS n
            FROM articles a
            JOIN topic_keywords tk ON a.title ILIKE ('%' || tk.keyword || '%')
           WHERE a.published_at >= CURRENT_DATE - INTERVAL '5 years'
           GROUP BY tk.topic, DATE_TRUNC('month', a.published_at)::date
        )
        SELECT name, month, n
          FROM monthly
         ORDER BY name, month
        `,
        pairs.flat(),
      );
      const byTopic = new Map(Object.keys(topics).map((name) => [name, []]));
      for (const row of r.rows) {
        const bucket = byTopic.get(row.name) || [];
        bucket.push({ month: row.month, n: Number(row.n) });
        byTopic.set(row.name, bucket);
      }
      const results = Array.from(byTopic.entries()).map(([name, counts]) => {
        const recent = counts.slice(-3);
        const prev = counts.slice(-6, -3);
        const recentAvg = recent.length ? recent.reduce((sum, row) => sum + row.n, 0) / recent.length : 0;
        const prevAvg = prev.length ? prev.reduce((sum, row) => sum + row.n, 0) / prev.length : 0;
        const momentum = prevAvg > 0 ? ((recentAvg - prevAvg) / prevAvg) * 100 : 0;
        return { name, momentum, recentAvg, total: counts.reduce((sum, row) => sum + row.n, 0), timeline: counts };
      });
      return buildJsonResponse(results);
    }

    if (segments[0] === 'api' && segments[1] === 'anomalies') {
      const year = params.get('year');
      const r = await safeQuery(`
        SELECT event_date, theme, symbol, forward_return_pct, expected_return, z_score, anomaly_type, title
        FROM event_anomalies
        ${year ? 'WHERE EXTRACT(YEAR FROM event_date) = $1' : ''}
        ORDER BY ABS(z_score) DESC
        LIMIT 30
      `, year ? [year] : []);
      return buildJsonResponse(r.rows);
    }

    if (segments[0] === 'api' && segments[1] === 'today') {
      return await resolveWithCache('today', buildTodayEvents);
    }

    if (segments[0] === 'api' && segments[1] === 'map-lens-overlays') {
      return await resolveWithCache(
        buildCacheKey(
          'map-lens-overlays',
          params.get('period') || 'quarter',
          params.get('filter') || 'all',
          params.get('theme') || 'all',
        ),
        () => buildMapLensOverlayPayload(params),
      );
    }

    if (segments[0] === 'api' && segments[1] === 'heatmap') {
      return await resolveWithCache('heatmap', buildHeatmap);
    }

    if (segments[0] === 'api' && segments[1] === 'live-status') {
      return await resolveWithCache('live-status', buildLiveStatus);
    }

    if (segments[0] === 'api' && segments[1] === 'pending') {
      const limit = Math.max(1, Math.min(200, Number(params.get('limit')) || 50));
      const r = await safeQuery(`
        WITH ranked AS (
          SELECT
            article_id AS "articleId",
            theme,
            symbol,
            entry_price AS "entryPrice",
            published_at AS "publishedAt",
            target_date AS "targetDate",
            GREATEST(0, (target_date::date - CURRENT_DATE)::int) AS "daysRemaining",
            ROW_NUMBER() OVER (
              PARTITION BY COALESCE(symbol, ''), COALESCE(theme, '')
              ORDER BY target_date ASC, published_at DESC NULLS LAST
            ) AS rn
          FROM pending_outcomes
          WHERE status IN ('pending', 'waiting')
        )
        SELECT "articleId", theme, symbol, "entryPrice", "publishedAt", "targetDate", "daysRemaining"
          FROM ranked
         WHERE rn = 1
         ORDER BY "targetDate" ASC
        LIMIT $1
      `, [limit]);
      const countRes = await safeQuery(`
        SELECT COUNT(DISTINCT (COALESCE(symbol, ''), COALESCE(theme, '')))::int AS total
          FROM pending_outcomes
         WHERE status IN ('pending', 'waiting')
      `);
      return buildJsonResponse({ items: r.rows, total: Number(countRes.rows[0]?.total || r.rows.length), limit });
    }

    if (segments[0] === 'api' && segments[1] === 'codex-latest') {
      let discoveries = null;
      try {
        const filePath = path.resolve('data', 'codex-discoveries.json');
        if (existsSync(filePath)) {
          discoveries = JSON.parse(await readFile(filePath, 'utf8'));
        }
      } catch {
        discoveries = null;
      }
      // S-Level §Phase 2: actionable items by default. Final proposals
      // (executed/dead) are omitted unless the caller opts in. Use this
      // route as a status overview, not as the inbox source-of-truth.
      const includeFinal = params.get('include_final') === '1' || params.get('includeFinal') === '1';
      const proposals = await safeQuery(
        includeFinal
          ? `SELECT * FROM codex_proposals ORDER BY created_at DESC LIMIT 20`
          : `SELECT * FROM codex_proposals WHERE status NOT IN ('executed', 'dead') ORDER BY created_at DESC LIMIT 20`,
      );
      return buildJsonResponse({ discoveries, proposals: proposals.rows });
    }

    // ── /api/signals/history?days=30&channels=vix,hy_credit_spread ──
    if (segments[0] === 'api' && segments[1] === 'signals' && segments[2] === 'history') {
      const days = Math.max(1, Math.min(365, Number(params.get('days')) || 30));
      const channelsParam = String(params.get('channels') || 'vix').trim();
      const channelNames = channelsParam.split(',').map((c) => c.trim()).filter(Boolean);
      const r = await safeQuery(`
        SELECT signal_name, ts, value
        FROM signal_history
        WHERE signal_name = ANY($1) AND ts >= NOW() - ($2 || ' days')::interval
        ORDER BY signal_name, ts
      `, [channelNames, String(days)]);
      const channels = {};
      for (const row of r.rows) {
        const name = String(row.signal_name || '');
        if (!channels[name]) channels[name] = [];
        channels[name].push({ ts: row.ts, value: Number(row.value || 0) });
      }
      return buildJsonResponse({ channels });
    }

    // ── /api/event-uplift-grades ──
    if (segments[0] === 'api' && segments[1] === 'event-uplift-grades') {
      const summaryRes = await safeQuery(`
        WITH uplift_candidates AS (
          SELECT eu.*
            FROM event_uplift eu
            JOIN canonical_events ce ON ce.id = eu.canonical_event_id
           WHERE eu.evidence_grade IS NOT NULL
             AND ce.event_date >= CURRENT_DATE - INTERVAL '${EVIDENCE_GRADE_WINDOW_DAYS} days'
        ),
        candidate_event_ids AS (
          SELECT DISTINCT canonical_event_id AS id
            FROM uplift_candidates
        ),
        article_quality AS (
          SELECT aem.canonical_event_id,
                 COUNT(*) FILTER (WHERE a.market_relevance IS NOT NULL)::int AS known_market_relevance_articles,
                 COUNT(*) FILTER (WHERE a.market_relevance IN ('high', 'medium'))::int AS market_relevant_articles,
                 COUNT(*) FILTER (WHERE a.market_relevance = 'low')::int AS low_relevance_articles
            FROM article_event_map aem
            JOIN candidate_event_ids cei ON cei.id = aem.canonical_event_id
            JOIN articles a ON a.id = aem.article_id
           GROUP BY aem.canonical_event_id
        ),
        gated AS (
          SELECT eu.evidence_grade AS raw_evidence_grade,
            CASE
              WHEN eu.evidence_grade IN ('E2','E3','E4')
               AND (
                 ABS(COALESCE(eu.t_stat, 0)) < 2
                 OR COALESCE(eu.n_controls, 0) < ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
                 OR (
                   COALESCE(aq.known_market_relevance_articles, 0) > 0
                   AND COALESCE(aq.market_relevant_articles, 0) = 0
                   AND COALESCE(aq.low_relevance_articles, 0) > 0
                 )
               ) THEN NULL
              ELSE eu.evidence_grade
            END AS evidence_grade,
            eu.uplift
          FROM uplift_candidates eu
          LEFT JOIN article_quality aq ON aq.canonical_event_id = eu.canonical_event_id
        )
        SELECT evidence_grade,
               COUNT(*)::int AS count,
               AVG(COALESCE(uplift, 0)) AS avg_uplift,
               COUNT(*) FILTER (WHERE raw_evidence_grade IS NOT NULL AND evidence_grade IS NULL)::int AS quarantined
          FROM gated
         GROUP BY evidence_grade
         ORDER BY evidence_grade DESC NULLS LAST
      `);

      const liveSignalWindowDays = 30;
      const signalsRes = await safeQuery(`
        WITH candidate_events AS (
          SELECT eu.canonical_event_id,
                 eu.evidence_grade,
                 eu.uplift,
                 eu.t_stat,
                 eu.n_controls,
                 ce.theme,
                 ce.representative_title AS title,
                 ce.event_date AS updated_at
            FROM event_uplift eu
            JOIN canonical_events ce ON ce.id = eu.canonical_event_id
           WHERE eu.evidence_grade = 'E2'
             AND ce.event_date >= CURRENT_DATE - INTERVAL '${liveSignalWindowDays} days'
             AND ABS(COALESCE(eu.t_stat, 0)) >= 2
             AND COALESCE(eu.n_controls, 0) >= ${HOT_EVENTS_MIN_PROMOTION_CONTROLS}
        ),
        article_quality AS (
          SELECT aem.canonical_event_id,
                 COUNT(*) FILTER (WHERE a.market_relevance IS NOT NULL)::int AS known_market_relevance_articles,
                 COUNT(*) FILTER (WHERE a.market_relevance IN ('high', 'medium'))::int AS market_relevant_articles,
                 COUNT(*) FILTER (WHERE a.market_relevance = 'low')::int AS low_relevance_articles
            FROM article_event_map aem
            JOIN candidate_events ce ON ce.canonical_event_id = aem.canonical_event_id
            JOIN articles a ON a.id = aem.article_id
           GROUP BY aem.canonical_event_id
        )
        SELECT ce.canonical_event_id,
               ce.evidence_grade,
               ce.uplift,
               ce.t_stat,
               ce.n_controls,
               ce.theme,
               ce.title,
               ce.updated_at,
               lo.symbol,
               lo.forward_return_pct,
               lo.abnormal_return,
               art.sources
          FROM candidate_events ce
          LEFT JOIN article_quality aq ON aq.canonical_event_id = ce.canonical_event_id
          LEFT JOIN LATERAL (
            SELECT lo2.symbol, lo2.forward_return_pct, lo2.abnormal_return
              FROM labeled_outcomes lo2
             WHERE lo2.canonical_event_id = ce.canonical_event_id
               AND lo2.symbol != 'SPY'
               AND lo2.abnormal_return IS NOT NULL
             ORDER BY ABS(lo2.abnormal_return) DESC
             LIMIT 1
          ) lo ON true
          LEFT JOIN LATERAL (
            SELECT json_agg(
              json_build_object(
                'title', sub.title,
                'url', sub.url,
                'source', sub.source,
                'publishedAt', sub.published_at
              ) ORDER BY sub.published_at DESC
            ) AS sources
            FROM (
              SELECT a.title, a.url, a.source, a.published_at
                FROM article_event_map aem
                JOIN articles a ON a.id = aem.article_id
               WHERE aem.canonical_event_id = ce.canonical_event_id
                 AND a.title IS NOT NULL
               ORDER BY a.published_at DESC
               LIMIT 3
            ) sub
          ) art ON true
         WHERE NOT (
           COALESCE(aq.known_market_relevance_articles, 0) > 0
           AND COALESCE(aq.market_relevant_articles, 0) = 0
           AND COALESCE(aq.low_relevance_articles, 0) > 0
         )
         ORDER BY ABS(COALESCE(ce.uplift, 0)) * 0.6 + ABS(COALESCE(ce.t_stat, 0)) * 0.4 DESC
         LIMIT 100
      `);
      const summaryRows = summaryRes.rows || [];
      const rawRows = summaryRows.reduce((sum, row) => sum + Number(row.count || 0), 0);
      const quarantinedCount = summaryRows.reduce((sum, row) => sum + Number(row.quarantined || 0), 0);
      const summary = summaryRows
        .filter((row) => row.evidence_grade)
        .map((row) => ({
          grade: row.evidence_grade,
          count: Number(row.count || 0),
          totalUplift: Number(row.avg_uplift || 0) * Number(row.count || 0),
          avgUplift: Number(Number(row.avg_uplift || 0).toFixed(4)),
        }));
      const symbolCounts = new Map();
      const seenTitles = new Set();
      const actionableSignals = [];
      for (const row of signalsRes.rows || []) {
        const titleKey = normalizeSignalQueueTitle(row.title);
        const symbolKey = String(row.symbol || 'unknown').toUpperCase();
        if (titleKey && seenTitles.has(titleKey)) continue;
        if ((symbolCounts.get(symbolKey) || 0) >= 1) continue;
        seenTitles.add(titleKey);
        symbolCounts.set(symbolKey, (symbolCounts.get(symbolKey) || 0) + 1);
        actionableSignals.push(row);
        if (actionableSignals.length >= 20) break;
      }
      return buildJsonResponse({
        grades: summary,
        signals: actionableSignals,
        meta: {
          liveSignalWindowDays,
          minPromotionControls: HOT_EVENTS_MIN_PROMOTION_CONTROLS,
          evidenceGradeWindowDays: EVIDENCE_GRADE_WINDOW_DAYS,
          rawRows,
          promotedRows: summary.reduce((sum, row) => sum + Number(row.count || 0), 0),
          quarantinedRows: quarantinedCount,
        },
      });
    }

    // ── /api/alpha-decay ──
    if (segments[0] === 'api' && segments[1] === 'alpha-decay') {
      const r = await safeQuery(`
        SELECT ce.theme, lo.horizon,
               AVG(lo.abnormal_return) AS alpha,
               COUNT(*) AS n
        FROM event_uplift eu
        JOIN canonical_events ce ON ce.id = eu.canonical_event_id
        JOIN labeled_outcomes lo ON lo.canonical_event_id = eu.canonical_event_id
                                 AND lo.symbol = eu.symbol
        WHERE ce.theme IS NOT NULL AND lo.horizon IN ('1w','2w','1m')
        GROUP BY ce.theme, lo.horizon
        HAVING COUNT(*) >= 5
        ORDER BY ce.theme, lo.horizon
      `);
      // Group by theme
      const byTheme = {};
      for (const row of r.rows) {
        if (!byTheme[row.theme]) byTheme[row.theme] = { theme: row.theme, points: [] };
        byTheme[row.theme].points.push({ horizon: row.horizon, alpha: Number(row.alpha || 0) });
      }
      return buildJsonResponse(Object.values(byTheme));
    }

    // ── /api/signal-correlation ──
    if (segments[0] === 'api' && segments[1] === 'signal-correlation') {
      const signals = ['vix', 'yieldSpread', 'oilPrice', 'dollarIndex', 'hy_credit_spread', 'marketStress'];
      const r = await safeQuery(`
        SELECT a.signal_name as signal_a, b.signal_name as signal_b,
               CORR(a.value, b.value) as correlation
        FROM signal_history a
        JOIN signal_history b ON DATE(a.ts) = DATE(b.ts)
        WHERE a.signal_name = ANY($1) AND b.signal_name = ANY($1)
          AND a.ts >= NOW() - INTERVAL '90 days'
          AND a.signal_name <= b.signal_name
        GROUP BY a.signal_name, b.signal_name
      `, [signals]);
      const full = [];
      for (const row of r.rows) {
        full.push(row);
        if (row.signal_a !== row.signal_b) {
          full.push({ signal_a: row.signal_b, signal_b: row.signal_a, correlation: row.correlation });
        }
      }
      return buildJsonResponse(full);
    }

    // ── /api/hawkes-heatmap — all themes ──
    if (segments[0] === 'api' && segments[1] === 'hawkes-heatmap') {
      const r = await safeQuery(`
        SELECT theme, event_date, hawkes_intensity
        FROM event_hawkes_intensity
        WHERE event_date >= NOW() - INTERVAL '6 months'
        ORDER BY theme, event_date
      `);
      return buildJsonResponse(r.rows);
    }

    // ── /api/correlation?theme=conflict ──
    if (segments[0] === 'api' && segments[1] === 'correlation') {
      const theme = String(params.get('theme') || '').trim();
      if (!theme) return buildJsonResponse({ error: 'theme parameter required' }, 400);
      const r = await safeQuery(`
        SELECT theme, symbol, signal_name, pearson_corr, regr_slope, sample_size
        FROM signal_sensitivity_continuous
        WHERE theme = $1 AND ABS(pearson_corr) > 0.05
        ORDER BY ABS(pearson_corr) DESC
      `, [theme]);
      return buildJsonResponse({ correlations: r.rows });
    }

    // ── /api/regime-timeline?theme=conflict&days=365 ──
    if (segments[0] === 'api' && segments[1] === 'regime-timeline') {
      const days = Math.max(1, Math.min(3650, Number(params.get('days')) || 365));
      const r = await safeQuery(`
        WITH daily_vix AS (
          SELECT DISTINCT ON (DATE(ts))
                 DATE(ts) AS d,
                 value AS vix
            FROM signal_history
           WHERE signal_name='vix' AND ts >= NOW() - ($1 || ' days')::interval
           ORDER BY DATE(ts), ts DESC
        ),
        daily_regime AS (
          SELECT d, vix,
            CASE WHEN vix > 25 THEN 'risk-off'
                 WHEN vix < 18 THEN 'risk-on'
                 ELSE 'balanced' END AS regime
          FROM daily_vix
        )
        SELECT d, regime, vix FROM daily_regime ORDER BY d
      `, [String(days)]);
      return buildJsonResponse({
        timeline: r.rows.map((row) => ({
          date: row.d,
          regime: String(row.regime || 'balanced'),
          vix: Number(row.vix || 0),
        })),
      });
    }

    // ── /api/multivariate/:theme/:symbol ──
    if (segments[0] === 'api' && segments[1] === 'multivariate' && segments.length >= 4) {
      const theme = segments[2] || '';
      const symbol = (segments[3] || '').toUpperCase();
      const r = await safeQuery(`
        SELECT coefficients, r_squared, sample_size
        FROM signal_multivariate_regression
        WHERE theme = $1 AND symbol = $2
      `, [theme, symbol]);
      const row = r.rows[0] || null;
      if (!row) return buildJsonResponse({ coefficients: null, r_squared: null, sample_size: 0 });
      return buildJsonResponse({
        coefficients: row.coefficients || {},
        r_squared: Number(row.r_squared || 0),
        sample_size: Number(row.sample_size || 0),
      });
    }

    if (segments.length === 0 || segments[0] === 'dashboard') {
      const htmlPath = path.resolve('event-dashboard.html');
      if (!existsSync(htmlPath)) {
        return {
          status: 404,
          contentType: 'text/plain; charset=utf-8',
          body: 'Dashboard HTML not found',
        };
      }
      return {
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: await readFile(htmlPath, 'utf8'),
      };
    }

    return buildJsonResponse({ error: 'Not found' }, 404);
  } catch (error) {
    logger.error('request resolution failed', {
      path: pathname,
      error: String(error?.message || error || 'unknown error'),
    });
    logger.metric('api.error_count', 1, { path: pathname });
    return buildJsonResponse({ error: String(error?.message || error) }, 500);
  }
}

export function startEventDashboardServer(port = PORT) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      sendResponse(res, buildJsonResponse({}));
      return;
    }

    const startedAt = performance.now();
    let requestBody = {};
    if (String(req.method || 'GET').toUpperCase() === 'POST') {
      try {
        requestBody = await readJsonBody(req);
      } catch (error) {
        sendResponse(res, buildJsonResponse({ error: `Invalid JSON body: ${String(error?.message || error)}` }, 400));
        return;
      }
    }
    const response = await resolveEventDashboardResponse(req.url, {
      method: req.method,
      body: requestBody,
    });
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
    const parsed = parseUrl(req.url);
    logger.info('request completed', {
      method: req.method || 'GET',
      path: parsed.pathname,
      status: response.status,
      durationMs,
    });
    logger.metric('api.request_count', 1, {
      method: req.method || 'GET',
      path: parsed.pathname,
      status: response.status,
    });
    if (response.status >= 400) {
      logger.metric('api.error_count', 1, {
        method: req.method || 'GET',
        path: parsed.pathname,
        status: response.status,
      });
    }
    sendResponse(res, response);
  });

  server.listen(port, () => {
    logger.info('server started', {
      port,
      dashboardUrl: `http://localhost:${port}/dashboard`,
    });
  });

  server.on('close', () => {
    void closeEventDashboardResources().catch(() => {});
  });

  return server;
}

const isDirectRun = (() => {
  // PM2 fork mode: pm_exec_path holds the actual script path
  const pmExecPath = process.env.pm_exec_path;
  if (pmExecPath) {
    try {
      const metaPath = fileURLToPath(import.meta.url);
      const norm = (p) => p.replace(/\\/g, '/').toLowerCase();
      if (norm(metaPath) === norm(pmExecPath)) return true;
    } catch {
      // fall through to standard check
    }
  }

  const entryArg = process.argv[1];
  if (!entryArg) return false;
  try {
    // Standard check: import.meta.url matches argv[1] as file URL
    if (import.meta.url === pathToFileURL(entryArg).href) return true;
    // Fallback for PM2/Windows: compare normalized basenames
    const entryBase = entryArg.replace(/\\/g, '/').split('/').pop();
    const metaBase = import.meta.url.split('/').pop();
    return entryBase === metaBase;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  startEventDashboardServer();
}
