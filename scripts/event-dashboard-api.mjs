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
import { pathToFileURL } from 'node:url';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { createLogger } from './_shared/structured-logger.mjs';
import { computeCalibrationDiagnostic } from './_shared/calibration-diagnostic.mjs';
import { computeDataQualityMetrics } from './_shared/data-quality-check.mjs';

loadOptionalEnvFile();

const { Pool } = pg;
const PORT = Number(process.env.DASHBOARD_PORT || 46200);
const CACHE_DIR = path.resolve('data', 'event-dashboard-cache');
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
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
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

function withMeta(payload, extra = {}) {
  return {
    ...payload,
    meta: {
      updatedAt: new Date().toISOString(),
      stale: false,
      ...payload.meta,
      ...extra,
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
        stale: true,
        cacheReason: String(error?.message || error || 'cache fallback'),
      }));
    }
    logger.metric('api.cache_miss', 1, { cacheKey });
    throw error;
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

async function buildLiveStatus() {
  const [signalsR, tempsR, pendingR, articlesR, recentThemesR] = await Promise.all([
    safeQuery(`
      SELECT DISTINCT ON (signal_name) signal_name, ts, value
      FROM signal_history
      ORDER BY signal_name, ts DESC
    `),
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

  const signals = signalsR.rows.map((row) => {
    const channel = String(row.signal_name || '');
    return {
      channel,
      value: Number(row.value || 0),
      label: SIGNAL_LABELS[channel] || channel,
      updatedAt: row.ts,
    };
  });

  return {
    temperatures,
    signals,
    pending: Number(pendingR.rows[0]?.count || 0),
    todayArticles: Number(articlesR.rows[0]?.count || 0),
  };
}

async function buildHeatmap() {
  const primary = await safeQuery(`
    WITH ranked AS (
      SELECT
        theme,
        symbol,
        hit_rate,
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
    SELECT r.theme, r.symbol, r.hit_rate
    FROM ranked r
    JOIN top_themes tt ON tt.theme = r.theme
    JOIN top_symbols ts ON ts.symbol = r.symbol
    WHERE r.theme_rank <= 10
    ORDER BY r.theme, r.symbol
  `);

  const rows = primary.rows.length > 0
    ? primary.rows
    : (await safeQuery(`
      SELECT theme, symbol, AVG(hit::int)::float AS hit_rate
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
    ? ageScore(signalAgeMs, 30 * 60 * 1000, 2 * 60 * 60 * 1000)
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

export async function resolveEventDashboardResponse(rawUrl) {
  const { pathname, segments, params } = parseUrl(rawUrl);
  try {
    // ── /api/health ──
    if (segments[0] === 'api' && segments[1] === 'health') {
      const payload = await buildHealth();
      return buildJsonResponse(payload, payload.status === 'critical' ? 503 : 200);
    }

    if (segments[0] === 'api' && segments[1] === 'calibration') {
      return buildJsonResponse(await computeCalibrationDiagnostic(getPool()));
    }

    if (segments[0] === 'api' && segments[1] === 'data-quality') {
      return buildJsonResponse(await buildDataQuality());
    }

    if (segments[0] === 'api' && segments[1] === 'codex-quality') {
      return buildJsonResponse(await buildCodexQuality());
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
    const response = await resolveEventDashboardResponse(req.url);
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
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  try {
    return import.meta.url === pathToFileURL(entryArg).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  startEventDashboardServer();
}
