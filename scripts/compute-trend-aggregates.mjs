#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { ensureAutoPipelineTables } from './auto-pipeline.mjs';
import { ensureEmergingTechSchema } from './_shared/schema-emerging-tech.mjs';
import { ensureArticleAnalysisTables } from './_shared/article-analysis-schema.mjs';
import { createWhereBuilder } from './_shared/query-builder.mjs';
import { buildLifecycleTransition, classifyLifecycle } from './_shared/lifecycle-classifier.mjs';
import {
  classifyArticleAgainstTaxonomy,
  getCanonicalParentTheme,
  isCanonicalThemeKey,
  resolveThemeTaxonomy,
} from './_shared/theme-taxonomy.mjs';

loadOptionalEnvFile();

const { Client } = pg;

const PERIOD_CONFIG = {
  week: { history: 16, annualizationFactor: 365 / 7 },
  month: { history: 18, annualizationFactor: 12 },
  quarter: { history: 12, annualizationFactor: 4 },
  year: { history: 6, annualizationFactor: 1 },
};

export const TREND_AGGREGATION_SCHEMA_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS auto_article_themes (
      article_id INTEGER PRIMARY KEY REFERENCES articles(id),
      auto_theme TEXT,
      confidence DOUBLE PRECISION DEFAULT 0,
      method TEXT DEFAULT 'embedding-cluster',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `,
  `
    ALTER TABLE auto_article_themes
      ADD COLUMN IF NOT EXISTS source_theme TEXT;
  `,
  `
    ALTER TABLE auto_article_themes
      ADD COLUMN IF NOT EXISTS confidence_tier TEXT;
  `,
  `
    ALTER TABLE auto_article_themes
      ADD COLUMN IF NOT EXISTS theme_key TEXT;
  `,
  `
    ALTER TABLE auto_article_themes
      ADD COLUMN IF NOT EXISTS theme_label TEXT;
  `,
  `
    ALTER TABLE auto_article_themes
      ADD COLUMN IF NOT EXISTS theme_type TEXT;
  `,
  `
    ALTER TABLE auto_article_themes
      ADD COLUMN IF NOT EXISTS parent_theme TEXT;
  `,
  `
    ALTER TABLE auto_article_themes
      ADD COLUMN IF NOT EXISTS parent_theme_label TEXT;
  `,
  `
    ALTER TABLE auto_article_themes
      ADD COLUMN IF NOT EXISTS theme_category TEXT;
  `,
  `
    ALTER TABLE auto_article_themes
      ADD COLUMN IF NOT EXISTS lifecycle_hint TEXT;
  `,
  `
    ALTER TABLE auto_article_themes
      ADD COLUMN IF NOT EXISTS taxonomy_version TEXT;
  `,
  `
    CREATE TABLE IF NOT EXISTS theme_trend_aggregates (
      theme TEXT NOT NULL,
      theme_label TEXT,
      parent_theme TEXT,
      category TEXT,
      period_type TEXT NOT NULL
        CHECK (period_type IN ('week', 'month', 'quarter', 'year')),
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      article_count INTEGER NOT NULL DEFAULT 0,
      run_rate_article_count DOUBLE PRECISION NOT NULL DEFAULT 0,
      annualized_article_count DOUBLE PRECISION NOT NULL DEFAULT 0,
      period_progress_ratio DOUBLE PRECISION NOT NULL DEFAULT 1,
      theme_share_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
      unique_sources INTEGER NOT NULL DEFAULT 0,
      unique_keywords INTEGER NOT NULL DEFAULT 0,
      geographic_spread INTEGER NOT NULL DEFAULT 0,
      source_diversity DOUBLE PRECISION NOT NULL DEFAULT 0,
      recurrence_ratio DOUBLE PRECISION NOT NULL DEFAULT 0,
      mean_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
      novelty_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      vs_previous_period_pct DOUBLE PRECISION,
      vs_year_ago_pct DOUBLE PRECISION,
      vs_3year_ago_pct DOUBLE PRECISION,
      trend_acceleration DOUBLE PRECISION,
      lifecycle_stage TEXT,
      lifecycle_confidence DOUBLE PRECISION,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (theme, period_type, period_start)
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_theme_trend_aggregates_period_end
      ON theme_trend_aggregates (period_type, period_end DESC);
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_theme_trend_aggregates_theme_period
      ON theme_trend_aggregates (theme, period_type, period_start DESC);
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_theme_trend_aggregates_lifecycle
      ON theme_trend_aggregates (lifecycle_stage, period_type, period_end DESC);
  `,
  `
    ALTER TABLE theme_trend_aggregates
      ADD COLUMN IF NOT EXISTS theme_label TEXT;
  `,
  `
    ALTER TABLE theme_trend_aggregates
      ADD COLUMN IF NOT EXISTS parent_theme TEXT;
  `,
  `
    ALTER TABLE theme_trend_aggregates
      ADD COLUMN IF NOT EXISTS category TEXT;
  `,
  `
    CREATE TABLE IF NOT EXISTS theme_lifecycle_transitions (
      theme TEXT NOT NULL,
      period_type TEXT NOT NULL
        CHECK (period_type IN ('week', 'month', 'quarter', 'year')),
      transitioned_at DATE NOT NULL,
      from_stage TEXT NOT NULL,
      to_stage TEXT NOT NULL,
      direction TEXT NOT NULL,
      distance INTEGER NOT NULL DEFAULT 0,
      annualized_article_count DOUBLE PRECISION NOT NULL DEFAULT 0,
      vs_previous_period_pct DOUBLE PRECISION,
      vs_year_ago_pct DOUBLE PRECISION,
      trend_acceleration DOUBLE PRECISION,
      confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (theme, period_type, transitioned_at)
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_theme_lifecycle_transitions_theme_period
      ON theme_lifecycle_transitions (theme, period_type, transitioned_at DESC);
  `,
  `
    CREATE TABLE IF NOT EXISTS theme_evolution (
      parent_theme TEXT NOT NULL,
      sub_theme TEXT NOT NULL,
      theme_label TEXT,
      category TEXT,
      period_type TEXT NOT NULL
        CHECK (period_type IN ('week', 'month', 'quarter', 'year')),
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      article_count INTEGER NOT NULL DEFAULT 0,
      share_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
      rank_in_parent INTEGER,
      acceleration DOUBLE PRECISION,
      lifecycle_stage TEXT,
      momentum_score DOUBLE PRECISION,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (parent_theme, sub_theme, period_type, period_start)
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_theme_evolution_parent_period
      ON theme_evolution (parent_theme, period_type, period_start DESC);
  `,
];

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, asNumber(value, minimum)));
}

function toDateOnly(value) {
  const normalized = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  const date = new Date(normalized || Date.now());
  return Number.isNaN(date.valueOf())
    ? new Date().toISOString().slice(0, 10)
    : date.toISOString().slice(0, 10);
}

function parseDateUtc(dateText) {
  const [year, month, day] = toDateOnly(dateText).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateUtc(date) {
  return new Date(date.getTime()).toISOString().slice(0, 10);
}

function addDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + Number(days || 0));
  return copy;
}

function addMonths(date, months) {
  const copy = new Date(date.getTime());
  copy.setUTCMonth(copy.getUTCMonth() + Number(months || 0), 1);
  return copy;
}

function addYears(date, years) {
  const copy = new Date(date.getTime());
  copy.setUTCFullYear(copy.getUTCFullYear() + Number(years || 0), 1);
  return copy;
}

function startOfPeriod(dateInput, periodType) {
  const date = new Date(dateInput.getTime());
  if (periodType === 'week') {
    const weekday = date.getUTCDay();
    const delta = weekday === 0 ? -6 : 1 - weekday;
    return addDays(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())), delta);
  }
  if (periodType === 'month') {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }
  if (periodType === 'quarter') {
    const quarterMonth = Math.floor(date.getUTCMonth() / 3) * 3;
    return new Date(Date.UTC(date.getUTCFullYear(), quarterMonth, 1));
  }
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
}

function endOfPeriod(startDate, periodType) {
  if (periodType === 'week') return addDays(startDate, 6);
  if (periodType === 'month') return addDays(addMonths(startDate, 1), -1);
  if (periodType === 'quarter') return addDays(addMonths(startDate, 3), -1);
  return addDays(addYears(startDate, 1), -1);
}

function subtractPeriods(dateInput, periodType, count) {
  const countValue = Number(count || 0);
  if (countValue === 0) return new Date(dateInput.getTime());
  if (periodType === 'week') return addDays(dateInput, -7 * countValue);
  if (periodType === 'month') return addMonths(dateInput, -countValue);
  if (periodType === 'quarter') return addMonths(dateInput, -(countValue * 3));
  return addYears(dateInput, -countValue);
}

function daysBetweenInclusive(startDate, endDate) {
  return Math.max(0, Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1);
}

function uniqueLowerText(values = []) {
  const set = new Set();
  for (const value of values) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized) set.add(normalized);
  }
  return Array.from(set);
}

function normalizeCountries(value) {
  if (Array.isArray(value)) {
    return uniqueLowerText(value);
  }
  if (value && typeof value === 'object') {
    return uniqueLowerText(value.values || value.items || []);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return normalizeCountries(parsed);
    } catch {
      return uniqueLowerText(value.split(','));
    }
  }
  return [];
}

function computeSourceDiversity(sourceCounts) {
  const counts = Array.from(sourceCounts.values()).map((value) => asNumber(value, 0)).filter((value) => value > 0);
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (counts.length <= 1 || total <= 0) return 0;
  const hhi = counts.reduce((sum, value) => {
    const share = value / total;
    return sum + (share * share);
  }, 0);
  const normalized = (1 - hhi) / (1 - (1 / counts.length));
  return Number(clamp(normalized, 0, 1).toFixed(4));
}

function percentageChange(current, previous) {
  const currentValue = asNumber(current, 0);
  const previousValue = asNumber(previous, 0);
  if (previousValue <= 0) {
    if (currentValue <= 0) return 0;
    return 100;
  }
  return Number((((currentValue - previousValue) / previousValue) * 100).toFixed(4));
}

function buildKeywordStats(rows) {
  const counts = new Map();
  for (const row of rows) {
    for (const keyword of row.keywords || []) {
      counts.set(keyword, (counts.get(keyword) || 0) + 1);
    }
  }
  return counts;
}

function topEntries(map, limit = 10) {
  return Array.from(map.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([key, value]) => ({ key, value }));
}

function buildRowsInWindow(rows, startDate, endDate) {
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();
  return rows.filter((row) => row.publishedAtMs >= startMs && row.publishedAtMs <= endMs);
}

function createComparableWindow(baseWindow, periodType, mode) {
  const naturalStart = mode === 'prev'
    ? subtractPeriods(baseWindow.naturalStart, periodType, 1)
    : addYears(baseWindow.naturalStart, mode === 'yearAgo' ? -1 : -3);
  const naturalEnd = endOfPeriod(naturalStart, periodType);
  const effectiveEnd = addDays(naturalStart, baseWindow.effectiveDays - 1);
  return {
    naturalStart,
    naturalEnd,
    effectiveEnd: effectiveEnd > naturalEnd ? naturalEnd : effectiveEnd,
    effectiveDays: baseWindow.effectiveDays,
  };
}

function buildPeriodWindows(asOfDate, periodType, historyCount) {
  const windows = [];
  const asOfPeriodStart = startOfPeriod(asOfDate, periodType);
  for (let offset = historyCount - 1; offset >= 0; offset -= 1) {
    const naturalStart = startOfPeriod(subtractPeriods(asOfPeriodStart, periodType, offset), periodType);
    const naturalEnd = endOfPeriod(naturalStart, periodType);
    const effectiveEnd = offset === 0 && asOfDate < naturalEnd ? asOfDate : naturalEnd;
    const effectiveDays = daysBetweenInclusive(naturalStart, effectiveEnd);
    windows.push({
      periodType,
      naturalStart,
      naturalEnd,
      effectiveEnd,
      effectiveDays,
      naturalDays: daysBetweenInclusive(naturalStart, naturalEnd),
      coverageRatio: clamp(effectiveDays / Math.max(1, daysBetweenInclusive(naturalStart, naturalEnd)), 0, 1),
    });
  }
  return windows;
}

function earliestRequiredDate(asOfDate, periodTypes, historyConfig) {
  let earliest = asOfDate;
  for (const periodType of periodTypes) {
    const historyCount = historyConfig[periodType] || PERIOD_CONFIG[periodType].history;
    const oldestWindowStart = startOfPeriod(
      subtractPeriods(startOfPeriod(asOfDate, periodType), periodType, historyCount - 1),
      periodType,
    );
    const comparisonStart = addYears(oldestWindowStart, -3);
    if (comparisonStart < earliest) earliest = comparisonStart;
  }
  return earliest;
}

function normalizeKeywords(value) {
  if (Array.isArray(value)) return uniqueLowerText(value);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return normalizeKeywords(parsed);
    } catch {
      return uniqueLowerText(value.split(','));
    }
  }
  return [];
}

function looksLikeDiscoveryTopic(value) {
  return /^dt-[a-z0-9]+$/i.test(String(value || '').trim());
}

export async function ensureTrendAggregationSchema(queryable) {
  for (const statement of TREND_AGGREGATION_SCHEMA_STATEMENTS) {
    try {
      await queryable.query(statement);
    } catch (error) {
      const message = String(error?.message || error || '');
      if (message.includes('pg_type_typname_nsp_index') || message.includes('already exists')) {
        continue;
      }
      throw error;
    }
  }
}

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    asOf: new Date().toISOString().slice(0, 10),
    periodTypes: Object.keys(PERIOD_CONFIG),
    themes: [],
    historyByPeriod: Object.fromEntries(
      Object.entries(PERIOD_CONFIG).map(([periodType, config]) => [periodType, config.history]),
    ),
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--as-of' && argv[index + 1]) {
      parsed.asOf = toDateOnly(argv[++index]);
    } else if (arg === '--period' && argv[index + 1]) {
      parsed.periodTypes = argv[++index]
        .split(',')
        .map((value) => String(value || '').trim().toLowerCase())
        .filter((value) => Object.prototype.hasOwnProperty.call(PERIOD_CONFIG, value));
    } else if (arg === '--theme' && argv[index + 1]) {
      parsed.themes = argv[++index]
        .split(',')
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean);
    } else if (arg === '--history-week' && argv[index + 1]) {
      parsed.historyByPeriod.week = Math.max(1, Math.floor(asNumber(argv[++index], PERIOD_CONFIG.week.history)));
    } else if (arg === '--history-month' && argv[index + 1]) {
      parsed.historyByPeriod.month = Math.max(1, Math.floor(asNumber(argv[++index], PERIOD_CONFIG.month.history)));
    } else if (arg === '--history-quarter' && argv[index + 1]) {
      parsed.historyByPeriod.quarter = Math.max(1, Math.floor(asNumber(argv[++index], PERIOD_CONFIG.quarter.history)));
    } else if (arg === '--history-year' && argv[index + 1]) {
      parsed.historyByPeriod.year = Math.max(1, Math.floor(asNumber(argv[++index], PERIOD_CONFIG.year.history)));
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    }
  }

  if (parsed.periodTypes.length === 0) {
    parsed.periodTypes = Object.keys(PERIOD_CONFIG);
  }

  return parsed;
}

async function loadArticleCorpus(client, options) {
  const asOfDate = parseDateUtc(options.asOf);
  const earliestDate = earliestRequiredDate(asOfDate, options.periodTypes, options.historyByPeriod);
  const where = createWhereBuilder([
    `a.published_at >= $1::date`,
    `COALESCE(NULLIF(t.theme_key, ''), NULLIF(t.auto_theme, 'unknown'), NULLIF(dp.parent_theme, ''), NULLIF(a.theme, ''), 'unknown') <> 'unknown'`,
  ], [formatDateUtc(earliestDate)]);
  if (options.themes.length > 0) {
    where.addValue(
      options.themes,
      (placeholder) =>
        `COALESCE(NULLIF(t.theme_key, ''), NULLIF(t.auto_theme, 'unknown'), NULLIF(dp.parent_theme, ''), NULLIF(a.theme, ''), 'unknown') = ANY(${placeholder}::text[])`,
    );
  }
  const { whereClause, params } = where.build();

  const { rows } = await client.query(`
    WITH discovery_parent AS (
      SELECT
        dta.article_id,
        (
          ARRAY_AGG(
            NULLIF(dt.parent_theme, '')
            ORDER BY dt.updated_at DESC NULLS LAST, dt.momentum DESC NULLS LAST
          ) FILTER (WHERE NULLIF(dt.parent_theme, '') IS NOT NULL)
        )[1] AS parent_theme
        ,
        (
          ARRAY_AGG(
            COALESCE(NULLIF(dt.label, ''), dt.id)
            ORDER BY dt.updated_at DESC NULLS LAST, dt.momentum DESC NULLS LAST
          )
        )[1] AS topic_label,
        (
          ARRAY_AGG(
            NULLIF(dt.category, '')
            ORDER BY dt.updated_at DESC NULLS LAST, dt.momentum DESC NULLS LAST
          ) FILTER (WHERE NULLIF(dt.category, '') IS NOT NULL)
        )[1] AS topic_category
      FROM discovery_topic_articles dta
      JOIN discovery_topics dt ON dt.id = dta.topic_id
      GROUP BY dta.article_id
    )
    SELECT
      a.id,
      a.title,
      LOWER(COALESCE(a.source, 'unknown')) AS source,
      a.published_at::date AS published_date,
      COALESCE(NULLIF(t.theme_key, ''), NULLIF(t.auto_theme, 'unknown'), NULLIF(dp.parent_theme, ''), NULLIF(a.theme, ''), 'unknown') AS theme,
      COALESCE(NULLIF(dp.topic_label, ''), NULLIF(a.theme, '')) AS topic_label,
      COALESCE(NULLIF(t.theme_label, ''), NULLIF(t.theme_key, ''), NULLIF(t.auto_theme, ''), NULLIF(a.theme, ''), NULLIF(dp.parent_theme, ''), 'unknown') AS theme_label,
      COALESCE(NULLIF(t.parent_theme, ''), NULLIF(dp.parent_theme, ''), COALESCE(NULLIF(t.theme_key, ''), NULLIF(t.auto_theme, 'unknown'), NULLIF(a.theme, ''), 'unknown')) AS parent_theme,
      COALESCE(NULLIF(t.theme_category, ''), NULLIF(dp.topic_category, ''), 'other') AS theme_category,
      COALESCE(t.confidence, 0) AS theme_confidence,
      COALESCE(aa.keywords, ARRAY[]::text[]) AS keywords,
      COALESCE(aa.entities->'countries', '[]'::jsonb) AS countries
    FROM articles a
    LEFT JOIN auto_article_themes t ON t.article_id = a.id
    LEFT JOIN discovery_parent dp ON dp.article_id = a.id
    LEFT JOIN article_analysis aa ON aa.article_id = a.id
    ${whereClause}
    ORDER BY a.published_at ASC, a.id ASC
  `, params);

  return {
    earliestLoadedDate: formatDateUtc(earliestDate),
    rows: rows.map((row) => {
      const publishedDate = toDateOnly(row.published_date);
      const taxonomyFallback = resolveThemeTaxonomy(
        looksLikeDiscoveryTopic(row.theme)
          ? (row.topic_label || row.theme)
          : row.theme,
      );
      const dynamicClassification = (looksLikeDiscoveryTopic(row.theme) || String(row.theme_category || '').trim().toLowerCase() === 'other')
        ? classifyArticleAgainstTaxonomy({
          title: row.title,
          source: row.source,
          keywords: normalizeKeywords(row.keywords),
          embeddingTheme: row.topic_label || row.theme,
          embeddingSimilarity: row.theme_confidence,
        })
        : null;
      const resolvedTheme = dynamicClassification?.theme && dynamicClassification.theme !== 'unknown'
        ? dynamicClassification.theme
        : (looksLikeDiscoveryTopic(row.theme) && taxonomyFallback.themeKey
          ? taxonomyFallback.themeKey
          : String(row.theme || 'unknown').trim().toLowerCase());
      const resolvedMeta = resolveThemeTaxonomy(resolvedTheme);
      if (!resolvedMeta.themeKey || !isCanonicalThemeKey(resolvedMeta.themeKey)) {
        return null;
      }
      return {
        id: Number(row.id),
        source: String(row.source || 'unknown').trim().toLowerCase() || 'unknown',
        theme: resolvedMeta.themeKey,
        themeLabel: String(row.theme_label || resolvedMeta.themeLabel || taxonomyFallback.themeLabel || resolvedMeta.themeKey).trim(),
        parentTheme: String(
          getCanonicalParentTheme(row.parent_theme)
            || resolvedMeta.parentTheme
            || taxonomyFallback.parentTheme
            || resolvedMeta.themeKey,
        ).trim().toLowerCase(),
        themeCategory: String(
          resolvedMeta.category
            || row.theme_category
            || taxonomyFallback.category
            || 'other',
        ).trim().toLowerCase(),
        themeConfidence: clamp(row.theme_confidence, 0, 1),
        keywords: normalizeKeywords(row.keywords),
        countries: normalizeCountries(row.countries),
        publishedDate,
        publishedAtMs: parseDateUtc(publishedDate).getTime(),
      };
    }).filter(Boolean),
  };
}

function computeAggregateRecord({
  theme,
  periodType,
  window,
  themeRows,
  allRows,
  previousRows,
  previousPreviousRows,
  yearAgoRows,
  threeYearAgoRows,
}) {
  const representative = themeRows[0] || allRows.find((row) => row.theme === theme) || null;
  const taxonomy = resolveThemeTaxonomy(theme);
  const themeLabel = representative?.themeLabel || taxonomy.themeLabel || theme;
  const parentTheme = representative?.parentTheme || taxonomy.parentTheme || theme;
  const category = representative?.themeCategory || taxonomy.category || 'other';
  const articleCount = themeRows.length;
  const effectiveDays = Math.max(1, window.effectiveDays);
  const coverageRatio = clamp(window.coverageRatio, 0.0001, 1);
  const runRateArticleCount = articleCount / coverageRatio;
  const annualizedArticleCount = runRateArticleCount * PERIOD_CONFIG[periodType].annualizationFactor;
  const uniqueSources = new Set(themeRows.map((row) => row.source));
  const uniquePublicationDays = new Set(themeRows.map((row) => row.publishedDate));
  const countries = new Set();
  for (const row of themeRows) {
    for (const country of row.countries || []) countries.add(country);
  }

  const sourceCounts = new Map();
  for (const row of themeRows) {
    sourceCounts.set(row.source, (sourceCounts.get(row.source) || 0) + 1);
  }

  const currentKeywordStats = buildKeywordStats(themeRows);
  const previousKeywordStats = buildKeywordStats(previousRows);
  let newKeywordCount = 0;
  for (const keyword of currentKeywordStats.keys()) {
    if (!previousKeywordStats.has(keyword)) newKeywordCount += 1;
  }

  const currentReferenceCount = articleCount / coverageRatio;
  const previousReferenceCount = previousRows.length / coverageRatio;
  const yearAgoReferenceCount = yearAgoRows.length / coverageRatio;
  const threeYearAgoReferenceCount = threeYearAgoRows.length / coverageRatio;
  const previousPreviousCount = previousPreviousRows.length / coverageRatio;

  const vsPreviousPeriodPct = percentageChange(currentReferenceCount, previousReferenceCount);
  const vsYearAgoPct = percentageChange(currentReferenceCount, yearAgoReferenceCount);
  const vs3YearAgoPct = percentageChange(currentReferenceCount, threeYearAgoReferenceCount);
  const previousGrowthPct = percentageChange(previousReferenceCount, previousPreviousCount);
  const trendAcceleration = Number((vsPreviousPeriodPct - previousGrowthPct).toFixed(4));
  const sourceDiversity = computeSourceDiversity(sourceCounts);
  const recurrenceRatio = Number((uniquePublicationDays.size / effectiveDays).toFixed(4));
  const themeSharePct = Number(((articleCount / Math.max(allRows.length, 1)) * 100).toFixed(4));
  const meanConfidence = Number((
    themeRows.reduce((sum, row) => sum + asNumber(row.themeConfidence, 0), 0) / Math.max(articleCount, 1)
  ).toFixed(4));
  const noveltyScore = Number((currentKeywordStats.size > 0 ? newKeywordCount / currentKeywordStats.size : 0).toFixed(4));

  const lifecycle = classifyLifecycle({
    annualizedArticleCount,
    vsPreviousPeriodPct,
    vsYearAgoPct,
    trendAcceleration,
    sourceDiversity,
    recurrenceRatio,
    noveltyScore,
    themeSharePct,
  });

  return {
    theme,
    themeLabel,
    parentTheme,
    category,
    periodType,
    periodStart: formatDateUtc(window.naturalStart),
    periodEnd: formatDateUtc(window.effectiveEnd),
    articleCount,
    runRateArticleCount: Number(runRateArticleCount.toFixed(4)),
    annualizedArticleCount: Number(annualizedArticleCount.toFixed(4)),
    periodProgressRatio: Number(window.coverageRatio.toFixed(4)),
    themeSharePct,
    uniqueSources: uniqueSources.size,
    uniqueKeywords: currentKeywordStats.size,
    geographicSpread: countries.size,
    sourceDiversity,
    recurrenceRatio,
    meanConfidence,
    noveltyScore,
    vsPreviousPeriodPct,
    vsYearAgoPct,
    vs3YearAgoPct,
    trendAcceleration,
    lifecycleStage: lifecycle.stage,
    lifecycleConfidence: lifecycle.confidence,
    lifecycleReasons: lifecycle.reasons,
    metadata: {
      naturalPeriodStart: formatDateUtc(window.naturalStart),
      naturalPeriodEnd: formatDateUtc(window.naturalEnd),
      effectiveDays,
      naturalDays: window.naturalDays,
      sourceBreakdown: topEntries(sourceCounts, 8),
      topKeywords: topEntries(currentKeywordStats, 12),
      comparisonCounts: {
        current: Number(currentReferenceCount.toFixed(4)),
        previous: Number(previousReferenceCount.toFixed(4)),
        yearAgo: Number(yearAgoReferenceCount.toFixed(4)),
        threeYearAgo: Number(threeYearAgoReferenceCount.toFixed(4)),
      },
    },
  };
}

async function upsertAggregate(client, record) {
  await client.query(`
    INSERT INTO theme_trend_aggregates (
      theme, theme_label, parent_theme, category, period_type, period_start, period_end, article_count, run_rate_article_count,
      annualized_article_count, period_progress_ratio, theme_share_pct, unique_sources,
      unique_keywords, geographic_spread, source_diversity, recurrence_ratio, mean_confidence,
      novelty_score, vs_previous_period_pct, vs_year_ago_pct, vs_3year_ago_pct, trend_acceleration,
      lifecycle_stage, lifecycle_confidence, metadata, computed_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6::date, $7::date, $8, $9,
      $10, $11, $12, $13,
      $14, $15, $16, $17, $18,
      $19, $20, $21, $22, $23,
      $24, $25, $26::jsonb, NOW()
    )
    ON CONFLICT (theme, period_type, period_start) DO UPDATE SET
      theme_label = EXCLUDED.theme_label,
      parent_theme = EXCLUDED.parent_theme,
      category = EXCLUDED.category,
      period_end = EXCLUDED.period_end,
      article_count = EXCLUDED.article_count,
      run_rate_article_count = EXCLUDED.run_rate_article_count,
      annualized_article_count = EXCLUDED.annualized_article_count,
      period_progress_ratio = EXCLUDED.period_progress_ratio,
      theme_share_pct = EXCLUDED.theme_share_pct,
      unique_sources = EXCLUDED.unique_sources,
      unique_keywords = EXCLUDED.unique_keywords,
      geographic_spread = EXCLUDED.geographic_spread,
      source_diversity = EXCLUDED.source_diversity,
      recurrence_ratio = EXCLUDED.recurrence_ratio,
      mean_confidence = EXCLUDED.mean_confidence,
      novelty_score = EXCLUDED.novelty_score,
      vs_previous_period_pct = EXCLUDED.vs_previous_period_pct,
      vs_year_ago_pct = EXCLUDED.vs_year_ago_pct,
      vs_3year_ago_pct = EXCLUDED.vs_3year_ago_pct,
      trend_acceleration = EXCLUDED.trend_acceleration,
      lifecycle_stage = EXCLUDED.lifecycle_stage,
      lifecycle_confidence = EXCLUDED.lifecycle_confidence,
      metadata = EXCLUDED.metadata,
      computed_at = NOW()
  `, [
    record.theme,
    record.themeLabel,
    record.parentTheme,
    record.category,
    record.periodType,
    record.periodStart,
    record.periodEnd,
    record.articleCount,
    record.runRateArticleCount,
    record.annualizedArticleCount,
    record.periodProgressRatio,
    record.themeSharePct,
    record.uniqueSources,
    record.uniqueKeywords,
    record.geographicSpread,
    record.sourceDiversity,
    record.recurrenceRatio,
    record.meanConfidence,
    record.noveltyScore,
    record.vsPreviousPeriodPct,
    record.vsYearAgoPct,
    record.vs3YearAgoPct,
    record.trendAcceleration,
    record.lifecycleStage,
    record.lifecycleConfidence,
    JSON.stringify({
      ...record.metadata,
      themeLabel: record.themeLabel,
      parentTheme: record.parentTheme,
      category: record.category,
      lifecycleReasons: record.lifecycleReasons,
    }),
  ]);
}

async function upsertTransition(client, theme, periodType, periodEnd, transition) {
  await client.query(`
    INSERT INTO theme_lifecycle_transitions (
      theme, period_type, transitioned_at, from_stage, to_stage, direction, distance,
      annualized_article_count, vs_previous_period_pct, vs_year_ago_pct, trend_acceleration,
      confidence, metadata, created_at
    )
    VALUES (
      $1, $2, $3::date, $4, $5, $6, $7,
      $8, $9, $10, $11,
      $12, $13::jsonb, NOW()
    )
    ON CONFLICT (theme, period_type, transitioned_at) DO UPDATE SET
      from_stage = EXCLUDED.from_stage,
      to_stage = EXCLUDED.to_stage,
      direction = EXCLUDED.direction,
      distance = EXCLUDED.distance,
      annualized_article_count = EXCLUDED.annualized_article_count,
      vs_previous_period_pct = EXCLUDED.vs_previous_period_pct,
      vs_year_ago_pct = EXCLUDED.vs_year_ago_pct,
      trend_acceleration = EXCLUDED.trend_acceleration,
      confidence = EXCLUDED.confidence,
      metadata = EXCLUDED.metadata
  `, [
    theme,
    periodType,
    periodEnd,
    transition.fromStage,
    transition.toStage,
    transition.direction,
    transition.distance,
    transition.metrics.annualizedArticleCount,
    transition.metrics.vsPreviousPeriodPct,
    transition.metrics.vsYearAgoPct,
    transition.metrics.trendAcceleration,
    transition.confidence,
    JSON.stringify({
      reason: transition.reason,
      metrics: transition.metrics,
    }),
  ]);
}

async function refreshThemeEvolution(client, periodTypes, themes = []) {
  for (const periodType of periodTypes) {
    const params = [periodType];
    const themeFilter = Array.isArray(themes) && themes.length > 0
      ? `AND b.theme = ANY($2::text[])`
      : '';
    if (themes.length > 0) params.push(themes);

    await client.query(`
      WITH latest AS (
        SELECT *
        FROM (
          SELECT
            theme,
            theme_label,
            parent_theme,
            category,
            period_type,
            period_start,
            period_end,
            article_count,
            trend_acceleration,
            lifecycle_stage,
            vs_previous_period_pct,
            ROW_NUMBER() OVER (
              PARTITION BY theme, period_type, period_start
              ORDER BY computed_at DESC
            ) AS rn
          FROM theme_trend_aggregates
          WHERE period_type = $1
        ) ranked
        WHERE rn = 1
      ),
      base AS (
        SELECT *
        FROM latest b
        WHERE COALESCE(NULLIF(b.parent_theme, ''), b.theme) <> b.theme
          ${themeFilter}
      ),
      totals AS (
        SELECT
          parent_theme,
          period_type,
          period_start,
          SUM(article_count)::float AS total_count
        FROM base
        GROUP BY parent_theme, period_type, period_start
      ),
      ranked AS (
        SELECT
          b.parent_theme,
          b.theme AS sub_theme,
          b.theme_label,
          b.category,
          b.period_type,
          b.period_start,
          b.period_end,
          b.article_count,
          CASE
            WHEN COALESCE(t.total_count, 0) > 0
              THEN (b.article_count::float / t.total_count::float) * 100
            ELSE 0
          END AS share_pct,
          DENSE_RANK() OVER (
            PARTITION BY b.parent_theme, b.period_type, b.period_start
            ORDER BY b.article_count DESC, b.theme
          ) AS rank_in_parent,
          b.trend_acceleration AS acceleration,
          b.lifecycle_stage,
          b.vs_previous_period_pct AS momentum_score
        FROM base b
        JOIN totals t
          ON t.parent_theme = b.parent_theme
         AND t.period_type = b.period_type
         AND t.period_start = b.period_start
      )
      INSERT INTO theme_evolution (
        parent_theme, sub_theme, theme_label, category, period_type, period_start, period_end,
        article_count, share_pct, rank_in_parent, acceleration, lifecycle_stage, momentum_score,
        metadata, computed_at
      )
      SELECT
        parent_theme, sub_theme, theme_label, category, period_type, period_start, period_end,
        article_count, share_pct, rank_in_parent, acceleration, lifecycle_stage, momentum_score,
        jsonb_build_object('source', 'theme_trend_aggregates'), NOW()
      FROM ranked
      ON CONFLICT (parent_theme, sub_theme, period_type, period_start) DO UPDATE SET
        theme_label = EXCLUDED.theme_label,
        category = EXCLUDED.category,
        period_end = EXCLUDED.period_end,
        article_count = EXCLUDED.article_count,
        share_pct = EXCLUDED.share_pct,
        rank_in_parent = EXCLUDED.rank_in_parent,
        acceleration = EXCLUDED.acceleration,
        lifecycle_stage = EXCLUDED.lifecycle_stage,
        momentum_score = EXCLUDED.momentum_score,
        metadata = EXCLUDED.metadata,
        computed_at = NOW()
    `, params);
  }
}

export async function runTrendAggregation(options = {}) {
  const config = { ...parseArgs([]), ...options };
  const client = new Client(resolveNasPgConfig());
  await client.connect();

  try {
    await ensureEmergingTechSchema(client);
    await ensureArticleAnalysisTables(client);
    await ensureAutoPipelineTables(client);
    await ensureTrendAggregationSchema(client);

    const corpus = await loadArticleCorpus(client, config);
    const rows = corpus.rows;
    const themes = config.themes.length > 0
      ? config.themes
      : Array.from(new Set(rows.map((row) => row.theme))).sort();
    const rowsByTheme = new Map();
    for (const theme of themes) {
      rowsByTheme.set(theme, rows.filter((row) => row.theme === theme));
    }

    const asOfDate = parseDateUtc(config.asOf);
    const summary = {
      asOf: config.asOf,
      earliestLoadedDate: corpus.earliestLoadedDate,
      themesProcessed: themes.length,
      aggregateRows: 0,
      transitions: 0,
      evolutionRows: 0,
      periodTypes: config.periodTypes,
      generatedByTheme: {},
      transitionByTheme: {},
      dryRun: config.dryRun,
    };

    for (const periodType of config.periodTypes) {
      const windows = buildPeriodWindows(asOfDate, periodType, config.historyByPeriod[periodType] || PERIOD_CONFIG[periodType].history);
      for (const theme of themes) {
        const themeRowsAll = rowsByTheme.get(theme) || [];
        let previousStage = null;

        for (const window of windows) {
          const themeRows = buildRowsInWindow(themeRowsAll, window.naturalStart, window.effectiveEnd);
          const allRows = buildRowsInWindow(rows, window.naturalStart, window.effectiveEnd);
          const previousWindow = createComparableWindow(window, periodType, 'prev');
          const yearAgoWindow = createComparableWindow(window, periodType, 'yearAgo');
          const threeYearAgoWindow = createComparableWindow(window, periodType, 'threeYearAgo');
          const previousRows = buildRowsInWindow(themeRowsAll, previousWindow.naturalStart, previousWindow.effectiveEnd);
          const previousPreviousWindow = createComparableWindow(previousWindow, periodType, 'prev');
          const previousPreviousRows = buildRowsInWindow(themeRowsAll, previousPreviousWindow.naturalStart, previousPreviousWindow.effectiveEnd);
          const yearAgoRows = buildRowsInWindow(themeRowsAll, yearAgoWindow.naturalStart, yearAgoWindow.effectiveEnd);
          const threeYearAgoRows = buildRowsInWindow(themeRowsAll, threeYearAgoWindow.naturalStart, threeYearAgoWindow.effectiveEnd);

          const record = computeAggregateRecord({
            theme,
            periodType,
            window,
            themeRows,
            allRows,
            previousRows,
            previousPreviousRows,
            yearAgoRows,
            threeYearAgoRows,
          });

          if (!config.dryRun) {
            await upsertAggregate(client, record);
          }
          summary.aggregateRows += 1;
          summary.generatedByTheme[theme] = (summary.generatedByTheme[theme] || 0) + 1;

          const transition = buildLifecycleTransition(previousStage, record.lifecycleStage, {
            annualizedArticleCount: record.annualizedArticleCount,
            vsPreviousPeriodPct: record.vsPreviousPeriodPct,
            vsYearAgoPct: record.vsYearAgoPct,
            trendAcceleration: record.trendAcceleration,
            sourceDiversity: record.sourceDiversity,
            recurrenceRatio: record.recurrenceRatio,
            noveltyScore: record.noveltyScore,
            themeSharePct: record.themeSharePct,
            confidence: record.lifecycleConfidence,
            reasons: record.lifecycleReasons,
          });

          if (transition) {
            if (!config.dryRun) {
              await upsertTransition(client, theme, periodType, record.periodEnd, transition);
            }
            summary.transitions += 1;
            summary.transitionByTheme[theme] = (summary.transitionByTheme[theme] || 0) + 1;
          }

          previousStage = record.lifecycleStage;
        }
      }
    }

    if (!config.dryRun) {
      await refreshThemeEvolution(client, config.periodTypes, config.themes);
    }
    summary.evolutionRows = config.periodTypes.length;

    return summary;
  } finally {
    await client.end();
  }
}

async function main() {
  const summary = await runTrendAggregation(parseArgs());
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
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
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
    process.exit(1);
  });
}
