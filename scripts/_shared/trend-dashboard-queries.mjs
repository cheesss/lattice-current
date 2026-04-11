import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import {
  getThemeConfig,
  isDiscoveryTopicKey as taxonomyIsDiscoveryTopicKey,
  isLegacyThemeKey as taxonomyIsLegacyThemeKey,
  listChildThemes as taxonomyListChildThemes,
  resolveThemeTaxonomy as taxonomyResolveThemeTaxonomy,
} from './theme-taxonomy.mjs';

const TABLE_PROBE_TTL_MS = 5 * 60 * 1000;
const tableProbeCache = new Map();
const columnProbeCache = new Map();
let normalizationStateCache = null;
let normalizationStateCheckedAt = 0;

export function clearTrendDashboardProbeCachesForTests() {
  tableProbeCache.clear();
  columnProbeCache.clear();
}

const PERIOD_CONFIG = {
  week: { periodsPerYear: 52 },
  month: { periodsPerYear: 12 },
  quarter: { periodsPerYear: 4 },
  year: { periodsPerYear: 1 },
};

const DEFAULT_PERIOD = 'quarter';
const DEFAULT_TREND_LIMIT = 6;
const DEFAULT_DIGEST_LIMIT = 5;
const DEFAULT_EVOLUTION_LIMIT = 8;
const DEFAULT_QUARTERLY_INSIGHTS_LIMIT = 10;
const NORMALIZATION_STATE_TTL_MS = 5 * 60 * 1000;
const LEGACY_THEME_KEYS = new Set(['conflict', 'tech', 'energy', 'economy', 'politics']);
const FOLLOWED_THEME_BRIEFING_SOURCE = 'followed-theme-briefing-generator';
const STRUCTURAL_ALERT_SOURCE = 'structural-alert-generator';
const THEME_NOTEBOOK_SCHEMA_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS theme_brief_notebooks (
      notebook_key TEXT PRIMARY KEY,
      theme TEXT NOT NULL,
      period_type TEXT NOT NULL,
      note_markdown TEXT NOT NULL DEFAULT '',
      pinned BOOLEAN NOT NULL DEFAULT false,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      share_token TEXT,
      shared_at TIMESTAMPTZ,
      export_count INTEGER NOT NULL DEFAULT 0,
      last_exported_at TIMESTAMPTZ,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (theme, period_type)
    );
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_theme_brief_notebooks_share_token
      ON theme_brief_notebooks (share_token)
      WHERE share_token IS NOT NULL;
  `,
];
const FOLLOWED_THEME_BRIEFING_SCHEMA_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS followed_theme_briefing_snapshots (
      snapshot_key TEXT PRIMARY KEY,
      theme_set_key TEXT NOT NULL,
      period_type TEXT NOT NULL,
      snapshot_date DATE NOT NULL,
      theme_count INTEGER NOT NULL DEFAULT 0,
      themes JSONB NOT NULL DEFAULT '[]'::jsonb,
      headline TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source TEXT NOT NULL DEFAULT '${FOLLOWED_THEME_BRIEFING_SOURCE}',
      UNIQUE (theme_set_key, period_type, snapshot_date)
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_followed_theme_briefing_snapshots_lookup
      ON followed_theme_briefing_snapshots (theme_set_key, period_type, snapshot_date DESC, generated_at DESC);
  `,
];
const STRUCTURAL_ALERT_SCHEMA_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS theme_structural_alerts (
      alert_key TEXT PRIMARY KEY,
      theme TEXT NOT NULL,
      label TEXT,
      parent_theme TEXT,
      category TEXT,
      period_type TEXT NOT NULL,
      period_start DATE,
      period_end DATE,
      alert_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'active',
      headline TEXT NOT NULL,
      detail TEXT NOT NULL,
      signal_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      evidence_classes JSONB NOT NULL DEFAULT '[]'::jsonb,
      provenance JSONB NOT NULL DEFAULT '[]'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      source TEXT NOT NULL DEFAULT '${STRUCTURAL_ALERT_SOURCE}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_theme_structural_alerts_lookup
      ON theme_structural_alerts (period_type, status, updated_at DESC, signal_score DESC);
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_theme_structural_alerts_theme
      ON theme_structural_alerts (theme, period_type, updated_at DESC);
  `,
];
const DISCOVERY_TRIAGE_SCHEMA_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS discovery_topic_reviews (
      review_id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL REFERENCES discovery_topics(id) ON DELETE CASCADE,
      review_state TEXT NOT NULL CHECK (review_state IN ('canonical', 'watch', 'suppressed')),
      normalized_theme TEXT,
      normalized_parent_theme TEXT,
      normalized_category TEXT,
      suppression_reason TEXT,
      review_note TEXT,
      reviewer TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_discovery_topic_reviews_topic
      ON discovery_topic_reviews (topic_id, reviewed_at DESC);
  `,
];
const GITHUB_THEME_EVIDENCE_SCHEMA_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS github_repositories (
      repo_key TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      owner_login TEXT,
      name TEXT,
      html_url TEXT,
      description TEXT,
      homepage_url TEXT,
      language TEXT,
      topics JSONB NOT NULL DEFAULT '[]'::jsonb,
      stargazers_count INTEGER NOT NULL DEFAULT 0,
      watchers_count INTEGER NOT NULL DEFAULT 0,
      forks_count INTEGER NOT NULL DEFAULT 0,
      open_issues_count INTEGER NOT NULL DEFAULT 0,
      default_branch TEXT,
      license_name TEXT,
      archived BOOLEAN NOT NULL DEFAULT FALSE,
      fork BOOLEAN NOT NULL DEFAULT FALSE,
      created_at_github TIMESTAMPTZ,
      pushed_at TIMESTAMPTZ,
      updated_at_github TIMESTAMPTZ,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_github_repositories_pushed
      ON github_repositories (pushed_at DESC, stargazers_count DESC);
  `,
  `
    CREATE TABLE IF NOT EXISTS theme_github_evidence (
      evidence_key TEXT PRIMARY KEY,
      theme TEXT NOT NULL,
      repo_key TEXT NOT NULL REFERENCES github_repositories(repo_key) ON DELETE CASCADE,
      search_query TEXT,
      matched_keywords TEXT[] NOT NULL DEFAULT '{}'::text[],
      github_signal_score DOUBLE PRECISION,
      stargazers_count INTEGER NOT NULL DEFAULT 0,
      pushed_at TIMESTAMPTZ,
      evidence_note TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (theme, repo_key)
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_theme_github_evidence_theme
      ON theme_github_evidence (theme, pushed_at DESC, stargazers_count DESC);
  `,
];

function isDiscoveryTopicKey(value) {
  return taxonomyIsDiscoveryTopicKey(value) || /^dt-[a-z0-9]+$/i.test(String(value || '').trim());
}

function isLegacyThemeKey(value) {
  return taxonomyIsLegacyThemeKey(value) || LEGACY_THEME_KEYS.has(String(value || '').trim().toLowerCase());
}

function isCanonicalThemeKey(value) {
  const theme = String(value || '').trim().toLowerCase();
  return Boolean(theme && theme !== 'unknown' && !isLegacyThemeKey(theme) && !isDiscoveryTopicKey(theme));
}

function resolveThemeTaxonomy(value) {
  const resolved = taxonomyResolveThemeTaxonomy(value);
  const theme = String(value || '').trim().toLowerCase();
  const parentTheme = resolved.parentTheme || PARENT_THEME_ALIASES[theme] || theme;
  return {
    themeKey: resolved.themeKey || (isCanonicalThemeKey(theme) ? theme : null),
    parentTheme,
    category: resolved.category || (theme ? inferCategory(theme) : 'other'),
  };
}

function listChildThemes() {
  return taxonomyListChildThemes(...arguments);
}

const CATEGORY_LABELS = {
  technology: 'Technology',
  science: 'Science',
  geopolitics: 'Geopolitics',
  macro: 'Macro',
  environment: 'Environment',
  society: 'Society',
  health: 'Health',
  other: 'Other',
};

const SOURCE_QUALITY = {
  reuters: 0.98,
  bloomberg: 0.97,
  ft: 0.96,
  wsj: 0.96,
  nyt: 0.93,
  guardian: 0.9,
  economist: 0.95,
  ap: 0.95,
  arxiv: 0.92,
  hackernews: 0.78,
};

const PARENT_THEME_ALIASES = {
  technology: 'technology-general',
  'technology-general': 'technology-general',
  science: 'science-general',
  'science-general': 'science-general',
  health: 'health-general',
  'health-general': 'health-general',
  society: 'society-general',
  'society-general': 'society-general',
  environment: 'environment-general',
  'environment-general': 'environment-general',
  macroeconomics: 'macroeconomics',
  macro: 'macroeconomics',
  economy: 'macroeconomics',
  geopolitics: 'geopolitics',
  geopolitical: 'geopolitics',
};

const TREND_STAGES = ['mainstream', 'growing', 'emerging', 'nascent', 'declining'];

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function normalizePercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function humanizeTheme(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function truncateText(value, limit = 320) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function normalizeTheme(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePeriodType(value) {
  const key = String(value || DEFAULT_PERIOD).trim().toLowerCase();
  return PERIOD_CONFIG[key] ? key : DEFAULT_PERIOD;
}

function normalizeLimit(value, fallback, max = 20) {
  return Math.max(1, Math.min(max, Number(value) || fallback));
}

function normalizeThemeList(value, limit = 12) {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || '')
      .split(',')
      .map((item) => item.trim());
  return Array.from(new Set(
    rawItems
      .map((item) => normalizeTheme(item))
      .filter((item) => isCanonicalThemeKey(item)),
  )).slice(0, limit);
}

function buildFollowedThemeSetKey(themes = []) {
  const normalized = normalizeThemeList(themes, 24);
  const serialized = normalized.join('|');
  return createHash('sha1').update(serialized).digest('hex');
}

export function buildThemeNotebookKey(theme, periodType = DEFAULT_PERIOD) {
  return `${normalizeTheme(theme)}::${normalizePeriodType(periodType)}`;
}

function normalizeNotebookTags(tags = []) {
  return Array.from(new Set(
    asArray(tags)
      .map((item) => String(item || '').trim())
      .filter(Boolean),
  )).slice(0, 16);
}

function startOfPeriodDate(periodType, reference = new Date()) {
  const date = new Date(Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate(),
  ));
  if (periodType === 'week') {
    const weekday = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - (weekday - 1));
    return date;
  }
  if (periodType === 'month') {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }
  if (periodType === 'quarter') {
    const quarterMonth = Math.floor(date.getUTCMonth() / 3) * 3;
    return new Date(Date.UTC(date.getUTCFullYear(), quarterMonth, 1));
  }
  if (periodType === 'year') {
    return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  }
  return date;
}

export function buildFollowedThemeBriefingSnapshotDate(periodType, reference = new Date()) {
  return toIsoDay(startOfPeriodDate(normalizePeriodType(periodType), reference));
}

function normalizeCategory(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return CATEGORY_LABELS[normalized] ? normalized : '';
}

function normalizeParentTheme(value) {
  const raw = normalizeTheme(value);
  const resolved = resolveThemeTaxonomy(raw);
  if (resolved.parentTheme) return resolved.parentTheme;
  return PARENT_THEME_ALIASES[raw] || raw;
}

function isCanonicalTrendRow(row) {
  const theme = normalizeTheme(row?.theme);
  if (!theme || theme === 'unknown') return false;
  if (isDiscoveryTopicKey(theme)) return false;
  if (isLegacyThemeKey(theme)) return false;
  const resolved = resolveThemeTaxonomy(theme);
  return Boolean(resolved.themeKey && isCanonicalThemeKey(resolved.themeKey));
}

function filterCanonicalTrendRows(rows = []) {
  const canonical = rows.filter((row) => isCanonicalTrendRow(row));
  return canonical.length > 0 ? canonical : rows;
}

function looksLikeDiscoveryTopicId(value) {
  return isDiscoveryTopicKey(value);
}

function looksLikeLegacyTheme(value) {
  const normalized = normalizeTheme(value);
  if (!LEGACY_THEME_KEYS.has(normalized) && !isLegacyThemeKey(normalized)) return false;
  const resolved = resolveThemeTaxonomy(normalized);
  return resolved.themeKey !== normalized;
}

function sanitizeDisplayLabel(label, fallbackValue) {
  const normalized = String(label || '').trim();
  if (normalized && !looksLikeDiscoveryTopicId(normalized)) {
    return normalized;
  }
  return humanizeTheme(fallbackValue);
}

function toIsoDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

function toIsoDay(value) {
  return toIsoDate(value)?.slice(0, 10) || null;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonths(date, months) {
  const next = new Date(date.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function addYears(date, years) {
  const next = new Date(date.getTime());
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

function startOfPeriod(date, periodType) {
  const utc = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    0,
    0,
    0,
    0,
  ));

  if (periodType === 'week') {
    const day = utc.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    utc.setUTCDate(utc.getUTCDate() + diff);
    return utc;
  }
  if (periodType === 'month') {
    utc.setUTCDate(1);
    return utc;
  }
  if (periodType === 'quarter') {
    utc.setUTCDate(1);
    utc.setUTCMonth(Math.floor(utc.getUTCMonth() / 3) * 3);
    return utc;
  }
  utc.setUTCMonth(0, 1);
  return utc;
}

function addPeriods(date, periodType, count) {
  if (periodType === 'week') return addDays(date, count * 7);
  if (periodType === 'month') return addMonths(date, count);
  if (periodType === 'quarter') return addMonths(date, count * 3);
  return addYears(date, count);
}

function formatPeriodLabel(periodStart, periodType) {
  const date = new Date(periodStart);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getUTCFullYear();
  if (periodType === 'week') {
    const firstDay = Date.UTC(year, 0, 1);
    const dayOfYear = Math.floor((date.getTime() - firstDay) / 86400000) + 1;
    const week = Math.ceil(dayOfYear / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
  }
  if (periodType === 'month') {
    return `${year}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  if (periodType === 'quarter') {
    return `${year}Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
  }
  return String(year);
}

function parseDateInput(value) {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function percentageDelta(currentValue, previousValue) {
  const current = Number(currentValue || 0);
  const previous = Number(previousValue || 0);
  if (previous === 0) {
    if (current === 0) return 0;
    return 300;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

function classifyLifecycle({ articleCount, yoyChangePct, periodType }) {
  const periodsPerYear = PERIOD_CONFIG[periodType]?.periodsPerYear || 4;
  const annualizedCount = Number(articleCount || 0) * periodsPerYear;
  const yoy = Number(yoyChangePct || 0);

  if (yoy <= -20) return 'declining';
  if (annualizedCount < 50 && yoy >= 200) return 'nascent';
  if (annualizedCount < 500 && yoy >= 50) return 'emerging';
  if (annualizedCount < 2000 && yoy >= 20) return 'growing';
  return 'mainstream';
}

function inferCategory(theme, explicitCategory = '') {
  const normalized = normalizeTheme(theme);
  const hinted = normalizeCategory(explicitCategory);
  if (hinted) return hinted;
  if (!normalized) return 'other';

  if (
    /(quantum|robot|semiconductor|chip|ai|ml|software|cloud|cyber|space|satellite|autonomous|automation|neural|compute|battery|photon|bioinformatics)/.test(normalized)
    || normalized === 'tech'
  ) return 'technology';
  if (/(biotech|genom|crispr|cell|drug|pharma|therapy|protein|research)/.test(normalized)) return 'science';
  if (/(conflict|war|military|defen|geopolit|sanction|border|sovereign|security|politics)/.test(normalized)) return 'geopolitics';
  if (/(econom|macro|trade|inflation|rate|yield|dollar|treasury|credit|labor|monetary|bank)/.test(normalized)) return 'macro';
  if (/(climate|energy|renewable|nuclear|hydrogen|resource|agri|food|water|carbon|emission)/.test(normalized)) return 'environment';
  if (/(demograph|migration|urban|education|inequality|remote|workforce|social|culture)/.test(normalized)) return 'society';
  if (/(health|longevity|mental|public-health|aging|medical)/.test(normalized)) return 'health';
  return 'other';
}

function sourceQualityFor(source) {
  const key = normalizeTheme(source);
  if (!key) return 0.65;
  return SOURCE_QUALITY[key] ?? 0.72;
}

function buildStagePriority(stage) {
  return TREND_STAGES.indexOf(stage);
}

function normalizeSignals(signals) {
  return asArray(signals).map((signal) => ({
    signalName: String(signal?.signalName || signal?.signal_name || ''),
    correlation: round(signal?.correlation ?? signal?.pearson_corr, 4),
    sampleSize: Number((signal?.sampleSize ?? signal?.sample_size) || 0),
  })).filter((signal) => signal.signalName);
}

async function probeTable(safeQuery, tableName) {
  const cached = tableProbeCache.get(tableName);
  if (cached && Date.now() - cached.checkedAt < TABLE_PROBE_TTL_MS) {
    return cached.exists;
  }
  const result = await safeQuery('SELECT to_regclass($1) AS relation_name', [`public.${tableName}`]);
  const exists = Boolean(result.rows[0]?.relation_name);
  tableProbeCache.set(tableName, { exists, checkedAt: Date.now() });
  return exists;
}

async function probeColumn(safeQuery, tableName, columnName) {
  const cacheKey = `${tableName}.${columnName}`;
  const cached = columnProbeCache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < TABLE_PROBE_TTL_MS) {
    return cached.exists;
  }
  const result = await safeQuery(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
      AND column_name = $2
    LIMIT 1
  `, [tableName, columnName]);
  const exists = result.rows.length > 0;
  columnProbeCache.set(cacheKey, { exists, checkedAt: Date.now() });
  return exists;
}

async function loadNormalizationState(safeQuery) {
  if (normalizationStateCache && Date.now() - normalizationStateCheckedAt < NORMALIZATION_STATE_TTL_MS) {
    return normalizationStateCache;
  }

  const [
    hasAutoArticleThemes,
    hasTrendAggregates,
    hasThemeEvolution,
    hasDailyCuratedNews,
    hasThemeKeyColumn,
    hasThemeLabelColumn,
    hasParentThemeColumn,
    hasThemeCategoryColumn,
  ] = await Promise.all([
    probeTable(safeQuery, 'auto_article_themes'),
    probeTable(safeQuery, 'theme_trend_aggregates'),
    probeTable(safeQuery, 'theme_evolution'),
    probeTable(safeQuery, 'daily_curated_news'),
    probeColumn(safeQuery, 'auto_article_themes', 'theme_key'),
    probeColumn(safeQuery, 'auto_article_themes', 'theme_label'),
    probeColumn(safeQuery, 'auto_article_themes', 'parent_theme'),
    probeColumn(safeQuery, 'auto_article_themes', 'theme_category'),
  ]);

  let normalizedArticleThemeCount = 0;
  let normalizedAggregateCount = 0;
  let normalizedEvolutionCount = 0;
  let normalizedDigestCount = 0;

  if (hasAutoArticleThemes && hasThemeKeyColumn) {
    const result = await safeQuery(`
      SELECT COUNT(*)::int AS normalized_count
      FROM auto_article_themes
      WHERE NULLIF(TRIM(theme_key), '') IS NOT NULL
        AND theme_key <> 'unknown'
        AND theme_key !~* '^dt-'
        AND theme_key <> ALL($1::text[])
    `, [Array.from(LEGACY_THEME_KEYS)]);
    normalizedArticleThemeCount = Number(result.rows[0]?.normalized_count || 0);
  }

  if (hasTrendAggregates) {
    const result = await safeQuery(`
      SELECT COUNT(*)::int AS normalized_count
      FROM theme_trend_aggregates
      WHERE theme IS NOT NULL
        AND theme <> 'unknown'
        AND theme !~* '^dt-'
        AND theme <> ALL($1::text[])
        AND COALESCE(NULLIF(parent_theme, ''), '') <> ''
    `, [Array.from(LEGACY_THEME_KEYS)]);
    normalizedAggregateCount = Number(result.rows[0]?.normalized_count || 0);
  }

  if (hasThemeEvolution) {
    const result = await safeQuery(`
      SELECT COUNT(*)::int AS normalized_count
      FROM theme_evolution
      WHERE sub_theme IS NOT NULL
        AND sub_theme <> 'unknown'
        AND sub_theme !~* '^dt-'
        AND sub_theme <> ALL($1::text[])
    `, [Array.from(LEGACY_THEME_KEYS)]);
    normalizedEvolutionCount = Number(result.rows[0]?.normalized_count || 0);
  }

  if (hasDailyCuratedNews) {
    const result = await safeQuery(`
      SELECT COUNT(*)::int AS normalized_count
      FROM daily_curated_news
      WHERE theme IS NOT NULL
        AND theme <> 'unknown'
        AND theme !~* '^dt-'
        AND theme <> ALL($1::text[])
    `, [Array.from(LEGACY_THEME_KEYS)]);
    normalizedDigestCount = Number(result.rows[0]?.normalized_count || 0);
  }

  normalizationStateCache = {
    hasNormalizedTaxonomy: (
      normalizedArticleThemeCount > 0
      || normalizedAggregateCount > 0
      || normalizedEvolutionCount > 0
      || normalizedDigestCount > 0
    ),
    hasTrendNormalizedTaxonomy: normalizedArticleThemeCount > 0 || normalizedAggregateCount > 0,
    hasEvolutionNormalizedTaxonomy: normalizedArticleThemeCount > 0 || normalizedAggregateCount > 0 || normalizedEvolutionCount > 0,
    hasDigestNormalizedTaxonomy: normalizedArticleThemeCount > 0 || normalizedDigestCount > 0,
    normalizedArticleThemeCount,
    normalizedAggregateCount,
    normalizedEvolutionCount,
    normalizedDigestCount,
    hasThemeKeyColumn,
    hasThemeLabelColumn,
    hasParentThemeColumn,
    hasThemeCategoryColumn,
  };
  normalizationStateCheckedAt = Date.now();
  return normalizationStateCache;
}

function buildTrendWindow(periodType) {
  const now = new Date();
  const currentStart = startOfPeriod(now, periodType);
  const currentEnd = addPeriods(currentStart, periodType, 1);
  const previousStart = addPeriods(currentStart, periodType, -1);
  const olderStart = addPeriods(currentStart, periodType, -2);
  const yearAgoStart = startOfPeriod(addYears(currentStart, -1), periodType);
  const yearAgoEnd = addPeriods(yearAgoStart, periodType, 1);
  const threeYearAgoStart = startOfPeriod(addYears(currentStart, -3), periodType);
  const threeYearAgoEnd = addPeriods(threeYearAgoStart, periodType, 1);

  return {
    currentStart,
    currentEnd,
    previousStart,
    olderStart,
    yearAgoStart,
    yearAgoEnd,
    threeYearAgoStart,
    threeYearAgoEnd,
  };
}

function mapTrendSnapshotRow(row, periodType) {
  const currentCount = Number(row.article_count ?? row.current_count ?? 0);
  const previousCount = Number(row.previous_count ?? 0);
  const olderCount = Number(row.older_count ?? 0);
  const yearAgoCount = Number(row.year_ago_count ?? 0);
  const threeYearAgoCount = Number(row.three_year_ago_count ?? 0);
  const vsPreviousPct = Number.isFinite(Number(row.vs_previous_period_pct))
    ? Number(row.vs_previous_period_pct)
    : percentageDelta(currentCount, previousCount);
  const vsYearAgoPct = Number.isFinite(Number(row.vs_year_ago_pct))
    ? Number(row.vs_year_ago_pct)
    : percentageDelta(currentCount, yearAgoCount);
  const vsThreeYearAgoPct = Number.isFinite(Number(row.vs_3year_ago_pct))
    ? Number(row.vs_3year_ago_pct)
    : percentageDelta(currentCount, threeYearAgoCount);
  const previousVsOlderPct = percentageDelta(previousCount, olderCount);
  const acceleration = Number.isFinite(Number(row.trend_acceleration))
    ? Number(row.trend_acceleration)
    : (vsPreviousPct - previousVsOlderPct);
  const lifecycleStage = String(
    row.lifecycle_stage
      || classifyLifecycle({ articleCount: currentCount, yoyChangePct: vsYearAgoPct, periodType }),
  ).toLowerCase();
  const previousLifecycleStage = String(
    row.previous_lifecycle_stage
      || classifyLifecycle({ articleCount: previousCount, yoyChangePct: previousVsOlderPct, periodType }),
  ).toLowerCase();
  const theme = normalizeTheme(row.theme || row.sub_theme || 'unknown');
  const category = inferCategory(theme, row.category);
  const sourceDiversityRaw = Number(row.source_diversity ?? row.current_source_count ?? 0);
  const sourceDiversity = row.source_diversity != null
    ? Number(row.source_diversity)
    : round(clamp(sourceDiversityRaw / 12, 0, 1), 4);
  const score = round(
    clamp(Math.log10(currentCount + 1) / 3, 0, 1) * 0.35
      + clamp(vsYearAgoPct / 200, -1, 1) * 0.3
      + clamp(acceleration / 200, -1, 1) * 0.2
      + clamp(sourceDiversity, 0, 1) * 0.15,
    4,
  );

  return {
    theme,
    label: sanitizeDisplayLabel(row.theme_label || row.label, theme),
    themeLabel: sanitizeDisplayLabel(row.theme_label || row.label, theme),
    parentTheme: normalizeParentTheme(row.parent_theme || theme),
    category,
    categoryLabel: CATEGORY_LABELS[category] || humanizeTheme(category),
    articleCount: currentCount,
    previousCount,
    yearAgoCount,
    threeYearAgoCount,
    vsPreviousPct: round(vsPreviousPct),
    vsYearAgoPct: round(vsYearAgoPct),
    vs3YearAgoPct: round(vsThreeYearAgoPct),
    acceleration: round(acceleration),
    lifecycleStage,
    previousLifecycleStage,
    transition: lifecycleStage !== previousLifecycleStage
      ? {
        from: previousLifecycleStage,
        to: lifecycleStage,
      }
      : null,
    sourceDiversity: round(sourceDiversity, 4),
    sourceDiversityRaw,
    geographicSpread: Number(row.geographic_spread || 0),
    periodType,
    periodStart: row.period_start ? toIsoDay(new Date(row.period_start)) : null,
    periodEnd: row.period_end ? toIsoDay(new Date(row.period_end)) : null,
    latestArticleAt: row.latest_article_at || null,
    score,
  };
}

function shouldSuppressThemeValue(theme, strictFilteringEnabled) {
  if (looksLikeDiscoveryTopicId(theme) || looksLikeLegacyTheme(theme)) return true;
  if (!strictFilteringEnabled) return false;
  return !isCanonicalTrendRow({ theme });
}

function filterVisibleTrendRows(rows, strictFilteringEnabled) {
  const filtered = rows.filter((row) => !shouldSuppressThemeValue(row.theme, strictFilteringEnabled));
  return filtered.length > 0 ? filtered : rows;
}

function sanitizeRelatedTopics(topics, topicLabel, normalizationState) {
  const cleaned = [];
  for (const topic of asArray(topics)) {
    const value = String(topic || '').trim();
    if (!value) continue;
    if (looksLikeDiscoveryTopicId(value)) continue;
    cleaned.push(value);
  }
  if (cleaned.length === 0 && topicLabel) {
    const normalizedLabel = String(topicLabel || '').trim();
    if (normalizedLabel && !looksLikeDiscoveryTopicId(normalizedLabel)) {
      cleaned.push(normalizedLabel);
    }
  }
  return Array.from(new Set(cleaned));
}

function shouldSuppressDigestItem(item, strictFilteringEnabled) {
  return shouldSuppressThemeValue(item.theme, strictFilteringEnabled);
}

async function loadTrendSnapshotFromAggregate(safeQuery, periodType, limit) {
  const rows = await safeQuery(`
    WITH ranked AS (
      SELECT
        theme,
        theme_label,
        parent_theme,
        category,
        period_type,
        period_start,
        period_end,
        article_count,
        vs_previous_period_pct,
        vs_year_ago_pct,
        vs_3year_ago_pct,
        lifecycle_stage,
        trend_acceleration,
        source_diversity,
        geographic_spread,
        computed_at,
        ROW_NUMBER() OVER (PARTITION BY theme, period_type ORDER BY period_start DESC, computed_at DESC) AS rn
      FROM theme_trend_aggregates
      WHERE period_type = $1
    )
    SELECT
      current.theme,
      current.theme_label,
      current.parent_theme,
      current.category,
      current.period_type,
      current.period_start,
      current.period_end,
      current.article_count,
      current.vs_previous_period_pct,
      current.vs_year_ago_pct,
      current.vs_3year_ago_pct,
      current.lifecycle_stage,
      current.trend_acceleration,
      current.source_diversity,
      current.geographic_spread,
      previous.lifecycle_stage AS previous_lifecycle_stage
    FROM ranked current
    LEFT JOIN ranked previous
      ON previous.theme = current.theme
     AND previous.period_type = current.period_type
     AND previous.rn = 2
    WHERE current.rn = 1
    ORDER BY current.article_count DESC NULLS LAST, current.theme
    LIMIT $2
  `, [periodType, limit]);
  return rows.rows.map((row) => mapTrendSnapshotRow(row, periodType));
}

async function loadTrendSnapshotFallback(safeQuery, periodType, limit) {
  const normalizationState = await loadNormalizationState(safeQuery);
  const window = buildTrendWindow(periodType);
  const themeExpr = normalizationState.hasThemeKeyColumn
    ? `COALESCE(NULLIF(TRIM(t.theme_key), ''), NULLIF(TRIM(t.auto_theme), ''), 'unknown')`
    : `COALESCE(NULLIF(TRIM(t.auto_theme), ''), 'unknown')`;
  const themeLabelExpr = normalizationState.hasThemeLabelColumn
    ? `NULLIF(TRIM(t.theme_label), '')`
    : 'NULL';
  const parentThemeExpr = normalizationState.hasParentThemeColumn
    ? `COALESCE(NULLIF(TRIM(t.parent_theme), ''), ${themeExpr})`
    : themeExpr;
  const categoryExpr = normalizationState.hasThemeCategoryColumn
    ? `COALESCE(NULLIF(TRIM(t.theme_category), ''), 'other')`
    : `'other'`;
  const rows = await safeQuery(`
    SELECT
      ${themeExpr} AS theme,
      ${themeLabelExpr} AS theme_label,
      ${parentThemeExpr} AS parent_theme,
      ${categoryExpr} AS category,
      COUNT(*) FILTER (WHERE a.published_at >= $1::timestamptz AND a.published_at < $2::timestamptz) AS current_count,
      COUNT(DISTINCT a.source) FILTER (WHERE a.published_at >= $1::timestamptz AND a.published_at < $2::timestamptz) AS current_source_count,
      COUNT(*) FILTER (WHERE a.published_at >= $3::timestamptz AND a.published_at < $1::timestamptz) AS previous_count,
      COUNT(*) FILTER (WHERE a.published_at >= $4::timestamptz AND a.published_at < $3::timestamptz) AS older_count,
      COUNT(*) FILTER (WHERE a.published_at >= $5::timestamptz AND a.published_at < $6::timestamptz) AS year_ago_count,
      COUNT(*) FILTER (WHERE a.published_at >= $7::timestamptz AND a.published_at < $8::timestamptz) AS three_year_ago_count,
      MAX(a.published_at) FILTER (WHERE a.published_at >= $1::timestamptz AND a.published_at < $2::timestamptz) AS latest_article_at
    FROM auto_article_themes t
    JOIN articles a ON a.id = t.article_id
    WHERE a.published_at >= $7::timestamptz
      AND a.published_at < $2::timestamptz
      AND ${themeExpr} <> 'unknown'
    GROUP BY 1, 2, 3, 4
    HAVING
      COUNT(*) FILTER (WHERE a.published_at >= $1::timestamptz AND a.published_at < $2::timestamptz) > 0
      OR COUNT(*) FILTER (WHERE a.published_at >= $3::timestamptz AND a.published_at < $1::timestamptz) > 0
      OR COUNT(*) FILTER (WHERE a.published_at >= $5::timestamptz AND a.published_at < $6::timestamptz) > 0
    ORDER BY current_count DESC NULLS LAST, theme
    LIMIT $9
  `, [
    toIsoDate(window.currentStart),
    toIsoDate(window.currentEnd),
    toIsoDate(window.previousStart),
    toIsoDate(window.olderStart),
    toIsoDate(window.yearAgoStart),
    toIsoDate(window.yearAgoEnd),
    toIsoDate(window.threeYearAgoStart),
    toIsoDate(window.threeYearAgoEnd),
    limit,
  ]);

  return rows.rows.map((row) => mapTrendSnapshotRow({
    ...row,
    period_start: toIsoDay(window.currentStart),
    period_end: toIsoDay(addDays(window.currentEnd, -1)),
  }, periodType));
}

async function loadLatestTrendSnapshot(safeQuery, periodType, limit = 80) {
  const normalizationState = await loadNormalizationState(safeQuery);
  const strictFilteringEnabled = normalizationState.hasTrendNormalizedTaxonomy;
  const hasAggregate = await probeTable(safeQuery, 'theme_trend_aggregates');
  if (hasAggregate) {
    const aggregateRows = filterVisibleTrendRows(
      await loadTrendSnapshotFromAggregate(safeQuery, periodType, limit),
      strictFilteringEnabled,
    );
    if (aggregateRows.length > 0 || !strictFilteringEnabled) {
      return {
        source: 'theme_trend_aggregates',
        rows: aggregateRows,
        normalizationState,
      };
    }
  }
  return {
    source: 'auto_article_themes_fallback',
    rows: filterVisibleTrendRows(
      await loadTrendSnapshotFallback(safeQuery, periodType, limit),
      strictFilteringEnabled,
    ),
    normalizationState,
  };
}

function buildPeriodEnvelope(periodType, referenceRow) {
  if (referenceRow?.periodStart && referenceRow?.periodEnd) {
    return {
      periodType,
      periodStart: referenceRow.periodStart,
      periodEnd: referenceRow.periodEnd,
      periodLabel: formatPeriodLabel(referenceRow.periodStart, periodType),
    };
  }
  const currentStart = startOfPeriod(new Date(), periodType);
  return {
    periodType,
    periodStart: toIsoDay(currentStart),
    periodEnd: toIsoDay(addDays(addPeriods(currentStart, periodType, 1), -1)),
    periodLabel: formatPeriodLabel(currentStart, periodType),
  };
}

function buildTransitions(rows, limit = 8) {
  return rows
    .filter((row) => row.transition)
    .sort((left, right) => {
      const accelerationDiff = Number(right.acceleration || 0) - Number(left.acceleration || 0);
      if (accelerationDiff !== 0) return accelerationDiff;
      return Number(right.articleCount || 0) - Number(left.articleCount || 0);
    })
    .slice(0, limit)
    .map((row) => ({
      theme: row.theme,
      label: row.label,
      category: row.category,
      from: row.transition.from,
      to: row.transition.to,
      articleCount: row.articleCount,
      vsYearAgoPct: row.vsYearAgoPct,
      acceleration: row.acceleration,
    }));
}

function buildCategorySummaries(rows, perCategoryLimit = 3) {
  const groups = new Map();
  for (const row of rows) {
    const bucket = groups.get(row.category) || [];
    bucket.push(row);
    groups.set(row.category, bucket);
  }

  return Array.from(groups.entries())
    .map(([category, items]) => {
      const sorted = items.slice().sort((left, right) => Number(right.score || 0) - Number(left.score || 0));
      const totalArticleCount = items.reduce((sum, item) => sum + Number(item.articleCount || 0), 0);
      const avgVsYearAgoPct = items.length > 0
        ? items.reduce((sum, item) => sum + Number(item.vsYearAgoPct || 0), 0) / items.length
        : 0;
      const acceleratingThemes = items.filter((item) => Number(item.acceleration || 0) > 0).length;
      return {
        category,
        label: CATEGORY_LABELS[category] || humanizeTheme(category),
        themeCount: items.length,
        totalArticleCount,
        avgVsYearAgoPct: round(avgVsYearAgoPct),
        acceleratingThemes,
        topThemes: sorted.slice(0, perCategoryLimit).map((item) => ({
          theme: item.theme,
          label: item.label,
          articleCount: item.articleCount,
          vsYearAgoPct: item.vsYearAgoPct,
          lifecycleStage: item.lifecycleStage,
        })),
      };
    })
    .sort((left, right) => right.totalArticleCount - left.totalArticleCount);
}

export async function buildTrendPyramidPayload(safeQuery, params = new URLSearchParams()) {
  const periodType = normalizePeriodType(params.get('period'));
  const limit = normalizeLimit(params.get('limit'), DEFAULT_TREND_LIMIT, 20);
  const category = normalizeCategory(params.get('category'));
  const includeTransitions = params.get('include_transitions') !== '0';
  const { source, rows, normalizationState } = await loadLatestTrendSnapshot(safeQuery, periodType, 120);
  const filteredRows = category ? rows.filter((row) => row.category === category) : rows;

  const grouped = Object.fromEntries(TREND_STAGES.map((stage) => [stage, []]));
  const sorted = filteredRows.slice().sort((left, right) => {
    const stageDiff = buildStagePriority(left.lifecycleStage) - buildStagePriority(right.lifecycleStage);
    if (stageDiff !== 0) return stageDiff;
    const scoreDiff = Number(right.score || 0) - Number(left.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return Number(right.articleCount || 0) - Number(left.articleCount || 0);
  });

  for (const row of sorted) {
    const stage = TREND_STAGES.includes(row.lifecycleStage) ? row.lifecycleStage : 'mainstream';
    if (grouped[stage].length < limit) {
      grouped[stage].push(row);
    }
  }

  const envelope = buildPeriodEnvelope(periodType, filteredRows[0] || rows[0]);
  const transitions = includeTransitions ? buildTransitions(filteredRows) : [];
  const categories = buildCategorySummaries(filteredRows, 2);

  return {
    ...envelope,
    requestedCategory: category || null,
    source,
    taxonomyFiltering: normalizationState?.hasTrendNormalizedTaxonomy ? 'canonical-only' : 'legacy-tolerant-fallback',
    buckets: grouped,
    mainstream: grouped.mainstream,
    growing: grouped.growing,
    emerging: grouped.emerging,
    nascent: grouped.nascent,
    declining: grouped.declining,
    transitions,
    categories,
    totals: {
      trackedThemes: filteredRows.length,
      articleCount: filteredRows.reduce((sum, row) => sum + Number(row.articleCount || 0), 0),
    },
  };
}

function buildPeriods(fromDate, toDate, periodType) {
  const periods = [];
  let cursor = startOfPeriod(fromDate, periodType);
  const ceiling = startOfPeriod(toDate, periodType);
  while (cursor.getTime() <= ceiling.getTime()) {
    const next = addPeriods(cursor, periodType, 1);
    periods.push({
      key: formatPeriodLabel(cursor, periodType),
      label: formatPeriodLabel(cursor, periodType),
      periodStart: toIsoDay(cursor),
      periodEnd: toIsoDay(addDays(next, -1)),
    });
    cursor = next;
  }
  return periods;
}

function seriesFromEvolutionRows(rows, periods, limit, explicitParent) {
  const periodIndex = new Map(periods.map((period, index) => [period.key, index]));
  const seriesByTheme = new Map();

  for (const row of rows) {
    const theme = String(row.sub_theme || row.theme || '');
    const periodKey = formatPeriodLabel(new Date(row.period_start), row.period_type || 'quarter');
    if (!periodIndex.has(periodKey) || !theme) continue;
    const bucket = seriesByTheme.get(theme) || {
      theme,
      label: humanizeTheme(theme),
      sharePctSeries: new Array(periods.length).fill(0),
      currentRank: Number(row.rank_in_parent || 0),
      parentTheme: explicitParent,
    };
    bucket.sharePctSeries[periodIndex.get(periodKey)] = round(Number(row.share_pct || 0));
    bucket.currentRank = bucket.currentRank || Number(row.rank_in_parent || 0);
    seriesByTheme.set(theme, bucket);
  }

  return Array.from(seriesByTheme.values())
    .map((item) => ({
      ...item,
      label: sanitizeDisplayLabel(item.label, item.theme),
      lastSharePct: round(item.sharePctSeries[item.sharePctSeries.length - 1] || 0),
      deltaSharePct: round((item.sharePctSeries[item.sharePctSeries.length - 1] || 0) - (item.sharePctSeries[0] || 0)),
      averageSharePct: round(
        item.sharePctSeries.reduce((sum, value) => sum + Number(value || 0), 0) / Math.max(item.sharePctSeries.length, 1),
      ),
    }))
    .sort((left, right) => {
      const lastDiff = Number(right.lastSharePct || 0) - Number(left.lastSharePct || 0);
      if (lastDiff !== 0) return lastDiff;
      return Number(right.deltaSharePct || 0) - Number(left.deltaSharePct || 0);
    })
    .slice(0, limit);
}

function seriesFromTrendAggregateRows(rows, periods, limit, explicitParent) {
  const periodIndex = new Map(periods.map((period, index) => [period.key, index]));
  const totals = new Array(periods.length).fill(0);
  const grouped = new Map();

  for (const row of rows) {
    const theme = normalizeTheme(row.sub_theme || row.theme || '');
    const periodKey = formatPeriodLabel(new Date(row.period_start), row.period_type || 'quarter');
    if (!theme || !periodIndex.has(periodKey)) continue;
    const index = periodIndex.get(periodKey);
    const articleCount = Number(row.article_count || 0);
    const bucket = grouped.get(theme) || {
      theme,
      label: sanitizeDisplayLabel(row.theme_label || row.label, theme),
      category: inferCategory(theme, row.category),
      lifecycleStage: String(row.lifecycle_stage || '').toLowerCase() || null,
      sharePctSeries: new Array(periods.length).fill(0),
      articleCountSeries: new Array(periods.length).fill(0),
      parentTheme: explicitParent,
    };
    bucket.articleCountSeries[index] = articleCount;
    grouped.set(theme, bucket);
    totals[index] += articleCount;
  }

  return Array.from(grouped.values())
    .map((item) => {
      const sharePctSeries = item.articleCountSeries.map((count, index) => {
        const total = totals[index] || 0;
        return round(total > 0 ? (count / total) * 100 : 0);
      });
      return {
        theme: item.theme,
        label: item.label,
        category: item.category,
        lifecycleStage: item.lifecycleStage,
        sharePctSeries,
        lastSharePct: round(sharePctSeries[sharePctSeries.length - 1] || 0),
        deltaSharePct: round((sharePctSeries[sharePctSeries.length - 1] || 0) - (sharePctSeries[0] || 0)),
        averageSharePct: round(
          sharePctSeries.reduce((sum, value) => sum + Number(value || 0), 0) / Math.max(sharePctSeries.length, 1),
        ),
        parentTheme: explicitParent,
      };
    })
    .sort((left, right) => {
      const lastDiff = Number(right.lastSharePct || 0) - Number(left.lastSharePct || 0);
      if (lastDiff !== 0) return lastDiff;
      return Number(right.deltaSharePct || 0) - Number(left.deltaSharePct || 0);
    })
    .slice(0, limit);
}

function filterSubThemesForParent(subThemes, parentTheme) {
  const allowedChildren = new Set(
    listChildThemes(parentTheme).map((theme) => normalizeTheme(theme?.key || theme)),
  );
  if (allowedChildren.size === 0) return subThemes;
  const filtered = subThemes.filter((item) => allowedChildren.has(normalizeTheme(item.theme)));
  return filtered.length > 0 ? filtered : [];
}

function seriesFromDiscoveryTopics(rows, periods, limit, explicitParent, periodType) {
  const totals = new Array(periods.length).fill(0);
  const periodLookup = new Map(periods.map((period, index) => [period.key, index]));

  const series = rows.map((row) => {
    const monthlyCounts = row.monthly_counts && typeof row.monthly_counts === 'object'
      ? row.monthly_counts
      : {};
    const counts = new Array(periods.length).fill(0);
    for (const [monthKey, rawCount] of Object.entries(monthlyCounts)) {
      const monthDate = parseDateInput(`${monthKey}-01T00:00:00.000Z`);
      if (!monthDate) continue;
      const periodStart = startOfPeriod(monthDate, periodType);
      const index = periodLookup.get(formatPeriodLabel(periodStart, periodType));
      if (index == null) continue;
      counts[index] += Number(rawCount || 0);
    }
    counts.forEach((count, index) => {
      totals[index] += count;
    });
    return {
      theme: String(row.id || ''),
      label: sanitizeDisplayLabel(row.label || row.id, row.id),
      category: inferCategory(row.parent_theme || explicitParent, row.category),
      lifecycleStage: String(row.stage || '').toLowerCase() || null,
      articleCount: Number(row.article_count || 0),
      momentum: round(Number(row.momentum || 0), 4),
      researchMomentum: round(Number(row.research_momentum || 0), 4),
      sharePctSeries: counts,
    };
  });

  return series
    .map((item) => {
      const sharePctSeries = item.sharePctSeries.map((count, index) => {
        const total = totals[index] || 0;
        return round(total > 0 ? (count / total) * 100 : 0);
      });
      return {
        ...item,
        sharePctSeries,
        lastSharePct: round(sharePctSeries[sharePctSeries.length - 1] || 0),
        deltaSharePct: round((sharePctSeries[sharePctSeries.length - 1] || 0) - (sharePctSeries[0] || 0)),
        averageSharePct: round(
          sharePctSeries.reduce((sum, value) => sum + Number(value || 0), 0) / Math.max(sharePctSeries.length, 1),
        ),
        parentTheme: explicitParent,
      };
    })
    .sort((left, right) => {
      const lastDiff = Number(right.lastSharePct || 0) - Number(left.lastSharePct || 0);
      if (lastDiff !== 0) return lastDiff;
      return Number(right.deltaSharePct || 0) - Number(left.deltaSharePct || 0);
    })
    .slice(0, limit);
}

function buildEvolutionInsights(subThemes) {
  const rising = subThemes
    .filter((item) => Number(item.deltaSharePct || 0) > 0)
    .sort((left, right) => Number(right.deltaSharePct || 0) - Number(left.deltaSharePct || 0))
    .slice(0, 3)
    .map((item) => ({
      type: 'rising_star',
      theme: item.theme,
      label: item.label,
      deltaSharePct: item.deltaSharePct,
      lastSharePct: item.lastSharePct,
      summary: `${item.label} gained ${item.deltaSharePct} share points over the selected range and now represents ${item.lastSharePct}% of ${humanizeTheme(item.parentTheme)} coverage.`,
    }));

  const declining = subThemes
    .filter((item) => Number(item.deltaSharePct || 0) < 0)
    .sort((left, right) => Number(left.deltaSharePct || 0) - Number(right.deltaSharePct || 0))
    .slice(0, 2)
    .map((item) => ({
      type: 'decline',
      theme: item.theme,
      label: item.label,
      deltaSharePct: item.deltaSharePct,
      lastSharePct: item.lastSharePct,
      summary: `${item.label} lost ${Math.abs(item.deltaSharePct)} share points over the selected range and is no longer expanding inside ${humanizeTheme(item.parentTheme)}.`,
    }));

  return [...rising, ...declining];
}

export async function buildThemeEvolutionPayload(parentParam, safeQuery, params = new URLSearchParams()) {
  const requestedParent = normalizeTheme(parentParam);
  const explicitParent = normalizeParentTheme(parentParam);
  const periodType = normalizePeriodType(params.get('period') || 'quarter');
  const limit = normalizeLimit(params.get('limit'), DEFAULT_EVOLUTION_LIMIT, 20);
  const periodCount = normalizeLimit(params.get('periods'), 8, 20);
  const normalizationState = await loadNormalizationState(safeQuery);
  const strictFilteringEnabled = normalizationState.hasEvolutionNormalizedTaxonomy;

  const toDate = parseDateInput(params.get('to')) || new Date();
  const defaultFrom = addPeriods(startOfPeriod(toDate, periodType), periodType, -(periodCount - 1));
  const fromDate = parseDateInput(params.get('from')) || defaultFrom;
  const periods = buildPeriods(fromDate, toDate, periodType);

  let source = 'discovery_topic_monthly_counts';
  let subThemes = [];
  const hasEvolutionTable = await probeTable(safeQuery, 'theme_evolution');
  if (hasEvolutionTable) {
    const evolutionRows = await safeQuery(`
      SELECT
        parent_theme,
        sub_theme,
        theme_label,
        category,
        lifecycle_stage,
        period_start,
        period_end,
        share_pct,
        rank_in_parent
      FROM theme_evolution
      WHERE parent_theme = ANY($1::text[])
        AND period_start >= $2::date
        AND period_start <= $3::date
      ORDER BY period_start ASC, rank_in_parent ASC NULLS LAST, share_pct DESC
    `, [[explicitParent, requestedParent].filter(Boolean), toIsoDay(fromDate), toIsoDay(toDate)]);

    if (evolutionRows.rows.length > 0) {
      source = 'theme_evolution';
      subThemes = filterSubThemesForParent(filterVisibleTrendRows(seriesFromEvolutionRows(
        evolutionRows.rows.map((row) => ({ ...row, period_type: periodType })),
        periods,
        limit,
        explicitParent,
      ), strictFilteringEnabled), explicitParent);
    }
  }

  if (subThemes.length === 0) {
    const hasAggregateTable = await probeTable(safeQuery, 'theme_trend_aggregates');
    if (hasAggregateTable) {
      const aggregateRows = await safeQuery(`
        SELECT
          theme AS sub_theme,
          theme_label,
          category,
          lifecycle_stage,
          period_type,
          period_start,
          article_count
        FROM theme_trend_aggregates
        WHERE parent_theme = ANY($1::text[])
          AND period_type = $2
          AND period_start >= $3::date
          AND period_start <= $4::date
        ORDER BY period_start ASC, article_count DESC, theme
      `, [[explicitParent, requestedParent].filter(Boolean), periodType, toIsoDay(fromDate), toIsoDay(toDate)]);
      if (aggregateRows.rows.length > 0) {
        source = 'theme_trend_aggregates';
        subThemes = filterSubThemesForParent(filterVisibleTrendRows(
          seriesFromTrendAggregateRows(aggregateRows.rows, periods, limit, explicitParent),
          strictFilteringEnabled,
        ), explicitParent);
      }
    }
  }

  if (subThemes.length === 0 && !strictFilteringEnabled) {
    const discoveryRows = await safeQuery(`
      SELECT
        id,
        COALESCE(label, id) AS label,
        category,
        stage,
        parent_theme,
        article_count,
        momentum,
        research_momentum,
        monthly_counts
      FROM discovery_topics
      WHERE status IN ('labeled', 'reported')
        AND parent_theme = $1
      ORDER BY momentum DESC NULLS LAST, article_count DESC
      LIMIT 60
    `, [explicitParent]);

    const fallbackRows = discoveryRows.rows.length > 0 || requestedParent === explicitParent
      ? discoveryRows.rows
      : (await safeQuery(`
        SELECT
          id,
          COALESCE(label, id) AS label,
          category,
          stage,
          parent_theme,
          article_count,
          momentum,
          research_momentum,
          monthly_counts
        FROM discovery_topics
        WHERE status IN ('labeled', 'reported')
          AND parent_theme = $1
        ORDER BY momentum DESC NULLS LAST, article_count DESC
        LIMIT 60
      `, [requestedParent])).rows;

    subThemes = filterSubThemesForParent(
      seriesFromDiscoveryTopics(fallbackRows, periods, limit, explicitParent, periodType),
      explicitParent,
    );
  }

  if (subThemes.length === 0 && strictFilteringEnabled) {
    source = 'normalized-taxonomy-empty';
  }

  return {
    parent: explicitParent,
    requestedParent,
    periodType,
    periods,
    subThemes,
    insights: buildEvolutionInsights(subThemes),
    source,
    taxonomyFiltering: strictFilteringEnabled ? 'canonical-only' : 'legacy-tolerant-fallback',
  };
}

async function readLatestDailyReport() {
  const dataDir = path.resolve('data');
  if (!existsSync(dataDir)) return null;
  const entries = (await readdir(dataDir).catch(() => []))
    .filter((name) => /^daily-report-\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort()
    .reverse();
  if (entries.length === 0) return null;
  try {
    return JSON.parse(await readFile(path.join(dataDir, entries[0]), 'utf8'));
  } catch {
    return null;
  }
}

function buildWhyItMatters(item) {
  const themeText = item.theme && item.theme !== 'unknown' ? humanizeTheme(item.theme) : 'This topic';
  const topicText = item.relatedTopics[0] ? ` The strongest linked discovery topic is ${item.relatedTopics[0]}.` : '';
  const signalText = item.relatedSignals[0]?.signalName
    ? ` The closest cross-signal link is ${item.relatedSignals[0].signalName}.`
    : '';
  const momentumText = item.themeMomentumPct == null
    ? 'recently active'
    : item.themeMomentumPct >= 30
      ? `accelerating ${round(item.themeMomentumPct)}% versus the prior week`
      : item.themeMomentumPct <= -20
        ? `cooling ${round(Math.abs(item.themeMomentumPct))}% versus the prior week`
        : 'holding a steady recent share of coverage';
  return `${themeText} is ${momentumText}.${topicText}${signalText}`.trim();
}

function scoreDigestItem(candidate, selectedDate) {
  const publishedAt = parseDateInput(candidate.publishedAt) || selectedDate;
  const ageHours = Math.max(0, (selectedDate.getTime() + 24 * 60 * 60 * 1000 - publishedAt.getTime()) / 3600000);
  const recencyScore = clamp(1 - ageHours / 30, 0, 1);
  const themeMomentumScore = clamp((Number(candidate.themeMomentumPct || 0) + 50) / 250, 0, 1);
  const topicMomentumScore = clamp((Number(candidate.topicMomentum || 1) - 1) / 1.5, 0, 1);
  const sourceScore = clamp(Number(candidate.sourceQuality || 0.72), 0, 1);
  const topicScore = candidate.relatedTopics.length > 0 ? 0.85 : 0.4;
  return round(
    100 * (
      recencyScore * 0.3
      + themeMomentumScore * 0.25
      + topicMomentumScore * 0.2
      + sourceScore * 0.15
      + topicScore * 0.1
    ),
    2,
  );
}

async function loadDailyDigestFromTable(safeQuery, selectedDate, limit, themeFilter, normalizationState) {
  const themeExpr = normalizationState.hasThemeKeyColumn
    ? `COALESCE(NULLIF(TRIM(t.theme_key), ''), NULLIF(TRIM(d.theme), ''), 'unknown')`
    : `COALESCE(NULLIF(TRIM(d.theme), ''), 'unknown')`;
  const parentThemeExpr = normalizationState.hasParentThemeColumn
    ? `COALESCE(NULLIF(TRIM(t.parent_theme), ''), NULLIF(TRIM(d.parent_theme), ''), ${themeExpr})`
    : `COALESCE(NULLIF(TRIM(d.parent_theme), ''), ${themeExpr})`;
  const categoryExpr = normalizationState.hasThemeCategoryColumn
    ? `COALESCE(NULLIF(TRIM(t.theme_category), ''), NULLIF(TRIM(d.category), ''), 'other')`
    : `COALESCE(NULLIF(TRIM(d.category), ''), 'other')`;
  const rows = await safeQuery(`
    SELECT
      d.curated_date,
      d.rank,
      d.article_id,
      ${themeExpr} AS theme,
      ${parentThemeExpr} AS parent_theme,
      ${categoryExpr} AS category,
      d.importance_score,
      d.one_line_summary,
      d.why_it_matters,
      d.related_topics,
      d.related_signals,
      d.topic_id,
      d.topic_label,
      a.title,
      a.source,
      a.published_at,
      a.url
    FROM daily_curated_news d
    LEFT JOIN articles a ON a.id = d.article_id
    LEFT JOIN auto_article_themes t ON t.article_id = d.article_id
    WHERE d.curated_date = $1::date
      AND ($2 = '' OR ${themeExpr} = $2)
    ORDER BY d.rank ASC, d.importance_score DESC NULLS LAST
    LIMIT $3
  `, [toIsoDay(selectedDate), themeFilter, limit]);

  return rows.rows.map((row, index) => {
    const theme = normalizeTheme(row.theme || 'unknown');
    return {
      rank: Number(row.rank || index + 1),
      articleId: Number(row.article_id || 0),
      title: String(row.title || row.one_line_summary || ''),
      source: String(row.source || ''),
      publishedAt: row.published_at || null,
      url: String(row.url || ''),
      theme,
      parentTheme: normalizeParentTheme(row.parent_theme || theme),
      category: inferCategory(theme, row.category),
      importanceScore: round(Number(row.importance_score || 0), 2),
      oneLineSummary: String(row.one_line_summary || row.title || ''),
      whyItMatters: String(row.why_it_matters || ''),
      relatedTopics: sanitizeRelatedTopics(row.related_topics, row.topic_label, normalizationState),
      relatedSignals: normalizeSignals(row.related_signals),
    };
  });
}

async function loadDailyDigestFallback(safeQuery, selectedDate, limit, themeFilter, categoryFilter) {
  const normalizationState = await loadNormalizationState(safeQuery);
  const strictFilteringEnabled = normalizationState.hasDigestNormalizedTaxonomy;
  const dayStart = new Date(Date.UTC(
    selectedDate.getUTCFullYear(),
    selectedDate.getUTCMonth(),
    selectedDate.getUTCDate(),
    0,
    0,
    0,
    0,
  ));
  const dayEnd = addDays(dayStart, 1);
  const priorWeekStart = addDays(dayStart, -7);
  const themeExpr = normalizationState.hasThemeKeyColumn
    ? `COALESCE(NULLIF(TRIM(t.theme_key), ''), NULLIF(TRIM(t.auto_theme), ''), COALESCE(tm.parent_theme, 'unknown'))`
    : `COALESCE(NULLIF(TRIM(t.auto_theme), ''), COALESCE(tm.parent_theme, 'unknown'))`;
  const parentThemeExpr = normalizationState.hasParentThemeColumn
    ? `COALESCE(NULLIF(TRIM(t.parent_theme), ''), COALESCE(tm.parent_theme, ${themeExpr}))`
    : `COALESCE(tm.parent_theme, ${themeExpr})`;
  const categoryExpr = normalizationState.hasThemeCategoryColumn
    ? `COALESCE(NULLIF(TRIM(t.theme_category), ''), COALESCE(tm.topic_category, 'other'))`
    : `COALESCE(tm.topic_category, 'other')`;

  let rows = await safeQuery(`
    WITH theme_velocity AS (
      SELECT
        ${normalizationState.hasThemeKeyColumn
    ? `COALESCE(NULLIF(TRIM(t.theme_key), ''), NULLIF(TRIM(t.auto_theme), ''), 'unknown')`
    : `COALESCE(NULLIF(TRIM(t.auto_theme), ''), 'unknown')`} AS theme,
        COUNT(*) FILTER (WHERE a.published_at >= $1::timestamptz AND a.published_at < $2::timestamptz) AS current_count,
        COUNT(*) FILTER (WHERE a.published_at >= $3::timestamptz AND a.published_at < $1::timestamptz) AS prior_count
      FROM auto_article_themes t
      JOIN articles a ON a.id = t.article_id
      WHERE a.published_at >= $3::timestamptz
        AND a.published_at < $2::timestamptz
      GROUP BY 1
    ),
    theme_signals AS (
      SELECT theme, jsonb_agg(
        jsonb_build_object(
          'signalName', signal_name,
          'correlation', pearson_corr,
          'sampleSize', sample_size
        )
        ORDER BY ABS(pearson_corr) DESC
      ) FILTER (WHERE rn <= 3) AS signals
      FROM (
        SELECT
          theme,
          signal_name,
          pearson_corr,
          sample_size,
          ROW_NUMBER() OVER (PARTITION BY theme ORDER BY ABS(pearson_corr) DESC, sample_size DESC) AS rn
        FROM signal_sensitivity_continuous
        WHERE ABS(pearson_corr) >= 0.05
      ) ranked
      WHERE rn <= 3
      GROUP BY theme
    )
    SELECT
      a.id,
      a.title,
      a.summary,
      a.source,
      a.url,
      a.published_at,
      ${themeExpr} AS theme,
      ${parentThemeExpr} AS parent_theme,
      ${categoryExpr} AS category,
      tm.topic_id,
      tm.topic_label,
      tm.topic_category,
      tm.topic_momentum,
      tm.topic_source_quality_score,
      tv.current_count,
      tv.prior_count,
      ts.signals
    FROM articles a
    LEFT JOIN auto_article_themes t ON t.article_id = a.id
    LEFT JOIN LATERAL (
      SELECT
        dt.id AS topic_id,
        COALESCE(dt.label, dt.id) AS topic_label,
        dt.category AS topic_category,
        dt.parent_theme,
        dt.momentum AS topic_momentum,
        dt.source_quality_score AS topic_source_quality_score
      FROM discovery_topic_articles dta
      JOIN discovery_topics dt ON dt.id = dta.topic_id
      WHERE dta.article_id = a.id
        AND dt.status IN ('labeled', 'reported')
      ORDER BY dt.momentum DESC NULLS LAST, dt.article_count DESC
      LIMIT 1
    ) tm ON TRUE
    LEFT JOIN theme_velocity tv
      ON tv.theme = ${themeExpr}
    LEFT JOIN theme_signals ts
      ON ts.theme = ${themeExpr}
    WHERE a.published_at >= $1::timestamptz
      AND a.published_at < $2::timestamptz
      AND ($4 = '' OR ${themeExpr} = $4)
    ORDER BY a.published_at DESC
    LIMIT $5
  `, [
    toIsoDate(dayStart),
    toIsoDate(dayEnd),
    toIsoDate(priorWeekStart),
    themeFilter,
    Math.max(limit * 8, 30),
  ]);

  let source = 'article_fallback';
  let windowLabel = 'selected-date';
  if (rows.rows.length === 0) {
    rows = await safeQuery(`
      WITH theme_velocity AS (
        SELECT
          ${normalizationState.hasThemeKeyColumn
    ? `COALESCE(NULLIF(TRIM(t.theme_key), ''), NULLIF(TRIM(t.auto_theme), ''), 'unknown')`
    : `COALESCE(NULLIF(TRIM(t.auto_theme), ''), 'unknown')`} AS theme,
          COUNT(*) FILTER (WHERE a.published_at >= NOW() - INTERVAL '72 hours') AS current_count,
          COUNT(*) FILTER (WHERE a.published_at >= NOW() - INTERVAL '14 days' AND a.published_at < NOW() - INTERVAL '72 hours') AS prior_count
        FROM auto_article_themes t
        JOIN articles a ON a.id = t.article_id
        WHERE a.published_at >= NOW() - INTERVAL '14 days'
        GROUP BY 1
      )
      SELECT
        a.id,
        a.title,
        a.summary,
        a.source,
        a.url,
        a.published_at,
        ${normalizationState.hasThemeKeyColumn
    ? `COALESCE(NULLIF(TRIM(t.theme_key), ''), NULLIF(TRIM(t.auto_theme), ''), 'unknown')`
    : `COALESCE(NULLIF(TRIM(t.auto_theme), ''), 'unknown')`} AS theme,
        ${normalizationState.hasParentThemeColumn
    ? `COALESCE(NULLIF(TRIM(t.parent_theme), ''), COALESCE(NULLIF(TRIM(t.theme_key), ''), NULLIF(TRIM(t.auto_theme), ''), 'unknown'))`
    : `COALESCE(NULLIF(TRIM(t.auto_theme), ''), 'unknown')`} AS parent_theme,
        ${normalizationState.hasThemeCategoryColumn
    ? `COALESCE(NULLIF(TRIM(t.theme_category), ''), 'other')`
    : `'other'`} AS category,
        NULL::text AS topic_id,
        NULL::text AS topic_label,
        NULL::text AS topic_category,
        NULL::double precision AS topic_momentum,
        NULL::double precision AS topic_source_quality_score,
        tv.current_count,
        tv.prior_count,
        '[]'::jsonb AS signals
      FROM articles a
      LEFT JOIN auto_article_themes t ON t.article_id = a.id
      LEFT JOIN theme_velocity tv
        ON tv.theme = ${normalizationState.hasThemeKeyColumn
    ? `COALESCE(NULLIF(TRIM(t.theme_key), ''), NULLIF(TRIM(t.auto_theme), ''), 'unknown')`
    : `COALESCE(NULLIF(TRIM(t.auto_theme), ''), 'unknown')`}
      WHERE a.published_at >= NOW() - INTERVAL '72 hours'
        AND ($1 = '' OR ${normalizationState.hasThemeKeyColumn
    ? `COALESCE(NULLIF(TRIM(t.theme_key), ''), NULLIF(TRIM(t.auto_theme), ''), 'unknown')`
    : `COALESCE(NULLIF(TRIM(t.auto_theme), ''), 'unknown')`} = $1)
      ORDER BY a.published_at DESC
      LIMIT $2
    `, [themeFilter, Math.max(limit * 8, 30)]);
    source = 'article_fallback_72h';
    windowLabel = '72h-fallback';
  }

  let items = rows.rows.map((row) => {
    const theme = normalizeTheme(row.theme || 'unknown');
    const category = inferCategory(theme, row.category || row.topic_category);
    const themeMomentumPct = percentageDelta(Number(row.current_count || 0), Number(row.prior_count || 0));
    return {
      articleId: Number(row.id || 0),
      title: String(row.title || ''),
      source: String(row.source || ''),
      publishedAt: row.published_at || null,
      url: String(row.url || ''),
      theme,
      parentTheme: normalizeParentTheme(row.parent_theme || theme),
      category,
      sourceQuality: Number(row.topic_source_quality_score || sourceQualityFor(row.source)),
      topicMomentum: Number(row.topic_momentum || 1),
      themeMomentumPct: round(themeMomentumPct),
      oneLineSummary: String(row.summary || row.title || ''),
      relatedTopics: sanitizeRelatedTopics(row.topic_label ? [String(row.topic_label)] : [], row.topic_label, normalizationState),
      relatedSignals: normalizeSignals(row.signals),
    };
  });

  items = items.filter((item) => !shouldSuppressDigestItem(item, strictFilteringEnabled));

  if (categoryFilter) {
    items = items.filter((item) => item.category === categoryFilter);
  }

  items = items
    .map((item) => ({
      ...item,
      importanceScore: scoreDigestItem(item, dayStart),
    }))
    .sort((left, right) => Number(right.importanceScore || 0) - Number(left.importanceScore || 0))
    .slice(0, limit)
    .map((item, index) => ({
      rank: index + 1,
      ...item,
      whyItMatters: buildWhyItMatters(item),
    }));

  return {
    items,
    source,
    windowLabel,
  };
}

export async function buildDailyDigestPayload(safeQuery, params = new URLSearchParams()) {
  const requestedDate = parseDateInput(params.get('date'));
  const selectedDate = requestedDate || new Date();
  const limit = normalizeLimit(params.get('limit'), DEFAULT_DIGEST_LIMIT, 20);
  const themeFilter = normalizeTheme(params.get('theme'));
  const categoryFilter = normalizeCategory(params.get('category'));
  const normalizationState = await loadNormalizationState(safeQuery);
  const strictFilteringEnabled = normalizationState.hasDigestNormalizedTaxonomy;

  let items = [];
  let source = 'article_fallback';
  let windowLabel = 'selected-date';

  const hasCuratedTable = await probeTable(safeQuery, 'daily_curated_news');
  if (hasCuratedTable) {
    items = (await loadDailyDigestFromTable(safeQuery, selectedDate, limit, themeFilter, normalizationState))
      .filter((item) => !shouldSuppressDigestItem(item, strictFilteringEnabled));
    if (categoryFilter) {
      items = items.filter((item) => item.category === categoryFilter);
    }
    if (items.length > 0) {
      source = 'daily_curated_news';
    }
  }

  if (items.length < limit) {
    const fallback = await loadDailyDigestFallback(safeQuery, selectedDate, limit, themeFilter, categoryFilter);
    if (items.length === 0) {
      items = fallback.items;
      source = fallback.source;
      windowLabel = fallback.windowLabel;
    } else {
      const seenArticleIds = new Set(items.map((item) => Number(item.articleId || 0)));
      const additions = fallback.items.filter((item) => !seenArticleIds.has(Number(item.articleId || 0)));
      items = items.concat(additions).slice(0, limit);
      windowLabel = `${windowLabel}+${fallback.windowLabel}`;
      source = `${source}+${fallback.source}`;
    }
  }

  const dailyReport = await readLatestDailyReport();
  return {
    digestDate: toIsoDay(selectedDate),
    requestedTheme: themeFilter || null,
    requestedCategory: categoryFilter || null,
    source,
    taxonomyFiltering: strictFilteringEnabled ? 'canonical-only' : 'legacy-tolerant-fallback',
    window: windowLabel,
    items,
    supportingStats: dailyReport
      ? {
        generatedAt: dailyReport.generatedAt || null,
        totalArticles: Number(dailyReport.articles?.total || 0),
        newArticles24h: Number(dailyReport.articles?.new_24h || 0),
      }
      : null,
  };
}

async function loadCategoryTopTopics(safeQuery, category, limit) {
  const [
    hasNormalizedCategory,
    hasNormalizedParentTheme,
    hasPromotionState,
  ] = await Promise.all([
    probeColumn(safeQuery, 'discovery_topics', 'normalized_category'),
    probeColumn(safeQuery, 'discovery_topics', 'normalized_parent_theme'),
    probeColumn(safeQuery, 'discovery_topics', 'promotion_state'),
  ]);
  const categoryExpr = hasNormalizedCategory
    ? `COALESCE(NULLIF(normalized_category, ''), category)`
    : 'category';
  const parentThemeExpr = hasNormalizedParentTheme
    ? `COALESCE(NULLIF(normalized_parent_theme, ''), parent_theme)`
    : 'parent_theme';
  const promotionSelect = hasPromotionState
    ? 'promotion_state,'
    : "'watch'::text AS promotion_state,";
  const promotionFilter = hasPromotionState
    ? `AND COALESCE(promotion_state, 'watch') <> 'suppressed'`
    : '';
  const rows = await safeQuery(`
    SELECT
      id,
      COALESCE(label, id) AS label,
      ${categoryExpr} AS category,
      ${parentThemeExpr} AS parent_theme,
      article_count,
      momentum,
      research_momentum,
      source_quality_score,
      stage,
      ${promotionSelect}
      updated_at
    FROM discovery_topics
    WHERE status IN ('labeled', 'reported')
      ${promotionFilter}
    ORDER BY momentum DESC NULLS LAST, article_count DESC
    LIMIT 100
  `);

  return rows.rows
    .map((row) => ({
      id: String(row.id || ''),
      label: String(row.label || row.id || ''),
      category: inferCategory(row.parent_theme || row.label || '', row.category),
      parentTheme: String(row.parent_theme || ''),
      articleCount: Number(row.article_count || 0),
      momentum: round(Number(row.momentum || 0), 4),
      researchMomentum: round(Number(row.research_momentum || 0), 4),
      sourceQualityScore: round(Number(row.source_quality_score || 0), 4),
      stage: String(row.stage || ''),
      promotionState: String(row.promotion_state || 'watch'),
      updatedAt: row.updated_at || null,
    }))
    .filter((row) => !category || row.category === category)
    .slice(0, limit);
}

export async function buildCategoryTrendsPayload(safeQuery, categoryParam, params = new URLSearchParams()) {
  const periodType = normalizePeriodType(params.get('period'));
  const limit = normalizeLimit(params.get('limit'), DEFAULT_TREND_LIMIT, 20);
  const category = normalizeCategory(categoryParam || params.get('category'));
  const { source, rows } = await loadLatestTrendSnapshot(safeQuery, periodType, 120);
  const availableCategories = Array.from(new Set(rows.map((row) => row.category))).sort();
  const filteredRows = category ? rows.filter((row) => row.category === category) : rows;
  const categories = buildCategorySummaries(rows, 3);
  const topTopics = await loadCategoryTopTopics(safeQuery, category, limit);
  const envelope = buildPeriodEnvelope(periodType, filteredRows[0] || rows[0]);

  const summary = category
    ? categories.find((entry) => entry.category === category) || {
      category,
      label: CATEGORY_LABELS[category] || humanizeTheme(category),
      themeCount: filteredRows.length,
      totalArticleCount: filteredRows.reduce((sum, row) => sum + Number(row.articleCount || 0), 0),
      avgVsYearAgoPct: 0,
      acceleratingThemes: 0,
      topThemes: [],
    }
    : null;

  return {
    ...envelope,
    category: category || null,
    categoryLabel: category ? CATEGORY_LABELS[category] || humanizeTheme(category) : null,
    availableCategories,
    source,
    summary,
    categories,
    themes: filteredRows
      .slice()
      .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
      .slice(0, category ? Math.max(limit * 3, 12) : Math.max(limit * 2, 10)),
    topTopics,
  };
}

function buildInsightSummary(row) {
  return `${row.label} logged ${row.articleCount} items this ${row.periodType}, ${row.vsYearAgoPct}% versus a year ago and ${row.acceleration >= 0 ? '+' : ''}${row.acceleration} acceleration versus the previous ${row.periodType}.`;
}

function buildQuarterlyOverview(rows) {
  return {
    trackedThemes: rows.length,
    acceleratingThemes: rows.filter((row) => Number(row.acceleration || 0) > 0).length,
    coolingThemes: rows.filter((row) => Number(row.vsYearAgoPct || 0) < 0).length,
    transitions: rows.filter((row) => row.transition).length,
  };
}

export async function buildQuarterlyInsightsPayload(safeQuery, params = new URLSearchParams()) {
  const periodType = normalizePeriodType(params.get('period') || 'quarter');
  const limit = normalizeLimit(params.get('limit'), DEFAULT_QUARTERLY_INSIGHTS_LIMIT, 20);
  const category = normalizeCategory(params.get('category'));
  const { source, rows } = await loadLatestTrendSnapshot(safeQuery, periodType, 120);
  const filteredRows = category ? rows.filter((row) => row.category === category) : rows;
  const topRisers = filteredRows
    .filter((row) => Number(row.vsYearAgoPct || 0) > 0)
    .sort((left, right) => Number(right.vsYearAgoPct || 0) - Number(left.vsYearAgoPct || 0))
    .slice(0, 4);
  const topAccelerators = filteredRows
    .filter((row) => Number(row.acceleration || 0) > 0)
    .sort((left, right) => Number(right.acceleration || 0) - Number(left.acceleration || 0))
    .slice(0, 4);
  const transitions = buildTransitions(filteredRows, 4);
  const emergingTopics = await loadCategoryTopTopics(safeQuery, category, 4);

  const insights = [
    ...topRisers.map((row) => ({
      type: 'rising_theme',
      theme: row.theme,
      label: row.label,
      category: row.category,
      title: `${row.label} is one of the strongest year-on-year risers`,
      summary: buildInsightSummary(row),
      metrics: {
        articleCount: row.articleCount,
        vsYearAgoPct: row.vsYearAgoPct,
        acceleration: row.acceleration,
        lifecycleStage: row.lifecycleStage,
      },
    })),
    ...topAccelerators
      .filter((row) => !topRisers.some((candidate) => candidate.theme === row.theme))
      .slice(0, 3)
      .map((row) => ({
        type: 'acceleration',
        theme: row.theme,
        label: row.label,
        category: row.category,
        title: `${row.label} is accelerating faster than the prior ${periodType}`,
        summary: buildInsightSummary(row),
        metrics: {
          articleCount: row.articleCount,
          vsPreviousPct: row.vsPreviousPct,
          acceleration: row.acceleration,
          lifecycleStage: row.lifecycleStage,
        },
      })),
    ...transitions.map((transition) => ({
      type: 'stage_transition',
      theme: transition.theme,
      label: transition.label,
      category: transition.category,
      title: `${transition.label} changed lifecycle stage`,
      summary: `${transition.label} moved from ${transition.from} to ${transition.to} with ${transition.articleCount} items and ${transition.vsYearAgoPct}% year-on-year growth.`,
      metrics: transition,
    })),
    ...emergingTopics.map((topic) => ({
      type: 'emerging_topic',
      theme: topic.id,
      label: topic.label,
      category: topic.category,
      title: `${topic.label} is a discovery topic worth monitoring`,
      summary: `${topic.label} carries ${topic.articleCount} linked articles, momentum ${topic.momentum}, and source quality ${topic.sourceQualityScore}.`,
      metrics: {
        articleCount: topic.articleCount,
        momentum: topic.momentum,
        researchMomentum: topic.researchMomentum,
        sourceQualityScore: topic.sourceQualityScore,
      },
    })),
  ].slice(0, limit);

  const envelope = buildPeriodEnvelope(periodType, filteredRows[0] || rows[0]);
  return {
    ...envelope,
    requestedCategory: category || null,
    source,
    overview: buildQuarterlyOverview(filteredRows),
    highlights: {
      rising: topRisers,
      accelerating: topAccelerators,
      transitions,
      emergingTopics,
    },
    insights,
  };
}

function findThemeSnapshot(rows, themeKey) {
  const normalizedTheme = normalizeTheme(themeKey);
  return rows.find((row) => normalizeTheme(row.theme) === normalizedTheme) || null;
}

async function loadThemeRecentArticles(safeQuery, themeKey, limit, normalizationState) {
  const themeExpr = normalizationState.hasThemeKeyColumn
    ? `COALESCE(NULLIF(TRIM(t.theme_key), ''), NULLIF(TRIM(t.auto_theme), ''), 'unknown')`
    : `COALESCE(NULLIF(TRIM(t.auto_theme), ''), 'unknown')`;
  const themeLabelExpr = normalizationState.hasThemeLabelColumn
    ? `COALESCE(NULLIF(TRIM(t.theme_label), ''), ${themeExpr})`
    : themeExpr;
  const parentThemeExpr = normalizationState.hasParentThemeColumn
    ? `COALESCE(NULLIF(TRIM(t.parent_theme), ''), ${themeExpr})`
    : themeExpr;
  const themeCategoryExpr = normalizationState.hasThemeCategoryColumn
    ? `COALESCE(NULLIF(TRIM(t.theme_category), ''), 'other')`
    : `'other'`;
  const rows = await safeQuery(`
    SELECT
      a.id,
      a.title,
      a.source,
      a.url,
      a.published_at,
      ${themeExpr} AS theme_key,
      ${themeLabelExpr} AS theme_label,
      ${parentThemeExpr} AS parent_theme,
      ${themeCategoryExpr} AS theme_category
    FROM auto_article_themes t
    JOIN articles a ON a.id = t.article_id
    WHERE ${themeExpr} = $1
    ORDER BY a.published_at DESC NULLS LAST, a.id DESC
    LIMIT $2
  `, [normalizeTheme(themeKey), limit]);

  return rows.rows.map((row) => ({
    articleId: Number(row.id || 0),
    title: String(row.title || ''),
    source: String(row.source || ''),
    url: String(row.url || ''),
    publishedAt: row.published_at || null,
    theme: normalizeTheme(row.theme_key || themeKey),
    label: sanitizeDisplayLabel(row.theme_label, row.theme_key || themeKey),
    parentTheme: normalizeParentTheme(row.parent_theme || row.theme_key || themeKey),
    category: inferCategory(row.theme_key || themeKey, row.theme_category),
  }));
}

export async function loadThemeSecContext(safeQuery, themeKey) {
  const [hasExposureTable, hasProfilesTable, hasLegacyFilingsTable, hasEvidenceFilingsTable] = await Promise.all([
    probeTable(safeQuery, 'theme_entity_exposure'),
    probeTable(safeQuery, 'sec_entity_profiles'),
    probeTable(safeQuery, 'sec_entity_filings'),
    probeTable(safeQuery, 'sec_filings_evidence'),
  ]);
  if (!hasExposureTable || !hasProfilesTable) {
    return {
      status: 'connector-pending',
      entities: [],
      provenance: [],
    };
  }

  const [
    hasCompanyName,
    hasEntityName,
    hasSectorHint,
    hasSicDescription,
    hasCategory,
  ] = await Promise.all([
    probeColumn(safeQuery, 'sec_entity_profiles', 'company_name'),
    probeColumn(safeQuery, 'sec_entity_profiles', 'entity_name'),
    probeColumn(safeQuery, 'sec_entity_profiles', 'sector_hint'),
    probeColumn(safeQuery, 'sec_entity_profiles', 'sic_description'),
    probeColumn(safeQuery, 'sec_entity_profiles', 'category'),
  ]);

  const companyNameExpr = hasCompanyName
    ? 'p.company_name'
    : hasEntityName
      ? 'p.entity_name'
      : 'NULL::text';
  const sectorHintExpr = hasSectorHint
    ? 'p.sector_hint'
    : hasSicDescription
      ? 'p.sic_description'
      : hasCategory
        ? 'p.category'
        : 'NULL::text';
  const filingsTable = hasLegacyFilingsTable
    ? 'sec_entity_filings'
    : hasEvidenceFilingsTable
      ? 'sec_filings_evidence'
      : '';
  const filingDateExpr = hasLegacyFilingsTable ? 'f.filed_at' : 'f.filing_date';
  const filingFormExpr = hasLegacyFilingsTable ? 'f.form_type' : 'f.filing_type';
  const profileJoinConditions = [
    `LOWER(COALESCE(p.ticker, '')) = LOWER(COALESCE(e.entity_key, ''))`,
    hasCompanyName ? `LOWER(COALESCE(p.company_name, '')) = LOWER(COALESCE(e.entity_key, ''))` : null,
    hasEntityName ? `LOWER(COALESCE(p.entity_name, '')) = LOWER(COALESCE(e.entity_key, ''))` : null,
  ].filter(Boolean);

  const filingSelect = filingsTable
    ? `,
      COUNT(f.*)::int AS filing_count,
      MAX(${filingDateExpr}) AS latest_filed_at,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT ${filingFormExpr}), NULL) AS recent_forms`
    : `,
      0::int AS filing_count,
      NULL::date AS latest_filed_at,
      ARRAY[]::text[] AS recent_forms`;
  const filingJoin = filingsTable
    ? `LEFT JOIN ${filingsTable} f
        ON f.cik = p.cik
       AND ${filingDateExpr} >= CURRENT_DATE - INTERVAL '365 days'`
    : '';
  const filingCountSortExpr = filingsTable ? 'COUNT(f.*)' : '0';
  const companySortExpr = `COALESCE(MAX(${companyNameExpr}), e.entity_key)`;

  const rows = await safeQuery(`
    SELECT
      e.theme,
      e.entity_type,
      e.entity_key,
      e.relation_type,
      e.sign,
      e.confidence,
      e.horizon,
      e.evidence_source,
      e.evidence_note,
      e.updated_at,
      p.cik,
      p.ticker,
      MAX(${companyNameExpr}) AS company_name,
      MAX(${sectorHintExpr}) AS sector_hint
      ${filingSelect}
    FROM theme_entity_exposure e
    LEFT JOIN sec_entity_profiles p
      ON ${profileJoinConditions.join('\n      OR ')}
    ${filingJoin}
    WHERE LOWER(COALESCE(e.theme, '')) = $1
    GROUP BY
      e.theme,
      e.entity_type,
      e.entity_key,
      e.relation_type,
      e.sign,
      e.confidence,
      e.horizon,
      e.evidence_source,
      e.evidence_note,
      e.updated_at,
      p.cik,
      p.ticker
    ORDER BY COALESCE(e.confidence, 0) DESC, ${filingCountSortExpr} DESC, ${companySortExpr}
    LIMIT 10
  `, [normalizeTheme(themeKey)]);

  return {
    status: rows.rows.length > 0 ? 'connected' : 'connector-ready-no-matches',
    entities: rows.rows.map((row) => ({
      entityType: String(row.entity_type || 'company'),
      entityKey: String(row.entity_key || row.ticker || ''),
      ticker: String(row.ticker || row.entity_key || ''),
      companyName: String(row.company_name || row.entity_key || ''),
      cik: String(row.cik || ''),
      sectorHint: String(row.sector_hint || ''),
      relationType: String(row.relation_type || 'beneficiary'),
      sign: String(row.sign || 'positive'),
      confidence: round(Number(row.confidence || 0), 2),
      horizon: String(row.horizon || 'long'),
      evidenceSource: String(row.evidence_source || 'sec-theme-connector'),
      evidenceNote: String(row.evidence_note || ''),
      filingCount: Number(row.filing_count || 0),
      latestFiledAt: row.latest_filed_at || null,
      recentForms: asArray(row.recent_forms).map((item) => String(item || '')).filter(Boolean).slice(0, 5),
      updatedAt: row.updated_at || null,
    })),
    provenance: rows.rows.map((row) => ({
      type: 'sec_connector',
      entityKey: String(row.entity_key || row.ticker || ''),
      evidenceSource: String(row.evidence_source || 'sec-theme-connector'),
      updatedAt: row.updated_at || null,
    })),
  };
}

export async function loadThemeOpenAlexContext(safeQuery, themeKey) {
  const [hasLegacyEvidenceTable, hasModernEvidenceTable, hasWorksTable] = await Promise.all([
    probeTable(safeQuery, 'openalex_theme_evidence'),
    probeTable(safeQuery, 'theme_openalex_evidence'),
    probeTable(safeQuery, 'openalex_works'),
  ]);

  if ((!hasLegacyEvidenceTable && !hasModernEvidenceTable) || !hasWorksTable) {
    return {
      status: 'connector-pending',
      works: [],
      summary: null,
      provenance: [],
    };
  }

  const evidenceTable = hasLegacyEvidenceTable ? 'openalex_theme_evidence' : 'theme_openalex_evidence';
  const [
    hasSearchQuery,
    hasMatchedKeywords,
    hasResearchSignalScore,
    hasThemeMatchScore,
    hasEvidenceNote,
    hasWorkTitle,
    hasDisplayName,
    hasSourceType,
    hasPrimaryTopic,
    hasLanguage,
    hasMetadata,
    hasLandingPageUrl,
  ] = await Promise.all([
    probeColumn(safeQuery, evidenceTable, 'search_query'),
    probeColumn(safeQuery, evidenceTable, 'matched_keywords'),
    probeColumn(safeQuery, evidenceTable, 'research_signal_score'),
    probeColumn(safeQuery, evidenceTable, 'theme_match_score'),
    probeColumn(safeQuery, evidenceTable, 'evidence_note'),
    probeColumn(safeQuery, 'openalex_works', 'title'),
    probeColumn(safeQuery, 'openalex_works', 'display_name'),
    probeColumn(safeQuery, 'openalex_works', 'source_type'),
    probeColumn(safeQuery, 'openalex_works', 'primary_topic'),
    probeColumn(safeQuery, 'openalex_works', 'language'),
    probeColumn(safeQuery, 'openalex_works', 'metadata'),
    probeColumn(safeQuery, 'openalex_works', 'landing_page_url'),
  ]);

  const titleExpr = hasWorkTitle
    ? 'w.title'
    : hasDisplayName
      ? 'w.display_name'
      : 'w.work_id::text';
  const searchQueryExpr = hasSearchQuery ? 'e.search_query' : 'NULL::text';
  const matchedKeywordsExpr = hasMatchedKeywords ? 'e.matched_keywords' : hasThemeMatchScore ? 'e.concept_overlap' : 'ARRAY[]::text[]';
  const signalScoreExpr = hasResearchSignalScore
    ? 'e.research_signal_score'
    : hasThemeMatchScore
      ? 'e.theme_match_score'
      : '0::double precision';
  const evidenceNoteExpr = hasEvidenceNote ? 'e.evidence_note' : 'NULL::text';
  const sourceTypeExpr = hasSourceType ? 'w.source_type' : `'research'::text`;
  const primaryTopicExpr = hasPrimaryTopic ? 'w.primary_topic' : 'NULL::text';
  const languageExpr = hasLanguage ? 'w.language' : 'NULL::text';
  const metadataExpr = hasMetadata ? 'w.metadata' : 'w.raw_payload';
  const landingPageExpr = hasLandingPageUrl ? 'w.landing_page_url' : 'NULL::text';

  const rows = await safeQuery(`
    SELECT
      e.theme,
      e.work_id,
      ${searchQueryExpr} AS search_query,
      ${matchedKeywordsExpr} AS matched_keywords,
      ${signalScoreExpr} AS research_signal_score,
      e.cited_by_count,
      e.publication_year,
      e.publication_date,
      ${evidenceNoteExpr} AS evidence_note,
      e.updated_at,
      ${titleExpr} AS title,
      w.abstract_text,
      w.source_display_name,
      ${sourceTypeExpr} AS source_type,
      ${primaryTopicExpr} AS primary_topic,
      ${languageExpr} AS language,
      w.concepts,
      w.authorships,
      ${metadataExpr} AS metadata,
      ${landingPageExpr} AS landing_page_url
    FROM ${evidenceTable} e
    JOIN openalex_works w ON w.work_id = e.work_id
    WHERE LOWER(COALESCE(e.theme, '')) = $1
    ORDER BY
      COALESCE(${signalScoreExpr}, 0) DESC,
      COALESCE(e.cited_by_count, 0) DESC,
      COALESCE(e.publication_date, DATE '1900-01-01') DESC
    LIMIT 8
  `, [normalizeTheme(themeKey)]);

  const works = rows.rows.map((row) => {
    const concepts = asArray(row.concepts).map((item) => {
      if (typeof item === 'string') {
        return {
          displayName: String(item).trim(),
          score: 0,
        };
      }
      return {
        displayName: String(item?.displayName || item?.display_name || item?.name || '').trim(),
        score: round(Number(item?.score || 0), 2),
      };
    }).filter((item) => item.displayName).slice(0, 6);
    const authors = asArray(row.authorships).map((item) => String(item?.author || item?.displayName || '').trim()).filter(Boolean).slice(0, 4);
    const abstractText = String(row.abstract_text || '').trim();
    return {
      workId: String(row.work_id || ''),
      title: String(row.title || row.work_id || ''),
      publicationYear: Number(row.publication_year || 0) || null,
      publicationDate: row.publication_date || null,
      citedByCount: Number(row.cited_by_count || 0),
      researchSignalScore: round(Number(row.research_signal_score || 0), 2),
      matchedKeywords: asArray(row.matched_keywords).map((item) => String(item || '')).filter(Boolean).slice(0, 6),
      sourceDisplayName: String(row.source_display_name || '').trim(),
      sourceType: String(row.source_type || 'research').trim() || 'research',
      primaryTopic: String(row.primary_topic || '').trim(),
      language: String(row.language || '').trim(),
      concepts,
      authors,
      abstractSummary: truncateText(abstractText, 320),
      searchQuery: String(row.search_query || '').trim(),
      evidenceNote: String(row.evidence_note || '').trim(),
      landingPageUrl: String(row.landing_page_url || '').trim(),
      updatedAt: row.updated_at || null,
      metadata: row.metadata || {},
    };
  });

  const recentCutoffYear = new Date().getUTCFullYear() - 3;
  const recentCount = works.filter((item) => Number(item.publicationYear || 0) >= recentCutoffYear).length;
  const totalCitations = works.reduce((sum, item) => sum + Number(item.citedByCount || 0), 0);
  const avgResearchSignalScore = works.length > 0
    ? round(works.reduce((sum, item) => sum + Number(item.researchSignalScore || 0), 0) / works.length, 2)
    : 0;
  const topConcepts = Array.from(new Set(works.flatMap((item) => item.concepts.map((concept) => concept.displayName)).filter(Boolean))).slice(0, 5);

  return {
    status: works.length > 0 ? 'connected' : 'connector-ready-no-matches',
    works,
    summary: works.length > 0 ? {
      workCount: works.length,
      recentCount,
      totalCitations,
      avgResearchSignalScore,
      topConcepts,
    } : null,
    provenance: works.map((item) => buildProvenanceRef('openalex_research', item.title, {
      workId: item.workId,
      publishedAt: item.publicationDate,
      citedByCount: item.citedByCount,
      researchSignalScore: item.researchSignalScore,
      source: item.sourceDisplayName || 'OpenAlex',
      sourceType: 'research',
    })),
  };
}

export async function loadThemeGitHubContext(safeQuery, themeKey) {
  const [hasEvidenceTable, hasReposTable] = await Promise.all([
    probeTable(safeQuery, 'theme_github_evidence'),
    probeTable(safeQuery, 'github_repositories'),
  ]);
  if (!hasEvidenceTable || !hasReposTable) {
    return { status: 'connector-pending', repos: [], summary: null, provenance: [] };
  }
  const [
    hasHomepageUrl,
    hasCreatedAtGithub,
    hasUpdatedAtGithub,
  ] = await Promise.all([
    probeColumn(safeQuery, 'github_repositories', 'homepage_url'),
    probeColumn(safeQuery, 'github_repositories', 'created_at_github'),
    probeColumn(safeQuery, 'github_repositories', 'updated_at_github'),
  ]);
  const rows = await safeQuery(`
    SELECT
      e.theme,
      e.search_query,
      e.matched_keywords,
      e.github_signal_score,
      e.stargazers_count,
      e.pushed_at,
      e.evidence_note,
      e.updated_at,
      r.repo_key,
      r.full_name,
      r.owner_login,
      r.name,
      r.html_url,
      r.description,
      ${hasHomepageUrl ? 'r.homepage_url' : 'NULL::text'} AS homepage_url,
      r.language,
      r.topics,
      r.stargazers_count,
      r.forks_count,
      r.watchers_count,
      r.open_issues_count,
      r.default_branch,
      r.license_name,
      ${hasCreatedAtGithub ? 'r.created_at_github' : 'NULL::timestamptz'} AS created_at_github,
      ${hasUpdatedAtGithub ? 'r.updated_at_github' : 'NULL::timestamptz'} AS updated_at_github,
      r.pushed_at,
      r.metadata
    FROM theme_github_evidence e
    JOIN github_repositories r ON r.repo_key = e.repo_key
    WHERE LOWER(COALESCE(e.theme, '')) = $1
    ORDER BY
      COALESCE(e.github_signal_score, 0) DESC,
      COALESCE(e.stargazers_count, r.stargazers_count, 0) DESC,
      COALESCE(r.pushed_at, NOW() - INTERVAL '50 years') DESC
    LIMIT 8
  `, [normalizeTheme(themeKey)]);

  const repos = rows.rows.map((row) => ({
    repoKey: String(row.repo_key || '').trim(),
    fullName: String(row.full_name || row.name || '').trim(),
    name: String(row.name || '').trim(),
    ownerLogin: String(row.owner_login || '').trim(),
    htmlUrl: String(row.html_url || '').trim(),
    homepageUrl: String(row.homepage_url || '').trim(),
    description: String(row.description || '').trim(),
    language: String(row.language || '').trim(),
    topics: asArray(row.topics).map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6),
    stargazersCount: Number(row.stargazers_count || 0),
    forksCount: Number(row.forks_count || 0),
    watchersCount: Number(row.watchers_count || 0),
    openIssuesCount: Number(row.open_issues_count || 0),
    defaultBranch: String(row.default_branch || '').trim(),
    licenseName: String(row.license_name || '').trim(),
    createdAt: row.created_at_github || null,
    updatedAt: row.updated_at || row.updated_at_github || null,
    pushedAt: row.pushed_at || null,
    matchedKeywords: asArray(row.matched_keywords).map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6),
    githubSignalScore: round(Number(row.github_signal_score || 0), 2),
    evidenceNote: String(row.evidence_note || '').trim(),
    searchQuery: String(row.search_query || '').trim(),
    metadata: row.metadata || {},
  }));

  const recentCutoff = new Date();
  recentCutoff.setUTCDate(recentCutoff.getUTCDate() - 90);
  const recentPushedCount = repos.filter((item) => item.pushedAt && new Date(item.pushedAt) >= recentCutoff).length;
  const totalStars = repos.reduce((sum, item) => sum + Number(item.stargazersCount || 0), 0);
  const avgGithubSignalScore = repos.length > 0
    ? round(repos.reduce((sum, item) => sum + Number(item.githubSignalScore || 0), 0) / repos.length, 2)
    : 0;
  const topLanguages = Array.from(new Set(repos.map((item) => item.language).filter(Boolean))).slice(0, 4);

  return {
    status: repos.length > 0 ? 'connected' : 'connector-ready-no-matches',
    repos,
    summary: repos.length > 0 ? {
      repoCount: repos.length,
      totalStars,
      recentPushedCount,
      avgGithubSignalScore,
      topLanguages,
    } : null,
    provenance: repos.map((item) => buildProvenanceRef('github_code', item.fullName, {
      repoKey: item.repoKey,
      stars: item.stargazersCount,
      forks: item.forksCount,
      pushedAt: item.pushedAt,
      source: 'GitHub',
      sourceType: 'code',
      url: item.htmlUrl,
    })),
  };
}

export async function loadThemeAttachmentContext(safeQuery, themeKey) {
  const hasCodexProposals = await probeTable(safeQuery, 'codex_proposals');
  if (!hasCodexProposals) {
    return {
      status: 'connector-pending',
      items: [],
      evidenceClasses: [],
      provenance: [],
      summary: null,
    };
  }

  const rows = await safeQuery(`
    SELECT payload, status, created_at
    FROM codex_proposals
    WHERE proposal_type = 'attach-theme'
      AND status IN ('pending', 'executed', 'queued', 'pending-approval', 'approved', 'dry-run')
      AND LOWER(COALESCE(payload->>'targetTheme', '')) = $1
    ORDER BY created_at DESC
    LIMIT 8
  `, [normalizeTheme(themeKey)]);

  const items = rows.rows
    .map((row) => {
      const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
      const assets = asArray(payload.assets)
        .map((asset) => ({
          symbol: String(asset?.symbol || '').trim().toUpperCase(),
          name: String(asset?.name || asset?.symbol || '').trim(),
          assetKind: String(asset?.assetKind || '').trim().toLowerCase(),
          sector: String(asset?.sector || '').trim().toLowerCase(),
          commodity: asset?.commodity ? String(asset.commodity).trim().toLowerCase() : null,
          direction: String(asset?.direction || '').trim().toLowerCase(),
          role: String(asset?.role || '').trim().toLowerCase(),
          relationType: String(asset?.relationType || payload.relationType || '').trim().toLowerCase(),
          transmissionOrder: String(asset?.transmissionOrder || payload.transmissionOrder || '').trim().toLowerCase(),
          transmissionPath: String(asset?.transmissionPath || payload.transmissionPath || '').trim(),
        }))
        .filter((asset) => asset.symbol)
        .slice(0, 8);
      if (assets.length === 0) return null;
      return {
        attachmentKey: String(payload.attachmentKey || '').trim(),
        targetTheme: String(payload.targetTheme || '').trim().toLowerCase(),
        targetThemeLabel: String(payload.targetThemeLabel || humanizeTheme(payload.targetTheme || '')).trim(),
        label: String(payload.label || '').trim(),
        confidence: Number.isFinite(Number(payload.confidence)) ? Number(payload.confidence) : null,
        reason: String(payload.reason || '').trim(),
        relationType: String(payload.relationType || '').trim().toLowerCase(),
        transmissionOrder: String(payload.transmissionOrder || '').trim().toLowerCase(),
        transmissionPath: String(payload.transmissionPath || '').trim(),
        thesis: String(payload.thesis || '').trim(),
        invalidation: asArray(payload.invalidation).map((item) => String(item || '').trim()).filter(Boolean).slice(0, 5),
        transmissionChannels: asArray(payload.transmissionChannels).map((item) => String(item || '').trim()).filter(Boolean).slice(0, 5),
        triggers: asArray(payload.triggers).map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6),
        sectors: asArray(payload.sectors).map((item) => String(item || '').trim()).filter(Boolean).slice(0, 5),
        commodities: asArray(payload.commodities).map((item) => String(item || '').trim()).filter(Boolean).slice(0, 5),
        timeframe: String(payload.timeframe || '').trim(),
        assets,
        suggestedSources: asArray(payload.suggestedSources).map((item) => normalizeSuggestedSourceLabel(item)).filter(Boolean).slice(0, 5),
        suggestedGdeltKeywords: asArray(payload.suggestedGdeltKeywords).map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6),
        createdAt: row.created_at || null,
        status: String(row.status || '').trim().toLowerCase(),
      };
    })
    .filter(Boolean);

  const provenance = items.map((item) => buildProvenanceRef('codex_attachment', item.label || item.attachmentKey || 'Adjacent pathway', {
    attachmentKey: item.attachmentKey,
    targetTheme: item.targetTheme,
    relationType: item.relationType,
    transmissionOrder: item.transmissionOrder,
    transmissionPath: item.transmissionPath,
    source: 'Codex',
    sourceType: 'analysis',
    createdAt: item.createdAt,
    updatedAt: item.createdAt,
  }));

  return {
    status: items.length > 0 ? 'connected' : 'no-attachments',
    items,
    evidenceClasses: dedupeEvidenceClasses([buildEvidenceClassRef('codex_attachment', { count: items.length })]),
    provenance,
    summary: items.length > 0 ? {
      count: items.length,
      highestConfidence: Math.max(...items.map((item) => Number(item.confidence || 0))),
      relationTypes: Array.from(new Set(items.map((item) => item.relationType).filter(Boolean))).slice(0, 5),
      transmissionOrders: Array.from(new Set(items.map((item) => item.transmissionOrder).filter(Boolean))).slice(0, 5),
    } : null,
  };
}

