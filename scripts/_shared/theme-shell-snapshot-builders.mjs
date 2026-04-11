import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { buildStructuralAlertsPayload } from './trend-workbench.mjs';
import { resolveThemeTaxonomy } from './theme-taxonomy.mjs';

const DEFAULT_DATA_ROOT = path.resolve('data');
const DEFAULT_EVENT_DASHBOARD_CACHE_DIR = path.join(DEFAULT_DATA_ROOT, 'event-dashboard-cache');
const DEFAULT_PERSISTENT_CACHE_DIR = path.join(DEFAULT_DATA_ROOT, 'persistent-cache');
const DEFAULT_HISTORICAL_DIR = path.join(DEFAULT_DATA_ROOT, 'historical');
const INVESTMENT_EXPERIMENT_REGISTRY_KEY = 'investment-intelligence-experiment-registry:v1';

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

const RISK_LEVELS = Object.freeze(['watch', 'elevated', 'high', 'critical']);
const MACRO_VERDICTS = Object.freeze(['watch', 'constructive', 'defensive']);

function normalizeString(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizeThemeKey(value) {
  return normalizeString(value).toLowerCase();
}

function asNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function unique(values = []) {
  return Array.from(new Set(asArray(values).filter(Boolean)));
}

function dedupeThemeTemperatures(items = []) {
  const deduped = new Map();
  for (const item of asArray(items)) {
    const theme = normalizeThemeKey(item?.theme);
    if (!theme) continue;
    const nextIntensity = asNumber(item?.intensity, 0) || 0;
    const previous = deduped.get(theme);
    if (!previous || (asNumber(previous?.intensity, 0) || 0) < nextIntensity) {
      deduped.set(theme, item);
    }
  }
  return Array.from(deduped.values());
}

function classifyRiskLevel(score) {
  const numeric = asNumber(score, 0);
  if (numeric >= 70) return 'critical';
  if (numeric >= 52) return 'high';
  if (numeric >= 34) return 'elevated';
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

function resolveThemeMeta(theme) {
  const normalized = normalizeThemeKey(theme);
  const taxonomy = normalized ? resolveThemeTaxonomy(normalized) : null;
  return {
    theme: normalized || null,
    themeLabel: taxonomy?.themeLabel || normalized || null,
    category: taxonomy?.category || null,
    categoryLabel: taxonomy?.categoryLabel || null,
    parentTheme: taxonomy?.parentTheme || null,
    parentThemeLabel: taxonomy?.parentThemeLabel || null,
    lifecycleHint: taxonomy?.lifecycleHint || null,
  };
}

async function readJsonIfExists(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function unwrapPersistentEnvelope(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload?.data?.snapshot && typeof payload.data.snapshot === 'object') return payload.data.snapshot;
  if (payload?.data && typeof payload.data === 'object') return payload.data;
  return payload;
}

function createSource(name, kind, {
  available = true,
  stale = false,
  updatedAt = null,
  detail = null,
} = {}) {
  return {
    name,
    kind,
    available,
    stale,
    updatedAt: toIso(updatedAt),
    detail: detail || null,
  };
}

function mergeSources(...sourceLists) {
  return sourceLists.flat().filter(Boolean);
}

async function readDashboardCache(cacheKey, options = {}) {
  const eventDashboardCacheDir = options.eventDashboardCacheDir || path.join(options.dataRoot || DEFAULT_DATA_ROOT, 'event-dashboard-cache');
  const filePath = path.join(eventDashboardCacheDir, `${cacheKey}.json`);
  const payload = await readJsonIfExists(filePath);
  if (!payload) {
    return {
      payload: null,
      source: createSource(cacheKey, 'event-dashboard-cache', { available: false }),
    };
  }
  return {
    payload,
    source: createSource(cacheKey, 'event-dashboard-cache', {
      available: true,
      stale: Boolean(payload?.meta?.stale),
      updatedAt: payload?.meta?.updatedAt || null,
    }),
  };
}

async function readPersistentCache(cacheKey, options = {}) {
  const persistentCacheDir = options.persistentCacheDir || path.join(options.dataRoot || DEFAULT_DATA_ROOT, 'persistent-cache');
  const filePath = path.join(persistentCacheDir, `${encodeURIComponent(cacheKey)}.json`);
  const payload = await readJsonIfExists(filePath);
  if (!payload) {
    return {
      payload: null,
      source: createSource(cacheKey, 'persistent-cache', { available: false }),
    };
  }
  const unwrapped = unwrapPersistentEnvelope(payload);
  return {
    payload: unwrapped,
    source: createSource(cacheKey, 'persistent-cache', {
      available: Boolean(unwrapped),
      updatedAt: payload?.updatedAt || unwrapped?.updatedAt || null,
      stale: payload?.expiresAt ? Number(payload.expiresAt) < Date.now() : false,
    }),
  };
}

async function readPersistentCacheData(cacheKey, options = {}) {
  const persistentCacheDir = options.persistentCacheDir || path.join(options.dataRoot || DEFAULT_DATA_ROOT, 'persistent-cache');
  const filePath = path.join(persistentCacheDir, `${encodeURIComponent(cacheKey)}.json`);
  const payload = await readJsonIfExists(filePath);
  if (!payload) {
    return {
      payload: null,
      source: createSource(cacheKey, 'persistent-cache', { available: false }),
    };
  }
  const data = payload?.data && typeof payload.data === 'object'
    ? payload.data
    : unwrapPersistentEnvelope(payload);
  return {
    payload: data,
    source: createSource(cacheKey, 'persistent-cache', {
      available: Boolean(data),
      updatedAt: payload?.updatedAt || data?.updatedAt || data?.generatedAt || null,
      stale: payload?.expiresAt ? Number(payload.expiresAt) < Date.now() : false,
    }),
  };
}

const COUNTRY_MATCHERS = Object.freeze([
  { code: 'US', label: 'United States', keywords: ['united states', 'u.s.', 'usa', 'washington', 'america'] },
  { code: 'RU', label: 'Russia', keywords: ['russia', 'moscow', 'kremlin', 'putin'] },
  { code: 'CN', label: 'China', keywords: ['china', 'beijing', 'prc', 'xi jinping'] },
  { code: 'UA', label: 'Ukraine', keywords: ['ukraine', 'kyiv', 'zelensky'] },
  { code: 'IR', label: 'Iran', keywords: ['iran', 'tehran', 'irgc'] },
  { code: 'IL', label: 'Israel', keywords: ['israel', 'tel aviv', 'idf', 'gaza'] },
  { code: 'TW', label: 'Taiwan', keywords: ['taiwan', 'taipei'] },
  { code: 'KP', label: 'North Korea', keywords: ['north korea', 'pyongyang', 'kim jong'] },
  { code: 'SA', label: 'Saudi Arabia', keywords: ['saudi arabia', 'riyadh'] },
  { code: 'TR', label: 'Turkey', keywords: ['turkey', 'ankara', 'erdogan'] },
  { code: 'PL', label: 'Poland', keywords: ['poland', 'warsaw'] },
  { code: 'DE', label: 'Germany', keywords: ['germany', 'berlin'] },
  { code: 'FR', label: 'France', keywords: ['france', 'paris', 'macron'] },
  { code: 'GB', label: 'United Kingdom', keywords: ['united kingdom', 'britain', 'uk', 'london'] },
  { code: 'IN', label: 'India', keywords: ['india', 'delhi', 'modi'] },
  { code: 'PK', label: 'Pakistan', keywords: ['pakistan', 'islamabad'] },
  { code: 'SY', label: 'Syria', keywords: ['syria', 'damascus'] },
  { code: 'YE', label: 'Yemen', keywords: ['yemen', 'sanaa', 'houthi'] },
  { code: 'MM', label: 'Myanmar', keywords: ['myanmar', 'burma'] },
  { code: 'VE', label: 'Venezuela', keywords: ['venezuela', 'caracas', 'maduro'] },
]);

function detectCountryFromText(...values) {
  const text = values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => normalizeString(value))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!text) return null;
  return COUNTRY_MATCHERS.find((matcher) => matcher.keywords.some((keyword) => text.includes(keyword))) || null;
}

