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
import { getBudgetStatus } from './_shared/automation-budget.mjs';
import { getRecentAutomationActions } from './_shared/automation-audit.mjs';
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
import { isLowSignalAddRssProposal } from './_shared/rss-proposal-quality.mjs';

loadOptionalEnvFile();

const { Pool } = pg;
const PORT = Number(process.env.DASHBOARD_PORT || 46200);
const CACHE_DIR = path.resolve('data', 'event-dashboard-cache');
const AUDIT_DIR = path.resolve('data', 'audits');
const logger = createLogger('event-dashboard-api');
let pool = null;
let poolConfig = null;
let poolConfigError = null;

function getPgConfig() {
  if (!poolConfig && !poolConfigError) {
    try {
      poolConfig = { ...resolveNasPgConfig(), max: 6 };
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

const SIGNAL_LABELS = {
  vix: 'VIX',
  yieldSpread: 'Yield Spread',
  hy_credit_spread: 'HY Credit',
  dollarIndex: 'Dollar',
  oilPrice: 'Oil',
  marketStress: 'Market Stress',
  transmissionStrength: 'Transmission',
  eventIntensity: 'Event Intensity',
};

const KPI_SIGNAL_CHANNELS = new Set([
  'vix',
  'yieldSpread',
  'hy_credit_spread',
  'dollarIndex',
  'oilPrice',
  'marketStress',
  'transmissionStrength',
]);

const SIGNAL_STALE_THRESHOLD_HOURS = Object.freeze({
  vix: 36,
  yieldSpread: 48,
  hy_credit_spread: 48,
  dollarIndex: 48,
  oilPrice: 120,
  marketStress: 48,
  transmissionStrength: 48,
});

const TOPIC_ARTICLE_GENERIC_TERMS = new Set([
  'attack',
  'attacks',
  'attacked',
  'killed',
  'kill',
  'kills',
  'strike',
  'strikes',
  'war',
  'wars',
  'conflict',
  'military',
  'forces',
  'state',
  'backed',
  'backing',
  'global',
  'latest',
  'threat',
  'threats',
  'world',
  'policy',
  'general',
  'public',
  'strategic',
  'activity',
  'infrastructure',
  'investment',
  'debate',
  'risk',
  'security',
  'growth',
  'industry',
]);

const TOPIC_ARTICLE_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'in',
  'of',
  'to',
  'on',
  'at',
  'by',
  'as',
  'or',
  'with',
  'from',
  'into',
  'that',
  'this',
  'these',
  'those',
  'their',
  'them',
  'they',
  'have',
  'has',
  'had',
  'are',
  'was',
  'were',
  'will',
  'would',
  'could',
  'should',
  'across',
  'about',
  'under',
  'over',
  'after',
  'before',
  'between',
  'through',
  'around',
  'against',
  'while',
  'where',
  'which',
  'what',
  'when',
  'than',
  'then',
  'into',
  'onto',
  'also',
  'still',
  'more',
  'most',
  'less',
  'only',
  'very',
  'much',
  'such',
  'because',
  'centers',
  'accelerating',
  'including',
  'rising',
  'demand',
  'software',
  'systems',
  'current',
  'cluster',
  'topic',
]);

const GEO_CONTEXT_PATTERNS = [
  /\bukrain/i,
  /\brussi/i,
  /\bisrael/i,
  /\biran/i,
  /\bgaza/i,
  /\bpalestin/i,
  /\bsyria?/i,
  /\byemen/i,
  /\bsudan/i,
  /\bhouthi/i,
  /\btaiwan/i,
  /\bchina/i,
  /\bodesa\b/i,
  /\bodessa\b/i,
  /\bkyiv\b/i,
  /\bmoscow\b/i,
  /\bkremlin\b/i,
  /\bblack sea\b/i,
];

function sanitizeTopicText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitTopicTerms(values, options = {}) {
  const includeWhole = options.includeWhole !== false;
  const maxWholeWords = Number(options.maxWholeWords || 4);
  const terms = new Set();
  for (const value of values) {
    const normalized = sanitizeTopicText(value);
    if (!normalized) continue;
    if (includeWhole && normalized.split(/\s+/).length <= maxWholeWords) {
      terms.add(normalized);
    }
    for (const token of normalized.split(/[\s/]+/)) {
      const cleaned = token.replace(/^-+|-+$/g, '');
      if (!cleaned) continue;
      terms.add(cleaned);
    }
  }
  return Array.from(terms);
}

function buildTopicArticleProfile(topic) {
  const labelTerms = splitTopicTerms([topic.label], { includeWhole: false });
  const technologyTerms = splitTopicTerms(Array.isArray(topic.key_technologies) ? topic.key_technologies : [], { includeWhole: true, maxWholeWords: 4 });
  const companyTerms = splitTopicTerms(Array.isArray(topic.key_companies) ? topic.key_companies : [], { includeWhole: true, maxWholeWords: 3 });
  const descriptionTerms = splitTopicTerms([topic.description], { includeWhole: false });
  const keywordTerms = splitTopicTerms(Array.isArray(topic.keywords) ? topic.keywords : [], { includeWhole: false });

  const strongTerms = new Set();
  const supportTerms = new Set();

  for (const term of [...technologyTerms, ...companyTerms, ...labelTerms]) {
    const compact = term.replace(/\s+/g, ' ').trim();
    if (!compact || compact.length < 3) continue;
    if (TOPIC_ARTICLE_STOPWORDS.has(compact) || TOPIC_ARTICLE_GENERIC_TERMS.has(compact)) continue;
    strongTerms.add(compact);
  }

  for (const term of [...keywordTerms, ...descriptionTerms]) {
    const compact = term.replace(/\s+/g, ' ').trim();
    if (!compact || compact.length < 4) continue;
    if (TOPIC_ARTICLE_STOPWORDS.has(compact)) continue;
    if (TOPIC_ARTICLE_GENERIC_TERMS.has(compact)) continue;
    if (strongTerms.has(compact)) continue;
    supportTerms.add(compact);
  }

  if (String(topic.parent_theme || '') === 'geopolitics') {
    for (const term of ['ukraine', 'ukrainian', 'russia', 'russian']) {
      supportTerms.add(term);
    }
  }

  const geoContext = Array.from(new Set([...labelTerms, ...keywordTerms, ...descriptionTerms]
    .filter((term) => GEO_CONTEXT_PATTERNS.some((pattern) => pattern.test(term)))))
    .slice(0, 8);

  const focusTerms = Array.from(new Set([...technologyTerms, ...labelTerms]
    .filter((term) => !geoContext.includes(term))
    .filter((term) => !TOPIC_ARTICLE_GENERIC_TERMS.has(term))
    .filter((term) => !TOPIC_ARTICLE_STOPWORDS.has(term))))
    .slice(0, 12);

  const strong = Array.from(strongTerms).slice(0, 16);
  const support = Array.from(supportTerms).slice(0, 24);
  return { strong, support, geoContext, focusTerms };
}

function buildTopicRecentArticleScore(article, topicId, parentTheme, profile) {
  const text = sanitizeTopicText([article.title, article.summary, article.source].filter(Boolean).join(' '));
  const matchedStrong = [];
  const matchedSupport = [];
  const matchedGeo = [];
  const matchedFocus = [];

  for (const term of profile.strong) {
    if (text.includes(term)) matchedStrong.push(term);
  }
  for (const term of profile.support) {
    if (text.includes(term)) matchedSupport.push(term);
  }
  for (const term of profile.geoContext || []) {
    if (text.includes(term)) matchedGeo.push(term);
  }
  for (const term of profile.focusTerms || []) {
    if (text.includes(term)) matchedFocus.push(term);
  }

  const strongHitCount = matchedStrong.length;
  const supportHitCount = matchedSupport.length;
  const geoHitCount = matchedGeo.length;
  const focusHitCount = matchedFocus.length;

  let score = strongHitCount * 8 + supportHitCount * 2;
  score += geoHitCount * 4 + focusHitCount * 5;
  if (article.legacy_theme && String(article.legacy_theme) === String(topicId)) score += 6;
  if (article.theme && String(article.theme) === String(parentTheme || '')) score += 2;
  if (article.legacy_theme && String(article.legacy_theme) === String(parentTheme || '')) score += 1;

  const publishedAt = article.published_at ? new Date(article.published_at).getTime() : 0;
  const ageHours = publishedAt > 0 ? Math.max(0, (Date.now() - publishedAt) / 36e5) : 99999;
  if (ageHours <= 72) score += 4;
  else if (ageHours <= 24 * 14) score += 3;
  else if (ageHours <= 24 * 30) score += 2;
  else if (ageHours <= 24 * 90) score += 1;

  return {
    score,
    matchedStrong,
    matchedSupport,
    matchedGeo,
    matchedFocus,
    strongHitCount,
    supportHitCount,
    geoHitCount,
    focusHitCount,
  };
}

export { buildTopicArticleProfile, buildTopicRecentArticleScore };

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

async function readJsonCache(name) {
  const filePath = path.join(CACHE_DIR, `${name}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJsonCache(name, payload) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path.join(CACHE_DIR, `${name}.json`), JSON.stringify(payload, null, 2));
}

const DATA_TIMESTAMP_KEYS = new Set([
  'createdAt',
  'created_at',
  'updatedAt',
  'updated_at',
  'dataUpdatedAt',
  'data_updated_at',
  'oldestInternalUpdatedAt',
  'oldest_internal_updated_at',
  'latestInternalUpdatedAt',
  'latest_internal_updated_at',
  'publishedAt',
  'published_at',
  'completedAt',
  'completed_at',
  'recordedAt',
  'recorded_at',
  'capturedAt',
  'captured_at',
  'signalCapturedAt',
  'signal_captured_at',
  'rawSnapshotUpdatedAt',
  'raw_snapshot_updated_at',
  'eventDate',
  'event_date',
  'ts',
]);

const MODE_STALE_THRESHOLD_HOURS = Object.freeze({
  live: 24,
  cache: 24,
  delayed: 72,
  fallback: 0,
});

function toIsoTimestamp(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function collectPayloadTimestamps(value, timestamps = [], depth = 0) {
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

function latestInternalTimestamp(payload) {
  const timestamps = collectPayloadTimestamps(payload).filter((value) => Number.isFinite(value));
  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function firstTimestamp(...values) {
  for (const value of values) {
    const iso = toIsoTimestamp(value);
    if (iso) return iso;
  }
  return null;
}

function inferResponseMode(payload, extra) {
  const payloadMeta = payload?.meta && typeof payload.meta === 'object' ? payload.meta : {};
  if (extra.mode) return String(extra.mode);
  if (payloadMeta.mode) return String(payloadMeta.mode);
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

function signalAgeHours(ts) {
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
  const status = mirrored ? 'mirrored' : stale ? 'stale' : 'observed';
  const reason = mirrored
    ? `latest ${repeatedCount} samples repeat the same value`
    : stale
      ? (ageHours == null ? 'missing signal timestamp' : `signal age ${Math.round(ageHours)}h exceeds ${maxAgeHours}h threshold`)
      : null;

  return {
    status,
    mirrored,
    stale,
    repeatedCount,
    ageHours: Number.isFinite(ageHours) ? Math.round(ageHours * 10) / 10 : null,
    maxAgeHours,
    reason,
  };
}

async function loadLatestSignalsWithQuality() {
  const [latestSignalsR, signalSamplesR] = await Promise.all([
    safeQuery(`
      SELECT DISTINCT ON (signal_name) signal_name, ts, value
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
      quality: classifySignalQuality(signalName, row, samplesBySignal.get(signalName) || []),
    };
  });
  const qualityBySignal = Object.fromEntries(rows.map((row) => [row.signal_name, row.quality]));
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

  return {
    generatedAt,
    updatedAt: dataUpdatedAt,
    dataUpdatedAt,
    latestInternalUpdatedAt,
    mode,
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

function hasRenderableData(payload) {
  if (!payload || typeof payload !== 'object') return false;
  return Object.values(payload).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    if (typeof value === 'number') return value > 0;
    return false;
  });
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
    if (cached) {
      logger.metric('api.cache_hit', 1, { cacheKey });
      return buildJsonResponse(withMeta(cached, {
        cacheHit: true,
        mode: 'cache',
        stale: true,
        cacheReason: String(error?.message || error || 'cache fallback'),
      }));
    }
    logger.metric('api.cache_miss', 1, { cacheKey });
    throw error;
  }
}