function attachmentLookbackDays(periodType) {
  const normalized = normalizePeriodType(periodType || 'week');
  if (normalized === 'year') return 400;
  if (normalized === 'quarter') return 120;
  if (normalized === 'month') return 45;
  return 21;
}

async function loadRecentThemeAttachments(safeQuery, themes = [], periodType = 'week', limit = 24) {
  const hasCodexProposals = await probeTable(safeQuery, 'codex_proposals');
  if (!hasCodexProposals) return [];
  const normalizedThemes = normalizeThemeList(themes, 40);
  const lookbackDays = attachmentLookbackDays(periodType);
  const values = [lookbackDays];
  let themeClause = '';
  if (normalizedThemes.length > 0) {
    values.push(normalizedThemes);
    themeClause = `AND LOWER(COALESCE(payload->>'targetTheme', '')) = ANY($${values.length})`;
  }
  values.push(limit);
  const result = await safeQuery(`
    SELECT payload, status, created_at
    FROM codex_proposals
    WHERE proposal_type = 'attach-theme'
      AND status IN ('pending', 'executed', 'queued', 'pending-approval', 'approved', 'dry-run')
      AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
      ${themeClause}
    ORDER BY created_at DESC
    LIMIT $${values.length}
  `, values);

  return result.rows
    .map((row) => {
      const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
      const targetTheme = normalizeTheme(payload.targetTheme || '');
      if (!targetTheme) return null;
      return {
        attachmentKey: String(payload.attachmentKey || '').trim(),
        targetTheme,
        targetThemeLabel: String(payload.targetThemeLabel || humanizeTheme(targetTheme)).trim(),
        label: String(payload.label || '').trim(),
        confidence: Number.isFinite(Number(payload.confidence)) ? Number(payload.confidence) : null,
        reason: String(payload.reason || '').trim(),
        relationType: String(payload.relationType || '').trim().toLowerCase(),
        transmissionOrder: String(payload.transmissionOrder || '').trim().toLowerCase(),
        transmissionPath: String(payload.transmissionPath || '').trim(),
        thesis: String(payload.thesis || '').trim(),
        assets: asArray(payload.assets).map((asset) => ({
          symbol: String(asset?.symbol || '').trim().toUpperCase(),
          relationType: String(asset?.relationType || '').trim().toLowerCase(),
          transmissionOrder: String(asset?.transmissionOrder || '').trim().toLowerCase(),
          transmissionPath: String(asset?.transmissionPath || '').trim(),
        })).filter((asset) => asset.symbol).slice(0, 6),
        suggestedSources: asArray(payload.suggestedSources).map((item) => normalizeSuggestedSourceLabel(item)).filter(Boolean).slice(0, 5),
        createdAt: row.created_at || null,
        status: String(row.status || '').trim().toLowerCase(),
      };
    })
    .filter(Boolean);
}