async function queryRows(safeQuery, sql, values = []) {
  if (typeof safeQuery !== 'function') return [];
  try {
    const result = await safeQuery(sql, values);
    return Array.isArray(result?.rows) ? result.rows : [];
  } catch {
    return [];
  }
}

function buildEmptyLiveStatus() {
  return {
    temperatures: [],
    signals: [],
    pending: 0,
    todayArticles: 0,
  };
}

function classifyTemperature(intensity) {
  const numeric = asNumber(intensity, 0);
  if (numeric >= 0.75) return 'HOT';
  if (numeric >= 0.5) return 'WARM';
  return 'COLD';
}

async function loadLiveStatusSnapshot(options = {}) {
  const cached = await readDashboardCache('live-status', options);
  if (cached.payload && (Array.isArray(cached.payload?.signals) || Array.isArray(cached.payload?.temperatures))) {
    return {
      payload: {
        temperatures: asArray(cached.payload.temperatures),
        signals: asArray(cached.payload.signals),
        pending: asNumber(cached.payload.pending, 0) || 0,
        todayArticles: asNumber(cached.payload.todayArticles, 0) || 0,
      },
      sources: [cached.source],
    };
  }

  const safeQuery = options.safeQuery;
  const [signalRows, temperatureRows, pendingRows, articleRows, recentThemeRows] = await Promise.all([
    queryRows(safeQuery, `
      SELECT DISTINCT ON (signal_name) signal_name, ts, value
      FROM signal_history
      ORDER BY signal_name, ts DESC
    `),
    queryRows(safeQuery, `
      SELECT DISTINCT ON (theme) theme, normalized_temperature
      FROM event_hawkes_intensity
      ORDER BY theme, event_date DESC
    `),
    queryRows(safeQuery, `
      SELECT COUNT(*)::int AS count
      FROM pending_outcomes
      WHERE status IN ('pending', 'waiting')
    `),
    queryRows(safeQuery, `
      SELECT COUNT(*)::int AS count
      FROM articles
      WHERE published_at >= NOW() - INTERVAL '24 hours'
    `),
    queryRows(safeQuery, `
      SELECT auto_theme AS theme, COUNT(*)::int AS count
      FROM auto_article_themes t
      JOIN articles a ON a.id = t.article_id
      WHERE a.published_at >= NOW() - INTERVAL '7 days'
      GROUP BY auto_theme
      ORDER BY count DESC
      LIMIT 8
    `),
  ]);

  const usableSignalRows = signalRows.length > 0;
  const usableTemperatureRows = temperatureRows.length > 0 || recentThemeRows.length > 0;
  if (!usableSignalRows && !usableTemperatureRows) {
    return {
      payload: buildEmptyLiveStatus(),
      sources: [
        cached.source,
        createSource('live-status-db', 'postgres', { available: false }),
      ],
    };
  }

  const temperatures = (temperatureRows.length > 0 ? temperatureRows : recentThemeRows).map((row) => {
    const intensity = temperatureRows.length > 0
      ? Math.max(0, Math.min(1, asNumber(row.normalized_temperature, 0) || 0))
      : Math.max(0, Math.min(1, (asNumber(row.count, 0) || 0) / 20));
    const themeMeta = resolveThemeMeta(row.theme);
    return {
      ...themeMeta,
      temperature: classifyTemperature(intensity),
      intensity: round(intensity, 4) || 0,
    };
  });

  const signals = signalRows.map((row) => ({
    channel: normalizeString(row.signal_name),
    value: asNumber(row.value, 0) || 0,
    label: SIGNAL_LABELS[normalizeString(row.signal_name)] || normalizeString(row.signal_name),
    updatedAt: toIso(row.ts),
  }));

  return {
    payload: {
      temperatures,
      signals,
      pending: asNumber(pendingRows[0]?.count, 0) || 0,
      todayArticles: asNumber(articleRows[0]?.count, 0) || 0,
    },
    sources: [createSource('live-status-db', 'postgres', { available: true })],
  };
}