function toCacheToken(value) {
  const normalized = String(value ?? 'all')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'all';
}

function buildCacheKey(prefix, ...parts) {
  return [prefix, ...parts.map((part) => toCacheToken(part))].join('--');
}

function hasDynamicSinceParams(params) {
  if (!params || typeof params.keys !== 'function') return false;
  if (params.has('since')) return true;
  return Array.from(params.keys()).some((key) => String(key || '').startsWith('since_'));
}

function buildSinceToken(params, keyPrefix = 'since') {
  const parts = [];
  for (const [key, value] of params.entries()) {
    if (key === keyPrefix || key.startsWith(`${keyPrefix}_`)) {
      parts.push(`${key}:${value}`);
    }
  }
  parts.sort();
  return parts.length > 0 ? parts.join('|') : 'none';
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

function normalizeTemperatureValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value, minimum, maximum) {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
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

const MAP_LENS_FILTER_TERMS = {
  all: [],
  conflict: ['conflict', 'war', 'defense', 'military', 'drone', 'sanction', 'security', 'iran', 'israel', 'ukraine', 'russia'],
  macro: ['macro', 'macroeconomics', 'fiscal', 'inflation', 'rates', 'liquidity', 'yield', 'monetary', 'budget', 'trade'],
  tech: ['technology', 'technology-general', 'ai', 'cloud', 'robotics', 'semiconductor', 'cyber', 'quantum', 'science'],
  energy: ['energy', 'oil', 'gas', 'lng', 'clean-energy', 'renewable', 'power', 'electricity', 'grid'],
  climate: ['climate', 'wildfire', 'water', 'agriculture', 'weather', 'heat', 'resilience', 'environment'],
};

const MAP_LENS_ANCHORS = [
  { id: 'iran', lat: 35.6892, lon: 51.389, terms: ['iran', 'tehran', 'persian gulf', 'hormuz'], filters: ['conflict', 'energy'] },
  { id: 'israel', lat: 31.7683, lon: 35.2137, terms: ['israel', 'gaza', 'tel aviv', 'jerusalem'], filters: ['conflict', 'energy'] },
  { id: 'ukraine', lat: 50.4501, lon: 30.5234, terms: ['ukraine', 'kyiv', 'kiev', 'donbas', 'crimea'], filters: ['conflict', 'energy'] },
  { id: 'russia', lat: 55.7558, lon: 37.6173, terms: ['russia', 'moscow', 'kremlin'], filters: ['conflict', 'energy'] },
  { id: 'taiwan', lat: 25.033, lon: 121.5654, terms: ['taiwan', 'tsmc', 'strait', 'taipei'], filters: ['tech', 'conflict'] },
  { id: 'seoul', lat: 37.5665, lon: 126.978, terms: ['korea', 'seoul', 'semiconductor', 'memory chip'], filters: ['tech'] },
  { id: 'tokyo', lat: 35.6762, lon: 139.6503, terms: ['japan', 'tokyo'], filters: ['tech', 'macro'] },
  { id: 'silicon-valley', lat: 37.3875, lon: -122.0575, terms: ['ai', 'cloud', 'data center', 'nvidia', 'silicon valley'], filters: ['tech'] },
  { id: 'london', lat: 51.5072, lon: -0.1276, terms: ['uk', 'britain', 'london', 'budget', 'gilts'], filters: ['macro'] },
  { id: 'washington', lat: 38.9072, lon: -77.0369, terms: ['us', 'federal reserve', 'treasury', 'washington', 'congress'], filters: ['macro', 'tech'] },
  { id: 'dubai', lat: 25.2048, lon: 55.2708, terms: ['shipping', 'suez', 'red sea', 'middle east', 'energy', 'oil'], filters: ['energy', 'conflict'] },
  { id: 'singapore', lat: 1.3521, lon: 103.8198, terms: ['shipping', 'strait', 'container', 'freight', 'logistics'], filters: ['energy', 'macro', 'tech'] },
  { id: 'santiago', lat: -33.4489, lon: -70.6693, terms: ['lithium', 'copper', 'critical minerals'], filters: ['energy', 'climate', 'tech'] },
  { id: 'amazon', lat: -3.4653, lon: -62.2159, terms: ['climate', 'wildfire', 'amazon', 'deforestation'], filters: ['climate'] },
  { id: 'australia', lat: -35.2809, lon: 149.13, terms: ['weather', 'wildfire', 'heat', 'water stress'], filters: ['climate', 'energy'] },
];

const TRANSMISSION_TARGETS = {
  commodity: { lat: 25.2048, lon: 55.2708, label: 'Commodity markets' },
  equity: { lat: 40.7128, lon: -74.006, label: 'Equity markets' },
  currency: { lat: 51.5072, lon: -0.1276, label: 'FX markets' },
  rates: { lat: 38.8951, lon: -77.0364, label: 'Rates markets' },
  country: { lat: 48.8566, lon: 2.3522, label: 'Country exposure' },
  'supply-chain': { lat: 1.3521, lon: 103.8198, label: 'Supply-chain hubs' },
};

function normalizeLensFilter(value) {
  const normalized = String(value || 'all').trim().toLowerCase();
  return Object.hasOwn(MAP_LENS_FILTER_TERMS, normalized) ? normalized : 'all';
}

function normalizeLensText(...values) {
  return values
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function matchesLensFilter(filter, text) {
  if (filter === 'all') return true;
  return MAP_LENS_FILTER_TERMS[filter].some((term) => text.includes(term));
}

function inferMapLensAnchor(title, theme, filter = 'all') {
  const text = normalizeLensText(title, theme);
  const direct = MAP_LENS_ANCHORS.find((anchor) => anchor.terms.some((term) => text.includes(term)));
  if (direct) return direct;
  if (filter !== 'all') {
    return MAP_LENS_ANCHORS.find((anchor) => anchor.filters.includes(filter)) || null;
  }
  return MAP_LENS_ANCHORS[0] || null;
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
      SELECT
        ce.id AS canonical_event_id,
        ce.theme,
        ce.representative_title,
        ce.event_date,
        eu.symbol,
        eu.horizon,
        eu.uplift,
        eu.t_stat,
        eu.evidence_grade
      FROM event_uplift eu
      JOIN canonical_events ce ON ce.id = eu.canonical_event_id
      WHERE eu.evidence_grade = 'E2'
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
  const [signalState, quoteFeed, tempsR, pendingR, articlesR, recentThemesR] = await Promise.all([
    loadLatestSignalsWithQuality(),
    detectLiveQuoteFeed(),
    safeQuery(`
      SELECT DISTINCT ON (theme) theme, normalized_temperature
      FROM event_hawkes_intensity
      ORDER BY theme, event_date DESC
    `),
    safeQuery(`
      SELECT COUNT(*)::int AS count
      FROM pending_outcomes
      WHERE status IN ('pending', 'waiting')
    `),
    safeQuery(`
      SELECT COUNT(*)::int AS count
      FROM articles
      WHERE published_at >= NOW() - INTERVAL '24 hours'
    `),
    safeQuery(`
      SELECT auto_theme AS theme, COUNT(*)::int AS count
      FROM auto_article_themes t
      JOIN articles a ON a.id = t.article_id
      WHERE a.published_at >= NOW() - INTERVAL '7 days'
      GROUP BY auto_theme
      ORDER BY count DESC
      LIMIT 8
    `),
  ]);

  const temperatures = (tempsR.rows.length > 0 ? tempsR.rows : recentThemesR.rows).map((row) => {
    const intensity = normalizeTemperatureValue(
      row.normalized_temperature ?? Math.min(1, Number(row.count || 0) / 20),
    );
    return {
      theme: String(row.theme || 'unknown'),
      temperature: classifyTemperature(intensity),
      intensity,
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

  return {
    temperatures,
    signals,
    signalQuality: signalState.qualityBySignal,
    pending: Number(pendingR.rows[0]?.count || 0),
    todayArticles: Number(articlesR.rows[0]?.count || 0),
    meta: {
      mode: signalState.mode,
      stale: signalState.stale || quoteFeed.status !== 'configured',
      staleReason: [signalState.staleReason, quoteFeed.status === 'configured' ? null : quoteFeed.reason].filter(Boolean).join('; ') || null,
      quoteFeed,
    },
  };
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
  const vix = Number(lookup.vix);
  const riskGauge = Number.isFinite(vix)
    ? Number(clamp(45 + (vix - 20) * 2, 4, 100).toFixed(1))
    : null;
  const riskState = Number.isFinite(vix)
    ? (vix > 25 ? 'risk-off' : vix < 18 ? 'risk-on' : 'balanced')
    : null;

  return {
    vix: Number.isFinite(vix) ? vix : null,
    yieldSpread: Number.isFinite(Number(lookup.yieldSpread)) ? Number(lookup.yieldSpread) : null,
    oilPrice: Number.isFinite(Number(lookup.oilPrice)) ? Number(lookup.oilPrice) : null,
    dollarIndex: Number.isFinite(Number(lookup.dollarIndex)) ? Number(lookup.dollarIndex) : null,
    hyCreditSpread: Number.isFinite(Number(lookup.hy_credit_spread)) ? Number(lookup.hy_credit_spread) : null,
    marketStress: Number.isFinite(Number(lookup.marketStress)) ? Number(lookup.marketStress) : null,
    riskGauge,
    riskState,
    vixHistory: vixHistoryR.rows.map((row) => Number(row.value || 0)).filter((value) => Number.isFinite(value)),
    rows,
    signalQuality: signalState.qualityBySignal,
    meta: {
      mode: signalState.mode,
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

async function buildTodayEvents() {
  const recent24h = await safeQuery(`
    SELECT id, title, source, published_at
    FROM articles
    WHERE published_at >= NOW() - INTERVAL '24 hours'
    ORDER BY published_at DESC
    LIMIT 40
  `);

  const articleRows = recent24h.rows.length > 0
    ? recent24h.rows
    : (await safeQuery(`
      SELECT id, title, source, published_at
      FROM articles
      WHERE published_at >= NOW() - INTERVAL '7 days'
      ORDER BY published_at DESC
      LIMIT 40
    `)).rows;

  if (!articleRows.length) {
    return { events: [], meta: { window: 'collecting' } };
  }

  const articleIds = articleRows.map((row) => Number(row.id)).filter(Number.isFinite);
  const themesR = articleIds.length > 0
    ? await safeQuery(`
      SELECT article_id, auto_theme
      FROM auto_article_themes
      WHERE article_id = ANY($1::int[])
    `, [articleIds])
    : { rows: [] };

  const themeByArticle = new Map();
  for (const row of themesR.rows) {
    themeByArticle.set(Number(row.article_id), String(row.auto_theme || 'unknown'));
  }

  const distinctThemes = Array.from(new Set(themesR.rows.map((row) => String(row.auto_theme || 'unknown')).filter(Boolean)));
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

  return {
    events: articleRows.map((row) => {
      const theme = themeByArticle.get(Number(row.id)) || 'unknown';
      return {
        title: String(row.title || ''),
        source: String(row.source || ''),
        publishedAt: row.published_at,
        theme,
        expectedReactions: mapExpectedReactions(reactionsByTheme.get(theme) || []),
      };
    }),
    meta: {
      window: recent24h.rows.length > 0 ? '24h' : '7d-fallback',
    },
  };
}

async function buildStrategies(params) {
  const theme = String(params.get('theme') || '').trim();
  const symbol = String(params.get('symbol') || '').trim().toUpperCase();

  const primary = await safeQuery(`
    SELECT name, sharpe_ratio, expected_return, max_drawdown, theme
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

async function loadLatestDataFreshnessAudit() {
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
  return {
    ok: true,
    auditPath: path.relative(process.cwd(), auditPath).replace(/\\/g, '/'),
    generatedAt: payload.generatedAt || null,
    summary: payload.summary || null,
    findings: Array.isArray(payload.findings) ? payload.findings : [],
    nas: payload.nas || null,
    backfill: payload.backfill || null,
    cache: {
      checkedFiles: payload.cache?.checkedFiles || 0,
      issues: Array.isArray(payload.cache?.issues) ? payload.cache.issues.slice(0, 20) : [],
    },
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

  const linkedArticles = linkedArticlesResponse.rows.map((row) => ({
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
          : reportResponse.rows[0].top_articles,
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

async function buildApprovalQueuePayload() {
  try {
    const approvals = await getPendingApprovals(getPool(), 200);
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

async function buildProposalInboxPayload() {
  const [proposalRows, approvalPayload] = await Promise.all([
    safeQuery(`
      SELECT id, proposal_type, payload, status, result, reasoning, source, created_at, executed_at
      FROM codex_proposals
      WHERE status NOT IN ('executed', 'dead')
      ORDER BY created_at DESC
      LIMIT 40
    `),
    buildApprovalQueuePayload(),
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
  try {
    const reviewed = await reviewCodexProposalById(getPool(), proposalId, decision, {
      reviewer: String(body.reviewer || 'theme-dashboard').slice(0, 120),
      reason: String(body.reason || ''),
      dryRun: body.dryRun === true,
    });
    const proposal = reviewed?.proposal || {};
    return buildJsonResponse({
      proposal: {
        id: Number(proposal.id || proposalId),
        proposal_type: String(proposal.proposal_type || proposal.proposalType || 'proposal'),
        proposalType: String(proposal.proposal_type || proposal.proposalType || 'proposal'),
        payload: proposal.payload || {},
        status: String(reviewed.status || proposal.status || 'pending'),
        result: reviewed.result ?? proposal.result ?? null,
        created_at: proposal.created_at || proposal.createdAt || null,
        createdAt: proposal.created_at || proposal.createdAt || null,
        executed_at: proposal.executed_at || proposal.executedAt || null,
        executedAt: proposal.executed_at || proposal.executedAt || null,
        alreadyFinal: Boolean(reviewed.alreadyFinal),
      },
    });
  } catch (error) {
    const message = String(error?.message || error || 'proposal review failed');
    const status = /not found/i.test(message) ? 404 : 500;
    return buildJsonResponse({ error: message }, status);
  }
}

async function reviewApprovalQueueItem(queueId, body = {}) {
  const decision = coerceReviewDecision(body.decision);
  if (!decision) {
    return buildJsonResponse({ error: 'decision must be accept or reject' }, 400);
  }
  const reviewer = String(body.reviewer || 'theme-dashboard').slice(0, 120);
  const approval = await loadApprovalById(getPool(), queueId);
  if (!approval) {
    return buildJsonResponse({ error: 'approval queue item not found' }, 404);
  }

  const currentStatus = String(approval.status || '').trim().toLowerCase();
  if (['approved', 'rejected', 'executed'].includes(currentStatus)) {
    return buildJsonResponse({
      approval,
      execution: null,
      alreadyFinal: true,
    });
  }

  if (decision === 'reject') {
    const reviewed = await markApprovalReviewed(getPool(), queueId, {
      decision: 'rejected',
      reviewer,
      note: body.reason ? String(body.reason) : 'Rejected in proposal inbox',
    });
    return buildJsonResponse({
      approval: reviewed,
      execution: null,
      alreadyFinal: false,
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
      return buildJsonResponse({
        approval,
        execution,
        dryRun: true,
        alreadyFinal: false,
      });
    }

    if (execution?.skipped === true) {
      const skipNote = `skipped: ${execution.reason || execution.summary || 'execution skipped without registration'}`;
      const reviewed = await markApprovalReviewed(getPool(), queueId, {
        decision: 'needs-fix',
        reviewer,
        note: skipNote,
      });
      return buildJsonResponse({
        approval: reviewed,
        execution,
        alreadyFinal: false,
        skipped: true,
        needsFix: true,
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
    return buildJsonResponse({
      approval: reviewed,
      execution,
      alreadyFinal: false,
    });
  } catch (error) {
    const message = String(error?.message || error || 'approval execution failed');
    return buildJsonResponse({
      error: message,
      approval,
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
    // ── /api/health ──
    if (segments[0] === 'api' && segments[1] === 'health') {
      const payload = await buildHealth();
      return buildJsonResponse(payload, payload.status === 'critical' ? 503 : 200);
    }

    if (segments[0] === 'api' && segments[1] === 'calibration') {
      return buildJsonResponse(await computeCalibrationDiagnostic(getPool(), { alertFn: sendAlert }));
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
      return buildJsonResponse(await loadLatestDataFreshnessAudit());
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
      return buildJsonResponse(await buildProposalInboxPayload());
    }

    if (segments[0] === 'api' && segments[1] === 'codex-proposals' && segments[2] && segments[3] === 'review' && method === 'POST') {
      return await reviewCodexProposal(segments[2], body);
    }

    if (segments[0] === 'api' && segments[1] === 'approval-queue' && segments[2] && segments[3] === 'review' && method === 'POST') {
      return await reviewApprovalQueueItem(segments[2], body);
    }

    if (segments[0] === 'api' && segments[1] === 'approval-queue') {
      return buildJsonResponse(await buildApprovalQueuePayload());
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
      if (hasDynamicSinceParams(params)) {
        return buildJsonResponse(withMeta(await buildThemeBriefPayload(theme, safeQuery, params), {
          cacheable: false,
          cacheReason: 'dynamic-since',
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
        return buildJsonResponse(withMeta(await applyDiscoveryTriageDecision({ query: safeQuery }, body), {
          cacheable: false,
        }));
      }
      return buildJsonResponse(await buildDiscoveryTriagePayload(safeQuery, params));
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
      const results = [];
      for (const [name, kws] of Object.entries(topics)) {
        const cond = kws.map((_, i) => `title ILIKE $${i + 1}`).join(' OR ');
        const r = await safeQuery(
          `SELECT DATE_TRUNC('month', published_at)::date AS month, COUNT(*) AS n
           FROM articles WHERE ${cond}
           GROUP BY month ORDER BY month`,
          kws.map((k) => `%${k}%`),
        );
        const counts = r.rows.map((row) => ({ month: row.month, n: Number(row.n) }));
        const recent = counts.slice(-3);
        const prev = counts.slice(-6, -3);
        const recentAvg = recent.length ? recent.reduce((sum, row) => sum + row.n, 0) / recent.length : 0;
        const prevAvg = prev.length ? prev.reduce((sum, row) => sum + row.n, 0) / prev.length : 0;
        const momentum = prevAvg > 0 ? ((recentAvg - prevAvg) / prevAvg) * 100 : 0;
        results.push({ name, momentum, recentAvg, total: counts.reduce((sum, row) => sum + row.n, 0), timeline: counts });
      }
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
      const r = await safeQuery(`
        SELECT
          article_id AS "articleId",
          theme,
          symbol,
          entry_price AS "entryPrice",
          published_at AS "publishedAt",
          target_date AS "targetDate",
          GREATEST(0, (target_date::date - CURRENT_DATE)::int) AS "daysRemaining"
        FROM pending_outcomes
        WHERE status IN ('pending', 'waiting')
        ORDER BY target_date ASC
      `);
      return buildJsonResponse({ items: r.rows });
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
      const proposals = await safeQuery(`
        SELECT *
        FROM codex_proposals
        ORDER BY created_at DESC
        LIMIT 20
      `);
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
      const r = await safeQuery(`
        WITH ranked_uplift AS (
          SELECT
            eu.canonical_event_id,
            eu.evidence_grade,
            eu.uplift,
            eu.t_stat,
            ce.theme,
            ce.representative_title AS title,
            ce.event_date AS updated_at,
            lo.symbol,
            lo.forward_return_pct,
            lo.abnormal_return,
            ROW_NUMBER() OVER (
              PARTITION BY eu.canonical_event_id
              ORDER BY ABS(COALESCE(lo.abnormal_return, eu.uplift, 0)) DESC,
                       ABS(COALESCE(eu.uplift, 0)) DESC,
                       ABS(COALESCE(eu.t_stat, 0)) DESC
            ) AS event_rank
          FROM event_uplift eu
          JOIN canonical_events ce ON ce.id = eu.canonical_event_id
          LEFT JOIN LATERAL (
            SELECT lo2.symbol, lo2.forward_return_pct, lo2.abnormal_return
            FROM labeled_outcomes lo2
            WHERE lo2.canonical_event_id = eu.canonical_event_id
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
              WHERE aem.canonical_event_id = eu.canonical_event_id
                AND a.title IS NOT NULL
              ORDER BY a.published_at DESC
              LIMIT 3
            ) sub
          ) art ON true
          WHERE eu.evidence_grade IS NOT NULL
        )
        SELECT canonical_event_id, evidence_grade, uplift, t_stat, theme, title, updated_at, symbol, forward_return_pct, abnormal_return, sources
        FROM ranked_uplift
        WHERE event_rank = 1
        ORDER BY evidence_grade DESC, ABS(uplift) DESC
        LIMIT 50000
      `);
      // Separate: summary for chart + top signals for queue
      const grades = r.rows;
      const summary = {};
      for (const row of grades) {
        const g = row.evidence_grade;
        if (!summary[g]) summary[g] = { grade: g, count: 0, totalUplift: 0 };
        summary[g].count++;
        summary[g].totalUplift += Number(row.uplift || 0);
      }
      for (const s of Object.values(summary)) {
        s.avgUplift = s.count > 0 ? Number((s.totalUplift / s.count).toFixed(4)) : 0;
      }
      const liveSignalWindowDays = 30;
      const recentCutoff = Date.now() - (liveSignalWindowDays * 24 * 60 * 60 * 1000);
      const symbolCounts = new Map();
      const seenTitles = new Set();
      const actionableSignals = [];
      for (const row of grades
        .filter((item) => {
          if (String(item.evidence_grade || '').toUpperCase() !== 'E2') return false;
          const updatedAt = item.updated_at ? Date.parse(item.updated_at) : NaN;
          return Number.isFinite(updatedAt) && updatedAt >= recentCutoff;
        })
        .sort((a, b) => {
          const aScore = Math.abs(Number(a.uplift || 0)) * 0.6 + Math.abs(Number(a.t_stat || 0)) * 0.4;
          const bScore = Math.abs(Number(b.uplift || 0)) * 0.6 + Math.abs(Number(b.t_stat || 0)) * 0.4;
          return bScore - aScore;
        })) {
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
        grades: Object.values(summary),
        signals: actionableSignals,
        meta: {
          liveSignalWindowDays,
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
        WITH daily_regime AS (
          SELECT DATE(ts) as d, value as vix,
            CASE WHEN value > 25 THEN 'risk-off'
                 WHEN value < 18 THEN 'risk-on'
                 ELSE 'balanced' END AS regime
          FROM signal_history WHERE signal_name='vix' AND ts >= NOW() - ($1 || ' days')::interval
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