function normalizeSuggestedSourceLabel(source) {
  if (!source) return '';
  if (typeof source === 'string') return source.trim();
  const domain = String(source.domain || '').trim().toLowerCase();
  const url = String(source.url || '').trim();
  const label = String(source.label || source.name || domain || url).trim();
  if (!label) return '';
  return domain && domain !== label ? `${label} (${domain})` : label;
}

function buildProvenanceRef(type, label, details = {}) {
  const evidenceClass = normalizeTheme(details.evidenceClass || type || 'reference');
  const sourceTypeMap = {
    trend_snapshot: 'aggregate',
    theme_evolution: 'aggregate',
    curated_digest: 'digest',
    recent_article: 'article',
    sec_connector: 'filing',
    sec_filings: 'filing',
    openalex_research: 'research',
    github_code: 'code',
    codex_attachment: 'analysis',
    taxonomy: 'taxonomy',
  };
  return {
    type,
    evidenceClass,
    sourceType: details.sourceType || sourceTypeMap[evidenceClass] || 'derived',
    label,
    ...details,
  };
}

function buildEvidenceClassRef(key, overrides = {}) {
  const normalizedKey = normalizeTheme(key || 'derived');
  const catalog = {
    trend_snapshot: {
      label: 'Trend aggregate',
      description: 'Current period aggregate row for the canonical theme.',
      sourceType: 'aggregate',
    },
    theme_evolution: {
      label: 'Theme evolution',
      description: 'Relative share movement inside the parent theme.',
      sourceType: 'aggregate',
    },
    curated_digest: {
      label: 'Curated digest',
      description: 'Ranked curated items linked to the theme.',
      sourceType: 'digest',
    },
    recent_article: {
      label: 'Recent article',
      description: 'Recent article-level evidence from the theme stream.',
      sourceType: 'article',
    },
    recent_articles: {
      label: 'Recent articles',
      description: 'Recent article-level evidence from the theme stream.',
      sourceType: 'article',
    },
    sec_filings: {
      label: 'SEC-backed entities',
      description: 'Theme-to-entity links backed by SEC connector data.',
      sourceType: 'filing',
    },
    sec_connector: {
      label: 'SEC connector',
      description: 'Connector-backed entity or filing evidence attached to the theme.',
      sourceType: 'filing',
    },
    openalex_research: {
      label: 'OpenAlex research',
      description: 'Research papers linked to the theme through OpenAlex work search and filtering.',
      sourceType: 'research',
    },
    github_code: {
      label: 'GitHub code',
      description: 'Repositories linked to the theme through GitHub search and ranking.',
      sourceType: 'code',
    },
    codex_attachment: {
      label: 'Adjacent pathway',
      description: 'Codex-attached adjacent or indirect pathway under an existing theme.',
      sourceType: 'analysis',
    },
    taxonomy: {
      label: 'Taxonomy governance',
      description: 'Canonical taxonomy and fallback tracking evidence.',
      sourceType: 'taxonomy',
    },
    derived: {
      label: 'Derived support',
      description: 'Derived support assembled from multiple evidence inputs.',
      sourceType: 'derived',
    },
  };
  const base = catalog[normalizedKey] || catalog.derived;
  return {
    key: normalizedKey,
    label: overrides.label || base.label,
    description: overrides.description || base.description,
    sourceType: overrides.sourceType || base.sourceType,
    count: Number.isFinite(Number(overrides.count)) ? Number(overrides.count) : null,
  };
}