async function loadStructuralAlertsSummary(options = {}) {
  const safeQuery = options.safeQuery;
  const buildAlerts = options.buildStructuralAlerts || buildStructuralAlertsPayload;
  const requiresSafeQuery = buildAlerts === buildStructuralAlertsPayload;
  if (typeof buildAlerts !== 'function' || (requiresSafeQuery && typeof safeQuery !== 'function')) {
    return {
      payload: { items: [] },
      sources: [createSource('theme-structural-alerts', 'postgres', { available: false })],
    };
  }
  try {
    const payload = await buildAlerts(safeQuery, new URLSearchParams([
      ['period', options.period || 'week'],
      ['limit', String(Math.max(1, Math.min(20, Number(options.limit || 8))))],
    ]));
    return {
      payload: payload && typeof payload === 'object' ? payload : { items: [] },
      sources: [createSource('theme-structural-alerts', 'postgres', { available: true })],
    };
  } catch {
    return {
      payload: { items: [] },
      sources: [createSource('theme-structural-alerts', 'postgres', { available: false })],
    };
  }
}

function buildEmptyRiskSnapshot() {
  return {
    generatedAt: new Date().toISOString(),
    score: 0,
    level: 'watch',
    summary: {
      alertCount: 0,
      pendingValidation: 0,
      articleCount24h: 0,
    },
    hottestThemes: [],
    highlights: [],
    meta: {
      available: false,
      stale: true,
      sources: [],
    },
  };
}

export async function buildCompactRiskSnapshot(options = {}) {
  const [liveStatus, structuralAlerts] = await Promise.all([
    loadLiveStatusSnapshot(options),
    loadStructuralAlertsSummary(options),
  ]);

  const live = liveStatus.payload || buildEmptyLiveStatus();
  const alertItems = asArray(structuralAlerts.payload?.items);
  const hottestThemes = dedupeThemeTemperatures(live.temperatures)
    .slice()
    .sort((left, right) => (asNumber(right.intensity, 0) || 0) - (asNumber(left.intensity, 0) || 0))
    .slice(0, 5)
    .map((item) => ({
      ...resolveThemeMeta(item.theme),
      temperature: normalizeString(item.temperature, 'COLD'),
      intensity: round(item.intensity, 4) || 0,
    }));

  const avgIntensity = hottestThemes.length > 0
    ? hottestThemes.reduce((sum, item) => sum + (asNumber(item.intensity, 0) || 0), 0) / hottestThemes.length
    : 0;
  const pendingValidation = asNumber(live.pending, 0) || 0;
  const articleCount24h = asNumber(live.todayArticles, 0) || 0;
  const pendingPressure = pendingValidation > 0
    ? Math.min(15, Math.round(Math.log10(pendingValidation + 1) * 4.5))
    : 0;
  const articlePressure = articleCount24h > 0
    ? Math.min(12, Math.round(articleCount24h / 6))
    : 0;
  const alertPressure = Math.min(24, alertItems.length * 4);
  const score = Math.min(
    100,
    Math.round((avgIntensity * 62) + alertPressure + pendingPressure + articlePressure),
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    score,
    level: classifyRiskLevel(score),
    summary: {
      alertCount: alertItems.length,
      pendingValidation,
      articleCount24h,
    },
    hottestThemes,
    highlights: alertItems.slice(0, 4).map((item) => ({
      id: normalizeString(item.id || item.alertKey),
      ...resolveThemeMeta(item.theme || item.parentTheme),
      severity: normalizeString(item.severity, 'medium'),
      headline: normalizeString(item.headline || item.label || item.detail),
      detail: normalizeString(item.detail),
      alertType: normalizeString(item.alertType || item.type),
      alertScore: round(item.alertScore, 2) || 0,
    })),
    meta: {
      available: hottestThemes.length > 0 || alertItems.length > 0 || (asNumber(live.todayArticles, 0) || 0) > 0,
      stale: liveStatus.sources.some((source) => source.stale) || structuralAlerts.sources.some((source) => source.stale),
      sources: mergeSources(liveStatus.sources, structuralAlerts.sources),
    },
  };

  return payload.meta.available ? payload : buildEmptyRiskSnapshot();
}

function buildSignalMap(livePayload) {
  return new Map(asArray(livePayload?.signals).map((item) => [normalizeString(item.channel), item]));
}

function countThemesFromHeatmap(heatmap) {
  const counts = new Map();
  for (const cell of asArray(heatmap?.cells)) {
    const theme = normalizeThemeKey(cell.theme);
    if (!theme) continue;
    const current = counts.get(theme) || { count: 0, totalAbsReturn: 0, maxHitRate: 0 };
    current.count += 1;
    current.totalAbsReturn += Math.abs(asNumber(cell.avgReturn, 0) || 0);
    current.maxHitRate = Math.max(current.maxHitRate, asNumber(cell.hitRate, 0) || 0);
    counts.set(theme, current);
  }
  return Array.from(counts.entries())
    .map(([theme, stats]) => ({
      ...resolveThemeMeta(theme),
      count: stats.count,
      magnitude: round(stats.totalAbsReturn, 2) || 0,
      maxHitRate: round(stats.maxHitRate, 3) || 0,
    }))
    .sort((left, right) => (right.magnitude - left.magnitude) || (right.count - left.count))
    .slice(0, 5);
}

async function loadWhatIfStrategies(options = {}) {
  const themeFilter = normalizeThemeKey(options.theme);
  const symbolFilter = normalizeString(options.symbol).toUpperCase();
  const limit = Math.max(1, Math.min(20, Number(options.limit || 8)));
  const cached = await readDashboardCache('whatif', options);
  const cachedStrategies = asArray(cached.payload?.strategies)
    .filter((item) => !themeFilter || normalizeThemeKey(item.theme) === themeFilter)
    .filter((item) => {
      const parsedSymbol = parseStrategySymbol(item);
      return !symbolFilter || parsedSymbol === symbolFilter;
    })
    .slice(0, limit)
    .map(normalizeStrategy);
  if (cachedStrategies.length > 0) {
    return {
      payload: { strategies: cachedStrategies },
      sources: [cached.source],
    };
  }

  const safeQuery = options.safeQuery;
  const primaryRows = await queryRows(safeQuery, `
    SELECT name, sharpe_ratio, expected_return, max_drawdown, theme, symbol
    FROM whatif_simulations
    WHERE ($1 = '' OR theme = $1) AND ($2 = '' OR symbol = $2)
    ORDER BY sharpe_ratio DESC
    LIMIT $3
  `, [themeFilter, symbolFilter, limit]);

  const fallbackRows = primaryRows.length > 0 ? primaryRows : await queryRows(safeQuery, `
    SELECT
      CONCAT(theme, ' / ', symbol) AS name,
      CASE
        WHEN COALESCE(return_vol, 0) > 0 THEN avg_return / NULLIF(return_vol, 0)
        ELSE avg_return
      END AS sharpe_ratio,
      avg_return AS expected_return,
      COALESCE(baseline_vol, return_vol, 0) AS max_drawdown,
      theme,
      symbol
    FROM stock_sensitivity_matrix
    WHERE horizon = '2w'
      AND ($1 = '' OR theme = $1)
      AND ($2 = '' OR symbol = $2)
    ORDER BY sharpe_ratio DESC NULLS LAST
    LIMIT $3
  `, [themeFilter, symbolFilter, limit]);

  return {
    payload: {
      strategies: fallbackRows.map(normalizeStrategy),
    },
    sources: [createSource('whatif-strategies-db', 'postgres', { available: fallbackRows.length > 0 })],
  };
}

