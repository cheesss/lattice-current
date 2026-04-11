#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { ensureArticleAnalysisTables } from './_shared/article-analysis-schema.mjs';
import { ensureEmergingTechSchema } from './_shared/schema-emerging-tech.mjs';
import { runCodexJsonPrompt } from './_shared/codex-json.mjs';
import { ensureAutoPipelineTables } from './auto-pipeline.mjs';
import { ensureTrendAggregationSchema, runTrendAggregation } from './compute-trend-aggregates.mjs';
import {
  classifyArticleAgainstTaxonomy,
  getCanonicalParentTheme,
  isCanonicalThemeKey,
  resolveThemeTaxonomy,
} from './_shared/theme-taxonomy.mjs';

loadOptionalEnvFile();

const { Client } = pg;

export const DAILY_CURATED_NEWS_SCHEMA_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS daily_curated_news (
      id BIGSERIAL PRIMARY KEY,
      curated_date DATE NOT NULL,
      rank INTEGER NOT NULL CHECK (rank >= 1 AND rank <= 25),
      article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      theme TEXT,
      parent_theme TEXT,
      category TEXT,
      topic_id TEXT,
      topic_label TEXT,
      importance_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      freshness_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      impact_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      source_quality_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      novelty_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      coverage_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      signal_alignment_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      one_line_summary TEXT,
      why_it_matters TEXT,
      related_topics TEXT[] NOT NULL DEFAULT '{}'::text[],
      related_signals JSONB NOT NULL DEFAULT '{}'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      summarized_by TEXT NOT NULL DEFAULT 'deterministic',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (curated_date, rank),
      UNIQUE (curated_date, article_id)
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_daily_curated_news_date
      ON daily_curated_news (curated_date DESC, rank ASC);
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_daily_curated_news_theme
      ON daily_curated_news (theme, curated_date DESC);
  `,
];

const SOURCE_WEIGHTS = {
  reuters: 0.98,
  bloomberg: 0.97,
  ap: 0.95,
  ft: 0.95,
  wsj: 0.94,
  nyt: 0.91,
  economist: 0.92,
  guardian: 0.89,
  arxiv: 0.92,
  hackernews: 0.76,
  gdelt: 0.54,
};

const LIFECYCLE_WEIGHTS = {
  nascent: 0.45,
  emerging: 0.74,
  growing: 0.9,
  mainstream: 0.62,
  declining: 0.18,
};
const CODEX_CURATION_TIMEOUT_MS = 45_000;
const AGGREGATE_REFRESH_FRESHNESS_MS = 6 * 60 * 60 * 1000;

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

function trimText(value, limit = 140) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}...`;
}

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)));
  }
  if (typeof value === 'string') {
    try {
      return normalizeArray(JSON.parse(value));
    } catch {
      return normalizeArray(value.split(','));
    }
  }
  return [];
}

function normalizeSource(source) {
  return String(source || '').trim().toLowerCase();
}

function looksLikeDiscoveryTopic(value) {
  return /^dt-[a-z0-9]+$/i.test(String(value || '').trim());
}

function sourceWeight(source) {
  const normalized = normalizeSource(source);
  if (!normalized) return 0.66;
  if (SOURCE_WEIGHTS[normalized]) return SOURCE_WEIGHTS[normalized];
  if (normalized.includes('reuters')) return SOURCE_WEIGHTS.reuters;
  if (normalized.includes('bloomberg')) return SOURCE_WEIGHTS.bloomberg;
  if (normalized.includes('financial')) return SOURCE_WEIGHTS.ft;
  if (normalized.includes('journal')) return SOURCE_WEIGHTS.wsj;
  if (normalized.includes('hacker')) return SOURCE_WEIGHTS.hackernews;
  if (normalized.includes('arxiv')) return SOURCE_WEIGHTS.arxiv;
  return 0.68;
}

function normalizePctToUnit(value, minPct = -20, maxPct = 180) {
  const numeric = asNumber(value, 0);
  if (numeric <= minPct) return 0;
  if (numeric >= maxPct) return 1;
  return (numeric - minPct) / (maxPct - minPct);
}