function dedupeEvidenceClasses(items = []) {
  const deduped = new Map();
  for (const item of items) {
    const ref = typeof item === 'string' ? buildEvidenceClassRef(item) : buildEvidenceClassRef(item?.key, item || {});
    if (!ref.key) continue;
    const existing = deduped.get(ref.key);
    deduped.set(ref.key, {
      ...ref,
      count: (existing?.count || 0) + (Number.isFinite(Number(ref.count)) ? Number(ref.count) : 0),
    });
  }
  return Array.from(deduped.values());
}

function dedupeProvenance(items = []) {
  const deduped = new Map();
  for (const item of items.filter(Boolean)) {
    const key = [
      item.type,
      item.evidenceClass,
      item.articleId,
      item.entityKey,
      item.label,
      item.source,
      item.publishedAt,
      item.updatedAt,
    ].join('::');
    if (!deduped.has(key)) deduped.set(key, item);
  }
  return Array.from(deduped.values());
}

function evidenceClassesFromProvenance(items = []) {
  return dedupeEvidenceClasses(
    items
      .filter(Boolean)
      .map((item) => buildEvidenceClassRef(item.evidenceClass || item.type)),
  );
}

function buildSectionEvidenceMeta(section, evidenceClasses = [], provenance = [], extra = {}) {
  return {
    section,
    evidenceClasses: dedupeEvidenceClasses(evidenceClasses),
    provenance: dedupeProvenance(provenance),
    ...extra,
  };
}