function parseStrategySymbol(strategy) {
  const direct = normalizeString(strategy?.symbol).toUpperCase();
  if (direct) return direct;
  const name = normalizeString(strategy?.name);
  const parts = name.split('/').map((item) => normalizeString(item));
  const last = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : '';
  return last || '';
}

function normalizeStrategy(strategy) {
  const theme = normalizeThemeKey(strategy?.theme || normalizeString(strategy?.name).split('/')[0]);
  return {
    name: normalizeString(strategy?.name || `${theme} / ${parseStrategySymbol(strategy)}`),
    ...resolveThemeMeta(theme),
    symbol: parseStrategySymbol(strategy),
    sharpe: round(strategy?.sharpe ?? strategy?.sharpe_ratio, 3) || 0,
    expectedReturn: round(strategy?.expectedReturn ?? strategy?.expected_return, 3) || 0,
    maxDrawdown: round(strategy?.maxDrawdown ?? strategy?.max_drawdown, 3) || 0,
  };
}

async function loadHeatmapPayload(options = {}) {
  const cached = await readDashboardCache('heatmap', options);
  if (cached.payload && Array.isArray(cached.payload?.cells)) {
    return {
      payload: cached.payload,
      sources: [cached.source],
    };
  }

  const safeQuery = options.safeQuery;
  const rows = await queryRows(safeQuery, `
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

  const fallbackRows = rows.length > 0 ? rows : await queryRows(safeQuery, `
    SELECT theme, symbol, AVG(hit::int)::float AS hit_rate, AVG(forward_return_pct)::float AS avg_return
    FROM labeled_outcomes
    WHERE horizon = '2w'
    GROUP BY theme, symbol
    ORDER BY theme, symbol
    LIMIT 120
  `);

  return {
    payload: {
      themes: unique(fallbackRows.map((row) => normalizeThemeKey(row.theme))),
      symbols: unique(fallbackRows.map((row) => normalizeString(row.symbol).toUpperCase())),
      cells: fallbackRows.map((row) => ({
        theme: normalizeThemeKey(row.theme),
        symbol: normalizeString(row.symbol).toUpperCase(),
        hitRate: asNumber(row.hit_rate, 0) || 0,
        avgReturn: asNumber(row.avg_return, 0) || 0,
      })),
    },
    sources: [createSource('heatmap-db', 'postgres', { available: fallbackRows.length > 0 })],
  };
}

function buildEmptyMacroSnapshot() {
  return {
    generatedAt: new Date().toISOString(),
    verdict: 'watch',
    strategyCount: 0,
    signals: [],
    topThemes: [],
    meta: {
      available: false,
      stale: true,
      sources: [],
    },
  };
}

export async function buildCompactMacroSnapshot(options = {}) {
  const [liveStatus, strategiesPayload, heatmapPayload] = await Promise.all([
    loadLiveStatusSnapshot(options),
    loadWhatIfStrategies(options),
    loadHeatmapPayload(options),
  ]);
  const live = liveStatus.payload || buildEmptyLiveStatus();
  const signalMap = buildSignalMap(live);
  const vix = asNumber(signalMap.get('vix')?.value, null);
  const marketStress = asNumber(signalMap.get('marketStress')?.value, null);
  const hyCredit = asNumber(signalMap.get('hy_credit_spread')?.value, null);
  const transmission = asNumber(signalMap.get('transmissionStrength')?.value, null);

  const signals = [
    signalMap.get('vix'),
    signalMap.get('marketStress'),
    signalMap.get('hy_credit_spread'),
    signalMap.get('dollarIndex'),
    signalMap.get('oilPrice'),
    signalMap.get('transmissionStrength'),
  ].filter(Boolean).map((item) => ({
    channel: normalizeString(item.channel),
    label: normalizeString(item.label || SIGNAL_LABELS[item.channel] || item.channel),
    value: round(item.value, 3) || 0,
    updatedAt: toIso(item.updatedAt),
  }));

  const topThemes = countThemesFromHeatmap(heatmapPayload.payload);
  const strategies = asArray(strategiesPayload.payload?.strategies);

  const payload = {
    generatedAt: new Date().toISOString(),
    verdict: classifyMacroVerdict({ vix, marketStress, hyCredit, transmission }),
    strategyCount: strategies.length,
    signals,
    topThemes,
    meta: {
      available: signals.length > 0 || topThemes.length > 0 || strategies.length > 0,
      stale: mergeSources(liveStatus.sources, strategiesPayload.sources, heatmapPayload.sources).some((source) => source.stale),
      sources: mergeSources(liveStatus.sources, strategiesPayload.sources, heatmapPayload.sources),
    },
  };

  return payload.meta.available ? payload : buildEmptyMacroSnapshot();
}

async function loadInvestmentIntelligenceCaches(options = {}) {
  const [
    snapshot,
    experimentRegistry,
    trackedIdeas,
    candidateReviews,
    banditStates,
    convictionModel,
    history,
    mappingStats,
    marketHistory,
  ] = await Promise.all([
    readPersistentCache('investment-intelligence:v1', options),
    readPersistentCache(INVESTMENT_EXPERIMENT_REGISTRY_KEY, options),
    readPersistentCache('investment-intelligence-tracked-ideas:v1', options),
    readPersistentCache('investment-intelligence-candidate-reviews:v1', options),
    readPersistentCache('investment-intelligence-bandit-states:v1', options),
    readPersistentCache('investment-intelligence-conviction-model:v1', options),
    readPersistentCache('investment-intelligence-history:v1', options),
    readPersistentCache('investment-intelligence-mapping-stats:v1', options),
    readPersistentCache('investment-intelligence-market-history:v1', options),
  ]);

  return {
    payload: {
      snapshot: snapshot.payload || null,
      experimentRegistry: experimentRegistry.payload?.registry || null,
      trackedIdeas: asArray(trackedIdeas.payload?.ideas),
      candidateReviews: asArray(candidateReviews.payload?.reviews),
      banditStates: asArray(banditStates.payload?.states),
      convictionModel: convictionModel.payload?.model || null,
      historyEntries: asArray(history.payload?.entries),
      mappingStats: asArray(mappingStats.payload?.stats),
      marketHistoryPoints: asArray(marketHistory.payload?.points),
    },
    sources: mergeSources(
      [snapshot.source],
      [experimentRegistry.source],
      [trackedIdeas.source],
      [candidateReviews.source],
      [banditStates.source],
      [convictionModel.source],
      [history.source],
      [mappingStats.source],
      [marketHistory.source],
    ),
  };
}

function scoreHeatmapCell(cell) {
  const avgReturn = Math.abs(asNumber(cell.avgReturn, 0) || 0);
  const hitRate = asNumber(cell.hitRate, 0) || 0;
  return avgReturn * 0.7 + hitRate * 10;
}

function normalizeTrackedIdea(idea) {
  const theme = normalizeThemeKey(idea?.theme);
  return {
    id: normalizeString(idea?.id || idea?.ideaId),
    ...resolveThemeMeta(theme),
    symbol: normalizeString(idea?.symbol).toUpperCase() || null,
    title: normalizeString(idea?.title || idea?.label || idea?.headline),
    status: normalizeString(idea?.status, 'active'),
    conviction: round(idea?.conviction, 3),
    updatedAt: toIso(idea?.updatedAt || idea?.createdAt),
  };
}

function summarizeExperimentRegistry(registry) {
  if (!registry || typeof registry !== 'object') return null;
  const activeProfile = registry.activeProfile && typeof registry.activeProfile === 'object'
    ? registry.activeProfile
    : {};
  const history = asArray(registry.history);
  const lastEntry = history.length > 0 ? history[history.length - 1] : null;
  return {
    lastScore: round(registry.lastScore, 1) || 0,
    rollbackArmed: Boolean(registry.rollbackArmed),
    activeReason: normalizeString(registry.activeReason),
    lastAction: normalizeString(lastEntry?.action, 'observe'),
    updatedAt: toIso(lastEntry?.recordedAt),
    profile: {
      corroboration: round(activeProfile.corroborationWeightMultiplier, 2) || 1,
      contradiction: round(activeProfile.contradictionPenaltyMultiplier, 2) || 1,
      reality: round(activeProfile.realityPenaltyMultiplier, 2) || 1,
      aggression: round(activeProfile.riskOnAggressionMultiplier, 2) || 1,
      riskOff: round(activeProfile.riskOffExposureMultiplier, 2) || 1,
    },
  };
}

function summarizeSignalRuntime(runtime) {
  if (!runtime || typeof runtime !== 'object') return null;
  const source = normalizeString(runtime.source, 'missing');
  return {
    source,
    coverage: asNumber(runtime.coverage, 0) || 0,
    signalCapturedAt: toIso(runtime.signalCapturedAt),
    transmissionGeneratedAt: toIso(runtime.transmissionGeneratedAt),
    transmissionFreshnessHours: round(runtime.transmissionFreshnessHours, 1),
    transmissionFresh: Boolean(runtime.transmissionFresh),
  };
}

function buildEmptyInvestmentSnapshot() {
  return {
    generatedAt: new Date().toISOString(),
    strategyCount: 0,
    trackedIdeaCount: 0,
    reviewCount: 0,
    strongestPairs: [],
    bestStrategies: [],
    trackedIdeas: [],
    experimentRegistry: null,
    signalRuntime: null,
    meta: {
      available: false,
      stale: true,
      sources: [],
    },
  };
}

export async function buildCompactInvestmentSnapshot(options = {}) {
  const [strategiesPayload, heatmapPayload, investmentCaches] = await Promise.all([
    loadWhatIfStrategies(options),
    loadHeatmapPayload(options),
    loadInvestmentIntelligenceCaches(options),
  ]);

  const strategies = asArray(strategiesPayload.payload?.strategies);
  const strongestPairs = asArray(heatmapPayload.payload?.cells)
    .slice()
    .sort((left, right) => scoreHeatmapCell(right) - scoreHeatmapCell(left))
    .slice(0, 6)
    .map((cell) => ({
      ...resolveThemeMeta(cell.theme),
      symbol: normalizeString(cell.symbol).toUpperCase() || null,
      hitRate: round(cell.hitRate, 3) || 0,
      avgReturn: round(cell.avgReturn, 3) || 0,
      compositeScore: round(scoreHeatmapCell(cell), 3) || 0,
    }));

  const trackedIdeas = investmentCaches.payload.trackedIdeas.slice(0, 6).map(normalizeTrackedIdea);
  const bestStrategies = strategies.slice(0, 6);
  const convictionModel = investmentCaches.payload.convictionModel;
  const experimentRegistry = summarizeExperimentRegistry(
    investmentCaches.payload.experimentRegistry || investmentCaches.payload.snapshot?.experimentRegistry || null,
  );
  const signalRuntime = summarizeSignalRuntime(investmentCaches.payload.snapshot?.integration?.signalRuntime || null);
  const reviewCount = investmentCaches.payload.candidateReviews.length;
  const trackedIdeaCount = investmentCaches.payload.trackedIdeas.length;

  const payload = {
    generatedAt: new Date().toISOString(),
    strategyCount: strategies.length,
    trackedIdeaCount,
    reviewCount,
    strongestPairs,
    bestStrategies,
    trackedIdeas,
    experimentRegistry,
    signalRuntime,
    conviction: convictionModel ? {
      observations: asNumber(convictionModel.observations, 0) || 0,
      learningRate: round(convictionModel.learningRate, 4),
      updatedAt: toIso(convictionModel.updatedAt),
      nonZeroWeightKeys: Object.keys(convictionModel.weights || {}).filter((key) => asNumber(convictionModel.weights?.[key], 0) !== 0),
    } : null,
    meta: {
      available: strategies.length > 0 || strongestPairs.length > 0 || trackedIdeas.length > 0 || Boolean(convictionModel) || Boolean(experimentRegistry) || Boolean(signalRuntime),
      stale: mergeSources(strategiesPayload.sources, heatmapPayload.sources, investmentCaches.sources).some((source) => source.stale),
      sources: mergeSources(strategiesPayload.sources, heatmapPayload.sources, investmentCaches.sources),
    },
  };

  return payload.meta.available ? payload : buildEmptyInvestmentSnapshot();
}

async function readValidationFallbackFiles(options = {}) {
  const dataRoot = options.dataRoot || DEFAULT_DATA_ROOT;
  const historicalDir = options.historicalDir || path.join(dataRoot, 'historical');
  const [alphaValidation, historicalBacktest] = await Promise.all([
    readJsonIfExists(path.join(dataRoot, 'alpha-validation-result.json')),
    readJsonIfExists(path.join(historicalDir, '1yr-backtest-result.json')),
  ]);
  return { alphaValidation, historicalBacktest };
}

function normalizeValidationRun(run) {
  return {
    id: normalizeString(run?.id),
    label: normalizeString(run?.label || run?.id || 'run'),
    mode: normalizeString(run?.mode, 'replay'),
    completedAt: toIso(run?.completedAt),
    uniqueThemeCount: asNumber(run?.uniqueThemeCount, 0) || 0,
    uniqueSymbolCount: asNumber(run?.uniqueSymbolCount, 0) || 0,
    frameCount: asNumber(run?.frameCount, 0) || 0,
    hitRate: round(run?.costAdjustedHitRate, 4) || 0,
    avgReturnPct: round(run?.costAdjustedAvgReturnPct, 4) || 0,
    navChangePct: round(run?.portfolio?.navChangePct, 4) || 0,
  };
}

function buildValidationFallback(alphaValidation, historicalBacktest, sourceList) {
  const tests = alphaValidation?.tests && typeof alphaValidation.tests === 'object' ? Object.values(alphaValidation.tests) : [];
  const passingTests = tests.filter((test) => test?.pass === true).length;
  const testCount = tests.length;
  const historicalRun = historicalBacktest?.run || null;
  return {
    updatedAt: toIso(historicalRun?.completedAt || alphaValidation?.updatedAt || null),
    runCount: historicalRun ? 1 : 0,
    costAdjustedHitRate: 0,
    avgReturnPct: 0,
    coverageScore: testCount > 0 ? Math.round((passingTests / testCount) * 100) : 0,
    qualityScore: normalizeString(alphaValidation?.verdict).toLowerCase() === 'pass' ? 100 : (testCount > 0 ? Math.round((passingTests / testCount) * 100) : 0),
    executionScore: historicalRun ? 100 : 0,
    coverageDensity: 0,
    completenessScore: 0,
    recentRuns: historicalRun ? [normalizeValidationRun(historicalRun)] : [],
    meta: {
      available: Boolean(alphaValidation || historicalRun),
      stale: true,
      sources: sourceList,
    },
  };
}

function buildEmptyValidationSnapshot() {
  return {
    updatedAt: null,
    runCount: 0,
    costAdjustedHitRate: 0,
    avgReturnPct: 0,
    coverageScore: 0,
    qualityScore: 0,
    executionScore: 0,
    coverageDensity: 0,
    completenessScore: 0,
    recentRuns: [],
    meta: {
      available: false,
      stale: true,
      sources: [],
    },
  };
}

export async function buildCompactValidationSnapshot(options = {}) {
  const replayAdaptation = await readPersistentCache('replay-adaptation:v1', options);
  const snapshot = replayAdaptation.payload;
  if (snapshot && typeof snapshot === 'object') {
    const recentRuns = asArray(snapshot.recentRuns).slice(0, 6).map(normalizeValidationRun);
    const workflow = snapshot.workflow || {};
    const coverageLedger = snapshot.coverageLedger || {};
    return {
      updatedAt: toIso(snapshot.updatedAt),
      runCount: asNumber(workflow.runCount, recentRuns.length) || 0,
      costAdjustedHitRate: round(workflow.costAdjustedHitRate, 4) || 0,
      avgReturnPct: round(workflow.costAdjustedAvgReturnPct, 4) || 0,
      coverageScore: round(workflow.coverageScore, 2) || 0,
      qualityScore: round(workflow.qualityScore, 2) || 0,
      executionScore: round(workflow.executionScore, 2) || 0,
      coverageDensity: round(coverageLedger.globalCoverageDensity, 2) || 0,
      completenessScore: round(coverageLedger.globalCompletenessScore, 2) || 0,
      recentRuns,
      meta: {
        available: recentRuns.length > 0 || Boolean(snapshot.workflow),
        stale: replayAdaptation.source.stale,
        sources: [replayAdaptation.source],
      },
    };
  }

  const { alphaValidation, historicalBacktest } = await readValidationFallbackFiles(options);
  const fallbackSources = [
    replayAdaptation.source,
    createSource('alpha-validation-result', 'json-file', { available: Boolean(alphaValidation) }),
    createSource('1yr-backtest-result', 'json-file', {
      available: Boolean(historicalBacktest?.run),
      updatedAt: historicalBacktest?.run?.completedAt || null,
    }),
  ];
  const fallback = buildValidationFallback(alphaValidation, historicalBacktest, fallbackSources);
  return fallback.meta.available ? fallback : buildEmptyValidationSnapshot();
}

function normalizeRelationType(value) {
  return normalizeString(value, 'link').toLowerCase();
}

function humanizeRelationType(value) {
  return normalizeRelationType(value)
    .split(/[_-]+/g)
    .map((token) => token ? `${token[0].toUpperCase()}${token.slice(1)}` : '')
    .join(' ');
}

function normalizeTransmissionEdge(edge) {
  const relationType = normalizeRelationType(edge?.relationType);
  const country = detectCountryFromText(
    edge?.eventTitle,
    edge?.reason,
    edge?.keywords,
  );
  return {
    id: normalizeString(edge?.id),
    headline: normalizeString(edge?.eventTitle, 'Transmission path'),
    source: normalizeString(edge?.eventSource),
    symbol: normalizeString(edge?.marketSymbol || edge?.marketName),
    relationType,
    relationLabel: humanizeRelationType(relationType),
    strength: round(edge?.strength, 2) || 0,
    rawStrength: round(edge?.rawStrength, 2) || 0,
    flowDirection: normalizeString(edge?.flowDirection, 'neutral'),
    lagHours: asNumber(edge?.flowLagHours, 0) || 0,
    reason: normalizeString(edge?.reason),
    keywords: asArray(edge?.keywords).map((keyword) => normalizeString(keyword)).filter(Boolean),
    countryCode: country?.code || null,
    countryLabel: country?.label || null,
  };
}

function aggregateTransmissionCountries(edges = []) {
  const bucket = new Map();
  for (const edge of edges) {
    const country = edge.countryCode
      ? { code: edge.countryCode, label: edge.countryLabel || edge.countryCode }
      : detectCountryFromText(edge.headline || edge.eventTitle, edge.reason, edge.keywords);
    if (!country) continue;
    const current = bucket.get(country.code) || {
      code: country.code,
      label: country.label,
      edgeCount: 0,
      totalStrength: 0,
      topSymbol: null,
      strongestEdgeHeadline: null,
      strongestEdgeStrength: 0,
    };
    const strength = asNumber(edge.strength, 0) || 0;
    current.edgeCount += 1;
    current.totalStrength += strength;
    if (strength >= current.strongestEdgeStrength) {
      current.strongestEdgeStrength = strength;
      current.strongestEdgeHeadline = normalizeString(edge.headline || edge.eventTitle, current.strongestEdgeHeadline || 'Transmission path');
      current.topSymbol = normalizeString(edge.symbol || edge.marketSymbol, current.topSymbol || '');
    }
    bucket.set(country.code, current);
  }
  return Array.from(bucket.values())
    .sort((left, right) => (right.totalStrength - left.totalStrength) || (right.edgeCount - left.edgeCount))
    .slice(0, 6)
    .map((item) => ({
      ...item,
      totalStrength: round(item.totalStrength, 2) || 0,
      strongestEdgeStrength: round(item.strongestEdgeStrength, 2) || 0,
      topSymbol: item.topSymbol || null,
      strongestEdgeHeadline: item.strongestEdgeHeadline || 'Transmission path',
    }));
}

function aggregateTransmissionRelations(edges = []) {
  const bucket = new Map();
  for (const edge of edges) {
    const relationType = normalizeRelationType(edge.relationType);
    const current = bucket.get(relationType) || {
      relationType,
      relationLabel: humanizeRelationType(relationType),
      count: 0,
      totalStrength: 0,
    };
    current.count += 1;
    current.totalStrength += asNumber(edge.strength, 0) || 0;
    bucket.set(relationType, current);
  }
  return Array.from(bucket.values())
    .sort((left, right) => (right.count - left.count) || (right.totalStrength - left.totalStrength))
    .slice(0, 6)
    .map((item) => ({
      ...item,
      avgStrength: item.count > 0 ? round(item.totalStrength / item.count, 2) || 0 : 0,
      totalStrength: round(item.totalStrength, 2) || 0,
    }));
}

function aggregateTransmissionSymbols(edges = []) {
  const bucket = new Map();
  for (const edge of edges) {
    const symbol = normalizeString(edge.symbol);
    if (!symbol) continue;
    const current = bucket.get(symbol) || { symbol, count: 0, totalStrength: 0 };
    current.count += 1;
    current.totalStrength += asNumber(edge.strength, 0) || 0;
    bucket.set(symbol, current);
  }
  return Array.from(bucket.values())
    .sort((left, right) => (right.totalStrength - left.totalStrength) || (right.count - left.count))
    .slice(0, 6)
    .map((item) => ({
      ...item,
      totalStrength: round(item.totalStrength, 2) || 0,
    }));
}

function buildEmptyGeoPressureSnapshot() {
  return {
    generatedAt: new Date().toISOString(),
    level: 'watch',
    score: 0,
    topCountries: [],
    linkedThemes: [],
    hotspots: [],
    meta: {
      available: false,
      stale: true,
      sources: [],
    },
  };
}

export async function buildCompactGeoPressureSnapshot(options = {}) {
  const riskSnapshotPromise = options.riskSnapshot
    ? Promise.resolve(options.riskSnapshot)
    : buildCompactRiskSnapshot(options);
  const [transmissionCache, riskSnapshot] = await Promise.all([
    readPersistentCacheData('event-market-transmission:v1', options),
    riskSnapshotPromise,
  ]);
  const transmission = transmissionCache.payload || {};
  const transmissionSnapshot = transmission?.snapshot && typeof transmission.snapshot === 'object'
    ? transmission.snapshot
    : null;
  const edges = asArray(transmissionSnapshot?.edges || transmission.edges).map(normalizeTransmissionEdge);
  const topCountries = aggregateTransmissionCountries(edges);
  const hotspots = edges
    .filter((edge) => edge.countryCode || edge.relationType === 'country')
    .slice()
    .sort((left, right) => (right.strength - left.strength) || left.headline.localeCompare(right.headline))
    .slice(0, 4);

  const avgCountryStrength = topCountries.length > 0
    ? topCountries.reduce((sum, item) => sum + (asNumber(item.totalStrength, 0) || 0), 0) / topCountries.length
    : 0;
  const score = Math.min(
    100,
    Math.round(avgCountryStrength * 0.65 + (asNumber(riskSnapshot.score, 0) || 0) * 0.35),
  );

  const payload = {
    generatedAt: toIso(transmissionSnapshot?.generatedAt) || new Date().toISOString(),
    level: classifyRiskLevel(score),
    score,
    topCountries,
    linkedThemes: asArray(riskSnapshot.hottestThemes).slice(0, 4),
    hotspots,
    meta: {
      available: topCountries.length > 0 || hotspots.length > 0,
      stale: transmissionCache.source.stale || Boolean(riskSnapshot.meta?.stale),
      sources: mergeSources([transmissionCache.source], asArray(riskSnapshot.meta?.sources)),
    },
  };

  return payload.meta.available ? payload : buildEmptyGeoPressureSnapshot();
}

function buildEmptyTransmissionSnapshot() {
  return {
    generatedAt: new Date().toISOString(),
    regimeLabel: 'Unavailable',
    regimeConfidence: 0,
    freshnessHours: null,
    fresh: false,
    edgeCount: 0,
    topRelations: [],
    topSymbols: [],
    topCountries: [],
    strongestEdges: [],
    notes: [],
    meta: {
      available: false,
      stale: true,
      sources: [],
    },
  };
}

export async function buildCompactTransmissionSnapshot(options = {}) {
  const transmissionCache = await readPersistentCacheData('event-market-transmission:v1', options);
  const transmission = transmissionCache.payload;
  const snapshot = transmission?.snapshot && typeof transmission.snapshot === 'object' ? transmission.snapshot : null;
  const edges = asArray(snapshot?.edges || transmission?.edges).map(normalizeTransmissionEdge);
  const strongestEdges = edges
    .slice()
    .sort((left, right) => (right.strength - left.strength) || left.headline.localeCompare(right.headline))
    .slice(0, 6);
  const topRelations = aggregateTransmissionRelations(edges);
  const topSymbols = aggregateTransmissionSymbols(edges);
  const topCountries = aggregateTransmissionCountries(edges);
  const generatedAt = toIso(snapshot?.generatedAt) || transmissionCache.source.updatedAt || new Date().toISOString();
  const freshnessMs = generatedAt ? Date.now() - Date.parse(generatedAt) : NaN;
  const freshnessHours = Number.isFinite(freshnessMs)
    ? Math.max(0, Math.round((freshnessMs / 36e5) * 10) / 10)
    : null;

  const payload = {
    generatedAt,
    regimeLabel: normalizeString(snapshot?.regime?.label, 'Unavailable'),
    regimeConfidence: asNumber(snapshot?.regime?.confidence, 0) || 0,
    freshnessHours,
    fresh: freshnessHours !== null ? freshnessHours <= 24 : false,
    edgeCount: edges.length,
    topRelations,
    topSymbols,
    topCountries,
    strongestEdges,
    notes: asArray(snapshot?.regime?.notes || snapshot?.summaryLines || snapshot?.notes).slice(0, 4).map((note) => normalizeString(note)).filter(Boolean),
    meta: {
      available: Boolean(snapshot) || edges.length > 0,
      stale: transmissionCache.source.stale,
      sources: [transmissionCache.source],
    },
  };

  return payload.meta.available ? payload : buildEmptyTransmissionSnapshot();
}

function buildEmptySourceOpsSnapshot() {
  return {
    generatedAt: new Date().toISOString(),
    activeCount: 0,
    approvedCount: 0,
    draftCount: 0,
    overrideCount: 0,
    discoveredCount: 0,
    profileCount: 0,
    categoryMix: [],
    recentEvents: [],
    meta: {
      available: false,
      stale: true,
      sources: [],
    },
  };
}

function normalizeSourceOpsEvent(event) {
  return {
    id: normalizeString(event?.id),
    title: normalizeString(event?.title, 'Source event'),
    action: normalizeString(event?.action, 'updated'),
    actor: normalizeString(event?.actor, 'system'),
    status: normalizeString(event?.status, 'ok'),
    category: normalizeString(event?.category || event?.kind),
    detail: normalizeString(event?.detail),
    createdAt: toIso(event?.createdAt),
  };
}

export async function buildCompactSourceOpsSnapshot(options = {}) {
  const [registryCache, opsLogCache, credibilityCache] = await Promise.all([
    readPersistentCacheData('source-registry:v1', options),
    readPersistentCacheData('source-ops-log:v1', options),
    readPersistentCacheData('source-credibility:v1', options),
  ]);

  const registry = registryCache.payload || {};
  const records = asArray(registry.records);
  const discoveredSources = asArray(registry.discoveredSources);
  const overrides = asArray(registry.overrides);
  const allSources = [...records, ...discoveredSources];

  const statusCounts = allSources.reduce((acc, item) => {
    const status = normalizeString(item?.status, 'unknown').toLowerCase();
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  const categoryBucket = new Map();
  for (const item of allSources) {
    const category = normalizeString(item?.category, 'other');
    categoryBucket.set(category, (categoryBucket.get(category) || 0) + 1);
  }
  const categoryMix = Array.from(categoryBucket.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 6);

  const recentEvents = asArray(opsLogCache.payload?.events)
    .slice(0, 6)
    .map(normalizeSourceOpsEvent);

  const profiles = asArray(credibilityCache.payload?.profiles);
  const approvedCount = (statusCounts.approved || 0) + (statusCounts.active || 0);

  const payload = {
    generatedAt: registryCache.source.updatedAt || opsLogCache.source.updatedAt || new Date().toISOString(),
    activeCount: statusCounts.active || 0,
    approvedCount,
    draftCount: statusCounts.draft || 0,
    overrideCount: overrides.length,
    discoveredCount: discoveredSources.length,
    profileCount: profiles.length,
    categoryMix,
    recentEvents,
    meta: {
      available: allSources.length > 0 || recentEvents.length > 0 || profiles.length > 0,
      stale: mergeSources([registryCache.source], [opsLogCache.source], [credibilityCache.source]).some((source) => source.stale),
      sources: mergeSources([registryCache.source], [opsLogCache.source], [credibilityCache.source]),
    },
  };

  return payload.meta.available ? payload : buildEmptySourceOpsSnapshot();
}

export async function buildThemeShellSnapshotPayloads(options = {}) {
  const risk = await buildCompactRiskSnapshot(options);
  const [macro, investment, validation, geoPressure, transmission, sourceOps] = await Promise.all([
    buildCompactMacroSnapshot(options),
    buildCompactInvestmentSnapshot(options),
    buildCompactValidationSnapshot(options),
    buildCompactGeoPressureSnapshot({ ...options, riskSnapshot: risk }),
    buildCompactTransmissionSnapshot(options),
    buildCompactSourceOpsSnapshot(options),
  ]);
  return { risk, macro, investment, validation, geoPressure, transmission, sourceOps };
}

export function getThemeShellSnapshotDefaults() {
  return {
    dataRoot: DEFAULT_DATA_ROOT,
    eventDashboardCacheDir: DEFAULT_EVENT_DASHBOARD_CACHE_DIR,
    persistentCacheDir: DEFAULT_PERSISTENT_CACHE_DIR,
    historicalDir: DEFAULT_HISTORICAL_DIR,
    riskLevels: RISK_LEVELS,
    macroVerdicts: MACRO_VERDICTS,
    signalLabels: { ...SIGNAL_LABELS },
  };
}