function stageWeight(stage) {
  return LIFECYCLE_WEIGHTS[String(stage || '').trim().toLowerCase()] ?? 0.36;
}

function computeFreshnessScore(publishedAt, asOfDate) {
  const publishedMs = new Date(publishedAt).getTime();
  const asOfMs = new Date(`${asOfDate}T23:59:59.999Z`).getTime();
  if (!Number.isFinite(publishedMs) || !Number.isFinite(asOfMs)) return 0;
  const ageHours = Math.max(0, (asOfMs - publishedMs) / 3_600_000);
  return Number(Math.exp(-ageHours / 20).toFixed(4));
}

function buildSignalPreference(theme) {
  const normalized = String(theme || '').toLowerCase();
  if (/(conflict|geopolit|sanction|defense|diplom)/.test(normalized)) {
    return ['vix', 'marketStress', 'oilPrice', 'eventIntensity'];
  }
  if (/(macro|inflation|monetary|trade|econom)/.test(normalized)) {
    return ['yieldSpread', 'hy_credit_spread', 'dollarIndex', 'marketStress'];
  }
  if (/(energy|resource|climate|food|agri)/.test(normalized)) {
    return ['oilPrice', 'dollarIndex', 'marketStress'];
  }
  return ['marketStress', 'transmissionStrength', 'dollarIndex'];
}

export async function ensureDailyCuratedNewsSchema(queryable) {
  for (const statement of DAILY_CURATED_NEWS_SCHEMA_STATEMENTS) {
    await queryable.query(statement);
  }
}

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    asOf: new Date().toISOString().slice(0, 10),
    limit: 5,
    candidateLimit: 250,
    windowHours: 48,
    refreshAggregates: false,
    themes: [],
    codexOnly: false,
    noCodex: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--as-of' && argv[index + 1]) {
      parsed.asOf = toDateOnly(argv[++index]);
    } else if (arg === '--limit' && argv[index + 1]) {
      parsed.limit = Math.max(1, Math.min(25, Math.floor(asNumber(argv[++index], parsed.limit))));
    } else if (arg === '--candidate-limit' && argv[index + 1]) {
      parsed.candidateLimit = Math.max(parsed.limit, Math.floor(asNumber(argv[++index], parsed.candidateLimit)));
    } else if (arg === '--window-hours' && argv[index + 1]) {
      parsed.windowHours = Math.max(6, Math.floor(asNumber(argv[++index], parsed.windowHours)));
    } else if (arg === '--theme' && argv[index + 1]) {
      parsed.themes = argv[++index].split(',').map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
    } else if (arg === '--refresh-aggregates') {
      parsed.refreshAggregates = true;
    } else if (arg === '--codex-only') {
      parsed.codexOnly = true;
    } else if (arg === '--no-codex') {
      parsed.noCodex = true;
    }
  }

  return parsed;
}