function flattenSectionMeta(sectionMeta = {}) {
  return Object.values(sectionMeta).filter(Boolean);
}

function buildThemeClaimLedger({
  whatChanged = [],
  whyItMatters = null,
  subtopicMovement = null,
  relatedEntities = null,
  adjacentPathways = null,
}) {
  const claims = [];
  for (const item of whatChanged) {
    claims.push({
      section: 'whatChanged',
      claimType: item.type,
      title: item.title,
      detail: item.detail,
      evidenceClasses: dedupeEvidenceClasses(item.evidenceClasses || evidenceClassesFromProvenance(item.provenance || [])),
      provenance: dedupeProvenance(item.provenance || []),
    });
  }
  if (whyItMatters?.summary) {
    claims.push({
      section: 'whyItMatters',
      claimType: 'summary',
      title: 'Why it matters',
      detail: whyItMatters.summary,
      evidenceClasses: dedupeEvidenceClasses(whyItMatters.evidenceClasses || evidenceClassesFromProvenance(whyItMatters.provenance || [])),
      provenance: dedupeProvenance(whyItMatters.provenance || []),
    });
  }
  if (subtopicMovement?.selectedTheme) {
    claims.push({
      section: 'subtopicMovement',
      claimType: 'relative_share',
      title: `${subtopicMovement.selectedTheme.label} share movement`,
      detail: `${subtopicMovement.selectedTheme.label} is ranked #${subtopicMovement.selectedTheme.rank || '--'} inside ${humanizeTheme(subtopicMovement.parentTheme)} with ${subtopicMovement.selectedTheme.lastSharePct}% share.`,
      evidenceClasses: dedupeEvidenceClasses(subtopicMovement.evidenceClasses || evidenceClassesFromProvenance(subtopicMovement.provenance || [])),
      provenance: dedupeProvenance(subtopicMovement.provenance || []),
    });
  }
  if (relatedEntities?.entities?.length > 0) {
    claims.push({
      section: 'relatedEntities',
      claimType: 'entity_exposure',
      title: 'Theme-to-entity linkage',
      detail: `${relatedEntities.entities.length} entity link${relatedEntities.entities.length === 1 ? '' : 's'} are attached to this theme.`,
      evidenceClasses: dedupeEvidenceClasses(relatedEntities.evidenceClasses || evidenceClassesFromProvenance(relatedEntities.provenance || [])),
      provenance: dedupeProvenance(relatedEntities.provenance || []),
    });
  }
  if (adjacentPathways?.items?.length > 0) {
    claims.push({
      section: 'adjacentPathways',
      claimType: 'adjacent_pathway',
      title: 'Adjacent indirect pathways',
      detail: `${adjacentPathways.items.length} reusable adjacent pathway${adjacentPathways.items.length === 1 ? '' : 's'} are attached to this theme.`,
      evidenceClasses: dedupeEvidenceClasses(adjacentPathways.evidenceClasses || evidenceClassesFromProvenance(adjacentPathways.provenance || [])),
      provenance: dedupeProvenance(adjacentPathways.provenance || []),
    });
  }
  return claims;
}

function extractProvenanceTimestamp(ref) {
  if (!ref || typeof ref !== 'object') return null;
  const candidates = [
    ref.updatedAt,
    ref.publishedAt,
    ref.latestFiledAt,
    ref.filedAt,
    ref.ts,
    ref.timestamp,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const date = new Date(candidate);
    if (!Number.isNaN(date.valueOf())) return date.toISOString();
  }
  return null;
}

function readWatchpointText(item) {
  if (typeof item === 'string') return item;
  return String(
    item?.implication
    || item?.trigger
    || item?.detail
    || item?.summary
    || '',
  );
}

function deriveBriefingFreshness(payload) {
  const provenance = dedupeProvenance(payload?.evidenceLedger?.provenance || []);
  const timestamps = provenance
    .map((ref) => extractProvenanceTimestamp(ref))
    .filter(Boolean)
    .map((value) => new Date(value).valueOf())
    .filter(Number.isFinite)
    .sort((left, right) => right - left);
  return timestamps.length > 0 ? new Date(timestamps[0]).toISOString() : null;
}

function deriveBriefingScore(payload) {
  const summary = payload?.summary || {};
  const normalizedYoY = Number(normalizePercent(summary.vsYearAgoPct) || 0);
  const normalizedAcceleration = Number(normalizePercent(summary.acceleration) || 0);
  const evidenceClassCount = Number(asArray(payload?.evidenceLedger?.evidenceClasses).length || 0);
  const whatChangedCount = Number(asArray(payload?.sections?.whatChanged).length || 0);
  const adjacentPathwayCount = Number(asArray(payload?.sections?.adjacentPathways?.items).length || 0);
  const highestAdjacentConfidence = Number(payload?.sections?.adjacentPathways?.summary?.highestConfidence || 0);
  return round(
    (evidenceClassCount * 4)
    + (whatChangedCount * 2)
    + (adjacentPathwayCount * 2.5)
    + (highestAdjacentConfidence * 0.04)
    + (normalizedYoY * 0.08)
    + (normalizedAcceleration * 0.05),
    2,
  );
}

function buildThemeEvidenceSourceBreakdown(digestItems, recentArticles, openAlexContext, githubContext) {
  const buckets = new Map();
  const ingest = (item, evidenceClass) => {
    const source = String(item?.source || 'unknown').trim().toLowerCase() || 'unknown';
    const bucket = buckets.get(source) || {
      source,
      sourceQuality: round(sourceQualityFor(source), 2),
      curatedItemCount: 0,
      recentArticleCount: 0,
      researchCount: 0,
      codeCount: 0,
      evidenceClasses: new Set(),
      latestPublishedAt: null,
    };
    if (evidenceClass === 'curated_digest') bucket.curatedItemCount += 1;
    if (evidenceClass === 'recent_article') bucket.recentArticleCount += 1;
    if (evidenceClass === 'openalex_research') bucket.researchCount += 1;
    if (evidenceClass === 'github_code') bucket.codeCount += 1;
    bucket.evidenceClasses.add(evidenceClass);
    if (item?.publishedAt && (!bucket.latestPublishedAt || new Date(item.publishedAt) > new Date(bucket.latestPublishedAt))) {
      bucket.latestPublishedAt = item.publishedAt;
    }
    buckets.set(source, bucket);
  };
  digestItems.forEach((item) => ingest(item, 'curated_digest'));
  recentArticles.forEach((item) => ingest(item, 'recent_article'));
  asArray(openAlexContext?.works).forEach((item) => ingest({
    source: item.sourceDisplayName || 'openalex',
    publishedAt: item.publicationDate || item.updatedAt || null,
  }, 'openalex_research'));
  asArray(githubContext?.repos).forEach((item) => ingest({
    source: 'github',
    publishedAt: item.pushedAt || item.updatedAt || null,
  }, 'github_code'));
  return Array.from(buckets.values())
    .map((bucket) => ({
      source: bucket.source,
      sourceQuality: bucket.sourceQuality,
      curatedItemCount: bucket.curatedItemCount,
      recentArticleCount: bucket.recentArticleCount,
      researchCount: bucket.researchCount,
      codeCount: bucket.codeCount,
      totalCount: bucket.curatedItemCount + bucket.recentArticleCount + bucket.researchCount + bucket.codeCount,
      evidenceClasses: Array.from(bucket.evidenceClasses),
      latestPublishedAt: bucket.latestPublishedAt,
    }))
    .sort((left, right) => Number(right.totalCount || 0) - Number(left.totalCount || 0));
}

function buildThemeEvidenceClasses(snapshot, digestItems, recentArticles, secContext, openAlexContext, githubContext) {
  const classes = [];
  if (snapshot) {
    classes.push(buildEvidenceClassRef('trend_snapshot', { count: 1 }));
  }
  classes.push(buildEvidenceClassRef('theme_evolution', { count: 1 }));
  if (digestItems.length > 0) {
    classes.push(buildEvidenceClassRef('curated_digest', { count: digestItems.length }));
  }
  if (recentArticles.length > 0) {
    classes.push(buildEvidenceClassRef('recent_articles', { count: recentArticles.length }));
  }
  if (secContext?.entities?.length > 0) {
    classes.push(buildEvidenceClassRef('sec_filings', { count: secContext.entities.length }));
  }
  if (openAlexContext?.works?.length > 0) {
    classes.push(buildEvidenceClassRef('openalex_research', { count: openAlexContext.works.length }));
  }
  if (githubContext?.repos?.length > 0) {
    classes.push(buildEvidenceClassRef('github_code', { count: githubContext.repos.length }));
  }
  return dedupeEvidenceClasses(classes);
}

function buildThemeWhatChanged(snapshot, subTheme, digestItems, fallbackLabel) {
  const resolvedLabel = fallbackLabel || snapshot?.label || subTheme?.label || humanizeTheme(snapshot?.theme || subTheme?.theme || 'theme');
  const changes = [];
  const snapshotRef = snapshot
    ? buildProvenanceRef('trend_snapshot', `${snapshot.label || humanizeTheme(snapshot.theme)} ${snapshot.periodType} aggregate`, {
      articleCount: snapshot.articleCount,
      vsPreviousPct: snapshot.vsPreviousPct,
      vsYearAgoPct: snapshot.vsYearAgoPct,
    })
    : null;
  const subThemeRef = subTheme
    ? buildProvenanceRef('theme_evolution', `${subTheme.label} share movement inside ${humanizeTheme(subTheme.parentTheme)}`, {
      sharePct: subTheme.lastSharePct,
      deltaSharePct: subTheme.deltaSharePct,
    })
    : null;
  const digestRefs = digestItems.slice(0, 3).map((item) => buildProvenanceRef('curated_digest', item.title || 'Curated item', {
    articleId: item.articleId,
    source: item.source,
    publishedAt: item.publishedAt,
  }));
  if (snapshot?.transition) {
    changes.push({
      type: 'lifecycle_transition',
      title: `${snapshot.label} changed lifecycle stage`,
      detail: `${snapshot.label} moved from ${snapshot.transition.from} to ${snapshot.transition.to} in the current ${snapshot.periodType} lens.`,
      metric: snapshot.transition,
      evidenceClasses: dedupeEvidenceClasses([buildEvidenceClassRef('trend_snapshot', { count: 1 })]),
      provenance: [snapshotRef].filter(Boolean),
    });
  }
  if (snapshot) {
    changes.push({
      type: 'coverage_shift',
      title: 'Coverage changed versus prior comparison windows',
      detail: `${snapshot.label} logged ${snapshot.articleCount} items, ${snapshot.vsPreviousPct >= 0 ? '+' : ''}${snapshot.vsPreviousPct}% versus the prior ${snapshot.periodType} and ${snapshot.vsYearAgoPct >= 0 ? '+' : ''}${snapshot.vsYearAgoPct}% versus a year ago.`,
      metric: {
        articleCount: snapshot.articleCount,
        vsPreviousPct: snapshot.vsPreviousPct,
        vsYearAgoPct: snapshot.vsYearAgoPct,
      },
      evidenceClasses: dedupeEvidenceClasses([buildEvidenceClassRef('trend_snapshot', { count: 1 })]),
      provenance: [snapshotRef].filter(Boolean),
    });
    changes.push({
      type: 'acceleration',
      title: snapshot.acceleration >= 0 ? 'Acceleration remains positive' : 'Acceleration is weakening',
      detail: `${snapshot.label} is showing ${snapshot.acceleration >= 0 ? 'positive' : 'negative'} acceleration of ${snapshot.acceleration} in the current ${snapshot.periodType} comparison.`,
      metric: {
        acceleration: snapshot.acceleration,
        sourceDiversity: snapshot.sourceDiversity,
      },
      evidenceClasses: dedupeEvidenceClasses([buildEvidenceClassRef('trend_snapshot', { count: 1 })]),
      provenance: [snapshotRef].filter(Boolean),
    });
  }
  if (subTheme) {
    changes.push({
      type: 'subtopic_share',
      title: 'Share inside the parent theme moved',
      detail: `${subTheme.label} now represents ${subTheme.lastSharePct}% of ${humanizeTheme(subTheme.parentTheme)} coverage, a ${subTheme.deltaSharePct >= 0 ? '+' : ''}${subTheme.deltaSharePct} point move across the selected range.`,
      metric: {
        lastSharePct: subTheme.lastSharePct,
        deltaSharePct: subTheme.deltaSharePct,
      },
      evidenceClasses: dedupeEvidenceClasses([buildEvidenceClassRef('theme_evolution', { count: 1 })]),
      provenance: [subThemeRef].filter(Boolean),
    });
  }
  if (digestItems.length > 0) {
    changes.push({
      type: 'curated_reinforcement',
      title: 'Recent curated coverage reinforced the theme',
      detail: `${digestItems.length} curated item${digestItems.length === 1 ? '' : 's'} mapped to ${resolvedLabel} in the recent digest window.`,
      metric: {
        curatedItems: digestItems.length,
      },
      evidenceClasses: dedupeEvidenceClasses([buildEvidenceClassRef('curated_digest', { count: digestItems.length })]),
      provenance: digestRefs,
    });
  }
  return changes.slice(0, 5);
}