async function loadCandidateArticles(client, config) {
  const params = [`${config.asOf}T23:59:59.999Z`, `${config.windowHours} hours`, config.candidateLimit];
  const conditions = [
    `a.published_at >= ($1::timestamptz - $2::interval)`,
    `COALESCE(NULLIF(t.theme_key, ''), NULLIF(t.auto_theme, 'unknown'), NULLIF(dr.parent_theme, ''), NULLIF(a.theme, ''), 'unknown') <> 'unknown'`,
  ];
  if (config.themes.length > 0) {
    params.push(config.themes);
    conditions.push(`COALESCE(NULLIF(t.theme_key, ''), NULLIF(t.auto_theme, 'unknown'), NULLIF(dr.parent_theme, ''), NULLIF(a.theme, ''), 'unknown') = ANY($${params.length}::text[])`);
  }

  const { rows } = await client.query(`
    WITH discovery_ranked AS (
      SELECT
        dta.article_id,
        dt.id AS topic_id,
        COALESCE(NULLIF(dt.label, ''), dt.id) AS topic_label,
        dt.parent_theme,
        dt.category,
        dt.novelty,
        dt.momentum,
        dt.research_momentum,
        dt.source_quality_score,
        ROW_NUMBER() OVER (
          PARTITION BY dta.article_id
          ORDER BY dt.momentum DESC NULLS LAST, dt.updated_at DESC NULLS LAST
        ) AS row_rank
      FROM discovery_topic_articles dta
      JOIN discovery_topics dt ON dt.id = dta.topic_id
    )
    SELECT
      a.id,
      a.title,
      a.summary,
      a.url,
      LOWER(COALESCE(a.source, 'unknown')) AS source,
      a.published_at,
      COALESCE(NULLIF(t.theme_key, ''), NULLIF(t.auto_theme, 'unknown'), NULLIF(dr.parent_theme, ''), NULLIF(a.theme, ''), 'unknown') AS theme,
      COALESCE(NULLIF(t.parent_theme, ''), NULLIF(dr.parent_theme, ''), COALESCE(NULLIF(t.theme_key, ''), NULLIF(t.auto_theme, 'unknown'), 'unknown')) AS parent_theme,
      COALESCE(NULLIF(t.theme_category, ''), NULLIF(dr.category, ''), 'other') AS category,
      COALESCE(t.confidence, 0) AS theme_confidence,
      dr.topic_id,
      dr.topic_label,
      COALESCE(dr.novelty, 0) AS topic_novelty,
      COALESCE(dr.momentum, 0) AS topic_momentum,
      COALESCE(dr.research_momentum, 0) AS research_momentum,
      COALESCE(dr.source_quality_score, 0) AS topic_source_quality,
      COALESCE(aa.keywords, ARRAY[]::text[]) AS keywords
    FROM articles a
    LEFT JOIN auto_article_themes t ON t.article_id = a.id
    LEFT JOIN discovery_ranked dr ON dr.article_id = a.id AND dr.row_rank = 1
    LEFT JOIN article_analysis aa ON aa.article_id = a.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY a.published_at DESC, a.id DESC
    LIMIT $3
  `, params);

  return rows.map((row) => ({
    id: Number(row.id),
    title: String(row.title || '').trim(),
    summary: String(row.summary || '').trim(),
    url: String(row.url || '').trim(),
    source: normalizeSource(row.source),
    publishedAt: row.published_at,
    theme: String(row.theme || 'unknown').trim().toLowerCase(),
    parentTheme: String(row.parent_theme || row.theme || 'unknown').trim().toLowerCase(),
    category: String(row.category || resolveThemeTaxonomy(row.theme).category || 'other').trim().toLowerCase(),
    themeConfidence: clamp(row.theme_confidence, 0, 1),
    topicId: row.topic_id ? String(row.topic_id) : null,
    topicLabel: row.topic_label ? String(row.topic_label) : null,
    topicNovelty: clamp(row.topic_novelty, 0, 1),
    topicMomentum: asNumber(row.topic_momentum, 0),
    researchMomentum: asNumber(row.research_momentum, 0),
    topicSourceQuality: clamp(row.topic_source_quality, 0, 1),
    keywords: normalizeArray(row.keywords).slice(0, 12),
  })).map((row) => {
    const taxonomyFallback = resolveThemeTaxonomy(looksLikeDiscoveryTopic(row.theme) ? (row.topicLabel || row.theme) : row.theme);
    const dynamicClassification = (looksLikeDiscoveryTopic(row.theme) || row.category === 'other')
      ? classifyArticleAgainstTaxonomy({
        title: row.title,
        source: row.source,
        keywords: row.keywords,
        embeddingTheme: row.topicLabel || row.theme,
        embeddingSimilarity: row.themeConfidence,
      })
      : null;
    const reclassifiedTheme = dynamicClassification?.theme && dynamicClassification.theme !== 'unknown'
      ? dynamicClassification.theme
      : null;
    const reclassifiedMeta = reclassifiedTheme ? resolveThemeTaxonomy(reclassifiedTheme) : taxonomyFallback;
    const canonicalTheme = reclassifiedTheme
      || (looksLikeDiscoveryTopic(row.theme) && taxonomyFallback.themeKey
        ? taxonomyFallback.themeKey
        : row.theme);
    const canonicalMeta = resolveThemeTaxonomy(canonicalTheme);
    if (!canonicalMeta.themeKey || !isCanonicalThemeKey(canonicalMeta.themeKey)) {
      return null;
    }
    return {
      ...row,
      theme: canonicalMeta.themeKey,
      parentTheme: getCanonicalParentTheme(row.parentTheme)
        || canonicalMeta.parentTheme
        || reclassifiedMeta.parentTheme
        || row.parentTheme,
      category: canonicalMeta.category
        || reclassifiedMeta.category
        || (row.category === 'other' && taxonomyFallback.category
          ? taxonomyFallback.category
          : row.category),
      themeConfidence: reclassifiedTheme
        ? Math.max(row.themeConfidence, dynamicClassification.confidence || 0)
        : row.themeConfidence,
    };
  }).filter(Boolean);
}