function buildThemeWhyItMatters(snapshot, subTheme, digestItems, fallbackLabel, openAlexContext, githubContext) {
  const statements = [];
  const provenance = [];
  const label = fallbackLabel || snapshot?.label || subTheme?.label || humanizeTheme(snapshot?.theme || subTheme?.theme || 'theme');
  if (snapshot) {
    statements.push(
      `${label} matters because it is ${snapshot.lifecycleStage} with ${snapshot.vsYearAgoPct >= 0 ? 'positive' : 'negative'} year-on-year movement and ${snapshot.acceleration >= 0 ? 'still building' : 'softening'} acceleration.`,
    );
    provenance.push(buildProvenanceRef('trend_snapshot', `${label} aggregate context`, {
      lifecycleStage: snapshot.lifecycleStage,
      vsYearAgoPct: snapshot.vsYearAgoPct,
      acceleration: snapshot.acceleration,
    }));
  }
  if (subTheme && Number(subTheme.deltaSharePct || 0) !== 0) {
    statements.push(
      `${label} is not just moving in isolation. It is shifting relative share inside ${humanizeTheme(subTheme.parentTheme)}, which makes it a structural signal rather than a single headline burst.`,
    );
    provenance.push(buildProvenanceRef('theme_evolution', `${label} relative-share context`, {
      parentTheme: subTheme.parentTheme,
      deltaSharePct: subTheme.deltaSharePct,
    }));
  }
  if (digestItems.length > 0) {
    const supportingTopics = Array.from(new Set(digestItems.flatMap((item) => asArray(item.relatedTopics)))).slice(0, 3);
    if (supportingTopics.length > 0) {
      statements.push(
        `Recent curated coverage connected the theme to ${supportingTopics.join(', ')}, which helps explain why it remains worth tracking beyond the raw article count.`,
      );
      provenance.push(...digestItems.slice(0, 3).map((item) => buildProvenanceRef('curated_digest', item.title || 'Curated item', {
        articleId: item.articleId,
        source: item.source,
      })));
    }
  }
  if (openAlexContext?.works?.length > 0) {
    const researchSummary = openAlexContext.summary || {};
    const topConceptText = asArray(researchSummary.topConcepts).slice(0, 3).join(', ');
    statements.push(
      `${label} is also reinforced by ${researchSummary.workCount || openAlexContext.works.length} OpenAlex-linked research works${researchSummary.recentCount ? `, including ${researchSummary.recentCount} from the last three publication years` : ''}, which suggests the theme has live research momentum and not just media attention.`,
    );
    provenance.push(...dedupeProvenance(openAlexContext.provenance || []).slice(0, 3));
    if (topConceptText) {
      statements.push(
        `The research lane clusters around ${topConceptText}, which sharpens the evidence base behind the theme beyond general news coverage.`,
      );
    }
  }
  if (githubContext?.repos?.length > 0) {
    const githubSummary = githubContext.summary || {};
    statements.push(
      `${label} is also supported by ${githubSummary.repoCount || githubContext.repos.length} GitHub repositories${githubSummary.recentPushedCount ? ` with ${githubSummary.recentPushedCount} active pushes in the last 90 days` : ''}, which points to live builder traction instead of media-only narrative strength.`,
    );
    provenance.push(...dedupeProvenance(githubContext.provenance || []).slice(0, 3));
    if (asArray(githubSummary.topLanguages).length > 0) {
      statements.push(
        `Code activity clusters around ${asArray(githubSummary.topLanguages).slice(0, 3).join(', ')}, which helps frame where the implementation layer is concentrating.`,
      );
    }
  }
  if (statements.length === 0) {
    statements.push('This theme is being tracked because it remains a durable object in the canonical taxonomy and can be monitored over multi-period horizons.');
    provenance.push(buildProvenanceRef('taxonomy', `${label} canonical tracking fallback`));
  }
  return {
    summary: statements[0],
    statements,
    evidenceClasses: dedupeEvidenceClasses(evidenceClassesFromProvenance(provenance)),
    provenance,
  };
}

function buildThemeEvidence(snapshot, digestItems, recentArticles, secContext, openAlexContext, githubContext) {
  const relatedSignals = Array.from(new Set(
    digestItems.flatMap((item) => asArray(item.relatedSignals).map((signal) => signal.signalName).filter(Boolean)),
  ));
  const sourceBreakdown = buildThemeEvidenceSourceBreakdown(digestItems, recentArticles, openAlexContext, githubContext);
  const evidenceClasses = buildThemeEvidenceClasses(snapshot, digestItems, recentArticles, secContext, openAlexContext, githubContext);
  const provenance = [
    snapshot
      ? buildProvenanceRef('trend_snapshot', `${snapshot.label || humanizeTheme(snapshot.theme)} aggregate`, {
        articleCount: snapshot.articleCount,
        lifecycleStage: snapshot.lifecycleStage,
      })
      : null,
    ...digestItems.slice(0, 5).map((item) => buildProvenanceRef('curated_digest', item.title || 'Curated item', {
      articleId: item.articleId,
      source: item.source,
      publishedAt: item.publishedAt,
    })),
    ...recentArticles.slice(0, 5).map((item) => buildProvenanceRef('recent_article', item.title || 'Recent article', {
      articleId: item.articleId,
      source: item.source,
      publishedAt: item.publishedAt,
      url: item.url,
    })),
    ...(secContext?.provenance || []),
    ...(openAlexContext?.provenance || []),
    ...(githubContext?.provenance || []),
  ].filter(Boolean);

  return {
    trend: snapshot
      ? {
        articleCount: snapshot.articleCount,
        lifecycleStage: snapshot.lifecycleStage,
        vsPreviousPct: snapshot.vsPreviousPct,
        vsYearAgoPct: snapshot.vsYearAgoPct,
        acceleration: snapshot.acceleration,
        sourceDiversity: snapshot.sourceDiversity,
        geographicSpread: snapshot.geographicSpread,
        latestArticleAt: snapshot.latestArticleAt,
      }
      : null,
    curatedItems: digestItems.map((item) => ({
      title: item.title,
      source: item.source,
      publishedAt: item.publishedAt,
      whyItMatters: item.whyItMatters,
      oneLineSummary: item.oneLineSummary,
      relatedTopics: item.relatedTopics,
    })),
    recentArticles: recentArticles.map((item) => ({
      articleId: item.articleId,
      title: item.title,
      source: item.source,
      publishedAt: item.publishedAt,
      url: item.url,
    })),
    researchEvidence: {
      status: openAlexContext?.status || 'connector-pending',
      summary: openAlexContext?.summary || null,
      works: asArray(openAlexContext?.works).map((item) => ({
        workId: item.workId,
        title: item.title,
        publicationYear: item.publicationYear,
        publicationDate: item.publicationDate,
        citedByCount: item.citedByCount,
        researchSignalScore: item.researchSignalScore,
        matchedKeywords: item.matchedKeywords,
        sourceDisplayName: item.sourceDisplayName,
        primaryTopic: item.primaryTopic,
        landingPageUrl: item.landingPageUrl,
        abstractSummary: item.abstractSummary,
        concepts: item.concepts,
        authors: item.authors,
      })),
    },
    githubEvidence: {
      status: githubContext?.status || 'connector-pending',
      summary: githubContext?.summary || null,
      repos: asArray(githubContext?.repos).map((item) => ({
        repoKey: item.repoKey,
        fullName: item.fullName,
        name: item.name,
        htmlUrl: item.htmlUrl,
        homepageUrl: item.homepageUrl,
        description: item.description,
        language: item.language,
        topics: item.topics,
        stargazersCount: item.stargazersCount,
        forksCount: item.forksCount,
        watchersCount: item.watchersCount,
        openIssuesCount: item.openIssuesCount,
        defaultBranch: item.defaultBranch,
        licenseName: item.licenseName,
        pushedAt: item.pushedAt,
        updatedAt: item.updatedAt,
        githubSignalScore: item.githubSignalScore,
        matchedKeywords: item.matchedKeywords,
        ownerLogin: item.ownerLogin,
      })),
    },
    relatedSignals,
    sourceBreakdown,
    evidenceClasses,
    sourceClasses: sourceBreakdown.map((item) => item.source),
    provenance,
  };
}

function buildThemeSubtopicMovement(parentTheme, subThemes, currentTheme) {
  const selected = subThemes.find((item) => normalizeTheme(item.theme) === normalizeTheme(currentTheme)) || null;
  const ranked = subThemes
    .slice()
    .sort((left, right) => Number(right.lastSharePct || 0) - Number(left.lastSharePct || 0));
  const selectedRank = selected
    ? ranked.findIndex((item) => normalizeTheme(item.theme) === normalizeTheme(selected.theme)) + 1
    : null;

  return {
    parentTheme,
    selectedTheme: selected
      ? {
        theme: selected.theme,
        label: selected.label,
        lastSharePct: selected.lastSharePct,
        deltaSharePct: selected.deltaSharePct,
        averageSharePct: selected.averageSharePct,
        rank: selectedRank || null,
      }
      : null,
    peerThemes: ranked.slice(0, 6).map((item, index) => ({
      theme: item.theme,
      label: item.label,
      lastSharePct: item.lastSharePct,
      deltaSharePct: item.deltaSharePct,
      rank: index + 1,
    })),
    evidenceClasses: dedupeEvidenceClasses([buildEvidenceClassRef('theme_evolution', { count: ranked.length || 1 })]),
    provenance: selected
      ? [
        buildProvenanceRef('theme_evolution', `${selected.label} relative share`, {
          parentTheme,
          sharePct: selected.lastSharePct,
          deltaSharePct: selected.deltaSharePct,
        }),
      ]
      : [],
  };
}

function buildThemeBriefRisks(snapshot, digestItems, subTheme, openAlexContext) {
  const risks = [];
  if (snapshot && Number(snapshot.sourceDiversity || 0) < 0.35) {
    risks.push('Source diversity is still narrow, so the theme may be over-dependent on a small source set.');
  }
  if (snapshot && Number(snapshot.vsYearAgoPct || 0) > 0 && Number(snapshot.acceleration || 0) < 0) {
    risks.push('Year-on-year growth remains positive, but near-term acceleration is weakening. This can indicate a cooling burst rather than compounding structural adoption.');
  }
  if (digestItems.length === 0) {
    risks.push('Recent curated coverage is thin, so the theme may be structurally important without having strong current confirmation in the latest digest window.');
  }
  if (subTheme && Number(subTheme.deltaSharePct || 0) < 0) {
    risks.push(`Share inside ${humanizeTheme(subTheme.parentTheme)} is declining, which weakens the case for sustained relative momentum.`);
  }
  if (snapshot && ['nascent', 'emerging'].includes(String(snapshot.lifecycleStage || ''))) {
    risks.push('The theme is still early-stage, so false starts and sharp narrative reversals are more likely.');
  }
  if (!openAlexContext?.works?.length && ['technology', 'science'].includes(String(snapshot?.category || inferCategory(subTheme?.theme || '')))) {
    risks.push('Research-class evidence is still thin, so the theme may be running ahead of durable technical confirmation.');
  }
  return risks;
}

function buildThemeBriefWatchpoints(snapshot, subTheme, openAlexContext, githubContext) {
  const watchpoints = [];
  if (snapshot) {
    watchpoints.push(`Monitor whether ${snapshot.label} keeps positive acceleration over the next ${snapshot.periodType} window.`);
    watchpoints.push(`Check if source diversity expands beyond ${snapshot.sourceDiversity} and whether geographic spread broadens from ${snapshot.geographicSpread}.`);
  }
  if (subTheme) {
    watchpoints.push(`Track whether ${subTheme.label} holds or expands its ${subTheme.lastSharePct}% share inside ${humanizeTheme(subTheme.parentTheme)}.`);
  }
  if (openAlexContext?.summary?.workCount) {
    watchpoints.push(`Watch whether research coverage for this theme stays above ${openAlexContext.summary.workCount} tracked OpenAlex works and whether new papers broaden beyond ${asArray(openAlexContext.summary.topConcepts).slice(0, 2).join(' / ') || 'the current concept cluster'}.`);
  }
  if (githubContext?.summary?.repoCount) {
    watchpoints.push(`Track whether GitHub activity stays above ${githubContext.summary.repoCount} relevant repositories and whether active pushes continue across ${asArray(githubContext.summary.topLanguages).slice(0, 2).join(' / ') || 'the current code stack'}.`);
  }
  watchpoints.push('Look for new evidence classes beyond news, especially filings, research, patents, or code activity as those connectors come online.');
  return watchpoints.slice(0, 4);
}

function buildThemeRelatedEntities(theme, category, secContext) {
  if (secContext?.entities?.length > 0) {
    return {
      status: secContext.status || 'connected',
      entities: secContext.entities,
      pathways: secContext.entities.map((item) => ({
        relationType: item.relationType,
        status: item.sign || 'positive',
          note: `${item.companyName || item.entityKey} is linked as ${item.relationType} with confidence ${item.confidence ?? '--'} and ${item.filingCount || 0} filing-backed touchpoint(s).`,
        })),
      evidenceClasses: dedupeEvidenceClasses([buildEvidenceClassRef('sec_filings', { count: secContext.entities.length })]),
      provenance: secContext.provenance || [],
    };
  }
  return {
    status: 'connector-pending',
    entities: [],
    pathways: [
      {
        relationType: 'beneficiary',
        status: 'pending',
        note: `Entity linkage for ${humanizeTheme(theme)} will populate once exposure connectors are enabled.`,
      },
      {
        relationType: 'supplier',
        status: 'pending',
        note: `The current foundation only tracks theme objects. ${CATEGORY_LABELS[category] || humanizeTheme(category)} exposure mapping is scheduled after SEC and OpenAlex.`,
      },
    ],
    evidenceClasses: dedupeEvidenceClasses([buildEvidenceClassRef('taxonomy', { count: 1 })]),
    provenance: [
      buildProvenanceRef('taxonomy', `${humanizeTheme(theme)} connector placeholder`, {
        detail: 'Exposure connectors not yet populated for this theme.',
      }),
    ],
  };
}

function buildThemeAdjacentPathways(attachmentContext, themeLabel) {
  const items = asArray(attachmentContext?.items).map((item) => ({
    attachmentKey: item.attachmentKey,
    label: item.label || 'Adjacent pathway',
    confidence: item.confidence,
    relationType: item.relationType || 'related',
    transmissionOrder: item.transmissionOrder || 'indirect',
    transmissionPath: item.transmissionPath || '',
    reason: item.reason || '',
    thesis: item.thesis || '',
    invalidation: asArray(item.invalidation),
    transmissionChannels: asArray(item.transmissionChannels),
    assets: asArray(item.assets),
    suggestedSources: asArray(item.suggestedSources),
    suggestedGdeltKeywords: asArray(item.suggestedGdeltKeywords),
    createdAt: item.createdAt,
    status: item.status || 'pending',
    targetTheme: item.targetTheme,
    targetThemeLabel: item.targetThemeLabel || themeLabel,
  }));

  if (items.length === 0) {
    return {
      status: attachmentContext?.status || 'no-attachments',
      items: [],
      evidenceClasses: dedupeEvidenceClasses(attachmentContext?.evidenceClasses || []),
      provenance: dedupeProvenance(attachmentContext?.provenance || []),
      summary: attachmentContext?.summary || null,
    };
  }

  return {
    status: attachmentContext?.status || 'connected',
    items,
    evidenceClasses: dedupeEvidenceClasses(attachmentContext?.evidenceClasses || []),
    provenance: dedupeProvenance(attachmentContext?.provenance || []),
    summary: attachmentContext?.summary || {
      count: items.length,
    },
  };
}

function buildThemeDeltaSinceLastVisit(previousViewedAt, digestItems, recentArticles, whatChanged = []) {
  if (!previousViewedAt) {
    return {
      active: false,
      status: 'first-view',
      since: null,
      headline: 'This is the first recorded view for this theme in the current workspace.',
      newDigestItemCount: 0,
      newArticleCount: 0,
      items: [],
    };
  }

  const sinceTs = new Date(previousViewedAt);
  if (Number.isNaN(sinceTs.valueOf())) {
    return {
      active: false,
      status: 'invalid-since',
      since: previousViewedAt,
      headline: 'The previous-view timestamp could not be parsed.',
      newDigestItemCount: 0,
      newArticleCount: 0,
      items: [],
    };
  }

  const newDigestItems = digestItems.filter((item) => item?.publishedAt && new Date(item.publishedAt) > sinceTs);
  const newArticles = recentArticles.filter((item) => item?.publishedAt && new Date(item.publishedAt) > sinceTs);
  const signals = [];

  if (newDigestItems.length > 0) {
    signals.push({
      type: 'curated_digest',
      title: `${newDigestItems.length} curated item${newDigestItems.length === 1 ? '' : 's'} arrived since the last view`,
      detail: newDigestItems[0]?.title || 'Curated coverage reinforced the theme after the previous view.',
      provenance: newDigestItems.slice(0, 3).map((item) => buildProvenanceRef('curated_digest', item.title || 'Curated item', {
        articleId: item.articleId,
        source: item.source,
        publishedAt: item.publishedAt,
      })),
    });
  }

  if (newArticles.length > 0) {
    signals.push({
      type: 'recent_articles',
      title: `${newArticles.length} recent article${newArticles.length === 1 ? '' : 's'} are newer than the last visit`,
      detail: newArticles[0]?.title || 'Recent article flow moved after the previous view.',
      provenance: newArticles.slice(0, 3).map((item) => buildProvenanceRef('recent_article', item.title || 'Recent article', {
        articleId: item.articleId,
        source: item.source,
        publishedAt: item.publishedAt,
        url: item.url,
      })),
    });
  }

  if (whatChanged.length > 0) {
    signals.push({
      type: 'brief_claims',
      title: 'Current Theme Brief highlights remained relevant since the previous visit',
      detail: whatChanged[0]?.detail || whatChanged[0]?.title || 'Structural changes remain active in the current lens.',
      provenance: dedupeProvenance(whatChanged.flatMap((item) => item.provenance || []).slice(0, 4)),
    });
  }

  const items = signals.map((item) => ({
    ...item,
    evidenceClasses: dedupeEvidenceClasses(evidenceClassesFromProvenance(item.provenance || [])),
    provenance: dedupeProvenance(item.provenance || []),
  }));

  return {
    active: items.length > 0,
    status: items.length > 0 ? 'changes-detected' : 'no-new-items',
    since: previousViewedAt,
    headline: items.length > 0
      ? `Changes were detected after ${new Date(previousViewedAt).toLocaleString('en-US', { hour12: false })}.`
      : 'No newer curated items or recent articles were detected after the previous view.',
    newDigestItemCount: newDigestItems.length,
    newArticleCount: newArticles.length,
    items,
  };
}

export async function buildThemeBriefPayload(themeParam, safeQuery, params = new URLSearchParams()) {
  const theme = normalizeTheme(themeParam);
  const periodType = normalizePeriodType(params.get('period') || 'quarter');
  const digestLimit = normalizeLimit(params.get('digest_limit'), 3, 10);
  const articleLimit = normalizeLimit(params.get('article_limit'), 5, 12);
  const previousViewedAt = String(params.get('since') || '').trim();
  const { source, rows, normalizationState } = await loadLatestTrendSnapshot(safeQuery, periodType, 160);
  const snapshot = findThemeSnapshot(rows, theme);
  const parentTheme = normalizeParentTheme(snapshot?.parentTheme || theme);
  const digestParams = new URLSearchParams();
  digestParams.set('theme', theme);
  digestParams.set('period', periodType);
  digestParams.set('limit', String(digestLimit));
  const [evolution, digestPayload, recentArticles, secContext, openAlexContext, githubContext, attachmentContext, notebookState] = await Promise.all([
    buildThemeEvolutionPayload(parentTheme, safeQuery, new URLSearchParams([
      ['period', periodType],
      ['periods', params.get('periods') || '8'],
      ['limit', params.get('evolution_limit') || '8'],
    ])),
    buildDailyDigestPayload(safeQuery, digestParams),
    loadThemeRecentArticles(safeQuery, theme, articleLimit, normalizationState),
    loadThemeSecContext(safeQuery, theme),
    loadThemeOpenAlexContext(safeQuery, theme),
    loadThemeGitHubContext(safeQuery, theme),
    loadThemeAttachmentContext(safeQuery, theme),
    loadThemeNotebookEntry(safeQuery, theme, periodType, { label: humanizeTheme(theme) }),
  ]);

  const digestItems = asArray(digestPayload?.items)
    .filter((item) => normalizeTheme(item.theme) === theme)
    .slice(0, digestLimit);
  const subTheme = asArray(evolution?.subThemes).find((item) => normalizeTheme(item.theme) === theme) || null;
  const label = snapshot?.label || subTheme?.label || humanizeTheme(theme);
  const category = snapshot?.category || subTheme?.category || inferCategory(theme);
  const whatChanged = buildThemeWhatChanged(snapshot, subTheme, digestItems, label);
  const whyItMatters = buildThemeWhyItMatters(snapshot, subTheme, digestItems, label, openAlexContext, githubContext);
  const evidence = buildThemeEvidence(snapshot, digestItems, recentArticles, secContext, openAlexContext, githubContext);
  const subtopicMovement = buildThemeSubtopicMovement(parentTheme, asArray(evolution?.subThemes), theme);
  const relatedEntities = buildThemeRelatedEntities(theme, category, secContext);
  const adjacentPathways = buildThemeAdjacentPathways(attachmentContext, label);
  const risks = buildThemeBriefRisks(snapshot, digestItems, subTheme, openAlexContext);
  const watchpoints = buildThemeBriefWatchpoints(snapshot, subTheme, openAlexContext, githubContext);
  const deltaSinceLastVisit = buildThemeDeltaSinceLastVisit(previousViewedAt, digestItems, recentArticles, whatChanged);
  const riskProvenance = [];
  const watchpointProvenance = [];
  if (snapshot) {
    const snapshotRef = buildProvenanceRef('trend_snapshot', `${label} risk baseline`, {
      articleCount: snapshot.articleCount,
      lifecycleStage: snapshot.lifecycleStage,
      sourceDiversity: snapshot.sourceDiversity,
      acceleration: snapshot.acceleration,
    });
    riskProvenance.push(snapshotRef);
    watchpointProvenance.push(snapshotRef);
  }
  if (subTheme) {
    const evolutionRef = buildProvenanceRef('theme_evolution', `${subTheme.label} share baseline`, {
      parentTheme: subTheme.parentTheme,
      sharePct: subTheme.lastSharePct,
      deltaSharePct: subTheme.deltaSharePct,
    });
    riskProvenance.push(evolutionRef);
    watchpointProvenance.push(evolutionRef);
  }
  if (digestItems.length > 0) {
    riskProvenance.push(...digestItems.slice(0, 2).map((item) => buildProvenanceRef('curated_digest', item.title || 'Curated item', {
      articleId: item.articleId,
      source: item.source,
      publishedAt: item.publishedAt,
    })));
  }
  const sectionMeta = {
    whatChanged: buildSectionEvidenceMeta(
      'whatChanged',
      whatChanged.flatMap((item) => item.evidenceClasses || evidenceClassesFromProvenance(item.provenance || [])),
      whatChanged.flatMap((item) => item.provenance || []),
      { claimCount: whatChanged.length },
    ),
    whyItMatters: buildSectionEvidenceMeta(
      'whyItMatters',
      whyItMatters.evidenceClasses || evidenceClassesFromProvenance(whyItMatters.provenance || []),
      whyItMatters.provenance || [],
      { claimCount: Array.isArray(whyItMatters.statements) ? whyItMatters.statements.length : 0 },
    ),
    evidence: buildSectionEvidenceMeta(
      'evidence',
      evidence.evidenceClasses || [],
      evidence.provenance || [],
      { sourceCount: evidence.sourceBreakdown?.length || 0 },
    ),
    subtopicMovement: buildSectionEvidenceMeta(
      'subtopicMovement',
      subtopicMovement.evidenceClasses || [],
      subtopicMovement.provenance || [],
      { peerThemeCount: subtopicMovement.peerThemes?.length || 0 },
    ),
    relatedEntities: buildSectionEvidenceMeta(
      'relatedEntities',
      relatedEntities.evidenceClasses || [],
      relatedEntities.provenance || [],
      { entityCount: relatedEntities.entities?.length || 0 },
    ),
    adjacentPathways: buildSectionEvidenceMeta(
      'adjacentPathways',
      adjacentPathways.evidenceClasses || [],
      adjacentPathways.provenance || [],
      { pathwayCount: adjacentPathways.items?.length || 0 },
    ),
    risks: buildSectionEvidenceMeta(
      'risks',
      evidenceClassesFromProvenance(riskProvenance),
      riskProvenance,
      { claimCount: risks.length },
    ),
    watchpoints: buildSectionEvidenceMeta(
      'watchpoints',
      dedupeEvidenceClasses([
        ...evidenceClassesFromProvenance(watchpointProvenance),
        buildEvidenceClassRef('taxonomy', { count: 1 }),
      ]),
      [
        ...watchpointProvenance,
        buildProvenanceRef('taxonomy', `${label} watchpoint fallback`, {
          detail: 'Watchpoints include connector-dependent checks for upcoming evidence classes.',
        }),
      ],
      { claimCount: watchpoints.length },
    ),
  };
  const evidenceLedger = {
    evidenceClasses: dedupeEvidenceClasses(flattenSectionMeta(sectionMeta).flatMap((item) => item.evidenceClasses || [])),
    provenance: dedupeProvenance(flattenSectionMeta(sectionMeta).flatMap((item) => item.provenance || [])),
    claims: buildThemeClaimLedger({
      whatChanged,
      whyItMatters,
      subtopicMovement,
      relatedEntities,
      adjacentPathways,
    }),
  };

  return {
    theme,
    label,
    category,
    categoryLabel: CATEGORY_LABELS[category] || humanizeTheme(category),
    parentTheme,
    periodType,
    source,
    taxonomyFiltering: normalizationState?.hasTrendNormalizedTaxonomy ? 'canonical-only' : 'legacy-tolerant-fallback',
    summary: snapshot
      ? {
        articleCount: snapshot.articleCount,
        lifecycleStage: snapshot.lifecycleStage,
        vsPreviousPct: snapshot.vsPreviousPct,
        vsYearAgoPct: snapshot.vsYearAgoPct,
        acceleration: snapshot.acceleration,
        sourceDiversity: snapshot.sourceDiversity,
        geographicSpread: snapshot.geographicSpread,
        evidenceClasses: dedupeEvidenceClasses([buildEvidenceClassRef('trend_snapshot', { count: 1 })]),
        provenance: dedupeProvenance([
          buildProvenanceRef('trend_snapshot', `${label} summary baseline`, {
            articleCount: snapshot.articleCount,
            lifecycleStage: snapshot.lifecycleStage,
            vsPreviousPct: snapshot.vsPreviousPct,
            vsYearAgoPct: snapshot.vsYearAgoPct,
          }),
        ]),
      }
      : null,
    deltaSinceLastVisit,
    evidenceLedger,
    sections: {
      whatChanged,
      whyItMatters,
        evidence,
        subtopicMovement,
        relatedEntities,
        adjacentPathways,
        risks,
        watchpoints,
        notebookHooks: {
        suggestedTags: [theme, parentTheme, category].filter(Boolean),
        exportTitle: `${label} ${humanizeTheme(periodType)} Theme Brief`,
        promptSeed: `What changed in ${label}, why it matters, and what should remain on the watchlist next?`,
        noteMarkdown: notebookState.noteMarkdown,
        pinned: notebookState.pinned,
        savedTags: notebookState.tags,
        shareToken: notebookState.shareToken,
        shareUrl: notebookState.shareUrl,
        sharedAt: notebookState.sharedAt,
        exportCount: notebookState.exportCount,
        lastExportedAt: notebookState.lastExportedAt,
        updatedAt: notebookState.updatedAt,
      },
    },
    sectionMeta,
    notebookState,
  };
}

async function ensureThemeNotebookSchema(safeQuery) {
  for (const statement of THEME_NOTEBOOK_SCHEMA_STATEMENTS) {
    await safeQuery(statement);
  }
}

function defaultNotebookState(theme, periodType, label = '') {
  return {
    notebookKey: buildThemeNotebookKey(theme, periodType),
    theme: normalizeTheme(theme),
    periodType: normalizePeriodType(periodType),
    label: label || humanizeTheme(theme),
    noteMarkdown: '',
    pinned: false,
    tags: [],
    shareToken: null,
    sharedAt: null,
    shareUrl: null,
    exportCount: 0,
    lastExportedAt: null,
    updatedAt: null,
    createdAt: null,
    metadata: {},
  };
}

export async function loadThemeNotebookEntry(safeQuery, theme, periodType = DEFAULT_PERIOD, options = {}) {
  const normalizedTheme = normalizeTheme(theme);
  const normalizedPeriod = normalizePeriodType(periodType);
  const fallback = defaultNotebookState(normalizedTheme, normalizedPeriod, options.label || '');
  if (!normalizedTheme) return fallback;
  await ensureThemeNotebookSchema(safeQuery);
  const result = await safeQuery(`
    SELECT
      notebook_key,
      theme,
      period_type,
      note_markdown,
      pinned,
      tags,
      share_token,
      shared_at,
      export_count,
      last_exported_at,
      metadata,
      created_at,
      updated_at
    FROM theme_brief_notebooks
    WHERE theme = $1 AND period_type = $2
    LIMIT 1
  `, [normalizedTheme, normalizedPeriod]);
  const row = result.rows[0];
  if (!row) return fallback;
  return {
    notebookKey: String(row.notebook_key || fallback.notebookKey),
    theme: String(row.theme || normalizedTheme),
    periodType: String(row.period_type || normalizedPeriod),
    label: options.label || fallback.label,
    noteMarkdown: String(row.note_markdown || ''),
    pinned: Boolean(row.pinned),
    tags: normalizeNotebookTags(row.tags),
    shareToken: row.share_token ? String(row.share_token) : null,
    sharedAt: row.shared_at || null,
    shareUrl: row.share_token ? `/api/theme-brief-shared/${encodeURIComponent(String(row.share_token))}` : null,
    exportCount: Number(row.export_count || 0),
    lastExportedAt: row.last_exported_at || null,
    updatedAt: row.updated_at || null,
    createdAt: row.created_at || null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
  };
}

export async function upsertThemeNotebookEntry(safeQuery, theme, periodType = DEFAULT_PERIOD, input = {}) {
  const normalizedTheme = normalizeTheme(theme);
  const normalizedPeriod = normalizePeriodType(periodType);
  if (!normalizedTheme) {
    return defaultNotebookState('', normalizedPeriod);
  }
  await ensureThemeNotebookSchema(safeQuery);
  const current = await loadThemeNotebookEntry(safeQuery, normalizedTheme, normalizedPeriod, { label: input.label });
  const wantsShare = Boolean(input.shareRequested);
  const wantsUnshare = Boolean(input.unshareRequested);
  const shareToken = wantsUnshare
    ? null
    : (current.shareToken || (wantsShare ? randomUUID().replace(/-/g, '') : null));
  const sharedAt = wantsUnshare
    ? null
    : (shareToken ? (current.sharedAt || new Date().toISOString()) : null);
  const noteMarkdown = input.noteMarkdown != null ? String(input.noteMarkdown) : current.noteMarkdown;
  const pinned = input.pinned != null ? Boolean(input.pinned) : current.pinned;
  const tags = input.tags != null ? normalizeNotebookTags(input.tags) : current.tags;
  const metadata = {
    ...(current.metadata && typeof current.metadata === 'object' ? current.metadata : {}),
    ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
  };
  const notebookKey = buildThemeNotebookKey(normalizedTheme, normalizedPeriod);

  await safeQuery(`
    INSERT INTO theme_brief_notebooks (
      notebook_key,
      theme,
      period_type,
      note_markdown,
      pinned,
      tags,
      share_token,
      shared_at,
      metadata,
      created_at,
      updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6::jsonb, $7, $8::timestamptz, $9::jsonb, NOW(), NOW()
    )
    ON CONFLICT (theme, period_type) DO UPDATE SET
      notebook_key = EXCLUDED.notebook_key,
      note_markdown = EXCLUDED.note_markdown,
      pinned = EXCLUDED.pinned,
      tags = EXCLUDED.tags,
      share_token = EXCLUDED.share_token,
      shared_at = EXCLUDED.shared_at,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
  `, [
    notebookKey,
    normalizedTheme,
    normalizedPeriod,
    noteMarkdown,
    pinned,
    JSON.stringify(tags),
    shareToken,
    sharedAt,
    JSON.stringify(metadata),
  ]);

  return loadThemeNotebookEntry(safeQuery, normalizedTheme, normalizedPeriod, { label: input.label });
}

export async function recordThemeNotebookExport(safeQuery, theme, periodType = DEFAULT_PERIOD) {
  const normalizedTheme = normalizeTheme(theme);
  const normalizedPeriod = normalizePeriodType(periodType);
  if (!normalizedTheme) {
    return defaultNotebookState('', normalizedPeriod);
  }
  await ensureThemeNotebookSchema(safeQuery);
  await safeQuery(`
    INSERT INTO theme_brief_notebooks (
      notebook_key,
      theme,
      period_type,
      created_at,
      updated_at,
      export_count,
      last_exported_at
    ) VALUES (
      $1, $2, $3, NOW(), NOW(), 1, NOW()
    )
    ON CONFLICT (theme, period_type) DO UPDATE SET
      export_count = theme_brief_notebooks.export_count + 1,
      last_exported_at = NOW(),
      updated_at = NOW()
  `, [buildThemeNotebookKey(normalizedTheme, normalizedPeriod), normalizedTheme, normalizedPeriod]);
  return loadThemeNotebookEntry(safeQuery, normalizedTheme, normalizedPeriod);
}

export async function loadSharedThemeNotebookEntry(safeQuery, shareToken) {
  const token = String(shareToken || '').trim();
  if (!token) return null;
  await ensureThemeNotebookSchema(safeQuery);
  const result = await safeQuery(`
    SELECT
      notebook_key,
      theme,
      period_type,
      note_markdown,
      pinned,
      tags,
      share_token,
      shared_at,
      export_count,
      last_exported_at,
      metadata,
      created_at,
      updated_at
    FROM theme_brief_notebooks
    WHERE share_token = $1
    LIMIT 1
  `, [token]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    notebookKey: String(row.notebook_key || ''),
    theme: String(row.theme || ''),
    periodType: String(row.period_type || DEFAULT_PERIOD),
    noteMarkdown: String(row.note_markdown || ''),
    pinned: Boolean(row.pinned),
    tags: normalizeNotebookTags(row.tags),
    shareToken: row.share_token ? String(row.share_token) : null,
    sharedAt: row.shared_at || null,
    shareUrl: row.share_token ? `/api/theme-brief-shared/${encodeURIComponent(String(row.share_token))}` : null,
    exportCount: Number(row.export_count || 0),
    lastExportedAt: row.last_exported_at || null,
    updatedAt: row.updated_at || null,
    createdAt: row.created_at || null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
  };
}

async function ensureStructuralAlertSchema(safeQuery) {
  for (const statement of STRUCTURAL_ALERT_SCHEMA_STATEMENTS) {
    await safeQuery(statement);
  }
}

async function ensureDiscoveryTriageSchema(safeQuery) {
  for (const statement of DISCOVERY_TRIAGE_SCHEMA_STATEMENTS) {
    await safeQuery(statement);
  }
}

function scoreStructuralAlert(type, snapshot, extra = {}) {
  const articleCount = Number(snapshot?.articleCount || 0);
  const vsYearAgoPct = Math.abs(Number(snapshot?.vsYearAgoPct || 0));
  const acceleration = Math.abs(Number(snapshot?.acceleration || 0));
  const shareDelta = Math.abs(Number(extra.shareDeltaPct || 0));
  const sourceDiversity = Number(snapshot?.sourceDiversity || 0);
  const attachmentConfidence = clamp(Number(extra.attachmentConfidence || 0) / 100, 0, 1);
  const transmissionOrderWeight = ({
    direct: 1,
    'second-order': 0.9,
    'third-order': 0.75,
    'fourth-order': 0.6,
    proxy: 0.55,
  })[String(extra.transmissionOrder || '').trim().toLowerCase()] || 0;
  const base = (
    clamp(Math.log10(articleCount + 1) / 3, 0, 1) * 0.25
    + clamp(vsYearAgoPct / 200, 0, 1) * 0.25
    + clamp(acceleration / 200, 0, 1) * 0.2
    + clamp(sourceDiversity, 0, 1) * 0.15
    + clamp(shareDelta / 10, 0, 1) * 0.15
  );
  if (type === 'lifecycle_transition') return round(base + 0.18, 4);
  if (type === 'share_jump') return round(base + 0.12, 4);
  if (type === 'cross_source_confirmation') return round(base + 0.08, 4);
  if (type === 'adjacent_pathway') return round((base * 0.45) + (attachmentConfidence * 0.4) + (transmissionOrderWeight * 0.15) + 0.04, 4);
  return round(base, 4);
}

function classifyAlertSeverity(signalScore) {
  const score = Number(signalScore || 0);
  if (score >= 0.82) return 'high';
  if (score >= 0.58) return 'medium';
  return 'low';
}

async function loadLatestThemeShareShifts(safeQuery, periodType, limit = 60) {
  const hasEvolution = await probeTable(safeQuery, 'theme_evolution');
  if (!hasEvolution) return [];
  const result = await safeQuery(`
    WITH ranked AS (
      SELECT
        parent_theme,
        sub_theme,
        share_pct,
        rank_in_parent,
        period_start,
        period_end,
        ROW_NUMBER() OVER (PARTITION BY parent_theme, sub_theme ORDER BY period_start DESC) AS rn
      FROM theme_evolution
      WHERE COALESCE(period_type, $1) = $1
    )
    SELECT
      current.parent_theme,
      current.sub_theme,
      current.share_pct,
      current.rank_in_parent,
      current.period_start,
      current.period_end,
      previous.share_pct AS previous_share_pct,
      previous.rank_in_parent AS previous_rank_in_parent
    FROM ranked current
    LEFT JOIN ranked previous
      ON previous.parent_theme = current.parent_theme
     AND previous.sub_theme = current.sub_theme
     AND previous.rn = 2
    WHERE current.rn = 1
    ORDER BY ABS(COALESCE(current.share_pct, 0) - COALESCE(previous.share_pct, 0)) DESC NULLS LAST
    LIMIT $2
  `, [periodType, limit]);
  return result.rows.map((row) => ({
    parentTheme: normalizeParentTheme(row.parent_theme || ''),
    theme: normalizeTheme(row.sub_theme || ''),
    sharePct: Number(row.share_pct || 0),
    previousSharePct: Number(row.previous_share_pct || 0),
    deltaSharePct: round(Number(row.share_pct || 0) - Number(row.previous_share_pct || 0), 2),
    rank: Number(row.rank_in_parent || 0),
    previousRank: Number(row.previous_rank_in_parent || 0),
    periodStart: row.period_start ? toIsoDay(new Date(row.period_start)) : null,
    periodEnd: row.period_end ? toIsoDay(new Date(row.period_end)) : null,
  }));
}

function buildStructuralAlertRecord(type, snapshot, overrides = {}) {
  const evidenceClasses = dedupeEvidenceClasses(overrides.evidenceClasses || []);
  const provenance = dedupeProvenance(overrides.provenance || []);
  const signalScore = scoreStructuralAlert(type, snapshot, overrides);
  return {
    alertKey: createHash('sha1').update([
      normalizeTheme(snapshot?.theme),
      normalizePeriodType(snapshot?.periodType),
      type,
      snapshot?.periodStart || '',
      overrides.shareDeltaPct ?? '',
      overrides.attachmentKey ?? '',
    ].join('|')).digest('hex'),
    theme: normalizeTheme(snapshot?.theme),
    label: snapshot?.label || humanizeTheme(snapshot?.theme),
    parentTheme: normalizeParentTheme(overrides.parentTheme || snapshot?.parentTheme || snapshot?.theme),
    category: snapshot?.category || inferCategory(snapshot?.theme),
    periodType: normalizePeriodType(snapshot?.periodType),
    periodStart: snapshot?.periodStart || null,
    periodEnd: snapshot?.periodEnd || null,
    alertType: type,
    severity: classifyAlertSeverity(signalScore),
    status: 'active',
    headline: overrides.headline || `${snapshot?.label || humanizeTheme(snapshot?.theme)} structural change detected`,
    detail: overrides.detail || 'Structural change detected in the selected theme.',
    signalScore,
    evidenceClasses,
    provenance,
    metadata: {
      articleCount: snapshot?.articleCount || 0,
      vsYearAgoPct: snapshot?.vsYearAgoPct || 0,
      acceleration: snapshot?.acceleration || 0,
      ...overrides.metadata,
    },
    source: STRUCTURAL_ALERT_SOURCE,
  };
}

export async function generateStructuralAlertsSnapshot(safeQuery, params = new URLSearchParams()) {
  const periodType = normalizePeriodType(params.get?.('period') || params.periodType || 'week');
  const limit = normalizeLimit(params.get?.('limit') || params.limit, 12, 40);
  const themesFilter = normalizeThemeList(params.get?.('themes') || params.themes || '', 24);
  const { rows } = await loadLatestTrendSnapshot(safeQuery, periodType, 160);
  const snapshots = themesFilter.length > 0
    ? rows.filter((row) => themesFilter.includes(normalizeTheme(row.theme)))
    : rows;
  const shareShifts = await loadLatestThemeShareShifts(safeQuery, periodType, 80);
  const shareShiftMap = new Map(shareShifts.map((item) => [item.theme, item]));
  const snapshotMap = new Map(snapshots.map((item) => [normalizeTheme(item.theme), item]));
  const recentAttachments = await loadRecentThemeAttachments(
    safeQuery,
    themesFilter.length > 0 ? themesFilter : snapshots.map((row) => row.theme),
    periodType,
    Math.max(limit * 2, 24),
  );
  const alerts = [];

  for (const snapshot of snapshots) {
    if (snapshot.transition) {
      alerts.push(buildStructuralAlertRecord('lifecycle_transition', snapshot, {
        headline: `${snapshot.label} changed lifecycle stage`,
        detail: `${snapshot.label} moved from ${snapshot.transition.from} to ${snapshot.transition.to} in the current ${periodType} lens.`,
        evidenceClasses: [buildEvidenceClassRef('trend_snapshot', { count: 1 })],
        provenance: [
          buildProvenanceRef('trend_snapshot', `${snapshot.label} lifecycle transition`, {
            from: snapshot.transition.from,
            to: snapshot.transition.to,
            articleCount: snapshot.articleCount,
            vsYearAgoPct: snapshot.vsYearAgoPct,
          }),
        ],
      }));
    }

    const shareShift = shareShiftMap.get(snapshot.theme);
    if (shareShift && Math.abs(Number(shareShift.deltaSharePct || 0)) >= 3) {
      alerts.push(buildStructuralAlertRecord('share_jump', snapshot, {
        parentTheme: shareShift.parentTheme,
        shareDeltaPct: shareShift.deltaSharePct,
        headline: `${snapshot.label} is gaining share inside ${humanizeTheme(shareShift.parentTheme)}`,
        detail: `${snapshot.label} moved ${shareShift.deltaSharePct >= 0 ? 'up' : 'down'} ${Math.abs(shareShift.deltaSharePct)} share points within ${humanizeTheme(shareShift.parentTheme)}.`,
        evidenceClasses: [
          buildEvidenceClassRef('theme_evolution', { count: 1 }),
          buildEvidenceClassRef('trend_snapshot', { count: 1 }),
        ],
        provenance: [
          buildProvenanceRef('theme_evolution', `${snapshot.label} share shift`, {
            parentTheme: shareShift.parentTheme,
            sharePct: shareShift.sharePct,
            previousSharePct: shareShift.previousSharePct,
            deltaSharePct: shareShift.deltaSharePct,
          }),
        ],
        metadata: {
          sharePct: shareShift.sharePct,
          previousSharePct: shareShift.previousSharePct,
          rank: shareShift.rank,
          previousRank: shareShift.previousRank,
        },
      }));
    }

    if (Number(snapshot.sourceDiversity || 0) >= 0.55 && Number(snapshot.articleCount || 0) >= 8) {
      alerts.push(buildStructuralAlertRecord('cross_source_confirmation', snapshot, {
        headline: `${snapshot.label} is being confirmed across source classes`,
        detail: `${snapshot.label} now shows ${snapshot.articleCount} items with ${round(snapshot.sourceDiversity, 2)} source diversity, suggesting broader structural confirmation.`,
        evidenceClasses: [buildEvidenceClassRef('trend_snapshot', { count: 1 })],
        provenance: [
          buildProvenanceRef('trend_snapshot', `${snapshot.label} cross-source confirmation`, {
            articleCount: snapshot.articleCount,
            sourceDiversity: snapshot.sourceDiversity,
            geographicSpread: snapshot.geographicSpread,
          }),
        ],
      }));
    }
  }

  for (const attachment of recentAttachments) {
    const snapshot = snapshotMap.get(attachment.targetTheme) || {
      theme: attachment.targetTheme,
      label: attachment.targetThemeLabel || humanizeTheme(attachment.targetTheme),
      parentTheme: attachment.targetTheme,
      category: inferCategory(attachment.targetTheme),
      periodType,
      periodStart: null,
      periodEnd: null,
      articleCount: 0,
      vsYearAgoPct: 0,
      acceleration: 0,
      sourceDiversity: 0,
    };
    const symbols = asArray(attachment.assets).map((item) => item.symbol).filter(Boolean).slice(0, 4);
    alerts.push(buildStructuralAlertRecord('adjacent_pathway', snapshot, {
      attachmentKey: attachment.attachmentKey,
      attachmentConfidence: attachment.confidence,
      transmissionOrder: attachment.transmissionOrder,
      headline: `${snapshot.label} gained a new adjacent pathway`,
      detail: `${attachment.label || 'Adjacent pathway'} attaches as a ${attachment.transmissionOrder || 'indirect'} ${attachment.relationType || 'pathway'} route.${attachment.transmissionPath ? ` ${attachment.transmissionPath}` : ''}`,
      evidenceClasses: [buildEvidenceClassRef('codex_attachment', { count: 1 })],
      provenance: [
        buildProvenanceRef('codex_attachment', attachment.label || 'Adjacent pathway', {
          attachmentKey: attachment.attachmentKey,
          targetTheme: attachment.targetTheme,
          relationType: attachment.relationType,
          transmissionOrder: attachment.transmissionOrder,
          transmissionPath: attachment.transmissionPath,
          source: 'Codex',
          sourceType: 'analysis',
          createdAt: attachment.createdAt,
          updatedAt: attachment.createdAt,
        }),
      ],
      metadata: {
        attachmentKey: attachment.attachmentKey,
        attachmentLabel: attachment.label,
        relationType: attachment.relationType,
        transmissionOrder: attachment.transmissionOrder,
        transmissionPath: attachment.transmissionPath,
        attachmentStatus: attachment.status,
        attachmentConfidence: attachment.confidence,
        topSymbols: symbols,
      },
    }));
  }

  const deduped = Array.from(new Map(
    alerts
      .sort((left, right) => Number(right.signalScore || 0) - Number(left.signalScore || 0))
      .map((item) => [item.alertKey, item]),
  ).values()).slice(0, limit);

  await ensureStructuralAlertSchema(safeQuery);
  for (const alert of deduped) {
    await safeQuery(`
      INSERT INTO theme_structural_alerts (
        alert_key,
        theme,
        label,
        parent_theme,
        category,
        period_type,
        period_start,
        period_end,
        alert_type,
        severity,
        status,
        headline,
        detail,
        signal_score,
        evidence_classes,
        provenance,
        metadata,
        source,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10, $11, $12, $13, $14,
        $15::jsonb, $16::jsonb, $17::jsonb, $18, NOW(), NOW()
      )
      ON CONFLICT (alert_key) DO UPDATE SET
        label = EXCLUDED.label,
        parent_theme = EXCLUDED.parent_theme,
        category = EXCLUDED.category,
        period_end = EXCLUDED.period_end,
        severity = EXCLUDED.severity,
        status = EXCLUDED.status,
        headline = EXCLUDED.headline,
        detail = EXCLUDED.detail,
        signal_score = EXCLUDED.signal_score,
        evidence_classes = EXCLUDED.evidence_classes,
        provenance = EXCLUDED.provenance,
        metadata = EXCLUDED.metadata,
        source = EXCLUDED.source,
        updated_at = NOW()
    `, [
      alert.alertKey,
      alert.theme,
      alert.label,
      alert.parentTheme,
      alert.category,
      alert.periodType,
      alert.periodStart,
      alert.periodEnd,
      alert.alertType,
      alert.severity,
      alert.status,
      alert.headline,
      alert.detail,
      alert.signalScore,
      JSON.stringify(alert.evidenceClasses || []),
      JSON.stringify(alert.provenance || []),
      JSON.stringify(alert.metadata || {}),
      alert.source,
    ]);
  }

  return {
    periodType,
    generatedAt: new Date().toISOString(),
    itemCount: deduped.length,
    alerts: deduped,
  };
}