async function loadLatestTrendContext(client, themes) {
  if (!themes.length) return {};
  const { rows } = await client.query(`
    SELECT DISTINCT ON (theme, period_type)
      theme,
      period_type,
      lifecycle_stage,
      annualized_article_count,
      novelty_score,
      vs_previous_period_pct,
      vs_year_ago_pct,
      trend_acceleration
    FROM theme_trend_aggregates
    WHERE theme = ANY($1::text[])
      AND period_type IN ('week', 'month', 'quarter')
    ORDER BY theme, period_type, period_start DESC, computed_at DESC
  `, [themes]);

  const context = {};
  for (const row of rows) {
    const theme = String(row.theme || '').trim().toLowerCase();
    if (!context[theme]) context[theme] = {};
    context[theme][String(row.period_type || '').trim().toLowerCase()] = row;
  }
  return context;
}

async function shouldRefreshTrendAggregates(client, asOfDate, periodTypes = ['week', 'month', 'quarter']) {
  const { rows } = await client.query(`
    SELECT period_type, MAX(computed_at) AS computed_at
         , MAX(period_end) AS period_end
    FROM theme_trend_aggregates
    WHERE period_type = ANY($2::text[])
    GROUP BY period_type
  `, [asOfDate, periodTypes]).catch(() => ({ rows: [] }));

  if (rows.length < periodTypes.length) return true;
  const now = Date.now();
  const targetMs = new Date(`${asOfDate}T00:00:00.000Z`).getTime();
  for (const row of rows) {
    const computedAt = new Date(row.computed_at).getTime();
    const periodEnd = new Date(row.period_end).getTime();
    const closeEnoughToTarget = Number.isFinite(targetMs) && Number.isFinite(periodEnd)
      ? Math.abs(periodEnd - targetMs) <= (36 * 60 * 60 * 1000)
      : false;
    if (!Number.isFinite(computedAt) || (now - computedAt) > AGGREGATE_REFRESH_FRESHNESS_MS || !closeEnoughToTarget) {
      return true;
    }
  }
  return false;
}

async function loadLatestSignals(client) {
  const { rows } = await client.query(`
    SELECT DISTINCT ON (signal_name) signal_name, value, ts
    FROM signal_history
    ORDER BY signal_name, ts DESC
  `).catch(() => ({ rows: [] }));
  return Object.fromEntries(rows.map((row) => [
    String(row.signal_name || ''),
    { value: asNumber(row.value, 0), ts: row.ts },
  ]));
}

function scoreCandidates(candidates, trendContext, signals, config) {
  const themeCounts = new Map();
  const keywordCounts = new Map();
  for (const candidate of candidates) {
    themeCounts.set(candidate.theme, (themeCounts.get(candidate.theme) || 0) + 1);
    for (const keyword of candidate.keywords) {
      keywordCounts.set(keyword, (keywordCounts.get(keyword) || 0) + 1);
    }
  }

  return candidates.map((candidate) => {
    const week = trendContext[candidate.theme]?.week || {};
    const month = trendContext[candidate.theme]?.month || {};
    const quarter = trendContext[candidate.theme]?.quarter || {};
    const relatedSignals = Object.fromEntries(
      buildSignalPreference(candidate.theme)
        .filter((signalName) => signals[signalName])
        .map((signalName) => [signalName, signals[signalName]]),
    );
    const freshnessScore = computeFreshnessScore(candidate.publishedAt, config.asOf);
    const impactScore = Number(clamp(
      stageWeight(week.lifecycle_stage || month.lifecycle_stage || quarter.lifecycle_stage) * 0.28
      + normalizePctToUnit(week.vs_previous_period_pct, -20, 120) * 0.18
      + normalizePctToUnit(month.vs_previous_period_pct, -20, 140) * 0.16
      + normalizePctToUnit(month.vs_year_ago_pct, -20, 180) * 0.18
      + normalizePctToUnit(quarter.trend_acceleration, -40, 80) * 0.1
      + clamp(Math.log10(asNumber(quarter.annualized_article_count, 0) + 1) / 4, 0, 1) * 0.1,
      0,
      1,
    ).toFixed(4));
    const sourceQualityScore = Number(clamp(
      sourceWeight(candidate.source) * 0.5
      + candidate.themeConfidence * 0.2
      + candidate.topicSourceQuality * 0.2
      + (candidate.source === 'arxiv' ? 0.1 : 0),
      0,
      1,
    ).toFixed(4));
    const noveltyScore = Number(clamp(
      candidate.topicNovelty * 0.4
      + clamp(asNumber(week.novelty_score, month.novelty_score), 0, 1) * 0.35
      + (
        candidate.keywords.length > 0
          ? candidate.keywords.reduce((sum, keyword) => sum + (1 / Math.max(1, keywordCounts.get(keyword) || 1)), 0) / candidate.keywords.length
          : 0
      ) * 0.25,
      0,
      1,
    ).toFixed(4));
    const coverageScore = Number(clamp(
      clamp((themeCounts.get(candidate.theme) || 0) / 8, 0, 1) * 0.65
      + (candidate.topicId ? 0.2 : 0)
      + (candidate.keywords.length > 0 ? 0.15 : 0),
      0,
      1,
    ).toFixed(4));
    const signalAlignmentScore = Number(clamp(
      Object.keys(relatedSignals).length / 4,
      0,
      1,
    ).toFixed(4));
    const taxonomyPenalty = looksLikeDiscoveryTopic(candidate.theme) ? 0.68 : 1;
    const categoryPenalty = candidate.category === 'other' ? 0.82 : 1;
    const importanceScore = Number(clamp(
      freshnessScore * 0.22
      + impactScore * 0.28
      + sourceQualityScore * 0.16
      + noveltyScore * 0.18
      + coverageScore * 0.1
      + signalAlignmentScore * 0.06,
      0,
      1,
    ).toFixed(4)) * taxonomyPenalty * categoryPenalty;

    return {
      ...candidate,
      relatedSignals,
      freshnessScore,
      impactScore,
      sourceQualityScore,
      noveltyScore,
      coverageScore,
      signalAlignmentScore,
      importanceScore: Number(importanceScore.toFixed(4)),
      lifecycleStage: String(week.lifecycle_stage || month.lifecycle_stage || quarter.lifecycle_stage || 'nascent'),
      trendWeek: week,
      trendMonth: month,
    };
  }).sort((left, right) => right.importanceScore - left.importanceScore || right.impactScore - left.impactScore);
}

function selectCuratedItems(scored, limit) {
  const selected = [];
  const seenTitles = new Set();
  const perTheme = new Map();
  const perCategory = new Map();

  const prioritized = [
    ...scored.filter((item) => item.category !== 'other'),
    ...scored.filter((item) => item.category === 'other'),
  ];

  for (const item of prioritized) {
    if (selected.length >= limit) break;
    const titleKey = trimText(item.title.toLowerCase(), 180);
    if (seenTitles.has(titleKey)) continue;
    if ((perTheme.get(item.theme) || 0) >= 2) continue;
    if ((perCategory.get(item.category) || 0) >= 2) continue;
    selected.push(item);
    seenTitles.add(titleKey);
    perTheme.set(item.theme, (perTheme.get(item.theme) || 0) + 1);
    perCategory.set(item.category, (perCategory.get(item.category) || 0) + 1);
  }

  for (const item of prioritized) {
    if (selected.length >= limit) break;
    const titleKey = trimText(item.title.toLowerCase(), 180);
    if (seenTitles.has(titleKey)) continue;
    selected.push(item);
    seenTitles.add(titleKey);
  }
  return selected.slice(0, limit);
}