export async function buildStructuralAlertsPayload(safeQuery, params = new URLSearchParams()) {
  const periodType = normalizePeriodType(params.get('period') || 'week');
  const limit = normalizeLimit(params.get('limit'), 12, 40);
  const themes = normalizeThemeList(params.get('themes') || '', 24);
  const refresh = params.get('refresh') === '1';
  await ensureStructuralAlertSchema(safeQuery);
  if (refresh) {
    await generateStructuralAlertsSnapshot(safeQuery, params);
  }
  let query = `
    SELECT
      alert_key,
      theme,
      label,
      parent_theme,
      category,
      period_type,
      period_start,
      period_end,
      alert_type,
      severity,
      status,
      headline,
      detail,
      signal_score,
      evidence_classes,
      provenance,
      metadata,
      source,
      created_at,
      updated_at
    FROM theme_structural_alerts
    WHERE period_type = $1
      AND status = 'active'
  `;
  const values = [periodType];
  if (themes.length > 0) {
    values.push(themes);
    query += ` AND theme = ANY($${values.length})`;
  }
  values.push(limit);
  query += `
    ORDER BY signal_score DESC NULLS LAST, updated_at DESC
    LIMIT $${values.length}
  `;
  const result = await safeQuery(query, values);
  const alerts = result.rows.map((row) => ({
    alertKey: String(row.alert_key || ''),
    theme: normalizeTheme(row.theme || ''),
    label: String(row.label || humanizeTheme(row.theme || '')),
    parentTheme: normalizeParentTheme(row.parent_theme || row.theme || ''),
    category: String(row.category || inferCategory(row.theme || '')),
    periodType: String(row.period_type || periodType),
    periodStart: row.period_start ? toIsoDay(new Date(row.period_start)) : null,
    periodEnd: row.period_end ? toIsoDay(new Date(row.period_end)) : null,
    alertType: String(row.alert_type || ''),
    severity: String(row.severity || 'medium'),
    headline: String(row.headline || ''),
    detail: String(row.detail || ''),
    signalScore: Number(row.signal_score || 0),
    alertScore: Number(row.signal_score || 0),
    evidenceClasses: dedupeEvidenceClasses(row.evidence_classes || []),
    provenance: dedupeProvenance(row.provenance || []),
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    source: String(row.source || STRUCTURAL_ALERT_SOURCE),
    updatedAt: row.updated_at || null,
  }));
  return {
    periodType,
    themeFilter: themes,
    refreshed: refresh,
    itemCount: alerts.length,
    alerts,
  };
}

export async function buildDiscoveryTriagePayload(safeQuery, params = new URLSearchParams()) {
  await ensureDiscoveryTriageSchema(safeQuery);
  const limit = normalizeLimit(params.get('limit'), 12, 40);
  const promotionState = String(params.get('state') || 'watch').trim().toLowerCase();
  const category = normalizeCategory(params.get('category'));
  const result = await safeQuery(`
    SELECT
      dt.id,
      COALESCE(dt.label, dt.id) AS label,
      dt.description,
      dt.category,
      dt.stage,
      dt.keywords,
      dt.article_count,
      dt.momentum,
      dt.research_momentum,
      dt.source_quality_score,
      dt.novelty,
      dt.diversity,
      dt.cohesion,
      dt.parent_theme,
      dt.normalized_theme,
      dt.normalized_parent_theme,
      dt.normalized_category,
      dt.promotion_state,
      dt.suppression_reason,
      dt.quality_flags,
      dt.updated_at,
      review.review_state,
      review.review_note,
      review.reviewer,
      review.reviewed_at
    FROM discovery_topics dt
    LEFT JOIN LATERAL (
      SELECT
        review_state,
        review_note,
        reviewer,
        reviewed_at
      FROM discovery_topic_reviews dtr
      WHERE dtr.topic_id = dt.id
      ORDER BY reviewed_at DESC
      LIMIT 1
    ) review ON TRUE
    WHERE dt.status IN ('labeled', 'reported')
      AND ($1 = '' OR dt.promotion_state = $1)
      AND ($2 = '' OR COALESCE(dt.normalized_category, dt.category, '') = $2)
    ORDER BY
      CASE WHEN dt.promotion_state = 'watch' THEN 0 WHEN dt.promotion_state = 'canonical' THEN 1 ELSE 2 END,
      COALESCE(dt.momentum, 0) DESC NULLS LAST,
      COALESCE(dt.article_count, 0) DESC,
      dt.updated_at DESC
    LIMIT $3
  `, [promotionState === 'all' ? '' : promotionState, category, limit]);
  const topics = result.rows.map((row) => ({
    id: String(row.id || ''),
    label: String(row.label || row.id || ''),
    description: String(row.description || ''),
    category: String(row.normalized_category || row.category || ''),
    stage: String(row.stage || ''),
    keywords: asArray(row.keywords),
    articleCount: Number(row.article_count || 0),
    momentum: Number(row.momentum || 0),
    researchMomentum: Number(row.research_momentum || 0),
    sourceQualityScore: Number(row.source_quality_score || 0),
    novelty: Number(row.novelty || 0),
    diversity: Number(row.diversity || 0),
    cohesion: Number(row.cohesion || 0),
    parentTheme: String(row.parent_theme || ''),
    normalizedTheme: String(row.normalized_theme || ''),
    normalizedParentTheme: String(row.normalized_parent_theme || ''),
    promotionState: String(row.promotion_state || 'watch'),
    suppressionReason: String(row.suppression_reason || ''),
    qualityFlags: asArray(row.quality_flags),
    updatedAt: row.updated_at || null,
    lastReview: row.reviewed_at
      ? {
        reviewState: String(row.review_state || row.promotion_state || 'watch'),
        reviewNote: String(row.review_note || ''),
        reviewer: String(row.reviewer || ''),
        reviewedAt: row.reviewed_at,
      }
      : null,
  }));
  const counts = topics.reduce((acc, topic) => {
    acc[topic.promotionState] = Number(acc[topic.promotionState] || 0) + 1;
    return acc;
  }, {});
  return {
    requestedState: promotionState,
    requestedCategory: category || null,
    itemCount: topics.length,
    counts,
    topics,
  };
}

export async function recordDiscoveryTriageDecision(safeQuery, input = {}) {
  await ensureDiscoveryTriageSchema(safeQuery);
  const topicId = String(input.topicId || '').trim();
  const reviewState = String(input.reviewState || input.promotionState || '').trim().toLowerCase();
  if (!topicId) {
    throw new Error('topicId is required');
  }
  if (!['canonical', 'watch', 'suppressed'].includes(reviewState)) {
    throw new Error('reviewState must be canonical, watch, or suppressed');
  }
  const normalizedTheme = normalizeTheme(input.normalizedTheme || '');
  const normalizedParentTheme = normalizeParentTheme(input.normalizedParentTheme || input.parentTheme || normalizedTheme || '');
  const normalizedCategory = normalizeCategory(input.normalizedCategory || input.category || '');
  const suppressionReason = String(input.suppressionReason || '').trim();
  const reviewNote = String(input.reviewNote || '').trim();
  const reviewer = String(input.reviewer || 'codex').trim();
  await safeQuery(`
    INSERT INTO discovery_topic_reviews (
      review_id,
      topic_id,
      review_state,
      normalized_theme,
      normalized_parent_theme,
      normalized_category,
      suppression_reason,
      review_note,
      reviewer,
      metadata,
      reviewed_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW()
    )
  `, [
    randomUUID().replace(/-/g, ''),
    topicId,
    reviewState,
    normalizedTheme || null,
    normalizedParentTheme || null,
    normalizedCategory || null,
    suppressionReason || null,
    reviewNote || null,
    reviewer || null,
    JSON.stringify(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
  ]);
  await safeQuery(`
    UPDATE discovery_topics
    SET
      promotion_state = $2,
      normalized_theme = COALESCE(NULLIF($3, ''), normalized_theme),
      normalized_parent_theme = COALESCE(NULLIF($4, ''), normalized_parent_theme),
      normalized_category = COALESCE(NULLIF($5, ''), normalized_category),
      suppression_reason = CASE WHEN $2 = 'suppressed' THEN NULLIF($6, '') ELSE NULL END,
      updated_at = NOW()
    WHERE id = $1
  `, [
    topicId,
    reviewState,
    normalizedTheme,
    normalizedParentTheme,
    normalizedCategory,
    suppressionReason,
  ]);
  const payload = await buildDiscoveryTriagePayload(safeQuery, new URLSearchParams([
    ['state', 'all'],
    ['limit', '40'],
  ]));
  const updatedTopic = payload.topics.find((topic) => topic.id === topicId) || null;
  return {
    ok: true,
    topicId,
    reviewState,
    topic: updatedTopic,
  };
}

async function ensureFollowedThemeBriefingSnapshotSchema(safeQuery) {
  for (const statement of FOLLOWED_THEME_BRIEFING_SCHEMA_STATEMENTS) {
    await safeQuery(statement);
  }
}

async function loadSavedFollowedThemeBriefingSnapshot(safeQuery, { themes, periodType, snapshotDate }) {
  await ensureFollowedThemeBriefingSnapshotSchema(safeQuery);
  const themeSetKey = buildFollowedThemeSetKey(themes);
  const rows = await safeQuery(`
    SELECT
      snapshot_key,
      theme_set_key,
      period_type,
      snapshot_date,
      theme_count,
      themes,
      headline,
      payload,
      generated_at,
      source
    FROM followed_theme_briefing_snapshots
    WHERE theme_set_key = $1
      AND period_type = $2
      AND snapshot_date = $3::date
    ORDER BY generated_at DESC
    LIMIT 1
  `, [themeSetKey, periodType, snapshotDate]);
  const row = rows.rows?.[0];
  if (!row) return null;
  return {
    snapshotKey: String(row.snapshot_key || ''),
    themeSetKey: String(row.theme_set_key || ''),
    periodType: String(row.period_type || periodType),
    snapshotDate: toIsoDay(row.snapshot_date) || snapshotDate,
    themeCount: Number(row.theme_count || 0),
    themes: normalizeThemeList(row.themes || themes, 24),
    headline: String(row.headline || ''),
    payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
    generatedAt: row.generated_at || null,
    source: String(row.source || FOLLOWED_THEME_BRIEFING_SOURCE),
  };
}

async function persistFollowedThemeBriefingSnapshot(safeQuery, { themes, periodType, snapshotDate, payload }) {
  await ensureFollowedThemeBriefingSnapshotSchema(safeQuery);
  const themeSetKey = buildFollowedThemeSetKey(themes);
  const snapshotKey = [themeSetKey, periodType, snapshotDate].join('::');
  const result = await safeQuery(`
    INSERT INTO followed_theme_briefing_snapshots (
      snapshot_key, theme_set_key, period_type, snapshot_date, theme_count, themes, headline, payload, generated_at, source
    )
    VALUES (
      $1, $2, $3, $4::date, $5, $6::jsonb, $7, $8::jsonb, NOW(), $9
    )
    ON CONFLICT (snapshot_key) DO UPDATE SET
      theme_count = EXCLUDED.theme_count,
      themes = EXCLUDED.themes,
      headline = EXCLUDED.headline,
      payload = EXCLUDED.payload,
      generated_at = NOW(),
      source = EXCLUDED.source
  `, [
    snapshotKey,
    themeSetKey,
    periodType,
    snapshotDate,
    Number(payload?.themeCount || payload?.itemCount || asArray(payload?.items).length || 0),
    JSON.stringify(normalizeThemeList(themes, 24)),
    String(payload?.headline || ''),
    JSON.stringify(payload || {}),
    FOLLOWED_THEME_BRIEFING_SOURCE,
  ]);
  const persisted = Boolean(result && (Number(result.rowCount || 0) > 0 || String(result.command || '').length > 0));
  return {
    snapshotKey,
    themeSetKey,
    snapshotDate,
    generatedAt: new Date().toISOString(),
    source: FOLLOWED_THEME_BRIEFING_SOURCE,
    persisted,
  };
}

async function buildFollowedThemeBriefingBasePayload(safeQuery, { themes, periodType, limit, params }) {
  const briefParams = new URLSearchParams([
    ['period', periodType],
    ['digest_limit', params.get('digest_limit') || '2'],
    ['article_limit', params.get('article_limit') || '4'],
    ['evolution_limit', params.get('evolution_limit') || '6'],
  ]);

  const briefs = await Promise.all(
    themes.map((theme) => buildThemeBriefPayload(theme, safeQuery, briefParams)),
  );

  const items = briefs
    .map((payload) => {
      const primaryChange = asArray(payload?.sections?.whatChanged)[0] || null;
      const watchpoint = asArray(payload?.sections?.watchpoints)[0] || null;
      const adjacentPathways = asArray(payload?.sections?.adjacentPathways?.items).slice(0, 2);
      const adjacentPrimary = adjacentPathways[0] || null;
      const adjacentHeadline = adjacentPrimary
        ? `${adjacentPrimary.label || 'Adjacent pathway'} is now attached to ${payload.label}`
        : null;
      const adjacentDetail = adjacentPrimary
        ? adjacentPrimary.transmissionPath || adjacentPrimary.thesis || adjacentPrimary.reason || ''
        : '';
      return {
        theme: payload.theme,
        label: payload.label,
        category: payload.category,
        categoryLabel: payload.categoryLabel,
        parentTheme: payload.parentTheme,
        summary: payload.summary,
        headline: primaryChange?.title || adjacentHeadline || payload?.sections?.whyItMatters?.summary || `${payload.label} remains on the weekly watchlist.`,
        detail: primaryChange?.detail || adjacentDetail || payload?.sections?.whyItMatters?.summary || '',
        whyItMatters: payload?.sections?.whyItMatters?.summary || '',
        topChange: primaryChange,
        adjacentPathways,
        adjacentSummary: payload?.sections?.adjacentPathways?.summary || null,
        watchpoint: watchpoint
          ? [watchpoint.horizon, watchpoint.trigger, watchpoint.implication].filter(Boolean).join(' | ')
          : '',
        watchpoints: asArray(payload?.sections?.watchpoints).slice(0, 2),
        risks: asArray(payload?.sections?.risks).slice(0, 2),
        whatChanged: asArray(payload?.sections?.whatChanged).slice(0, 3),
        deltaSinceLastVisit: null,
        evidenceClasses: dedupeEvidenceClasses(payload?.evidenceLedger?.evidenceClasses || []),
        provenance: dedupeProvenance(payload?.evidenceLedger?.provenance || []),
        lastEvidenceAt: deriveBriefingFreshness(payload),
        score: deriveBriefingScore(payload),
      };
    })
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
    .slice(0, limit);

  return {
    periodType,
    generatedAt: new Date().toISOString(),
    themeCount: items.length,
    themes,
    headline: `Weekly structural briefing for ${items.length} followed theme${items.length === 1 ? '' : 's'}.`,
    items,
  };
}

async function overlayFollowedThemeBriefingDeltas(payload, safeQuery, params = new URLSearchParams()) {
  const items = asArray(payload?.items);
  if (!items.length) return payload;

  const deltaThemes = items
    .map((item) => normalizeTheme(item.theme))
    .filter((theme) => String(params.get(`since_${theme}`) || '').trim());
  if (!deltaThemes.length) return payload;

  const periodType = normalizePeriodType(payload.periodType || params.get('period') || 'week');
  const deltaMap = new Map();
  const deltaPayloads = await Promise.all(deltaThemes.map(async (theme) => {
    const since = String(params.get(`since_${theme}`) || '').trim();
    const briefParams = new URLSearchParams([
      ['period', periodType],
      ['digest_limit', params.get('digest_limit') || '2'],
      ['article_limit', params.get('article_limit') || '4'],
      ['evolution_limit', params.get('evolution_limit') || '6'],
      ['since', since],
    ]);
    const brief = await buildThemeBriefPayload(theme, safeQuery, briefParams);
    return { theme, delta: brief.deltaSinceLastVisit || null };
  }));
  deltaPayloads.forEach((entry) => deltaMap.set(entry.theme, entry.delta));

  return {
    ...payload,
    items: items.map((item) => ({
      ...item,
      deltaSinceLastVisit: deltaMap.get(normalizeTheme(item.theme)) || item.deltaSinceLastVisit || null,
    })),
  };
}

export async function buildFollowedThemeBriefingPayload(safeQuery, params = new URLSearchParams()) {
  const requestedThemes = String(params.get('themes') || '')
    .split(',')
    .map((value) => normalizeTheme(value))
    .filter((value) => isCanonicalThemeKey(value));
  const themes = Array.from(new Set(requestedThemes));
  const periodType = normalizePeriodType(params.get('period') || 'week');
  const limit = normalizeLimit(params.get('limit'), 5, 12);
  const snapshotDate = String(params.get('snapshot_date') || buildFollowedThemeBriefingSnapshotDate(periodType)).trim();
  const forceRefresh = params.get('refresh') === '1';
  const persistSnapshots = params.get('persist') !== '0';

  if (themes.length === 0) {
    return {
      periodType,
      itemCount: 0,
      items: [],
      snapshot: {
        persisted: false,
        snapshotDate,
        source: FOLLOWED_THEME_BRIEFING_SOURCE,
      },
    };
  }

  let snapshotMeta = {
    persisted: false,
    snapshotDate,
    source: FOLLOWED_THEME_BRIEFING_SOURCE,
  };
  let payload = null;

  if (!forceRefresh) {
    const saved = await loadSavedFollowedThemeBriefingSnapshot(safeQuery, { themes, periodType, snapshotDate });
    if (saved?.payload?.items?.length) {
      const hasAdjacentSchema = asArray(saved.payload.items).every((item) => Object.prototype.hasOwnProperty.call(item || {}, 'adjacentPathways'));
      if (hasAdjacentSchema) {
        payload = {
          ...saved.payload,
          periodType,
          themes,
          generatedAt: saved.generatedAt || saved.payload.generatedAt || null,
        };
        snapshotMeta = {
          persisted: true,
          snapshotKey: saved.snapshotKey,
          snapshotDate: saved.snapshotDate,
          generatedAt: saved.generatedAt,
          source: saved.source,
        };
      }
    }
  }

  if (!payload) {
    payload = await buildFollowedThemeBriefingBasePayload(safeQuery, { themes, periodType, limit, params });
    if (persistSnapshots) {
      snapshotMeta = await persistFollowedThemeBriefingSnapshot(safeQuery, {
        themes,
        periodType,
        snapshotDate,
        payload,
      });
    }
  }

  const withDeltas = await overlayFollowedThemeBriefingDeltas(payload, safeQuery, params);
  return {
    ...withDeltas,
    snapshot: snapshotMeta,
  };
}

function formatMarkdownList(items = []) {
  const normalized = asArray(items).filter(Boolean);
  if (!normalized.length) return '- None';
  return normalized.map((item) => {
    if (typeof item === 'string') return `- ${item}`;
    return `- ${item.detail || item.title || item.summary || item.label || ''}`.trim();
  }).filter(Boolean).join('\n');
}

function fmtSignedPercent(value) {
  const normalized = normalizePercent(value);
  if (!Number.isFinite(normalized)) return '--';
  return `${normalized >= 0 ? '+' : ''}${round(normalized, 1)}%`;
}

function formatThemeBriefMarkdown(payload) {
  const sections = payload?.sections || {};
  const relatedEntities = asArray(sections.relatedEntities?.entities)
    .slice(0, 6)
    .map((item) => `${item.companyName || item.entityKey || item.ticker || 'Entity'} (${item.relationType || 'related'}; confidence ${item.confidence ?? '--'})`);
  const adjacentPathways = asArray(sections.adjacentPathways?.items)
    .slice(0, 6)
    .map((item) => {
      const topSymbols = asArray(item.assets).slice(0, 4).map((asset) => asset.symbol).filter(Boolean).join(', ');
      return `${item.label || 'Adjacent pathway'} (${item.relationType || 'related'}; ${item.transmissionOrder || 'indirect'}${topSymbols ? `; symbols ${topSymbols}` : ''})${item.transmissionPath ? ` - ${item.transmissionPath}` : ''}`;
    });
  const evidenceRefs = asArray(payload?.evidenceLedger?.provenance)
    .slice(0, 8)
    .map((item) => `${item.label || item.detail || item.type || 'reference'} [${item.evidenceClass || item.sourceType || 'derived'}]`);
  return [
    `# ${payload?.label || humanizeTheme(payload?.theme || 'Theme')} Theme Brief`,
    '',
    `- Theme: ${payload?.theme || 'unknown'}`,
    `- Period: ${payload?.periodType || DEFAULT_PERIOD}`,
    `- Category: ${payload?.categoryLabel || payload?.category || 'unknown'}`,
    `- Parent theme: ${payload?.parentTheme || 'unknown'}`,
    payload?.summary ? `- Lifecycle: ${payload.summary.lifecycleStage || 'n/a'} | YoY ${fmtSignedPercent(payload.summary.vsYearAgoPct)} | Acceleration ${fmtSignedPercent(payload.summary.acceleration)}` : null,
    '',
    '## What Changed',
    formatMarkdownList(sections.whatChanged),
    '',
    '## Why It Matters',
    formatMarkdownList([sections.whyItMatters?.summary, ...asArray(sections.whyItMatters?.statements).slice(1)]),
    '',
    '## Evidence',
    formatMarkdownList(evidenceRefs),
    '',
    '## Subtopic Movement',
    formatMarkdownList([
      sections.subtopicMovement?.selectedTheme
        ? `${sections.subtopicMovement.selectedTheme.label || sections.subtopicMovement.selectedTheme.theme}: share ${sections.subtopicMovement.selectedTheme.lastSharePct ?? '--'}%, delta ${sections.subtopicMovement.selectedTheme.deltaSharePct ?? '--'}%`
        : null,
      ...asArray(sections.subtopicMovement?.peerThemes).slice(0, 5).map((item) => `${item.label || item.theme}: share ${item.lastSharePct ?? '--'}%, delta ${item.deltaSharePct ?? '--'}%`),
    ]),
    '',
    '## Related Entities',
    formatMarkdownList(relatedEntities),
    '',
    '## Adjacent Pathways',
    formatMarkdownList(adjacentPathways),
    '',
    '## Risks',
    formatMarkdownList(sections.risks),
    '',
    '## Watch Next',
    formatMarkdownList(sections.watchpoints),
    '',
    '## Notebook',
    sections.notebookHooks?.noteMarkdown ? sections.notebookHooks.noteMarkdown : '- No saved analyst notes.',
  ].filter(Boolean).join('\n');
}

export async function buildThemeBriefExportPayload(themeParam, safeQuery, params = new URLSearchParams()) {
  const theme = normalizeTheme(themeParam);
  const periodType = normalizePeriodType(params.get('period') || DEFAULT_PERIOD);
  const format = String(params.get('format') || 'markdown').trim().toLowerCase();
  const payload = await buildThemeBriefPayload(theme, safeQuery, params);
  const notebook = await recordThemeNotebookExport(safeQuery, theme, periodType);
  if (format === 'json') {
    return {
      theme,
      periodType,
      format,
      filename: `${theme || 'theme'}-${periodType}-theme-brief.json`,
      contentType: 'application/json; charset=utf-8',
      content: JSON.stringify({
        exportedAt: new Date().toISOString(),
        brief: payload,
        notebook,
      }, null, 2),
      notebook,
    };
  }
  return {
    theme,
    periodType,
    format: 'markdown',
    filename: `${theme || 'theme'}-${periodType}-theme-brief.md`,
    contentType: 'text/markdown; charset=utf-8',
    content: formatThemeBriefMarkdown({
      ...payload,
      sections: {
        ...payload.sections,
        notebookHooks: {
          ...payload.sections?.notebookHooks,
          noteMarkdown: notebook.noteMarkdown,
        },
      },
      notebookState: notebook,
    }),
    notebook,
  };
}

export async function buildSharedThemeBriefPayload(shareToken, safeQuery, params = new URLSearchParams()) {
  const notebook = await loadSharedThemeNotebookEntry(safeQuery, shareToken);
  if (!notebook?.theme) return null;
  const periodType = normalizePeriodType(params.get('period') || notebook.periodType || DEFAULT_PERIOD);
  const brief = await buildThemeBriefPayload(notebook.theme, safeQuery, new URLSearchParams([
    ['period', periodType],
  ]));
  return {
    shareToken: notebook.shareToken,
    sharedAt: notebook.sharedAt,
    notebook,
    brief: {
      ...brief,
      sections: {
        ...brief.sections,
        notebookHooks: {
          ...brief.sections?.notebookHooks,
          noteMarkdown: notebook.noteMarkdown,
          pinned: notebook.pinned,
          savedTags: notebook.tags,
          shareToken: notebook.shareToken,
          shareUrl: notebook.shareUrl,
        },
      },
      notebookState: notebook,
    },
  };
}