function buildDeterministicNarrative(item) {
  const weeklyChange = asNumber(item.trendWeek?.vs_previous_period_pct, item.trendMonth?.vs_previous_period_pct);
  const yoyChange = asNumber(item.trendMonth?.vs_year_ago_pct, 0);
  return {
    oneLineSummary: trimText(`${item.title}`, 120),
    whyItMatters: trimText(
      `${item.theme.replace(/-/g, ' ')} is currently in ${item.lifecycleStage} stage. Coverage is ${weeklyChange >= 0 ? 'up' : 'down'} ${Math.abs(weeklyChange).toFixed(0)}% versus the prior window and ${yoyChange >= 0 ? 'up' : 'down'} ${Math.abs(yoyChange).toFixed(0)}% year over year.`,
      220,
    ),
    relatedTopics: Array.from(new Set([item.theme, item.topicLabel, ...item.keywords.slice(0, 4)].filter(Boolean))),
  };
}

function buildCodexPrompt(curatedDate, items) {
  return [
    'Summarize curated articles for a long-horizon trend intelligence dashboard.',
    'You are writing low-noise monitoring blurbs, not market calls.',
    '',
    'For each item, analyze:',
    '1. What changed or became newly visible',
    '2. Why this matters for structural monitoring',
    '3. Which related topics should stay linked to this item',
    '',
    'Rules:',
    '- Keep one_line_summary under 120 characters and focused on the actual change.',
    '- why_it_matters must explain structural significance or monitoring relevance, not price prediction.',
    '- related_topics must come from the supplied theme, topic, or keywords.',
    '- Return one object per supplied articleId.',
    '',
    'Output rules:',
    '- Return strict JSON only as an array.',
    '- Do not include markdown or commentary outside JSON.',
    '- Each item must use this schema exactly.',
    '',
    'Schema:',
    '{"articleId":123,"one_line_summary":"under 120 chars","why_it_matters":"1-2 sentences","related_topics":["topic-a","topic-b"]}',
    'Do not make trading calls. Focus on structural change, durability, and monitoring significance.',
    `Curated date: ${curatedDate}`,
    ...items.map((item, index) => [
      `Item ${index + 1}`,
      `articleId: ${item.id}`,
      `theme: ${item.theme}`,
      `topic: ${item.topicLabel || item.topicId || ''}`,
      `title: ${item.title}`,
      `summary: ${item.summary || ''}`,
      `source: ${item.source}`,
      `lifecycle: ${item.lifecycleStage}`,
      `importanceScore: ${item.importanceScore}`,
      `weeklyDelta: ${asNumber(item.trendWeek?.vs_previous_period_pct, 0)}`,
      `monthlyYoY: ${asNumber(item.trendMonth?.vs_year_ago_pct, 0)}`,
      `keywords: ${item.keywords.join(', ')}`,
    ].join('\n')),
  ].join('\n\n');
}

async function enrichNarratives(items, config) {
  const fallback = Object.fromEntries(items.map((item) => [item.id, buildDeterministicNarrative(item)]));
  if (config.noCodex) {
    return Object.fromEntries(Object.entries(fallback).map(([key, value]) => [key, { ...value, summarizedBy: 'deterministic' }]));
  }
  const response = await runCodexJsonPrompt(buildCodexPrompt(config.asOf, items), CODEX_CURATION_TIMEOUT_MS, {
    label: 'curate-daily-news',
    asOf: config.asOf,
  });
  if (!Array.isArray(response.parsed)) {
    if (config.codexOnly) return {};
    return Object.fromEntries(Object.entries(fallback).map(([key, value]) => [key, { ...value, summarizedBy: 'deterministic' }]));
  }

  const normalized = {};
  for (const row of response.parsed) {
    const articleId = Number(row.articleId ?? row.article_id);
    if (!Number.isFinite(articleId) || !fallback[articleId]) continue;
    normalized[articleId] = {
      oneLineSummary: trimText(row.one_line_summary || row.oneLineSummary || fallback[articleId].oneLineSummary, 120),
      whyItMatters: trimText(row.why_it_matters || row.whyItMatters || fallback[articleId].whyItMatters, 220),
      relatedTopics: normalizeArray(row.related_topics || row.relatedTopics).slice(0, 6),
      summarizedBy: 'codex',
    };
  }

  if (Object.keys(normalized).length === 0 && !config.codexOnly) {
    return Object.fromEntries(Object.entries(fallback).map(([key, value]) => [key, { ...value, summarizedBy: 'deterministic' }]));
  }

  for (const [articleId, narrative] of Object.entries(fallback)) {
    if (!normalized[articleId] && !config.codexOnly) {
      normalized[articleId] = { ...narrative, summarizedBy: 'deterministic' };
    }
  }
  return normalized;
}

async function persistCuratedItems(client, curatedDate, items, narratives) {
  await client.query('BEGIN');
  try {
    await client.query(`DELETE FROM daily_curated_news WHERE curated_date = $1::date`, [curatedDate]);
    for (const [index, item] of items.entries()) {
      const narrative = narratives[item.id] || buildDeterministicNarrative(item);
      await client.query(`
        INSERT INTO daily_curated_news (
          curated_date, rank, article_id, theme, parent_theme, category, topic_id, topic_label,
          importance_score, freshness_score, impact_score, source_quality_score, novelty_score,
          coverage_score, signal_alignment_score, one_line_summary, why_it_matters, related_topics,
          related_signals, metadata, summarized_by, updated_at
        )
        VALUES (
          $1::date, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18::text[],
          $19::jsonb, $20::jsonb, $21, NOW()
        )
      `, [
        curatedDate,
        index + 1,
        item.id,
        item.theme,
        item.parentTheme,
        item.category,
        item.topicId,
        item.topicLabel,
        item.importanceScore,
        item.freshnessScore,
        item.impactScore,
        item.sourceQualityScore,
        item.noveltyScore,
        item.coverageScore,
        item.signalAlignmentScore,
        narrative.oneLineSummary,
        narrative.whyItMatters,
        narrative.relatedTopics || [],
        JSON.stringify(item.relatedSignals || {}),
        JSON.stringify({
          url: item.url,
          title: item.title,
          summary: item.summary,
          keywords: item.keywords,
          lifecycleStage: item.lifecycleStage,
        }),
        narrative.summarizedBy || 'deterministic',
      ]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function runDailyNewsCuration(options = {}) {
  const config = { ...parseArgs([]), ...options };
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    await ensureEmergingTechSchema(client);
    await ensureArticleAnalysisTables(client);
    await ensureAutoPipelineTables(client);
    await ensureTrendAggregationSchema(client);
    await ensureDailyCuratedNewsSchema(client);

    if (config.refreshAggregates && await shouldRefreshTrendAggregates(client, config.asOf)) {
      await runTrendAggregation({ asOf: config.asOf, periodTypes: ['week', 'month', 'quarter'] });
    }

    const candidates = await loadCandidateArticles(client, config);
    const themes = Array.from(new Set(candidates.map((item) => item.theme).filter(Boolean)));
    const trendContext = await loadLatestTrendContext(client, themes);
    const signals = await loadLatestSignals(client);
    const scored = scoreCandidates(candidates, trendContext, signals, config);
    const selected = selectCuratedItems(scored, config.limit);
    const narratives = await enrichNarratives(selected, config);
    await persistCuratedItems(client, config.asOf, selected, narratives);

    return {
      curatedDate: config.asOf,
      candidateCount: candidates.length,
      curatedCount: selected.length,
      items: selected.map((item, index) => ({
        rank: index + 1,
        articleId: item.id,
        theme: item.theme,
        category: item.category,
        importanceScore: item.importanceScore,
      })),
    };
  } finally {
    await client.end();
  }
}

async function main() {
  const summary = await runDailyNewsCuration(parseArgs());
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
